// Conversa no ticket e anexos.
//
// O comentário é texto puro. A formatação é resolvida na exibição, com um
// subconjunto mínimo de marcação — o suficiente para registrar decisão e
// contexto, e pouco o bastante para não virar um editor de documentos.

import { randomBytes } from "node:crypto";
import { all, one, run, insert, nowIso } from "./db.js";
import { logEvent } from "./events.js";
import { touch, badRequest, notFound } from "./tasks.js";
import { guardar, ler, remover } from "./storage.js";

export const MAX_UPLOAD = 12 * 1024 * 1024; // 12 MB: um print cabe com folga.

// Lista fechada. Nada de executável, nada de svg (que carrega script).
const ALLOWED = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["image/avif", ".avif"],
  ["application/pdf", ".pdf"],
  ["text/plain", ".txt"],
  ["text/csv", ".csv"],
  ["application/zip", ".zip"],
  ["application/json", ".json"],
]);

const INLINE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

// --- Comentários -----------------------------------------------------------

export async function listComments(taskId) {
  const rows = await all(
    `SELECT c.*, u.display_name AS author_name, u.color AS author_color, u.username
       FROM comments c
       LEFT JOIN users u ON u.id = c.author_id
      WHERE c.task_id = ?
      ORDER BY c.created_at, c.id`,
    [taskId]
  );
  const files = await listAttachments(taskId);

  return rows.map((c) => ({
    id: c.id,
    taskId: c.task_id,
    authorId: c.author_id,
    authorName: c.author_name,
    authorColor: c.author_color,
    authorUsername: c.username,
    body: c.body,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    edited: !!c.edited,
    attachments: files.filter((f) => f.commentId === c.id),
  }));
}

export async function addComment(taskId, body, actorId) {
  const text = String(body || "").trim();
  if (!text) throw badRequest("O comentário está vazio.");
  if (text.length > 20000) throw badRequest("Comentário longo demais.");

  const existe = await one("SELECT id FROM tasks WHERE id = ?", [taskId]);
  if (!existe) throw notFound("Tarefa não encontrada.");

  const id = await insert(
    "INSERT INTO comments (task_id, author_id, body, created_at) VALUES (?, ?, ?, ?)",
    [taskId, actorId, text, nowIso()]
  );
  await logEvent({ taskId, actorId, kind: "comment", to: text.slice(0, 160) });
  await touch(taskId);
  return one("SELECT * FROM comments WHERE id = ?", [id]);
}

export async function editComment(commentId, body, actorId) {
  const c = await one("SELECT * FROM comments WHERE id = ?", [commentId]);
  if (!c) throw notFound("Comentário não encontrado.");
  if (c.author_id !== actorId) {
    const e = new Error("Só quem escreveu pode editar o comentário.");
    e.status = 403;
    throw e;
  }
  const text = String(body || "").trim();
  if (!text) throw badRequest("O comentário está vazio.");

  await run("UPDATE comments SET body = ?, updated_at = ?, edited = 1 WHERE id = ?", [
    text,
    nowIso(),
    commentId,
  ]);
  await touch(c.task_id);
  return one("SELECT * FROM comments WHERE id = ?", [commentId]);
}

export async function deleteComment(commentId, actor) {
  const c = await one("SELECT * FROM comments WHERE id = ?", [commentId]);
  if (!c) return;
  if (c.author_id !== actor.id && actor.role !== "admin") {
    const e = new Error("Só quem escreveu pode apagar o comentário.");
    e.status = 403;
    throw e;
  }

  const anexos = await all("SELECT * FROM attachments WHERE comment_id = ?", [commentId]);
  for (const f of anexos) await remover(f.stored_name);

  await run("DELETE FROM attachments WHERE comment_id = ?", [commentId]);
  await run("DELETE FROM comments WHERE id = ?", [commentId]);
  await touch(c.task_id);
}

// --- Anexos ----------------------------------------------------------------

export async function listAttachments(taskId) {
  const linhas = await all(
    `SELECT a.*, u.display_name AS uploader_name
       FROM attachments a
       LEFT JOIN users u ON u.id = a.uploader_id
      WHERE a.task_id = ?
      ORDER BY a.id`,
    [taskId]
  );
  return linhas.map(shapeAttachment);
}

// Versão pública: nunca inclui a referência do arquivo no armazenamento.
export async function getAttachment(id) {
  const a = await getAttachmentInterno(id);
  if (!a) return null;
  const { storedName, ...publico } = a;
  return publico;
}

