// Testes da auditoria de server/tasks.js.
//
// Cada teste aqui nasceu de um defeito que foi reproduzido antes de ser
// corrigido. São todos casos que não aparecem na tela: a chave que colide, o
// campo que aceita lixo em silêncio, o arquivo que fica no disco depois que a
// tarefa some.
//
//   node --test tests/auditoria-regras-tarefa.test.js

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.TDAH_DATA_DIR = mkdtempSync(join(tmpdir(), "tdah-test-"));

const { openDb, one, all, insert, nowIso } = await import("../server/db.js");
const { DB_FILE, DATA_DIR, UPLOAD_DIR } = await import("../server/paths.js");
const { createUser } = await import("../server/auth.js");
const { createTask, updateTask, moveTask, deleteTask } = await import("../server/tasks.js");
const { saveAttachment } = await import("../server/comments.js");
const { cursor } = await import("../server/events.js");

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
    // A condição não é paranoia: DATA_DIR só aponta para o diretório
    // temporário porque TDAH_DATA_DIR foi definido ANTES do import de
    // paths.js. Trocar o import dinâmico por um estático faz esta linha
    // apagar o banco e os anexos de quem usa a máquina, sem erro nenhum.
    if (DATA_DIR.startsWith(tmpdir())) rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {}
});

async function criarProjeto(chave) {
  const ts = nowIso();
  await insert(
    `INSERT INTO projects (key, name, color, description, position, created_at, updated_at)
     VALUES (?, ?, '#a2e4f0', '', 0, ?, ?)`,
    [chave, chave, ts, ts]
  );
  return (await one("SELECT id FROM projects WHERE key = ?", [chave])).id;
}

// --- Chave legível ---------------------------------------------------------

test("trocar de projeto renumera a chave e o destino continua aceitando tarefa nova", async () => {
  const origem = await criarProjeto("AAA");
  const destino = await criarProjeto("BBB");

  await createTask({ title: "Primeira da origem", projectId: origem }, ator);
  const segunda = await createTask({ title: "Segunda da origem", projectId: origem }, ator);
  await createTask({ title: "Primeira do destino", projectId: destino }, ator);

  const movida = await updateTask(segunda.id, { projectId: destino }, ator);
  assert.equal(movida.key, "BBB-2", "a tarefa recebe o próximo número do destino");

  // Sem renumerar o contador, esta criação bate no índice único e o projeto
  // de destino nunca mais aceita tarefa nenhuma.
  const nova = await createTask({ title: "Segunda do destino", projectId: destino }, ator);
  assert.equal(nova.key, "BBB-3");
});

test("tarefa que nasceu solta ganha a chave do projeto ao entrar nele", async () => {
  const projeto = await criarProjeto("DDD");
  const t = await createTask({ title: "Nasceu solta" }, ator);
  assert.equal(t.number, null);

  const dentro = await updateTask(t.id, { projectId: projeto }, ator);
  assert.equal(dentro.key, "DDD-1", "sem número a tarefa ficaria com #id para sempre");
});

test("tirar a tarefa do projeto devolve o identificador solto", async () => {
  const projeto = await criarProjeto("CCC");
  const t = await createTask({ title: "Sai do projeto", projectId: projeto }, ator);
  assert.equal(t.key, "CCC-1");

  const solta = await updateTask(t.id, { projectId: null }, ator);
  assert.equal(solta.number, null);
  assert.equal(solta.key, `#${t.id}`);
});

test("criar em projeto inexistente é recusado com 400", async () => {
  await assert.rejects(
    async () => await createTask({ title: "Sem projeto", projectId: 987654 }, ator),
    (e) => e.status === 400 && /Projeto inexistente/.test(e.message)
  );
});

// --- Campos de escolha -----------------------------------------------------

test("criar recusa valor fora da lista, igual ao PATCH", async () => {
  for (const campo of [
    { kind: "opotunidade" },
    { priority: "P1" },
    { status: "inventado" },
    { energy: "fortíssima" },
  ]) {
    await assert.rejects(
      async () => await createTask({ title: "Dobrar a carteira", ...campo }, ator),
      /inválido/i,
      `${Object.keys(campo)[0]} deveria ser recusado na criação`
    );
  }
});

test("criar continua aceitando os valores válidos e os padrões", async () => {
  const cheia = await createTask(
    { title: "Com tudo", kind: "meta", priority: "agora", energy: "leve", status: "todo" },
    ator
  );
  assert.deepEqual(
    [cheia.kind, cheia.priority, cheia.energy, cheia.status],
    ["meta", "agora", "leve", "todo"]
  );

  const vazia = await createTask({ title: "Sem nada", kind: "", energy: null }, ator);
  assert.deepEqual([vazia.kind, vazia.priority, vazia.energy, vazia.status], [
    "task",
    "normal",
    null,
    "inbox",
  ]);
});

// --- Título ----------------------------------------------------------------

test("PATCH não deixa o título virar espaço em branco", async () => {
  const t = await createTask({ title: "Tem nome" }, ator);
  await assert.rejects(async () => await updateTask(t.id, { title: "   " }, ator), /vazio/i);
  assert.equal((await updateTask(t.id, { title: "  Tem nome mesmo  " }, ator)).title, "Tem nome mesmo");
});

test("PATCH respeita o mesmo limite de título da criação", async () => {
  const t = await createTask({ title: "Curto" }, ator);
  await assert.rejects(
    async () => await updateTask(t.id, { title: "x".repeat(501) }, ator),
    /longo/i
  );
  assert.equal((await updateTask(t.id, { title: "x".repeat(500) }, ator)).title.length, 500);
});

// --- Datas -----------------------------------------------------------------

