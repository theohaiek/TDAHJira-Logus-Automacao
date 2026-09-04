// Regras de tarefa. Concentra o que o servidor precisa garantir para que a
// história fique correta: quando algo começou, desde quando está parado,
// quem mexeu no quê.

import { all, one, run, insert, tx, nowIso, today, getDb } from "./db.js";
import { logEvent } from "./events.js";

export const STATUSES = ["inbox", "todo", "doing", "waiting", "done"];
export const PRIORITIES = ["agora", "normal", "quando_der"];
export const ENERGIES = ["leve", "media", "pesada"];

// "task" é o trabalho do dia a dia. Os outros três são horizontes mais longos
// e ficam fora da fila principal — aparecem em quadros próprios, menores.
export const KINDS = ["task", "longa", "oportunidade", "meta"];

// Campos que a API aceita alterar, e como cada um se chama no banco.
const FIELDS = {
  title: { col: "title", type: "text" },
  description: { col: "description", type: "text" },
  status: { col: "status", type: "enum", values: STATUSES },
  kind: { col: "kind", type: "enum", values: KINDS },
  priority: { col: "priority", type: "enum", values: PRIORITIES },
  energy: { col: "energy", type: "enum", values: ENERGIES, nullable: true },
  size: { col: "size", type: "int", nullable: true, min: 1, max: 40 },
  assigneeId: { col: "assignee_id", type: "int", nullable: true },
  projectId: { col: "project_id", type: "int", nullable: true },
  parentId: { col: "parent_id", type: "int", nullable: true },
  dueOn: { col: "due_on", type: "date", nullable: true },
  focusOn: { col: "focus_on", type: "date", nullable: true },
  waitingFor: { col: "waiting_for", type: "text", nullable: true },
  position: { col: "position", type: "real" },
  archived: { col: "is_archived", type: "bool" },
};

const EVENT_FOR = {
  title: "title",
  description: "description",
  status: "status",
  kind: "kind",
  priority: "priority",
  energy: "energy",
  size: "size",
  assigneeId: "assignee",
  projectId: "project",
  parentId: "parent",
  dueOn: "due",
  focusOn: "focus",
  waitingFor: "waiting",
  archived: "archived",
};

// --- Leitura ---------------------------------------------------------------

const SELECT_TASK = `
  SELECT t.*, p.key AS project_key, p.color AS project_color, p.name AS project_name
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id`;

export async function getTask(id) {
  const row = await one(`${SELECT_TASK} WHERE t.id = ?`, [id]);
  return row ? shape(row) : null;
}

export async function listTasks({ includeArchived = false } = {}) {
  const rows = await all(
    `${SELECT_TASK} ${includeArchived ? "" : "WHERE t.is_archived = 0"}
     ORDER BY t.position, t.id`
  );
  return decorate(rows);
}

export async function tasksByIds(ids) {
  if (!ids.length) return [];
  const marks = ids.map(() => "?").join(",");
  return decorate(await all(`${SELECT_TASK} WHERE t.id IN (${marks})`, ids));
}

// Anexa a cada tarefa o que o cartão precisa mostrar sem uma segunda ida ao
// servidor: passos, etiquetas e a contagem da conversa.
async function decorate(rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => "?").join(",");

  // As quatro consultas são independentes; pedir em paralelo importa quando
  // cada uma é uma ida à rede, como no modo hospedado.
  const [steps, labels, comments, files] = await Promise.all([
    all(`SELECT * FROM steps WHERE task_id IN (${marks}) ORDER BY position, id`, ids),
    all(`SELECT task_id, label_id FROM task_labels WHERE task_id IN (${marks})`, ids),
    all(
      `SELECT task_id, COUNT(*) AS n FROM comments WHERE task_id IN (${marks}) GROUP BY task_id`,
      ids
    ),
    all(
      `SELECT task_id, COUNT(*) AS n FROM attachments WHERE task_id IN (${marks}) GROUP BY task_id`,
      ids
    ),
  ]);

  const byTask = (list) => {
    const m = new Map();
    for (const r of list) {
      if (!m.has(r.task_id)) m.set(r.task_id, []);
      m.get(r.task_id).push(r);
    }
    return m;
  };
  const stepMap = byTask(steps);
  const labelMap = byTask(labels);
  const commentMap = new Map(comments.map((c) => [c.task_id, c.n]));
  const fileMap = new Map(files.map((c) => [c.task_id, c.n]));

  return rows.map((r) => {
    const t = shape(r);
    t.steps = (stepMap.get(r.id) || []).map((s) => ({
      id: s.id,
      text: s.text,
      done: !!s.is_done,
      position: s.position,
    }));
    t.labels = (labelMap.get(r.id) || []).map((l) => l.label_id);
    t.commentCount = commentMap.get(r.id) || 0;
    t.attachmentCount = fileMap.get(r.id) || 0;
    return t;
  });
}