// Uso interno: entregar e remover o arquivo precisam da referência.
export async function getAttachmentInterno(id) {
  const row = await one("SELECT * FROM attachments WHERE id = ?", [id]);
  return row ? { ...shapeAttachment(row), storedName: row.stored_name } : null;
}

export async function saveAttachment({
  taskId,
  commentId = null,
  buffer,
  mime,
  originalName,
  actorId,
}) {
  if (!ALLOWED.has(mime)) throw badRequest(`Tipo de arquivo não aceito: ${mime}`);
  if (!buffer || !buffer.length) throw badRequest("Arquivo vazio.");
  if (buffer.length > MAX_UPLOAD)
    throw badRequest(`Arquivo acima do limite de ${Math.round(MAX_UPLOAD / 1048576)} MB.`);

  const existe = await one("SELECT id FROM tasks WHERE id = ?", [taskId]);
  if (!existe) throw notFound("Tarefa não encontrada.");

  // O nome no armazenamento é sorteado: o que a pessoa enviou é apenas um
  // rótulo, e nunca chega perto do sistema de arquivos.
  const nome = `${Date.now().toString(36)}-${randomBytes(9).toString("hex")}${ALLOWED.get(mime)}`;
  const referencia = await guardar(nome, buffer, mime);

  const dim = mime.startsWith("image/") ? imageSize(buffer, mime) : null;
  const label = safeLabel(originalName) || `anexo${ALLOWED.get(mime)}`;

  const id = await insert(
    `INSERT INTO attachments (task_id, comment_id, uploader_id, original_name, stored_name,
                              mime, size_bytes, width, height, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      taskId,
      commentId,
      actorId,
      label,
      referencia,
      mime,
      buffer.length,
      dim?.width ?? null,
      dim?.height ?? null,
      nowIso(),
    ]
  );
  await logEvent({ taskId, actorId, kind: "attachment", to: label });
  await touch(taskId);
  return getAttachment(id);
}

export async function readAttachment(id) {
  const a = await getAttachmentInterno(id);
  if (!a) return null;
  const conteudo = await ler(a.storedName);
  return conteudo ? { meta: a, conteudo } : null;
}

export async function deleteAttachment(id, actor) {
  const a = await one("SELECT * FROM attachments WHERE id = ?", [id]);
  if (!a) return;
  if (a.uploader_id !== actor.id && actor.role !== "admin") {
    const e = new Error("Só quem enviou pode remover o anexo.");
    e.status = 403;
    throw e;
  }
  await remover(a.stored_name);
  await run("DELETE FROM attachments WHERE id = ?", [id]);
  await touch(a.task_id);
}

export function isInline(mime) {
  return INLINE.has(mime);
}

function shapeAttachment(a) {
  return {
    id: a.id,
    taskId: a.task_id,
    commentId: a.comment_id,
    name: a.original_name,
    mime: a.mime,
    size: a.size_bytes,
    width: a.width,
    height: a.height,
    uploaderId: a.uploader_id,
    uploaderName: a.uploader_name || null,
    createdAt: a.created_at,
    isImage: a.mime.startsWith("image/"),
    url: `api/attachments/${a.id}`,
  };
}

// Rótulo higienizado: sem caminho, sem caractere de controle, sem os
// caracteres que o Windows recusa em nome de arquivo. Acentos permanecem.
const PROIBIDOS = new Set(["<", ">", ":", '"', "|", "?", "*"]);

function safeLabel(name) {
  const bruto = String(name || "").replace(/[\\/]/g, "_");
  let saida = "";
  for (const ch of bruto) {
    const code = ch.codePointAt(0);
    if (code < 32 || code === 127) continue;
    if (PROIBIDOS.has(ch)) continue;
    saida += ch;
  }
  return saida.trim().slice(0, 120);
}

// Dimensões lidas do cabeçalho do arquivo. Serve para reservar o espaço da
// miniatura antes de a imagem carregar e evitar o salto de layout.
function imageSize(buf, mime) {
  try {
    if (mime === "image/png" && buf.length > 24) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === "image/gif" && buf.length > 10) {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (mime === "image/jpeg") {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
    if (mime === "image/webp" && buf.length > 30 && buf.toString("ascii", 12, 16) === "VP8X") {
      return {
        width: 1 + buf.readUIntLE(24, 3),
        height: 1 + buf.readUIntLE(27, 3),
      };
    }
  } catch {}
  return null;
}
