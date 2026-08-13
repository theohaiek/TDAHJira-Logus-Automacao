// Testes das regras que o contrato exige dos dois backends.
//
// O foco está no que quebraria em silêncio: as transições de estado que
// gravam data sozinhas, e o interpretador da captura rápida. São as duas
// partes onde um erro não aparece na tela — ele aparece semanas depois, num
// histórico errado ou numa tarefa que nunca foi criada como se esperava.
//
//   node --test tests/

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.TDAH_DATA_DIR = mkdtempSync(join(tmpdir(), "tdah-test-"));

const { openDb, one, insert } = await import("../server/db.js");
const { DB_FILE, DATA_DIR } = await import("../server/paths.js");
const { createUser } = await import("../server/auth.js");
const { createTask, updateTask, addStep, toggleStep, getTaskFull, moveTask } = await import(
  "../server/tasks.js"
);
const { addComment, listComments } = await import("../server/comments.js");
const { taskTimeline } = await import("../server/events.js");
const { parseCaptura } = await import("../web/js/capture.js");

let ator;

before(() => {
  openDb(DB_FILE);
  ator = createUser({ username: "teste", displayName: "Teste", password: "apenas-para-teste" }).id;
});

after(() => {
  try {
    rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {}
});

// --- Ciclo de vida ---------------------------------------------------------

test("criar exige apenas o título", () => {
  const t = createTask({ title: "Só o título" }, ator);
  assert.equal(t.title, "Só o título");
  assert.equal(t.status, "inbox");
  assert.equal(t.priority, "normal");
  assert.equal(t.energy, null);
  assert.equal(t.dueOn, null);
});

test("criar sem título é recusado", () => {
  assert.throws(() => createTask({ title: "   " }, ator), /título/i);
});

test("entrar em fazendo grava o início e puxa para hoje", () => {
  const t = createTask({ title: "Vai começar" }, ator);
  assert.equal(t.startedAt, null);

  const depois = updateTask(t.id, { status: "doing" }, ator);
  assert.ok(depois.startedAt, "started_at deveria ter sido gravado");
  assert.ok(depois.focusOn, "entrar em fazendo declara que é hoje");
});

test("o início não é reescrito ao voltar para fazendo", () => {
  const t = createTask({ title: "Vai e volta" }, ator);
  const primeiro = updateTask(t.id, { status: "doing" }, ator).startedAt;
  updateTask(t.id, { status: "todo" }, ator);
  const segundo = updateTask(t.id, { status: "doing" }, ator).startedAt;
  assert.equal(segundo, primeiro, "started_at marca a primeira vez, não a última");
});

test("concluir grava a data e reabrir limpa", () => {
  const t = createTask({ title: "Termina e reabre" }, ator);
  const feita = updateTask(t.id, { status: "done" }, ator);
  assert.ok(feita.doneAt);

  const reaberta = updateTask(t.id, { status: "todo" }, ator);
  assert.equal(reaberta.doneAt, null, "reabrir precisa limpar done_at");
});

test("sair de esperando limpa de quem se esperava e registra o evento", () => {
  const t = createTask({ title: "Depende de alguém" }, ator);
  updateTask(t.id, { status: "waiting", waitingFor: "o retorno do fornecedor" }, ator);

  const solta = updateTask(t.id, { status: "todo" }, ator);
  assert.equal(solta.waitingFor, null);

  const trilha = taskTimeline(t.id);
  const limpeza = trilha.filter((e) => e.kind === "waiting" && e.to === null);
  assert.equal(limpeza.length, 1, "a limpeza precisa aparecer na trilha");
});

test("mudar de estado reinicia a contagem de tempo parado", async () => {
  const t = createTask({ title: "Conta o tempo" }, ator);
  const antes = getTaskFull(t.id).statusSince;
  await new Promise((r) => setTimeout(r, 12));
  const depois = updateTask(t.id, { status: "todo" }, ator).statusSince;
  assert.notEqual(depois, antes);
});

test("valor inválido em campo de escolha é recusado", () => {
  const t = createTask({ title: "Validação" }, ator);
  assert.throws(() => updateTask(t.id, { status: "inventado" }, ator), /inválido/i);
  assert.throws(() => updateTask(t.id, { priority: "P1" }, ator), /inválido/i);
});

test("o tamanho fica dentro da escala", () => {
  const t = createTask({ title: "Tamanho" }, ator);
  assert.equal(updateTask(t.id, { size: 999 }, ator).size, 40);
  assert.equal(updateTask(t.id, { size: 0 }, ator).size, 1);
});

// --- Trilha ----------------------------------------------------------------

test("toda mudança de campo vira um evento com valor anterior e novo", () => {
  const t = createTask({ title: "Rastreável" }, ator);
  updateTask(t.id, { priority: "agora" }, ator);
  updateTask(t.id, { title: "Rastreável mesmo" }, ator);

  const trilha = taskTimeline(t.id);
  assert.equal(trilha[0].kind, "created");

  const prioridade = trilha.find((e) => e.kind === "priority");
  assert.equal(prioridade.from, "normal");
  assert.equal(prioridade.to, "agora");

  const titulo = trilha.find((e) => e.kind === "title");
  assert.equal(titulo.from, "Rastreável");
  assert.equal(titulo.to, "Rastreável mesmo");
});

test("gravar o mesmo valor não polui a trilha", () => {
  const t = createTask({ title: "Sem ruído" }, ator);
  const antes = taskTimeline(t.id).length;
  updateTask(t.id, { title: "Sem ruído", priority: "normal" }, ator);
  assert.equal(taskTimeline(t.id).length, antes, "nada mudou, nada a registrar");
});

// --- Passos ----------------------------------------------------------------

test("passos entram na ordem e a conclusão é registrada", () => {
  const t = createTask({ title: "Com passos" }, ator);
  const p1 = addStep(t.id, "Primeiro", ator);
  addStep(t.id, "Segundo", ator);

  const cheia = getTaskFull(t.id);
  assert.equal(cheia.steps.length, 2);
  assert.equal(cheia.steps[0].text, "Primeiro");

  toggleStep(p1.id, true, ator);
  assert.equal(getTaskFull(t.id).steps[0].done, true);
  assert.ok(taskTimeline(t.id).some((e) => e.kind === "step_done"));
});

// --- Conversa --------------------------------------------------------------

test("comentar registra evento e aparece na contagem do cartão", () => {
  const t = createTask({ title: "Conversa" }, ator);
  addComment(t.id, "Primeiro comentário", ator);

  assert.equal(listComments(t.id).length, 1);
  assert.equal(getTaskFull(t.id).commentCount, 1);
  assert.ok(taskTimeline(t.id).some((e) => e.kind === "comment"));
});

test("comentário vazio é recusado", () => {
  const t = createTask({ title: "Vazio" }, ator);
  assert.throws(() => addComment(t.id, "   ", ator), /vazio/i);
});

// --- Chave legível ---------------------------------------------------------

test("cada tarefa do projeto recebe um número próprio e sequencial", () => {
  const ts = new Date().toISOString();
  insert(
    `INSERT INTO projects (key, name, color, description, position, created_at, updated_at)
     VALUES ('TST', 'Teste', '#a2e4f0', '', 0, ?, ?)`,
    [ts, ts]
  );
  const projeto = one("SELECT id FROM projects WHERE key = 'TST'");

  const a = createTask({ title: "Primeira", projectId: projeto.id }, ator);
  const b = createTask({ title: "Segunda", projectId: projeto.id }, ator);

  assert.equal(a.key, "TST-1");
  assert.equal(b.key, "TST-2");
});

test("tarefa sem projeto ainda tem um identificador", () => {
  const t = createTask({ title: "Solta" }, ator);
  assert.match(t.key, /^#\d+$/);
});

// --- Ordenação -------------------------------------------------------------

test("mover entre dois cartões coloca a tarefa no meio", () => {
  const a = createTask({ title: "A", status: "todo", position: 1000 }, ator);
  const b = createTask({ title: "B", status: "todo", position: 2000 }, ator);
  const c = createTask({ title: "C", status: "todo", position: 3000 }, ator);

  const movida = moveTask(c.id, { status: "todo", afterId: a.id, beforeId: b.id }, ator);
  assert.ok(movida.position > a.position && movida.position < b.position);
});

// --- Captura rápida --------------------------------------------------------

const contexto = {
  projects: [{ id: 1, key: "AUT", name: "Automações" }, { id: 2, key: "COM", name: "Comercial" }],
  users: [{ id: 7, username: "bruno", name: "Bruno Exemplo" }],
  labels: [{ id: 3, name: "cliente" }],
};

test("a captura entende a frase inteira", () => {
  const r = parseCaptura("Ligar para o fornecedor #COM @bruno !agora ~2 +cliente", contexto);
  assert.equal(r.title, "Ligar para o fornecedor");
  assert.equal(r.dados.projectId, 2);
  assert.equal(r.dados.assigneeId, 7);
  assert.equal(r.dados.priority, "agora");
  assert.equal(r.dados.size, 2);
  assert.deepEqual(r.dados.labels, [3]);
});

test("o projeto também é reconhecido pelo começo do nome", () => {
  assert.equal(parseCaptura("Revisar #automa", contexto).dados.projectId, 1);
});

test("uma frase comum vira só o título", () => {
  const r = parseCaptura("Comprar café para o escritório", contexto);
  assert.equal(r.title, "Comprar café para o escritório");
  assert.deepEqual(r.dados, {});
});

test("data em linguagem comum vira prazo", () => {
  assert.ok(parseCaptura("Enviar proposta amanhã", contexto).dados.dueOn);
  const hoje = parseCaptura("Terminar hoje", contexto).dados;
  assert.ok(hoje.dueOn);
  assert.equal(hoje.dueOn, hoje.focusOn, "hoje também puxa para o foco do dia");
});

test("palavra que apenas começa como data não é confundida", () => {
  const r = parseCaptura("Comprar amanhecedor novo", contexto);
  assert.equal(r.dados.dueOn, undefined);
  assert.equal(r.title, "Comprar amanhecedor novo");
});

test("marcação de pessoa inexistente fica no título", () => {
  const r = parseCaptura("Falar com @fulano", contexto);
  assert.equal(r.dados.assigneeId, undefined);
  assert.ok(r.title.includes("@fulano"));
});
