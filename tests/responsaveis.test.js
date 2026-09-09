// Testes de "quem faz", agora que são vários.
//
// A armadilha desta mudança tem nome: tasks.assignee_id continua existindo.
// Ela guarda o primeiro da lista, serve ao índice e responde às perguntas que
// só precisam de um nome. Isso não a torna uma segunda verdade — mas torna
// possível que ela e a tabela discordem, e é exatamente isso que a maior parte
// destes testes vigia.
//
//   node --test tests/responsaveis.test.js

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.TDAH_DATA_DIR = mkdtempSync(join(tmpdir(), "tdah-quemfaz-"));

const { openDb, all, one } = await import("../server/db.js");
const { DB_FILE, DATA_DIR } = await import("../server/paths.js");
const { createUser } = await import("../server/auth.js");
const { createTask, updateTask, getTaskFull, deleteTask } = await import("../server/tasks.js");
const { taskTimeline } = await import("../server/events.js");

let ana;
let bruno;
let carla;

before(async () => {
  await openDb(DB_FILE);
  ana = (await createUser({ username: "ana", displayName: "Ana", password: "uma-senha-boa", role: "admin" })).id;
  bruno = (await createUser({ username: "bruno", displayName: "Bruno", password: "uma-senha-boa" })).id;
  carla = (await createUser({ username: "carla", displayName: "Carla", password: "uma-senha-boa" })).id;
});

