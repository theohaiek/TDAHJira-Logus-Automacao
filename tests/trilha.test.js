// Testes do contrato da trilha.
//
// O evento acumula dois papéis que nada no código liga um ao outro: ele é a
// história da tarefa e é o relógio da sincronização. Disso vêm duas falhas que
// não aparecem em nenhuma tela de erro.
//
// A primeira: o nome do evento nasce em server/events.js e precisa de tradução
// em dois dicionários do cliente — FRASE, em web/js/views/fluxo.js, e NARRA,
// em web/js/ticket.js. Esquecer um deles imprime o identificador cru no meio
// da frase, em português macarrônico, para o usuário final.
//
// A segunda: quem escreve sem gravar evento não move o cursor, e a mudança
// fica invisível para todas as outras abas até um recarregamento completo.
//
//   node --test tests/trilha.test.js

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.TDAH_DATA_DIR = mkdtempSync(join(tmpdir(), "tdah-test-"));

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

const { openDb, all } = await import("../server/db.js");
const { DB_FILE, DATA_DIR } = await import("../server/paths.js");
const { createUser } = await import("../server/auth.js");
const { createTask, updateTask, moveTask } = await import("../server/tasks.js");
const { addComment, editComment, deleteComment } = await import("../server/comments.js");
const { logEvent, taskTimeline, cursor, changedSince, EVENT_KINDS, EVENT_KINDS_MUDOS } =
  await import("../server/events.js");

let ator;

before(async () => {
  await openDb(DB_FILE);
  const u = await createUser({
    username: "trilha",
    displayName: "Trilha Exemplo",
    password: "apenas-para-teste",
  });
  ator = u.id;
});

