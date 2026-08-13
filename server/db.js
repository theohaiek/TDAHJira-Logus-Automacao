// Camada de banco. SQLite embutido no próprio Node — nenhuma dependência
// externa, nenhuma etapa de compilação, nenhum serviço para subir.

import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROOT } from "./paths.js";

let db = null;

export function nowIso() {
  return new Date().toISOString();
}

export function today() {
  // Data local do servidor, não UTC: quem usa raciocina no fuso em que vive.
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export function openDb(file) {
  mkdirSync(dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(readFileSync(join(ROOT, "core", "schema.sql"), "utf8"));
  return db;
}

export function getDb() {
  if (!db) throw new Error("Banco não foi aberto.");
  return db;
}

// --- Açúcar sobre o driver -------------------------------------------------

export function all(sql, params = []) {
  return getDb()
    .prepare(sql)
    .all(...params)
    .map(plain);
}

export function one(sql, params = []) {
  const row = getDb()
    .prepare(sql)
    .get(...params);
  return row ? plain(row) : null;
}

export function run(sql, params = []) {
  return getDb()
    .prepare(sql)
    .run(...params);
}

export function insert(sql, params = []) {
  return Number(run(sql, params).lastInsertRowid);
}

export function tx(fn) {
  const d = getDb();
  d.exec("BEGIN");
  try {
    const out = fn();
    d.exec("COMMIT");
    return out;
  } catch (err) {
    try {
      d.exec("ROLLBACK");
    } catch {}
    throw err;
  }
}

// O driver devolve objetos com protótipo nulo; JSON.stringify lida bem, mas
// operadores de espalhamento e checagens de instância ficam mais previsíveis
// com objetos comuns.
function plain(row) {
  return Object.assign({}, row);
}

// --- Configuração da instância ---------------------------------------------

export function getSetting(key, fallback = null) {
  const row = one("SELECT value FROM settings WHERE key = ?", [key]);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, String(value), nowIso()]
  );
}
