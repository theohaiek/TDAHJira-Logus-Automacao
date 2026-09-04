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

// --- Ciclo de vida ---------------------------------------------------------

test("criar exige apenas o título", async () => {
  const t = await createTask({ title: "Só o título" }, ator);
  assert.equal(t.title, "Só o título");
  assert.equal(t.status, "inbox");
  assert.equal(t.priority, "normal");
  assert.equal(t.energy, null);
  assert.equal(t.dueOn, null);
});

test("criar sem título é recusado", async () => {
  await assert.rejects(async () => await createTask({ title: "   " }, ator), /título/i);
});

test("entrar em fazendo grava o início e puxa para hoje", async () => {
  const t = await createTask({ title: "Vai começar" }, ator);
  assert.equal(t.startedAt, null);

  const depois = await updateTask(t.id, { status: "doing" }, ator);
  assert.ok(depois.startedAt, "started_at deveria ter sido gravado");
  assert.ok(depois.focusOn, "entrar em fazendo declara que é hoje");
});

test("o início não é reescrito ao voltar para fazendo", async () => {
  const t = await createTask({ title: "Vai e volta" }, ator);
  const primeiro = (await updateTask(t.id, { status: "doing" }, ator)).startedAt;
  await updateTask(t.id, { status: "todo" }, ator);
  const segundo = (await updateTask(t.id, { status: "doing" }, ator)).startedAt;
  assert.equal(segundo, primeiro, "started_at marca a primeira vez, não a última");
});

test("concluir grava a data e reabrir limpa", async () => {
  const t = await createTask({ title: "Termina e reabre" }, ator);
  const feita = await updateTask(t.id, { status: "done" }, ator);
  assert.ok(feita.doneAt);

  const reaberta = await updateTask(t.id, { status: "todo" }, ator);
  assert.equal(reaberta.doneAt, null, "reabrir precisa limpar done_at");
});

test("sair de esperando limpa de quem se esperava e registra o evento", async () => {
  const t = await createTask({ title: "Depende de alguém" }, ator);
  await updateTask(t.id, { status: "waiting", waitingFor: "o retorno do fornecedor" }, ator);

  const solta = await updateTask(t.id, { status: "todo" }, ator);
  assert.equal(solta.waitingFor, null);

  const trilha = await taskTimeline(t.id);
  const limpeza = trilha.filter((e) => e.kind === "waiting" && e.to === null);
  assert.equal(limpeza.length, 1, "a limpeza precisa aparecer na trilha");
});

test("mudar de estado reinicia a contagem de tempo parado", async () => {
  const t = await createTask({ title: "Conta o tempo" }, ator);
  const antes = (await getTaskFull(t.id)).statusSince;
  await new Promise((r) => setTimeout(r, 12));
  const depois = (await updateTask(t.id, { status: "todo" }, ator)).statusSince;
  assert.notEqual(depois, antes);
});

test("valor inválido em campo de escolha é recusado", async () => {
  const t = await createTask({ title: "Validação" }, ator);
  await assert.rejects(async () => await updateTask(t.id, { status: "inventado" }, ator), /inválido/i);
  await assert.rejects(async () => await updateTask(t.id, { priority: "P1" }, ator), /inválido/i);
});

test("o tamanho fica dentro da escala", async () => {
  const t = await createTask({ title: "Tamanho" }, ator);
  assert.equal((await updateTask(t.id, { size: 999 }, ator)).size, 40);
  assert.equal((await updateTask(t.id, { size: 0 }, ator)).size, 1);
});

// --- Trilha ----------------------------------------------------------------

test("toda mudança de campo vira um evento com valor anterior e novo", async () => {
  const t = await createTask({ title: "Rastreável" }, ator);
  await updateTask(t.id, { priority: "agora" }, ator);
  await updateTask(t.id, { title: "Rastreável mesmo" }, ator);

  const trilha = await taskTimeline(t.id);
  assert.equal(trilha[0].kind, "created");

  const prioridade = trilha.find((e) => e.kind === "priority");
  assert.equal(prioridade.from, "normal");
  assert.equal(prioridade.to, "agora");

  const titulo = trilha.find((e) => e.kind === "title");
  assert.equal(titulo.from, "Rastreável");
  assert.equal(titulo.to, "Rastreável mesmo");
});

test("gravar o mesmo valor não polui a trilha", async () => {
  const t = await createTask({ title: "Sem ruído" }, ator);
  const antes = (await taskTimeline(t.id)).length;
  await updateTask(t.id, { title: "Sem ruído", priority: "normal" }, ator);
  assert.equal((await taskTimeline(t.id)).length, antes, "nada mudou, nada a registrar");
});

// --- Passos ----------------------------------------------------------------

test("passos entram na ordem e a conclusão é registrada", async () => {
  const t = await createTask({ title: "Com passos" }, ator);
  const p1 = await addStep(t.id, "Primeiro", ator);
  await addStep(t.id, "Segundo", ator);

  const cheia = await getTaskFull(t.id);
  assert.equal(cheia.steps.length, 2);
  assert.equal(cheia.steps[0].text, "Primeiro");

  await toggleStep(p1.id, true, ator);
  assert.equal((await getTaskFull(t.id)).steps[0].done, true);
  assert.ok((await taskTimeline(t.id)).some((e) => e.kind === "step_done"));
});

// --- Conversa --------------------------------------------------------------

test("comentar registra evento e aparece na contagem do cartão", async () => {
  const t = await createTask({ title: "Conversa" }, ator);
  await addComment(t.id, "Primeiro comentário", ator);

  assert.equal((await listComments(t.id)).length, 1);
  assert.equal((await getTaskFull(t.id)).commentCount, 1);
  assert.ok((await taskTimeline(t.id)).some((e) => e.kind === "comment"));
});

