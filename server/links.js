// Links da tarefa: o PR, o commit, a branch ou o documento que andam junto com
// ela. É o "link remoto" do Jira. A tarefa não ganha campo nenhum: a lista mora
// na própria tabela, e cada ligação ou remoção vira evento na trilha.
//
// Quem mais escreve aqui é o agente, pelo MCP (server/mcp/ferramentas/vincular.js),
// e por isso repetir a mesma URL não duplica: atualiza tipo e título. Um agente
// que registra o PR no começo e de novo no fim da sessão não deixa duas linhas.

import { all, one, run, insert, nowIso } from "./db.js";
import { logEvent } from "./events.js";
import { touch, badRequest, notFound } from "./tasks.js";

export const LINK_KINDS = ["pr", "commit", "branch", "doc", "link"];

const URL_MAX = 2000;
const TITULO_MAX = 200;

export async function listLinks(taskId) {
  const linhas = await all(
    `SELECT l.*, u.display_name AS author_name, u.username
       FROM task_links l
       LEFT JOIN users u ON u.id = l.author_id
      WHERE l.task_id = ?
      ORDER BY l.id`,
    [taskId]
  );
  return linhas.map(shapeLink);
}

// O tipo que a URL já diz. Só GitHub e GitLab têm formato reconhecível; o resto
// é "link", e quem chama pode dizer "doc" quando for documento.
export function tipoDoLink(url) {
  const u = String(url);
  if (/\/pull\/\d+|\/merge_requests\/\d+/.test(u)) return "pr";
  if (/\/commits?\/[0-9a-f]{7,40}\b/i.test(u)) return "commit";
  if (/\/(tree|compare)\//.test(u)) return "branch";
  return "link";
}

export async function addLink(taskId, entrada, actorId) {
  const url = validarUrl(entrada?.url);
  const kind = entrada?.kind ? String(entrada.kind) : tipoDoLink(url);
  if (!LINK_KINDS.includes(kind)) throw badRequest(`Tipo de link inválido. Aceitos: ${LINK_KINDS.join(", ")}.`);
  const title = textoLimpo(entrada?.title, TITULO_MAX) || null;

  const existe = await one("SELECT id FROM tasks WHERE id = ?", [taskId]);
  if (!existe) throw notFound("Tarefa não encontrada.");

  const antes = await one("SELECT * FROM task_links WHERE task_id = ? AND url = ?", [taskId, url]);
  if (antes) {
    // Repetir não é erro: é o agente confirmando. Só o que veio escrito muda.
    await run("UPDATE task_links SET kind = ?, title = ? WHERE id = ?", [
      entrada?.kind ? kind : antes.kind,
      title ?? antes.title,
      antes.id,
    ]);
    return { link: await linkPorId(antes.id), novo: false };
  }

  const id = await insert(
    "INSERT INTO task_links (task_id, kind, url, title, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [taskId, kind, url, title, actorId || null, nowIso()]
  );
  await logEvent({ taskId, actorId, kind: "link_add", field: kind, to: url.slice(0, 300) });
  await touch(taskId);
  return { link: await linkPorId(id), novo: true };
}

// Quem ligou ou quem administra, a mesma regra do anexo.
export async function removeLink(linkId, actor) {
  const l = await one("SELECT * FROM task_links WHERE id = ?", [linkId]);
  if (!l) throw notFound("Link não encontrado.");
  if (l.author_id !== actor.id && actor.role !== "admin") {
    throw Object.assign(new Error("Só quem ligou pode remover o link."), { status: 403 });
  }
  await run("DELETE FROM task_links WHERE id = ?", [linkId]);
  await logEvent({ taskId: l.task_id, actorId: actor.id, kind: "link_remove", field: l.kind, from: l.url.slice(0, 300) });
  await touch(l.task_id);
  return shapeLink(l);
}

async function linkPorId(id) {
  const l = await one(
    `SELECT l.*, u.display_name AS author_name, u.username
       FROM task_links l LEFT JOIN users u ON u.id = l.author_id WHERE l.id = ?`,
    [id]
  );
  return l ? shapeLink(l) : null;
}

// Só http e https. A URL vira href na tela: aceitar "javascript:" aqui seria
// entregar um clique que executa código na sessão de quem abrir o ticket.
function validarUrl(bruto) {
  const texto = String(bruto || "").trim();
  if (!texto) throw badRequest("O link precisa de uma URL.");
  if (texto.length > URL_MAX) throw badRequest("URL longa demais.");
  let u;
  try {
    u = new URL(texto);
  } catch {
    throw badRequest("URL inválida.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw badRequest("Só links http ou https.");
  return u.href;
}

function textoLimpo(valor, max) {
  if (valor === null || valor === undefined) return "";
  let saida = "";
  for (const ch of String(valor)) {
    const code = ch.codePointAt(0);
    if (code < 32 || code === 127) continue;
    saida += ch;
  }
  return saida.trim().slice(0, max);
}

function shapeLink(l) {
  return {
    id: l.id,
    taskId: l.task_id,
    kind: l.kind,
    url: l.url,
    title: l.title || null,
    authorId: l.author_id,
    authorName: l.author_name || null,
    authorUsername: l.username || null,
    createdAt: l.created_at,
  };
}
