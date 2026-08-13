// Utilidades de HTTP. Nada de framework: a superfície é pequena o bastante
// para caber num arquivo, e sem dependências não há o que atualizar.

import { createReadStream, statSync, existsSync } from "node:fs";
import { join, normalize, extname } from "node:path";

export const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
};

export function sendJson(res, status, data, headers = {}) {
  const body = Buffer.from(JSON.stringify(data), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(body);
}

export function sendError(res, status, message, extra = {}) {
  sendJson(res, status, { error: message, ...extra });
}

export function sendText(res, status, text, type = "text/plain; charset=utf-8") {
  const body = Buffer.from(text, "utf8");
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": body.length,
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

// Lê o corpo com teto de tamanho: sem isso, um cliente pode segurar memória
// do processo indefinidamente.
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error("Corpo da requisição grande demais."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function readJson(req, limit = 2 * 1024 * 1024) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    throw Object.assign(new Error("JSON inválido."), { status: 400 });
  }
}

export function parseCookies(header = "") {
  const out = {};
  for (const part of String(header).split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookieHeader(name, value, { maxAge, expires, secure = false } = {}) {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) bits.push("Secure");
  if (maxAge !== undefined) bits.push(`Max-Age=${maxAge}`);
  if (expires) bits.push(`Expires=${expires}`);
  return bits.join("; ");
}

// Serve arquivo estático com proteção contra subir de diretório.
export function serveStatic(res, rootDir, relPath, { immutable = false } = {}) {
  const clean = normalize(decodeURIComponent(relPath)).replace(/^([/\\.]+)/, "");
  const full = join(rootDir, clean);
  if (!full.startsWith(rootDir)) {
    sendError(res, 403, "Caminho fora do diretório permitido.");
    return true;
  }
  if (!existsSync(full)) return false;
  const st = statSync(full);
  if (!st.isFile()) return false;

  const type = MIME[extname(full).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": st.size,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  createReadStream(full).pipe(res);
  return true;
}

// Só aceita escrita vinda da própria origem. Combinado com SameSite=Lax no
// cookie, fecha a porta para requisição forjada de outro site.
export function sameOrigin(req) {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;

  const origin = req.headers.origin;
  if (!origin) return true; // cliente não-navegador, sem cookie de sessão em jogo
  try {
    const host = req.headers.host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