after(() => {
  try {
    // A condição não é paranoia: DATA_DIR só aponta para o diretório
    // temporário porque TDAH_DATA_DIR foi definido ANTES do import de
    // paths.js. Trocar o import dinâmico por um estático faz esta linha
    // apagar o banco e os anexos de quem usa a máquina, sem erro nenhum.
    if (DATA_DIR.startsWith(tmpdir())) rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {}
});

// --- O nome do evento ------------------------------------------------------

test("todo campo que a API altera tem nome de evento próprio", () => {
  const fonte = readFileSync(join(RAIZ, "server/tasks.js"), "utf8");
  const campos = chaves(fonte, "FIELDS");
  const traduzidos = chaves(fonte, "EVENT_FOR");

  const sem = campos.filter((c) => !traduzidos.includes(c));
  assert.deepEqual(
    sem,
    [],
    `campos sem entrada em EVENT_FOR caem no genérico e chegam ao usuário crus: ${sem.join(", ")}`
  );
});

test("reordenar cartão grava o evento com nome próprio, não o genérico", async () => {
  const a = await createTask({ title: "Primeira", status: "todo", position: 1000 }, ator);
  const b = await createTask({ title: "Segunda", status: "todo", position: 2000 }, ator);
  const c = await createTask({ title: "Terceira", status: "todo", position: 3000 }, ator);

  await moveTask(c.id, { status: "todo", afterId: a.id, beforeId: b.id }, ator);

  const kinds = (await all("SELECT DISTINCT kind FROM events WHERE task_id = ?", [c.id])).map(
    (r) => r.kind
  );
  assert.ok(!kinds.includes("update"), `evento genérico gravado: ${kinds.join(", ")}`);
  assert.ok(kinds.includes("position"), `esperava o evento de posição, veio ${kinds.join(", ")}`);
});

test("kind fora da lista é recusado na hora de gravar", async () => {
  const t = await createTask({ title: "Guarda" }, ator);
  await assert.rejects(
    () => logEvent({ taskId: t.id, actorId: ator, kind: "inventado" }),
    /inventado/,
    "kind desconhecido precisa falhar alto, não virar texto cru na tela de alguém"
  );
});

// --- Os dois dicionários do cliente ----------------------------------------

test("todo evento visível tem tradução nos dois dicionários do cliente", () => {
  const frase = chaves(readFileSync(join(RAIZ, "web/js/views/fluxo.js"), "utf8"), "FRASE");
  const narra = chaves(readFileSync(join(RAIZ, "web/js/ticket.js"), "utf8"), "NARRA");

  // Sanidade: se o formato dos dicionários mudar, a extração devolve pouco e o
  // teste passaria por vazio em vez de por acerto.
  assert.ok(frase.length > 15, `FRASE veio com ${frase.length} chaves — extração falhou`);
  assert.ok(narra.length > 15, `NARRA veio com ${narra.length} chaves — extração falhou`);

  const visiveis = EVENT_KINDS.filter((k) => !EVENT_KINDS_MUDOS.includes(k));

  assert.deepEqual(
    visiveis.filter((k) => !frase.includes(k)),
    [],
    "faltam entradas em FRASE (web/js/views/fluxo.js)"
  );

  // A exclusão é o único evento que a trilha da tarefa nunca mostra: quando ele
  // existe, a tarefa já não existe, e não há ticket para abrir.
  assert.deepEqual(
    visiveis.filter((k) => k !== "deleted" && !narra.includes(k)),
    [],
    "faltam entradas em NARRA (web/js/ticket.js)"
  );
});

test("os dicionários não traduzem evento que não existe mais", () => {
  const frase = chaves(readFileSync(join(RAIZ, "web/js/views/fluxo.js"), "utf8"), "FRASE");
  const narra = chaves(readFileSync(join(RAIZ, "web/js/ticket.js"), "utf8"), "NARRA");

  assert.deepEqual(
    frase.filter((k) => !EVENT_KINDS.includes(k)),
    [],
    "FRASE traduz evento que o servidor não grava — sobra de refatoração"
  );
  assert.deepEqual(
    narra.filter((k) => !EVENT_KINDS.includes(k)),
    [],
    "NARRA traduz evento que o servidor não grava — sobra de refatoração"
  );
});

test("evento mudo não aparece na trilha da tarefa", async () => {
  const a = await createTask({ title: "Fica", status: "todo", position: 1000 }, ator);
  const b = await createTask({ title: "Move", status: "todo", position: 2000 }, ator);
  await moveTask(b.id, { status: "todo", beforeId: a.id }, ator);

  const linha = await taskTimeline(b.id);
  assert.ok(
    !linha.some((e) => EVENT_KINDS_MUDOS.includes(e.kind)),
    "a reordenação precisa mover o cursor sem virar linha de história"
  );
});

// --- O relógio da sincronização --------------------------------------------

test("editar comentário chega às outras abas", async () => {
  const t = await createTask({ title: "Com conversa" }, ator);
  const c = await addComment(t.id, "primeira versão", ator);

  const antes = await cursor();
  await editComment(c.id, "versão corrigida", ator);

  assert.ok(
    (await changedSince(antes)).includes(t.id),
    "sem evento, a outra aba continua mostrando o texto antigo até recarregar"
  );
});

test("apagar comentário chega às outras abas", async () => {
  const t = await createTask({ title: "Com conversa apagada" }, ator);
  const c = await addComment(t.id, "some daqui", ator);

  const antes = await cursor();
  await deleteComment(c.id, { id: ator, role: "admin" });

  assert.ok(
    (await changedSince(antes)).includes(t.id),
    "sem evento, a outra aba continua contando um comentário que já não existe"
  );
});

test("mudança de campo continua chegando às outras abas", async () => {
  const t = await createTask({ title: "Muda de estado" }, ator);
  const antes = await cursor();
  await updateTask(t.id, { status: "doing" }, ator);

  assert.ok((await changedSince(antes)).includes(t.id));
});

// --- Extração --------------------------------------------------------------

// Lê as chaves de um objeto literal direto do arquivo-fonte. É análise de
// texto, e não importação, porque os dois dicionários do cliente vivem em
// módulos que tocam o DOM — não há navegador aqui.
function chaves(fonte, nome) {
  const abre = fonte.indexOf(`const ${nome} = {`);
  assert.notEqual(abre, -1, `objeto ${nome} não encontrado`);
  const fecha = fonte.indexOf("\n};", abre);
  assert.ok(fecha > abre, `fim do objeto ${nome} não encontrado`);

  const bloco = fonte.slice(abre, fecha);
  const achadas = bloco.match(/^ {2}([A-Za-z_]+):/gm) || [];
  return achadas.map((s) => s.trim().slice(0, -1));
}