test("comentário vazio é recusado", async () => {
  const t = await createTask({ title: "Vazio" }, ator);
  await assert.rejects(async () => await addComment(t.id, "   ", ator), /vazio/i);
});

// --- Chave legível ---------------------------------------------------------

test("cada tarefa do projeto recebe um número próprio e sequencial", async () => {
  const ts = new Date().toISOString();
  await insert(
    `INSERT INTO projects (key, name, color, description, position, created_at, updated_at)
     VALUES ('TST', 'Teste', '#a2e4f0', '', 0, ?, ?)`,
    [ts, ts]
  );
  const projeto = await one("SELECT id FROM projects WHERE key = 'TST'");

  const a = await createTask({ title: "Primeira", projectId: projeto.id }, ator);
  const b = await createTask({ title: "Segunda", projectId: projeto.id }, ator);

  assert.equal(a.key, "TST-1");
  assert.equal(b.key, "TST-2");
});

test("tarefa sem projeto ainda tem um identificador", async () => {
  const t = await createTask({ title: "Solta" }, ator);
  assert.match(t.key, /^#\d+$/);
});

// --- Ordenação -------------------------------------------------------------

test("mover entre dois cartões coloca a tarefa no meio", async () => {
  const a = await createTask({ title: "A", status: "todo", position: 1000 }, ator);
  const b = await createTask({ title: "B", status: "todo", position: 2000 }, ator);
  const c = await createTask({ title: "C", status: "todo", position: 3000 }, ator);

  const movida = await moveTask(c.id, { status: "todo", afterId: a.id, beforeId: b.id }, ator);
  assert.ok(movida.position > a.position && movida.position < b.position);
});

// --- Captura rápida --------------------------------------------------------

const contexto = {
  projects: [{ id: 1, key: "AUT", name: "Automações" }, { id: 2, key: "COM", name: "Comercial" }],
  users: [{ id: 7, username: "bruno", name: "Bruno Exemplo" }],
  labels: [{ id: 3, name: "cliente" }],
};

test("a captura entende a frase inteira", async () => {
  const r = parseCaptura("Ligar para o fornecedor #COM @bruno !agora ~2 +cliente", contexto);
  assert.equal(r.title, "Ligar para o fornecedor");
  assert.equal(r.dados.projectId, 2);
  assert.equal(r.dados.assigneeId, 7);
  assert.equal(r.dados.priority, "agora");
  assert.equal(r.dados.size, 2);
  assert.deepEqual(r.dados.labels, [3]);
});

test("o projeto também é reconhecido pelo começo do nome", async () => {
  assert.equal(parseCaptura("Revisar #automa", contexto).dados.projectId, 1);
});

test("uma frase comum vira só o título", async () => {
  const r = parseCaptura("Comprar café para o escritório", contexto);
  assert.equal(r.title, "Comprar café para o escritório");
  assert.deepEqual(r.dados, {});
});

test("data em linguagem comum vira prazo", async () => {
  assert.ok(parseCaptura("Enviar proposta amanhã", contexto).dados.dueOn);
  const hoje = parseCaptura("Terminar hoje", contexto).dados;
  assert.ok(hoje.dueOn);
  assert.equal(hoje.dueOn, hoje.focusOn, "hoje também puxa para o foco do dia");
});

test("palavra que apenas começa como data não é confundida", async () => {
  const r = parseCaptura("Comprar amanhecedor novo", contexto);
  assert.equal(r.dados.dueOn, undefined);
  assert.equal(r.title, "Comprar amanhecedor novo");
});

test("'ter' e 'dom' soltos são palavras, não dias da semana", () => {
  const r = parseCaptura("Ter um cliente fora do estado", contexto);
  assert.equal(r.dados.dueOn, undefined);
  assert.equal(r.title, "Ter um cliente fora do estado");
  assert.ok(parseCaptura("Ligar ter.", contexto).dados.dueOn, "com ponto, é terça");
  assert.ok(parseCaptura("Ligar terça", contexto).dados.dueOn, "por extenso, é terça");
  assert.ok(parseCaptura("Ligar sex", contexto).dados.dueOn, "as outras abreviações seguem valendo");
});

test("marcação de pessoa inexistente fica no título", async () => {
  const r = parseCaptura("Falar com @fulano", contexto);
  assert.equal(r.dados.assigneeId, undefined);
  assert.ok(r.title.includes("@fulano"));
});

// --- Tipo: fluxo do dia versus quadros laterais ------------------------------

test("tarefa nasce como 'task' quando o tipo não é informado", async () => {
  const t = await createTask({ title: "Sem tipo" }, ator);
  assert.equal(t.kind, "task");
});

test("tipo é gravado, validado, e a troca vira evento na trilha", async () => {
  const t = await createTask({ title: "Vira meta", kind: "meta" }, ator);
  assert.equal(t.kind, "meta");

  const movida = await updateTask(t.id, { kind: "oportunidade" }, ator);
  assert.equal(movida.kind, "oportunidade");

  const ev = (await taskTimeline(t.id)).find((e) => e.kind === "kind");
  assert.equal(ev.from, "meta");
  assert.equal(ev.to, "oportunidade");

  await assert.rejects(async () => await updateTask(t.id, { kind: "inventado" }, ator), /inválido/i);
});

test("a captura entende o prefixo ^ para o tipo", () => {
  assert.equal(parseCaptura("Dobrar a carteira ^meta", contexto).dados.kind, "meta");
  assert.equal(parseCaptura("Renovar domínio ^longa", contexto).dados.kind, "longa");
  assert.equal(parseCaptura("Parceria regional ^oport", contexto).dados.kind, "oportunidade");
  assert.equal(parseCaptura("Título comum", contexto).dados.kind, undefined);
});
