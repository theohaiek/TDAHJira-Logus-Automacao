// Testes dos defeitos de autenticação e banco corrigidos na auditoria.
//
// Todos partem de uma reprodução real: cada um destes falhava antes do
// conserto e o cenário é o que acontece de verdade em uso — duas pessoas
// salvando no mesmo segundo, duas instâncias subindo juntas depois do deploy,
// o administrador recriando um acesso que já existe.
//
//   node --test tests/auditoria-auth-banco.test.js

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

process.env.TDAH_DATA_DIR = mkdtempSync(join(tmpdir(), "tdah-test-"));

const { openDb, all, tx, run, one } = await import("../server/db.js");
const { DB_FILE, DATA_DIR, ROOT } = await import("../server/paths.js");
const { createUser, registrarFalha, podeTentar, limparTentativas, createSession, userFromToken } =
  await import("../server/auth.js");
const { createTask, updateTask } = await import("../server/tasks.js");

let ator;

before(async () => {
  await openDb(DB_FILE);
  const u = await createUser({
    username: "teste",
    displayName: "Teste",
    password: "apenas-para-teste",
  });
  ator = u.id;
});

after(() => {
  try {
    rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {}
});

// --- Transações simultâneas no modo local ----------------------------------

test("três edições no mesmo instante passam todas", async () => {
  const tarefas = await Promise.all([
    createTask({ title: "Uma" }, ator),
    createTask({ title: "Duas" }, ator),
    createTask({ title: "Três" }, ator),
  ]);

  const saidas = await Promise.all(
    tarefas.map((t) => updateTask(t.id, { status: "todo" }, ator))
  );
  for (const t of saidas) assert.equal(t.status, "todo");
});

test("uma transação que falha não trava as seguintes", async () => {
  await assert.rejects(async () => {
    await tx(async () => {
      await run("UPDATE tasks SET title = ? WHERE id = ?", ["não vai ficar", 1]);
      throw new Error("desisti no meio");
    });
  }, /desisti no meio/);

  const t = await createTask({ title: "Depois da falha" }, ator);
  assert.equal(t.title, "Depois da falha");
});

test("o rollback desfaz o que a transação interrompida escreveu", async () => {
  const t = await createTask({ title: "Título original" }, ator);
  await assert.rejects(async () => {
    await tx(async () => {
      await run("UPDATE tasks SET title = ? WHERE id = ?", ["rasurado", t.id]);
      throw new Error("interrompida");
    });
  });
  const linha = await one("SELECT title FROM tasks WHERE id = ?", [t.id]);
  assert.equal(linha.title, "Título original");
});

// --- Migração aplicada por duas instâncias ao mesmo tempo -------------------

test("duas aberturas simultâneas de um banco antigo não brigam pela coluna nova", async () => {
  // Banco no formato anterior ao commit que criou "kind": é o que existe em
  // produção quando a versão nova sobe.
  const antes = readFileSync(join(ROOT, "core", "schema.sql"), "utf8")
    .split("\n")
    .filter((l) => !/^\s*kind\s+TEXT\s+NOT NULL DEFAULT 'task'/.test(l))
    .join("\n");

  const pasta = mkdtempSync(join(tmpdir(), "tdah-antigo-"));
  const arquivo = join(pasta, "dados", "tdah.db");
  mkdirSync(dirname(arquivo), { recursive: true });

  const { DatabaseSync } = await import("node:sqlite");
  const antigo = new DatabaseSync(arquivo);
  antigo.exec(antes.replace(/^[ \t]*--.*$/gm, ""));
  assert.equal(
    antigo.prepare("SELECT name FROM pragma_table_info('tasks') WHERE name = 'kind'").all().length,
    0,
    "o banco de partida precisa mesmo estar sem a coluna"
  );
  antigo.close();

  try {
    // Sem o conserto, a segunda abertura levava "duplicate column name: kind".
    await Promise.all([openDb(arquivo), openDb(arquivo)]);
    const col = await all(
      "SELECT name FROM pragma_table_info('tasks') WHERE name = 'kind'"
    );
    assert.equal(col.length, 1);
  } finally {
    // O restante do arquivo continua com o banco de teste principal.
    await openDb(DB_FILE);
    try {
      rmSync(pasta, { recursive: true, force: true });
    } catch {}
  }
});

// --- Freio de login --------------------------------------------------------

test("encher o mapa de tentativas não zera o contador de quem está sob ataque", async () => {
  const alvo = "1.2.3.4|alvo";
  limparTentativas(alvo);
  for (let i = 0; i < 8; i++) registrarFalha(alvo);
  assert.equal(podeTentar(alvo), false, "oito falhas já deviam travar");

  // O contorno: inventar usuários até estourar o teto do mapa.
  for (let i = 0; i < 6000; i++) registrarFalha(`9.9.9.9|inventado-${i}`);

  assert.equal(podeTentar(alvo), false, "o alvo continua travado depois da limpeza");
});

// --- Sessão ----------------------------------------------------------------

test("sondagem seguida não regrava last_seen_at a cada requisição", async () => {
  const s = await createSession(ator, "teste");

  const primeira = await userFromToken(s.token);
  assert.ok(primeira, "a sessão recém-criada precisa valer");
  const gravado = (await one("SELECT last_seen_at FROM users WHERE id = ?", [ator])).last_seen_at;
  assert.ok(gravado, "a primeira visita grava");

  // A sondagem do frontend repete de seis em seis segundos; no modo hospedado
  // cada escrita destas é uma ida à rede.
  await userFromToken(s.token);
  await userFromToken(s.token);
  const depois = (await one("SELECT last_seen_at FROM users WHERE id = ?", [ator])).last_seen_at;
  assert.equal(depois, gravado);
});

test("last_seen_at antigo volta a ser gravado", async () => {
  const s = await createSession(ator, "teste");
  await run("UPDATE users SET last_seen_at = ? WHERE id = ?", [
    new Date(Date.now() - 3600000).toISOString(),
    ator,
  ]);
  const antes = (await one("SELECT last_seen_at FROM users WHERE id = ?", [ator])).last_seen_at;

  await userFromToken(s.token);
  const depois = (await one("SELECT last_seen_at FROM users WHERE id = ?", [ator])).last_seen_at;
  assert.notEqual(depois, antes);
});

// --- Criação de acesso -----------------------------------------------------

test("criar acesso com usuário existente responde 409, não erro interno", async () => {
  await createUser({ username: "carla.exemplo", displayName: "Carla Exemplo" });
  await assert.rejects(
    async () => await createUser({ username: "Carla.Exemplo", displayName: "Outra" }),
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /já existe/i);
      return true;
    }
  );
});

test("nome de usuário sem caractere válido responde 400", async () => {
  await assert.rejects(
    async () => await createUser({ username: "ãéç", displayName: "Sem nome" }),
    (err) => {
      assert.equal(err.status, 400);
      return true;
    }
  );
});
