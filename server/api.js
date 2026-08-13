// Rotas da API. Este arquivo é a definição prática do contrato descrito em
// docs/API.md.
//
// Nada aqui sabe onde o aplicativo está rodando: o driver de banco e o de
// arquivo já resolveram isso antes. A mesma requisição produz a mesma resposta
// num servidor próprio ou numa função hospedada.

import { all, one, run, insert, nowIso, today, getSetting, setSetting } from "./db.js";
import {
  COOKIE,
  createSession,
  destroySession,
  findByUsername,
  verifyPassword,
  verifyPasswordConstantTime,
  podeTentar,
  registrarFalha,
  limparTentativas,
  minutosAteLiberar,
  setPassword,
  listUsers,
  publicUser,
  createUser,
  generatePassword,
} from "./auth.js";
import {
  listTasks,
  getTaskFull,
  createTask,
  updateTask,
  deleteTask,
  moveTask,
  addStep,
  toggleStep,
  removeStep,
  setLabels,
  tasksByIds,
  STATUSES,
  PRIORITIES,
  ENERGIES,
} from "./tasks.js";
import {
  listComments,
  addComment,
  editComment,
  deleteComment,
  listAttachments,
  getAttachment,
  readAttachment,
  saveAttachment,
  deleteAttachment,
  isInline,
  MAX_UPLOAD,
} from "./comments.js";
import { taskTimeline, recentActivity, cursor, changedSince, logEvent } from "./events.js";
import { readJson, readBody, sendJson, sendError, cookieHeader } from "./http.js";

