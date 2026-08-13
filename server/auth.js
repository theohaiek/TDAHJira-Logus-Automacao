// Autenticação: senha com scrypt e sessão em cookie. Sem serviço externo,
// sem token no repositório, sem cadastro aberto — quem entra é quem o
// administrador criou.

import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from "node:crypto";
import { all, one, run, insert, nowIso } from "./db.js";

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_DAYS = 30;
export const COOKIE = "tdah_sess";

export function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith("scrypt$")) return false;
  const [, N, r, p, salt, key] = stored.split("$");
  const expected = Buffer.from(key, "base64");
  let actual;
  try {
    actual = scryptSync(password, Buffer.from(salt, "base64"), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Hash descartável, calculado uma vez na carga do módulo.
//
// Serve para que uma tentativa de login com usuário inexistente custe o mesmo
// tempo que uma com usuário real. Sem isso, a diferença de duração entre as
// duas respostas revela quais contas existem.
const HASH_FALSO = hashPassword(randomBytes(32).toString("hex"));

export function verifyPasswordConstantTime(password, stored) {
  return verifyPassword(password, stored || HASH_FALSO) && !!stored;
}

// Freio de tentativas de login.
//
// Duas razões: dificultar adivinhação de senha, e proteger o próprio servidor.
// A verificação de senha é deliberadamente cara, então uma rajada de
// tentativas trava o laço de eventos e derruba o aplicativo para todo mundo.
const tentativas = new Map();
const JANELA_MS = 15 * 60 * 1000;
const LIMITE = 8;

export function podeTentar(chave) {
  const registro = tentativas.get(chave);
  if (!registro) return true;
  if (Date.now() - registro.desde > JANELA_MS) {
    tentativas.delete(chave);
    return true;
  }
  return registro.falhas < LIMITE;
}

export function registrarFalha(chave) {
  const registro = tentativas.get(chave);
  if (!registro || Date.now() - registro.desde > JANELA_MS) {
    tentativas.set(chave, { falhas: 1, desde: Date.now() });
  } else {
    registro.falhas++;
  }
  // Sem teto, uma rajada de tentativas com usuários inventados encheria a
  // memória do processo.
  if (tentativas.size > 5000) tentativas.clear();
}

export function limparTentativas(chave) {
  tentativas.delete(chave);
}

export function minutosAteLiberar(chave) {
  const registro = tentativas.get(chave);
  if (!registro) return 0;
  return Math.max(1, Math.ceil((JANELA_MS - (Date.now() - registro.desde)) / 60000));
}

// Senha inicial sorteada: nada de padrão previsível gravado em lugar nenhum.
export function generatePassword() {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(14);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function createSession(userId, userAgent = "") {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  run(
    "INSERT INTO sessions (token, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)",
    [token, userId, nowIso(), expires, String(userAgent).slice(0, 200)]
  );
  return { token, expires };
}

export function destroySession(token) {
  if (token) run("DELETE FROM sessions WHERE token = ?", [token]);
}

export function userFromToken(token) {
  if (!token) return null;
  const row = one(
    `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ? AND u.is_active = 1`,
    [token, nowIso()]
  );
  if (!row) return null;
  run("UPDATE users SET last_seen_at = ? WHERE id = ?", [nowIso(), row.id]);
  return row;
}

export function purgeExpiredSessions() {
  run("DELETE FROM sessions WHERE expires_at <= ?", [nowIso()]);
}

export function createUser({
  username,
  displayName,
  email = null,
  password = null,
  role = "member",
  color = "#a2e4f0",
}) {
  const clean = String(username).trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  if (!clean) throw new Error("Nome de usuário inválido.");
  const id = insert(
    `INSERT INTO users (username, display_name, email, password_hash, color, role,
                        must_change_password, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      clean,
      String(displayName || clean).trim(),
      email,
      password ? hashPassword(password) : null,
      color,
      role,
      password ? 1 : 0,
      nowIso(),
    ]
  );
  return one("SELECT * FROM users WHERE id = ?", [id]);
}

export function setPassword(userId, password) {
  run(
    "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
    [hashPassword(password), userId]
  );
  // Trocar a senha derruba as outras sessões daquela pessoa.
  run("DELETE FROM sessions WHERE user_id = ?", [userId]);
}

export function findByUsername(username) {
  return one("SELECT * FROM users WHERE lower(username) = lower(?)", [
    String(username || "").trim(),
  ]);
}

export function listUsers() {
  return all(
    `SELECT id, username, display_name, email, color, role, is_active, prefs, last_seen_at
       FROM users ORDER BY is_active DESC, display_name COLLATE NOCASE`
  );
}

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    name: u.display_name,
    color: u.color,
    role: u.role,
    active: !!u.is_active,
  };
}

export function newInstallId() {
  return randomUUID();
}
