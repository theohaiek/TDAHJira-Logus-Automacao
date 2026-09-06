// A trilha. Toda mudança passa por aqui, e nada daqui é editado ou apagado.
// É o que permite responder "onde está isso e desde quando" sem pedir que
// alguém preencha um campo a mais.

import { all, insert, nowIso } from "./db.js";

export async function logEvent({
  taskId,
  actorId = null,
  kind,
  field = null,
  from = null,
  to = null,
  note = null,
}) {
  return insert(
    `INSERT INTO events (task_id, actor_id, kind, field, from_value, to_value, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      taskId,
      actorId,
      kind,
      field,
      from === null || from === undefined ? null : String(from),
      to === null || to === undefined ? null : String(to),
      note,
      nowIso(),
    ]
  );
}

export async function taskTimeline(taskId) {
  const linhas = await all(
    `SELECT e.*, u.display_name AS actor_name, u.color AS actor_color
       FROM events e
       LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.task_id = ?
      ORDER BY e.id`,
    [taskId]
  );
  return linhas.map(shape);
}

// Atividade recente de toda a instância: a resposta para "o que andou hoje".
export async function recentActivity(limit = 80) {
  const linhas = await all(
    `SELECT e.*, u.display_name AS actor_name, u.color AS actor_color,
            t.title AS task_title, t.id AS tid,
            p.key AS project_key, t.number AS task_number
       FROM events e
       LEFT JOIN users u ON u.id = e.actor_id
       LEFT JOIN tasks t ON t.id = e.task_id
       LEFT JOIN projects p ON p.id = t.project_id
      WHERE e.task_id IS NOT NULL OR e.kind = 'deleted'
      ORDER BY e.id DESC
      LIMIT ?`,
    [Math.min(Number(limit) || 80, 300)]
  );

  return linhas.map((e) => ({
    ...shape(e),
    taskTitle: e.task_title,
    taskKey: e.project_key && e.task_number ? `${e.project_key}-${e.task_number}` : null,
  }));
}

export async function cursor() {
  const linha = await all("SELECT COALESCE(MAX(id), 0) AS c FROM events");
  return linha.length ? Number(linha[0].c) : 0;
}

// Quais tarefas mudaram depois de um dado ponto da trilha. O próprio log de
// eventos funciona como cursor de sincronização entre as pessoas conectadas.
export async function changedSince(cur) {
  const linhas = await all(
    "SELECT DISTINCT task_id FROM events WHERE id > ? AND task_id IS NOT NULL",
    [Number(cur) || 0]
  );
  return linhas.map((r) => r.task_id);
}

// Identificadores das tarefas apagadas desde o cursor.
//
// O evento de exclusão nasce com task_id nulo — a linha da tarefa não existe
// mais, e a chave estrangeira levaria o evento junto no CASCADE. O número da
// tarefa fica em to_value, e é por ele que o cliente sabe qual cartão tirar
// da tela.
export async function deletedSince(cur) {
  const linhas = await all(
    "SELECT to_value FROM events WHERE id > ? AND kind = 'deleted' AND task_id IS NULL",
    [Number(cur) || 0]
  );
  return linhas.map((r) => Number(r.to_value)).filter((n) => Number.isFinite(n));
}

function shape(e) {
  return {
    id: e.id,
    taskId: e.task_id,
    actorId: e.actor_id,
    actorName: e.actor_name || null,
    actorColor: e.actor_color || null,
    kind: e.kind,
    field: e.field,
    from: e.from_value,
    to: e.to_value,
    note: e.note,
    at: e.created_at,
  };
}