export async function handleApi(req, res, { path, query, user }) {
  const seg = path.split("/").filter(Boolean); // ["api", ...]
  const parts = seg.slice(1);
  const method = req.method.toUpperCase();
  const head = parts[0];

  // --- Rotas abertas -------------------------------------------------------
  if (head === "session" && method === "POST") return login(req, res);
  if (head === "session" && method === "DELETE") return logout(req, res);
  if (head === "boot" && method === "GET") return boot(req, res, user);

  if (!user) return sendError(res, 401, "Sessão expirada ou inexistente.");

  // --- Estado completo -----------------------------------------------------
  if (head === "state" && method === "GET") {
    return sendJson(res, 200, await snapshot(user));
  }

  // Sincronização incremental: o próprio log de eventos é o cursor.
  if (head === "sync" && method === "GET") {
    const from = Number(query.get("cursor") || 0);
    const now = await cursor();
    if (now === from) return sendJson(res, 200, { cursor: now, tasks: [], events: [] });

    const ids = await changedSince(from);
    const vivas = await tasksByIds(ids);

    // O que mudou mas não voltou na consulta foi apagado. Deduzir daqui evita
    // uma consulta por identificador, que no modo hospedado seria uma ida à
    // rede para cada tarefa tocada.
    const presentes = new Set(vivas.map((t) => t.id));

    return sendJson(res, 200, {
      cursor: now,
      tasks: vivas,
      removed: ids.filter((id) => !presentes.has(id)),
      events: await recentActivity(40),
    });
  }

  // --- Tarefas -------------------------------------------------------------
  if (head === "tasks") {
    const id = Number(parts[1]);

    if (!parts[1]) {
      if (method === "GET")
        return sendJson(res, 200, {
          tasks: await listTasks({ includeArchived: query.get("archived") === "1" }),
        });
      if (method === "POST") {
        const body = await readJson(req);
        return sendJson(res, 201, { task: await createTask(body, user.id) });
      }
    }

    if (id && parts.length === 2) {
      if (method === "GET") {
        const task = await getTaskFull(id);
        if (!task) return sendError(res, 404, "Tarefa não encontrada.");
        return sendJson(res, 200, {
          task,
          comments: await listComments(id),
          attachments: await listAttachments(id),
          timeline: await taskTimeline(id),
        });
      }
      if (method === "PATCH") {
        const body = await readJson(req);
        if (Array.isArray(body.labels)) await setLabels(id, body.labels, user.id);
        const task = await updateTask(id, body, user.id);
        return sendJson(res, 200, { task });
      }
      if (method === "DELETE") {
        if (user.role !== "admin") return sendError(res, 403, "Apenas administradores apagam tarefas.");
        await deleteTask(id);
        return sendJson(res, 200, { ok: true });
      }
    }

    if (id && parts[2] === "move" && method === "POST") {
      const body = await readJson(req);
      return sendJson(res, 200, { task: await moveTask(id, body, user.id) });
    }

    // --- Passos ------------------------------------------------------------
    if (id && parts[2] === "steps") {
      if (method === "POST") {
        const body = await readJson(req);
        await addStep(id, body.text, user.id);
        return sendJson(res, 201, { task: await getTaskFull(id) });
      }
      const stepId = Number(parts[3]);
      if (stepId && method === "PATCH") {
        const body = await readJson(req);
        await toggleStep(stepId, !!body.done, user.id);
        return sendJson(res, 200, { task: await getTaskFull(id) });
      }
      if (stepId && method === "DELETE") {
        await removeStep(stepId, user.id);
        return sendJson(res, 200, { task: await getTaskFull(id) });
      }
    }

    // --- Comentários -------------------------------------------------------
    if (id && parts[2] === "comments") {
      if (method === "GET") return sendJson(res, 200, { comments: await listComments(id) });
      if (method === "POST") {
        const body = await readJson(req);
        await addComment(id, body.body, user.id);
        return sendJson(res, 201, {
          comments: await listComments(id),
          task: await getTaskFull(id),
          timeline: await taskTimeline(id),
        });
      }
    }

    // --- Anexos ------------------------------------------------------------
    // Corpo binário puro em vez de multipart: menos código, menos superfície
    // de erro, e o navegador envia um Blob diretamente.
    if (id && parts[2] === "attachments" && method === "POST") {
      const mime = String(req.headers["content-type"] || "").split(";")[0].trim();
      const name = decodeURIComponent(String(req.headers["x-file-name"] || "anexo"));
      const commentId = req.headers["x-comment-id"] ? Number(req.headers["x-comment-id"]) : null;
      const buffer = await readBody(req, MAX_UPLOAD + 1024);
      const att = await saveAttachment({
        taskId: id,
        commentId,
        buffer,
        mime,
        originalName: name,
        actorId: user.id,
      });
      return sendJson(res, 201, { attachment: att, task: await getTaskFull(id) });
    }

    if (id && parts[2] === "timeline" && method === "GET") {
      return sendJson(res, 200, { timeline: await taskTimeline(id) });
    }
  }

  // --- Comentário individual ------------------------------------------------
  if (head === "comments" && parts[1]) {
    const cid = Number(parts[1]);
    if (method === "PATCH") {
      const body = await readJson(req);
      const c = await editComment(cid, body.body, user.id);
      return sendJson(res, 200, { comments: await listComments(c.task_id) });
    }
    if (method === "DELETE") {
      const c = await one("SELECT task_id FROM comments WHERE id = ?", [cid]);
      await deleteComment(cid, user);
      return sendJson(res, 200, { comments: c ? await listComments(c.task_id) : [] });
    }
  }

  // --- Arquivo do anexo -----------------------------------------------------
  if (head === "attachments" && parts[1]) {
    const aid = Number(parts[1]);
    const att = await getAttachment(aid);
    if (!att) return sendError(res, 404, "Anexo não encontrado.");

    if (method === "DELETE") {
      await deleteAttachment(aid, user);
      return sendJson(res, 200, { ok: true });
    }
    if (method === "GET") {
      // O conteúdo vem do disco ou do armazenamento remoto, conforme a
      // instância. Em nenhum dos dois casos quem usa recebe o endereço real:
      // o arquivo sempre passa por aqui, depois da checagem de sessão.
      const arquivo = await readAttachment(aid);
      if (!arquivo) return sendError(res, 404, "Arquivo não encontrado.");

      const disposition = isInline(att.mime) ? "inline" : "attachment";
      res.writeHead(200, {
        "Content-Type": att.mime,
        "Content-Length": arquivo.conteudo.length,
        // nosniff impede que o navegador reinterprete o conteúdo como HTML.
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(att.name)}`,
        "Cache-Control": "private, max-age=86400",
      });
      return res.end(arquivo.conteudo);
    }
  }

  // --- Projetos -------------------------------------------------------------
  if (head === "projects") {
    if (method === "GET") return sendJson(res, 200, { projects: await listProjects() });
    if (method === "POST") {
      const body = await readJson(req);
      return sendJson(res, 201, { project: await createProject(body) });
    }
    const pid = Number(parts[1]);
    if (pid && method === "PATCH") {
      const body = await readJson(req);
      return sendJson(res, 200, { project: await updateProject(pid, body) });
    }
  }

  // --- Etiquetas ------------------------------------------------------------
  if (head === "labels") {
    if (method === "GET") return sendJson(res, 200, { labels: await all("SELECT * FROM labels ORDER BY name") });
    if (method === "POST") {
      const body = await readJson(req);
      const name = String(body.name || "").trim().slice(0, 40);
      if (!name) return sendError(res, 400, "A etiqueta precisa de um nome.");
      const existing = await one("SELECT * FROM labels WHERE lower(name) = lower(?)", [name]);
      if (existing) return sendJson(res, 200, { label: existing });
      const lid = await insert("INSERT INTO labels (name, color) VALUES (?, ?)", [
        name,
        String(body.color || "#8fa9b5").slice(0, 9),
      ]);
      return sendJson(res, 201, { label: await one("SELECT * FROM labels WHERE id = ?", [lid]) });
    }
    const lid = Number(parts[1]);
    if (lid && method === "DELETE") {
      await run("DELETE FROM labels WHERE id = ?", [lid]);
      return sendJson(res, 200, { ok: true });
    }
  }

  // --- Pessoas --------------------------------------------------------------
  if (head === "users") {
    if (method === "GET") return sendJson(res, 200, { users: (await listUsers()).map(publicUser) });
    if (method === "POST") {
      if (user.role !== "admin") return sendError(res, 403, "Apenas administradores criam acessos.");
      const body = await readJson(req);
      const senha = generatePassword();
      const novo = await createUser({
        username: body.username,
        displayName: body.name,
        email: body.email || null,
        password: senha,
        role: body.role === "admin" ? "admin" : "member",
        color: body.color || "#a2e4f0",
      });
      // A senha aparece uma única vez, na resposta desta chamada, e não é
      // gravada em lugar nenhum além do hash.
      return sendJson(res, 201, { user: publicUser(novo), senhaInicial: senha });
    }
  }

  // --- Preferências e senha da própria pessoa -------------------------------
  if (head === "me") {
    if (parts[1] === "prefs" && method === "PATCH") {
      const body = await readJson(req);
      const atual = safeJson((await one("SELECT prefs FROM users WHERE id = ?", [user.id]))?.prefs);
      const merged = { ...atual, ...body };
      await run("UPDATE users SET prefs = ? WHERE id = ?", [JSON.stringify(merged), user.id]);
      return sendJson(res, 200, { prefs: merged });
    }
    if (parts[1] === "password" && method === "POST") {
      const body = await readJson(req);
      const full = await one("SELECT * FROM users WHERE id = ?", [user.id]);
      if (!verifyPassword(String(body.atual || ""), full.password_hash))
        return sendError(res, 403, "A senha atual não confere.");
      const nova = String(body.nova || "");
      if (nova.length < 8) return sendError(res, 400, "A nova senha precisa de ao menos 8 caracteres.");
      await setPassword(user.id, nova);
      const s = await createSession(user.id, req.headers["user-agent"]);
      return sendJson(res, 200, { ok: true }, {
        "Set-Cookie": cookieHeader(COOKIE, s.token, { maxAge: 2592000, secure: httpsAtivo(req) }),
      });
    }
  }

  // --- Foco -----------------------------------------------------------------
  if (head === "focus") {
    if (parts[1] === "start" && method === "POST") {
      const body = await readJson(req);
      await run("UPDATE focus_sessions SET ended_at = ?, completed = 0 WHERE user_id = ? AND ended_at IS NULL", [
        nowIso(),
        user.id,
      ]);
      const fid = await insert(
        "INSERT INTO focus_sessions (task_id, user_id, started_at, planned_min) VALUES (?, ?, ?, ?)",
        [body.taskId ? Number(body.taskId) : null, user.id, nowIso(), Number(body.minutes) || 25]
      );
      return sendJson(res, 201, { session: await one("SELECT * FROM focus_sessions WHERE id = ?", [fid]) });
    }
    if (parts[1] === "stop" && method === "POST") {
      const body = await readJson(req);
      const open = await one(
        "SELECT * FROM focus_sessions WHERE user_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1",
        [user.id]
      );
      if (open) {
        const secs = Math.max(0, Math.round((Date.now() - new Date(open.started_at).getTime()) / 1000));
        await run("UPDATE focus_sessions SET ended_at = ?, seconds = ?, completed = ? WHERE id = ?", [
          nowIso(),
          secs,
          body.completed ? 1 : 0,
          open.id,
        ]);
      }
      return sendJson(res, 200, { ok: true });
    }
    if (method === "GET") {
      return sendJson(res, 200, {
        today: await all(
          `SELECT COALESCE(SUM(seconds), 0) AS s, COUNT(*) AS n
             FROM focus_sessions
            WHERE user_id = ? AND completed = 1 AND substr(started_at, 1, 10) = ?`,
          [user.id, new Date().toISOString().slice(0, 10)]
        )[0],
      });
    }
  }

  // --- Atividade ------------------------------------------------------------
  if (head === "activity" && method === "GET") {
    return sendJson(res, 200, { activity: await recentActivity(Number(query.get("limit")) || 60) });
  }

  return sendError(res, 404, `Rota desconhecida: ${method} /${path}`);
}

// --- Autenticação ----------------------------------------------------------

async function login(req, res) {
  const body = await readJson(req);
  const chave = `${req.socket.remoteAddress || "?"}|${String(body.usuario || "").toLowerCase()}`;

  if (!podeTentar(chave)) {
    return sendError(
      res,
      429,
      `Tentativas demais. Tente de novo em ${minutosAteLiberar(chave)} minutos.`
    );
  }

  const u = await findByUsername(body.usuario);
  // A verificação roda mesmo quando o usuário não existe, contra um hash
  // descartável: sem isso, o tempo de resposta denunciaria quais contas existem.
  const senhaConfere = verifyPasswordConstantTime(
    String(body.senha || ""),
    u && u.is_active ? u.password_hash : null
  );

  if (!u || !u.is_active || !senhaConfere) {
    registrarFalha(chave);
    // Mesma mensagem para usuário inexistente e senha errada: não vale
    // entregar de graça a informação de quais contas existem.
    return sendError(res, 401, "Usuário ou senha incorretos.");
  }

  limparTentativas(chave);
  const s = await createSession(u.id, req.headers["user-agent"]);
  return sendJson(
    res,
    200,
    { user: publicUser(u), mustChangePassword: !!u.must_change_password },
    { "Set-Cookie": cookieHeader(COOKIE, s.token, { maxAge: 2592000, secure: httpsAtivo(req) }) }
  );
}

// O atributo Secure só pode ser ligado quando a conexão é de fato cifrada:
// marcá-lo em HTTP simples faz o navegador descartar o cookie, e ninguém mais
// consegue entrar.
//
// Atrás de um proxy reverso, o processo enxerga HTTP mesmo quando o navegador
// falou HTTPS. O cabeçalho enviado pelo proxy resolve — mas só é levado a
// sério quando a instância declara que existe um proxy à frente, senão
// qualquer cliente poderia forjá-lo.
function httpsAtivo(req) {
  if (req.socket.encrypted) return true;
  if (process.env.TRUST_PROXY_PROTO === "https") return true;
  if (process.env.TRUST_PROXY_PROTO) {
    return req.headers["x-forwarded-proto"] === "https";
  }
  return false;
}

async function logout(req, res) {
  const token = (req.headers.cookie || "").match(/tdah_sess=([^;]+)/)?.[1];
  await destroySession(token ? decodeURIComponent(token) : null);
  return sendJson(res, 200, { ok: true }, {
    "Set-Cookie": cookieHeader(COOKIE, "", { maxAge: 0, secure: httpsAtivo(req) }),
  });
}

async function boot(req, res, user) {
  return sendJson(res, 200, {
    app: "TDAH Jira — Logus",
    mode: "standalone",
    version: await getSetting("version", "1.0.0"),
    authenticated: !!user,
    user: publicUser(user),
    vocabulary: { statuses: STATUSES, priorities: PRIORITIES, energies: ENERGIES },
    limits: { maxUpload: MAX_UPLOAD },
  });
}

// --- Fotografia do estado --------------------------------------------------
// Uma chamada só entrega tudo que a interface precisa. Para um time pequeno
// isso é mais rápido e muito mais simples do que paginar.

async function snapshot(user) {
  return {
    cursor: await cursor(),
    today: today(),
    me: publicUser(user),
    prefs: safeJson((await one("SELECT prefs FROM users WHERE id = ?", [user.id]))?.prefs),
    users: (await listUsers()).map(publicUser),
    projects: await listProjects(),
    labels: await all("SELECT * FROM labels ORDER BY name"),
    tasks: await listTasks(),
    activity: await recentActivity(50),
  };
}

async function listProjects() {
  const linhas = await all(
    "SELECT * FROM projects WHERE is_archived = 0 ORDER BY position, id"
  );
  return linhas.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    color: p.color,
    description: p.description,
    position: p.position,
  }));
}

async function createProject(body) {
  const name = String(body.name || "").trim();
  if (!name) throw Object.assign(new Error("O projeto precisa de um nome."), { status: 400 });
  const key = String(body.key || name)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6) || "PRJ";

  let final = key;
  let n = 2;
  while (await one("SELECT id FROM projects WHERE key = ?", [final])) final = `${key}${n++}`;

  const ts = nowIso();
  const id = await insert(
    `INSERT INTO projects (key, name, color, description, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      final,
      name.slice(0, 120),
      String(body.color || "#a2e4f0").slice(0, 9),
      String(body.description || "").slice(0, 500),
      Number(body.position) || 0,
      ts,
      ts,
    ]
  );
  return await one("SELECT * FROM projects WHERE id = ?", [id]);
}

async function updateProject(id, body) {
  const p = await one("SELECT * FROM projects WHERE id = ?", [id]);
  if (!p) throw Object.assign(new Error("Projeto não encontrado."), { status: 404 });
  await run(
    "UPDATE projects SET name = ?, color = ?, description = ?, is_archived = ?, updated_at = ? WHERE id = ?",
    [
      String(body.name ?? p.name).slice(0, 120),
      String(body.color ?? p.color).slice(0, 9),
      String(body.description ?? p.description).slice(0, 500),
      body.archived === undefined ? p.is_archived : body.archived ? 1 : 0,
      nowIso(),
      id,
    ]
  );
  return await one("SELECT * FROM projects WHERE id = ?", [id]);
}

function safeJson(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}