// O mesmo cuidado do resto da suíte: no Windows o arquivo do banco continua
// travado por um instante depois do último teste, e uma limpeza que estoura
// derrubaria a suíte inteira por causa de uma pasta temporária.
after(() => {
  try {
    if (DATA_DIR.startsWith(tmpdir())) rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {}
});

// A coluna guarda o primeiro; a tabela guarda todos. As duas saem da mesma
// função, e o dia em que discordarem é o dia em que o cartão mostra um rosto e
// o ticket mostra outro.
async function conferirAcordo(id) {
  const linha = await one("SELECT assignee_id FROM tasks WHERE id = ?", [id]);
  const lista = (
    await all(
      "SELECT user_id FROM task_assignees WHERE task_id = ? ORDER BY position, user_id",
      [id]
    )
  ).map((r) => r.user_id);

  assert.equal(
    linha.assignee_id,
    lista[0] ?? null,
    `a coluna diz ${linha.assignee_id} e a lista começa em ${lista[0]}`
  );
  return lista;
}

test("criar com vários responsáveis guarda todos, na ordem", async () => {
  const t = await createTask({ title: "Migrar o painel", assigneeIds: [bruno, ana] }, ana);

  assert.deepEqual(t.assigneeIds, [bruno, ana]);
  assert.equal(t.assigneeId, bruno, "o primeiro da lista é o que a coluna guarda");
  assert.deepEqual(await conferirAcordo(t.id), [bruno, ana]);
});

test("criar com assigneeId sozinho continua funcionando", async () => {
  // A planilha, a captura rápida e qualquer integração antiga mandam assim.
  const t = await createTask({ title: "Conferir o backup", assigneeId: carla }, ana);

  assert.equal(t.assigneeId, carla);
  assert.deepEqual(t.assigneeIds, [carla]);
  assert.deepEqual(await conferirAcordo(t.id), [carla]);
});

test("trocar a lista reescreve a coluna junto", async () => {
  const t = await createTask({ title: "Fechar o mês", assigneeIds: [ana] }, ana);

  const depois = await updateTask(t.id, { assigneeIds: [carla, bruno] }, ana);
  assert.deepEqual(depois.assigneeIds, [carla, bruno]);
  assert.equal(depois.assigneeId, carla);
  assert.deepEqual(await conferirAcordo(t.id), [carla, bruno]);
});

test("mandar assigneeId num patch substitui a lista inteira", async () => {
  // É o que a célula da planilha faria se mandasse só o campo antigo. Deixar a
  // lista intacta faria a tela mostrar um responsável e o banco guardar três.
  const t = await createTask({ title: "Revisar contrato", assigneeIds: [ana, bruno] }, ana);

  const depois = await updateTask(t.id, { assigneeId: carla }, ana);
  assert.deepEqual(depois.assigneeIds, [carla]);
  assert.deepEqual(await conferirAcordo(t.id), [carla]);
});

test("lista vazia tira todo mundo", async () => {
  const t = await createTask({ title: "Arquivar as notas", assigneeIds: [ana, bruno] }, ana);

  const depois = await updateTask(t.id, { assigneeIds: [] }, ana);
  assert.deepEqual(depois.assigneeIds, []);
  assert.equal(depois.assigneeId, null);
  assert.deepEqual(await conferirAcordo(t.id), []);
});

test("um patch que não fala de responsável não mexe em quem já está", async () => {
  // A diferença entre "não falei disso" e "tire todos" é o que impede uma
  // mudança de prazo de esvaziar a tarefa.
  const t = await createTask({ title: "Ligar para o fornecedor", assigneeIds: [ana, bruno] }, ana);

  const depois = await updateTask(t.id, { priority: "agora" }, ana);
  assert.deepEqual(depois.assigneeIds, [ana, bruno]);
  assert.deepEqual(await conferirAcordo(t.id), [ana, bruno]);
});

test("repetido não entra duas vezes e a ordem do primeiro vale", async () => {
  const t = await createTask({ title: "Organizar a pasta", assigneeIds: [ana, bruno, ana] }, ana);
  assert.deepEqual(t.assigneeIds, [ana, bruno]);
});

test("pessoa inexistente é recusada, e ninguém entra pela metade", async () => {
  const t = await createTask({ title: "Testar a guarda", assigneeIds: [ana] }, ana);

  await assert.rejects(
    () => updateTask(t.id, { assigneeIds: [bruno, 99999] }, ana),
    /Pessoa inexistente/
  );

  // A recusa acontece antes de qualquer escrita: quem estava, continua.
  assert.deepEqual(await conferirAcordo(t.id), [ana]);
});

test("a trilha guarda a lista, e a lista antiga de um nome continua legível", async () => {
  const t = await createTask({ title: "Escrever o resumo", assigneeIds: [ana] }, ana);
  await updateTask(t.id, { assigneeIds: [ana, bruno] }, ana);

  const doQuem = (await taskTimeline(t.id)).filter((e) => e.kind === "assignee");
  const ultimo = doQuem[0].to === `${ana},${bruno}` ? doQuem[0] : doQuem[doQuem.length - 1];

  assert.equal(ultimo.to, `${ana},${bruno}`);
  assert.equal(
    doQuem.some((e) => e.to === String(ana)),
    true,
    "a primeira atribuição gravou um id só, que é uma lista de um"
  );
});

test("trocar só de responsável ainda marca a tarefa como tocada", async () => {
  const t = await createTask({ title: "Puxar o relatório", assigneeIds: [ana] }, ana);
  const antes = (await one("SELECT touched_at FROM tasks WHERE id = ?", [t.id])).touched_at;

  await new Promise((r) => setTimeout(r, 5));
  await updateTask(t.id, { assigneeIds: [bruno] }, ana);

  const depois = (await one("SELECT touched_at FROM tasks WHERE id = ?", [t.id])).touched_at;
  assert.notEqual(depois, antes, "sem isto o cartão envelhece na tela como se ninguém o tocasse");
});

test("apagar a tarefa não deixa responsável órfão", async () => {
  const t = await createTask({ title: "Some daqui", assigneeIds: [ana, bruno] }, ana);
  await deleteTask(t.id, ana);

  const sobrou = await all("SELECT user_id FROM task_assignees WHERE task_id = ?", [t.id]);
  assert.deepEqual(sobrou, []);
});

test("a leitura de uma tarefa só devolve os dois formatos", async () => {
  const t = await createTask({ title: "Ler dos dois jeitos", assigneeIds: [bruno, carla] }, ana);
  const lida = await getTaskFull(t.id);

  assert.equal(lida.assigneeId, bruno);
  assert.deepEqual(lida.assigneeIds, [bruno, carla]);
});