function shape(r) {
  return {
    id: r.id,
    key: r.project_key && r.number ? `${r.project_key}-${r.number}` : `#${r.id}`,
    number: r.number,
    projectId: r.project_id,
    projectKey: r.project_key || null,
    projectColor: r.project_color || null,
    projectName: r.project_name || null,
    title: r.title,
    description: r.description || "",
    status: r.status,
    kind: r.kind || "task",
    priority: r.priority,
    energy: r.energy,
    size: r.size,
    assigneeId: r.assignee_id,
    reporterId: r.reporter_id,
    parentId: r.parent_id,
    dueOn: r.due_on,
    focusOn: r.focus_on,
    waitingFor: r.waiting_for,
    position: r.position,
    archived: !!r.is_archived,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    startedAt: r.started_at,
    doneAt: r.done_at,
    statusSince: r.status_since,
    touchedAt: r.touched_at,
    steps: [],
    labels: [],
    commentCount: 0,
    attachmentCount: 0,
  };
}

// --- Escrita ---------------------------------------------------------------

export async function createTask(input, actorId) {
  const title = String(input.title || "").trim();
  if (!title) throw badRequest("A tarefa precisa de um título.");
  if (title.length > 500) throw badRequest("Título longo demais.");

  return tx(async () => {
    const projectId = input.projectId ? Number(input.projectId) : null;
    let number = null;

    if (projectId) {
      const proj = await one("SELECT id FROM projects WHERE id = ?", [projectId]);
      if (!proj) throw badRequest("Projeto inexistente.");

      // Incremento no próprio banco. Ler o valor, somar aqui e gravar de
      // volta faria duas pessoas criando ao mesmo tempo receberem o mesmo
      // número — e a chave visível deixaria de ser única.
      await run("UPDATE projects SET seq = seq + 1, updated_at = ? WHERE id = ?", [
        nowIso(),
        projectId,
      ]);
      const atual = await one("SELECT seq FROM projects WHERE id = ?", [projectId]);
      number = atual.seq;
    }

    const ts = nowIso();
    const status = STATUSES.includes(input.status) ? input.status : "inbox";
    const id = await insert(
      `INSERT INTO tasks (project_id, number, title, description, status, kind, priority,
                          energy, size, assignee_id, reporter_id, parent_id,
                          due_on, focus_on, waiting_for, position,
                          created_at, updated_at, status_since, touched_at,
                          started_at, done_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        projectId,
        number,
        title,
        String(input.description || ""),
        status,
        KINDS.includes(input.kind) ? input.kind : "task",
        PRIORITIES.includes(input.priority) ? input.priority : "normal",
        ENERGIES.includes(input.energy) ? input.energy : null,
        input.size ? Math.max(1, Math.min(40, Number(input.size))) : null,
        input.assigneeId ? Number(input.assigneeId) : null,
        actorId || null,
        input.parentId ? Number(input.parentId) : null,
        cleanDate(input.dueOn),
        cleanDate(input.focusOn),
        input.waitingFor ? String(input.waitingFor).slice(0, 200) : null,
        typeof input.position === "number" ? input.position : await nextPosition(status),
        ts,
        ts,
        ts,
        ts,
        status === "doing" ? ts : null,
        status === "done" ? ts : null,
      ]
    );

    await logEvent({ taskId: id, actorId, kind: "created", to: title });

    if (Array.isArray(input.steps)) {
      for (const [i, text] of input.steps.entries()) {
        const clean = String(text || "").trim();
        if (clean) await addStep(id, clean, actorId, i * 1000);
      }
    }
    return getTaskFull(id);
  });
}

export async function updateTask(id, patch, actorId) {
  return tx(async () => {
    const before = await one("SELECT * FROM tasks WHERE id = ?", [id]);
    if (!before) throw notFound("Tarefa não encontrada.");

    const sets = [];
    const params = [];
    const changes = [];

    for (const [key, spec] of Object.entries(FIELDS)) {
      if (!(key in patch)) continue;
      const value = coerce(key, spec, patch[key]);
      const current = before[spec.col];
      if (String(current ?? "") === String(value ?? "")) continue;

      sets.push(`${spec.col} = ?`);
      params.push(value);
      changes.push({ key, col: spec.col, from: current, to: value });
    }

    if (!changes.length) return getTaskFull(id);

    const ts = nowIso();
    const statusChange = changes.find((c) => c.key === "status");

    if (statusChange) {
      sets.push("status_since = ?");
      params.push(ts);
      if (statusChange.to === "doing" && !before.started_at) {
        sets.push("started_at = ?");
        params.push(ts);
      }
      if (statusChange.to === "done") {
        sets.push("done_at = ?");
        params.push(ts);
      } else if (before.status === "done") {
        sets.push("done_at = ?");
        params.push(null);
      }
      // Sair de "esperando" limpa de quem se esperava: dado obsoleto engana.
      if (statusChange.from === "waiting" && statusChange.to !== "waiting" && !("waitingFor" in patch)) {
        sets.push("waiting_for = ?");
        params.push(null);
        if (before.waiting_for) {
          changes.push({ key: "waitingFor", col: "waiting_for", from: before.waiting_for, to: null });
        }
      }
      // Puxar para "fazendo" é declarar que é hoje.
      if (statusChange.to === "doing" && !before.focus_on && !("focusOn" in patch)) {
        sets.push("focus_on = ?");
        params.push(today());
      }
    }

    sets.push("updated_at = ?", "touched_at = ?");
    params.push(ts, ts, id);
    await run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, params);

    for (const c of changes) {
      await logEvent({
        taskId: id,
        actorId,
        kind: EVENT_FOR[c.key] || "update",
        field: c.key,
        from: c.from,
        to: c.to,
      });
    }
    return getTaskFull(id);
  });
}

export async function deleteTask(id) {
  // O banco local apaga as dependentes em cascata pela chave estrangeira.
  // No modo hospedado a integridade referencial não é garantida do mesmo
  // jeito, então as filhas saem à mão para não virarem órfãs invisíveis.
  const filhas = await all("SELECT id FROM tasks WHERE parent_id = ?", [id]);
  for (const f of filhas) await deleteTask(f.id);

  if (getDb().tipo !== "local") {
    for (const tabela of ["steps", "comments", "attachments", "events", "task_labels", "focus_sessions"]) {
      await run(`DELETE FROM ${tabela} WHERE task_id = ?`, [id]);
    }
  }
  await run("DELETE FROM tasks WHERE id = ?", [id]);
}

// Reordenação por posição fracionária: mover um cartão só escreve uma linha.
export async function moveTask(id, { status, beforeId = null, afterId = null }, actorId) {
  const target = STATUSES.includes(status) ? status : null;
  const patch = {};
  if (target) patch.status = target;

  const atual = await one("SELECT status FROM tasks WHERE id = ?", [id]);
  const col = target || atual?.status;

  const prev = afterId ? await one("SELECT position FROM tasks WHERE id = ?", [afterId]) : null;
  const next = beforeId ? await one("SELECT position FROM tasks WHERE id = ?", [beforeId]) : null;

  let position;
  if (prev && next) position = (prev.position + next.position) / 2;
  else if (prev) position = prev.position + 1024;
  else if (next) position = next.position - 1024;
  else position = await nextPosition(col);

  patch.position = position;
  return updateTask(id, patch, actorId);
}

async function nextPosition(status) {
  const row = await one("SELECT MAX(position) AS m FROM tasks WHERE status = ?", [status]);
  return (row?.m ?? 0) + 1024;
}

// --- Passos ----------------------------------------------------------------

export async function addStep(taskId, text, actorId, position = null) {
  const clean = String(text || "").trim();
  if (!clean) throw badRequest("O passo precisa de um texto.");

  const existe = await one("SELECT id FROM tasks WHERE id = ?", [taskId]);
  if (!existe) throw notFound("Tarefa não encontrada.");

  let pos = position;
  if (pos === null) {
    const max = await one("SELECT MAX(position) AS m FROM steps WHERE task_id = ?", [taskId]);
    pos = (max?.m ?? 0) + 1000;
  }

  const id = await insert(
    "INSERT INTO steps (task_id, text, position, created_at) VALUES (?, ?, ?, ?)",
    [taskId, clean.slice(0, 300), pos, nowIso()]
  );
  await logEvent({ taskId, actorId, kind: "step_add", to: clean.slice(0, 300) });
  await touch(taskId);
  return one("SELECT * FROM steps WHERE id = ?", [id]);
}

export async function toggleStep(stepId, done, actorId) {
  const step = await one("SELECT * FROM steps WHERE id = ?", [stepId]);
  if (!step) throw notFound("Passo não encontrado.");

  await run("UPDATE steps SET is_done = ?, done_at = ? WHERE id = ?", [
    done ? 1 : 0,
    done ? nowIso() : null,
    stepId,
  ]);
  await logEvent({
    taskId: step.task_id,
    actorId,
    kind: done ? "step_done" : "step_undone",
    to: step.text,
  });
  await touch(step.task_id);
  return one("SELECT * FROM steps WHERE id = ?", [stepId]);
}

export async function removeStep(stepId, actorId) {
  const step = await one("SELECT * FROM steps WHERE id = ?", [stepId]);
  if (!step) return;
  await run("DELETE FROM steps WHERE id = ?", [stepId]);
  await logEvent({ taskId: step.task_id, actorId, kind: "step_remove", from: step.text });
  await touch(step.task_id);
}

// --- Etiquetas -------------------------------------------------------------

export async function setLabels(taskId, labelIds, actorId) {
  const wanted = new Set((labelIds || []).map(Number).filter(Boolean));
  const atuais = await all("SELECT label_id FROM task_labels WHERE task_id = ?", [taskId]);
  const current = new Set(atuais.map((r) => r.label_id));

  for (const id of wanted) {
    if (!current.has(id)) {
      await run("INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)", [taskId, id]);
      await logEvent({ taskId, actorId, kind: "label_add", to: String(id) });
    }
  }
  for (const id of current) {
    if (!wanted.has(id)) {
      await run("DELETE FROM task_labels WHERE task_id = ? AND label_id = ?", [taskId, id]);
      await logEvent({ taskId, actorId, kind: "label_remove", from: String(id) });
    }
  }
  await touch(taskId);
}

// --- Auxiliares ------------------------------------------------------------

export async function touch(taskId) {
  const ts = nowIso();
  await run("UPDATE tasks SET touched_at = ?, updated_at = ? WHERE id = ?", [ts, ts, taskId]);
}

export async function getTaskFull(id) {
  const [t] = await tasksByIds([id]);
  return t || null;
}

function coerce(key, spec, raw) {
  const empty = raw === null || raw === undefined || raw === "";
  if (empty) {
    if (spec.nullable) return null;
    if (spec.type === "bool") return 0;
    throw badRequest(`O campo ${key} não pode ficar vazio.`);
  }
  switch (spec.type) {
    case "enum":
      if (!spec.values.includes(raw)) throw badRequest(`Valor inválido para ${key}.`);
      return raw;
    case "int": {
      let n = Number(raw);
      if (!Number.isFinite(n)) throw badRequest(`Valor inválido para ${key}.`);
      n = Math.round(n);
      if (spec.min !== undefined) n = Math.max(spec.min, n);
      if (spec.max !== undefined) n = Math.min(spec.max, n);
      return n;
    }
    case "real": {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw badRequest(`Valor inválido para ${key}.`);
      return n;
    }
    case "bool":
      return raw === true || raw === 1 || raw === "1" || raw === "true" ? 1 : 0;
    case "date": {
      const d = cleanDate(raw);
      if (!d) throw badRequest(`Data inválida em ${key}.`);
      return d;
    }
    default: {
      const s = String(raw);
      if (s.length > 20000) throw badRequest(`Texto longo demais em ${key}.`);
      return s;
    }
  }
}

function cleanDate(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export function badRequest(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}

export function notFound(message) {
  const e = new Error(message);
  e.status = 404;
  return e;
}