test("data com formato certo mas inexistente é recusada", async () => {
  const t = await createTask({ title: "Prazo" }, ator);
  for (const d of ["2026-99-99", "0000-00-00", "2026-02-30", "2026-13-01"]) {
    await assert.rejects(
      async () => await updateTask(t.id, { dueOn: d }, ator),
      /inválida/i,
      `${d} deveria ser recusada`
    );
  }
  assert.equal((await updateTask(t.id, { dueOn: "2026-02-28" }, ator)).dueOn, "2026-02-28");
  assert.equal((await updateTask(t.id, { dueOn: "2028-02-29" }, ator)).dueOn, "2028-02-29");
});

test("na criação a data inexistente não é gravada", async () => {
  const t = await createTask({ title: "Prazo torto", dueOn: "2026-99-99" }, ator);
  assert.equal(t.dueOn, null);
});

// --- Ponteiros -------------------------------------------------------------

test("PATCH com pessoa, pai ou projeto inexistente devolve 400, não 500", async () => {
  const t = await createTask({ title: "Ponteiros" }, ator);
  for (const campo of [{ assigneeId: 99999 }, { parentId: 88888 }, { projectId: 77777 }]) {
    await assert.rejects(
      async () => await updateTask(t.id, campo, ator),
      (e) => e.status === 400,
      `${Object.keys(campo)[0]} inexistente deveria virar 400`
    );
  }
});

// --- Exclusão --------------------------------------------------------------

test("apagar tarefa registra a saída na trilha e o cursor não anda para trás", async () => {
  const t = await createTask({ title: "Vai sumir" }, ator);
  await updateTask(t.id, { priority: "agora" }, ator);

  const antes = await cursor();
  await deleteTask(t.id, ator);
  const depois = await cursor();

  assert.ok(depois > antes, "o cursor de sincronização só pode andar para a frente");
  const saida = await one(
    "SELECT * FROM events WHERE kind = 'deleted' AND to_value = ?",
    [String(t.id)]
  );
  assert.ok(saida, "a exclusão precisa deixar rastro");
  assert.equal(saida.task_id, null, "o evento não pode apontar para a linha que acabou de sair");
});

test("apagar tarefa apaga também o arquivo do anexo", async () => {
  const t = await createTask({ title: "Com print colado" }, ator);
  await saveAttachment({
    taskId: t.id,
    buffer: Buffer.from("conteúdo do anexo"),
    mime: "text/plain",
    originalName: "print.txt",
    actorId: ator,
  });

  const [arquivo] = await all("SELECT stored_name FROM attachments WHERE task_id = ?", [t.id]);
  const caminho = join(UPLOAD_DIR, arquivo.stored_name);
  assert.ok(existsSync(caminho), "o anexo tem que existir antes do teste valer alguma coisa");

  await deleteTask(t.id, ator);
  assert.equal(existsSync(caminho), false, "o arquivo não pode ficar órfão no disco");
});

test("apagar a tarefa pai leva junto o anexo da filha", async () => {
  const pai = await createTask({ title: "Pai" }, ator);
  const filha = await createTask({ title: "Filha", parentId: pai.id }, ator);
  await saveAttachment({
    taskId: filha.id,
    buffer: Buffer.from("anexo da filha"),
    mime: "text/plain",
    originalName: "filha.txt",
    actorId: ator,
  });

  const [arquivo] = await all("SELECT stored_name FROM attachments WHERE task_id = ?", [filha.id]);
  const caminho = join(UPLOAD_DIR, arquivo.stored_name);

  await deleteTask(pai.id, ator);
  assert.equal(existsSync(caminho), false);
});

// --- Ordenação -------------------------------------------------------------

test("soltar sempre no mesmo ponto não colapsa a ordem manual", async () => {
  // A coluna "waiting" é usada só aqui para o teste não depender do que os
  // outros deixaram nas demais colunas.
  const topo = await createTask({ title: "Topo", status: "waiting", position: 1000 }, ator);
  let vizinho = await createTask({ title: "Vizinho", status: "waiting", position: 2024 }, ator);

  // Sem rebalanceamento o intervalo satura por volta da 53ª inserção e as
  // duas tarefas passam a ter a mesma posição.
  for (let i = 0; i < 70; i++) {
    const nova = await createTask({ title: `Solta ${i}`, status: "waiting" }, ator);
    vizinho = await moveTask(
      nova.id,
      { status: "waiting", afterId: topo.id, beforeId: vizinho.id },
      ator
    );
  }

  const coluna = await all(
    "SELECT id, position FROM tasks WHERE status = 'waiting' ORDER BY position, id"
  );
  const posicoes = new Set(coluna.map((r) => r.position));
  assert.equal(posicoes.size, coluna.length, "duas tarefas na mesma posição perdem a ordem manual");

  const atual = await one("SELECT position FROM tasks WHERE id = ?", [topo.id]);
  assert.ok(vizinho.position > atual.position, "a última solta continua logo abaixo do topo");
});

// --- A exclusão precisa chegar em quem está com a aba aberta ----------------

test("a tarefa apagada é anunciada pelo cursor de sincronização", async () => {
  const { cursor, changedSince, deletedSince } = await import("../server/events.js");

  const t = await createTask({ title: "Vai sumir da tela do colega" }, ator);
  const antes = await cursor();

  await deleteTask(t.id, ator);

  const agora = await cursor();
  assert.ok(agora > antes, "o cursor precisa avançar, nunca recuar");

  // changedSince sozinho não enxerga: o evento de exclusão nasce sem task_id,
  // porque a linha da tarefa já não existe.
  assert.equal((await changedSince(antes)).includes(t.id), false);
  assert.ok((await deletedSince(antes)).includes(t.id), "deletedSince precisa devolver o id");
});
