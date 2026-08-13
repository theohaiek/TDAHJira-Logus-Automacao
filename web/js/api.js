// Cliente da API.
//
// A base é relativa ao documento, e não absoluta: é isso que faz o mesmo
// front funcionar servido pelo Node em /, e pelo WordPress em
// /wp-json/tdah-logus/v1/ dentro de um site que mora em subpasta.

const BOOT = globalThis.TDAH_BOOT || {};
const BASE = (BOOT.apiBase || "api/").replace(/\/?$/, "/");

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, { body, headers = {}, raw } = {}) {
  const opts = {
    method,
    credentials: "same-origin",
    headers: { ...headers },
  };

  if (BOOT.nonce) opts.headers["X-WP-Nonce"] = BOOT.nonce;

  if (raw) {
    opts.body = raw;
  } else if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(BASE + path, opts);
  const tipo = res.headers.get("content-type") || "";

  if (!tipo.includes("application/json")) {
    if (!res.ok) throw new ApiError(`Falha na comunicação (${res.status}).`, res.status);
    return res;
  }

  const data = await res.json();
  if (!res.ok) throw new ApiError(data.error || `Erro ${res.status}.`, res.status);
  return data;
}

export const api = {
  boot: () => request("GET", "boot"),
  login: (usuario, senha) => request("POST", "session", { body: { usuario, senha } }),
  logout: () => request("DELETE", "session"),

  state: () => request("GET", "state"),
  sync: (cursor) => request("GET", `sync?cursor=${cursor || 0}`),
  activity: (limit = 60) => request("GET", `activity?limit=${limit}`),

  createTask: (dados) => request("POST", "tasks", { body: dados }),
  getTask: (id) => request("GET", `tasks/${id}`),
  patchTask: (id, patch) => request("PATCH", `tasks/${id}`, { body: patch }),
  deleteTask: (id) => request("DELETE", `tasks/${id}`),
  moveTask: (id, destino) => request("POST", `tasks/${id}/move`, { body: destino }),

  addStep: (id, text) => request("POST", `tasks/${id}/steps`, { body: { text } }),
  toggleStep: (id, stepId, done) =>
    request("PATCH", `tasks/${id}/steps/${stepId}`, { body: { done } }),
  removeStep: (id, stepId) => request("DELETE", `tasks/${id}/steps/${stepId}`),

  comments: (id) => request("GET", `tasks/${id}/comments`),
  addComment: (id, body) => request("POST", `tasks/${id}/comments`, { body: { body } }),
  editComment: (cid, body) => request("PATCH", `comments/${cid}`, { body: { body } }),
  deleteComment: (cid) => request("DELETE", `comments/${cid}`),

  // O arquivo vai como corpo binário puro. Sem multipart: menos peça para
  // dar errado dos dois lados.
  upload: (taskId, file, commentId = null) =>
    request("POST", `tasks/${taskId}/attachments`, {
      raw: file,
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name || "anexo"),
        ...(commentId ? { "X-Comment-Id": String(commentId) } : {}),
      },
    }),
  deleteAttachment: (id) => request("DELETE", `attachments/${id}`),

  // Endereço direto do arquivo, usado em <img src> e no link de download.
  // Uma tag de imagem não manda cabeçalho nenhum, então no WordPress o
  // nonce precisa viajar na própria URL — sem isso a REST não reconhece o
  // cookie de sessão e toda imagem de anexo quebraria.
  attachmentUrl: (id) =>
    BOOT.nonce
      ? `${BASE}attachments/${id}?_wpnonce=${encodeURIComponent(BOOT.nonce)}`
      : `${BASE}attachments/${id}`,

  timeline: (id) => request("GET", `tasks/${id}/timeline`),

  projects: () => request("GET", "projects"),
  createProject: (dados) => request("POST", "projects", { body: dados }),
  patchProject: (id, dados) => request("PATCH", `projects/${id}`, { body: dados }),

  labels: () => request("GET", "labels"),
  createLabel: (name, color) => request("POST", "labels", { body: { name, color } }),

  users: () => request("GET", "users"),
  createUser: (dados) => request("POST", "users", { body: dados }),

  savePrefs: (prefs) => request("PATCH", "me/prefs", { body: prefs }),
  changePassword: (atual, nova) => request("POST", "me/password", { body: { atual, nova } }),

  focusStart: (taskId, minutes) => request("POST", "focus/start", { body: { taskId, minutes } }),
  focusStop: (completed) => request("POST", "focus/stop", { body: { completed } }),
  focusToday: () => request("GET", "focus"),
};

export const bootInfo = BOOT;
