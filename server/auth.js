// Autenticação: senha com scrypt e sessão em cookie. Sem serviço externo,
// sem token no repositório, sem cadastro aberto — quem entra é quem o
// administrador criou.

import { randomBytes, scryptSync, timingSafeEqual, randomUUID, createHash } from "node:crypto";
import { all, one, run, insert, nowIso } from "./db.js";
import { parseCookies } from "./http.js";

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_DAYS = 30;
const FRESCOR_VISTO_MS = 10 * 60 * 1000;
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
const TETO_CHAVES = 5000;

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
  // Sem nenhuma poda, uma rajada com usuários inventados encheria a memória do
  // processo. Só que limpar o mapa inteiro era um jeito barato de desarmar o
  // freio: bastava inventar chaves até estourar o teto para zerar junto o
  // contador da conta sob ataque. Agora saem apenas as janelas já vencidas, e
  // isso basta — cada falha custa um scrypt deliberadamente caro, então o mapa
  // só cresce na velocidade em que a máquina consegue verificar senha, e o que
  // entra some sozinho em quinze minutos.
  if (tentativas.size > TETO_CHAVES) {
    const agora = Date.now();
    for (const [k, v] of tentativas) {
      if (agora - v.desde > JANELA_MS) tentativas.delete(k);
    }
  }
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

export async function createSession(userId, userAgent = "") {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await run(
    "INSERT INTO sessions (token, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)",
    [token, userId, nowIso(), expires, String(userAgent).slice(0, 200)]
  );
  return { token, expires };
}

export async function destroySession(token) {
  if (token) await run("DELETE FROM sessions WHERE token = ?", [token]);
}

export async function userFromToken(token) {
  if (!token) return null;
  const row = await one(
    `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ? AND u.is_active = 1`,
    [token, nowIso()]
  );
  if (!row) return null;
  // Gravar a cada requisição custava uma escrita por sondagem: no modo
  // hospedado, uma ida à rede inteira a cada seis segundos, por pessoa. Nada na
  // tela depende do minuto exato deste campo, então de dez em dez minutos conta
  // a mesma história por um décimo do preço.
  const ultimo = Date.parse(row.last_seen_at || "") || 0;
  if (Date.now() - ultimo > FRESCOR_VISTO_MS) {
    await run("UPDATE users SET last_seen_at = ? WHERE id = ?", [nowIso(), row.id]);
  }
  return row;
}

export async function purgeExpiredSessions() {
  await run("DELETE FROM sessions WHERE expires_at <= ?", [nowIso()]);
}

// A conta apontada por ADMIN_USERNAME é sempre administradora.
//
// A variável já nomeava a conta criada na primeira subida. Agora ela também
// promove, e é por um motivo prático: sem isto, virar administrador de uma
// instalação que já existe só era possível pelo console do banco, que quem
// administra o produto pode não ter à mão. O papel decide quem apaga tarefa,
// quem cria acesso e quem autoriza o que o agente de relatos vai implementar.
//
// Só promove: não rebaixa ninguém e não cria conta. Quem cria é o preparo da
// primeira subida, logo antes de cada chamada desta função.
export async function garantirAdministrador() {
  const username = String(process.env.ADMIN_USERNAME || "").trim();
  if (!username) return null;

  const r = await run("UPDATE users SET role = 'admin' WHERE username = ? AND role <> 'admin'", [username]);
  if (!r?.changes) return null;

  console.log(`  Conta "${username}" promovida a administradora por ADMIN_USERNAME.`);
  return username;
}

export async function createUser({
  username,
  displayName,
  email = null,
  password = null,
  role = "member",
  color = "#8fa9b5",
}) {
  const clean = String(username).trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  // Sem o status, estes dois viram "Erro interno. Confira o log do servidor." na
  // tela de quem está criando o acesso — como se o aplicativo tivesse quebrado,
  // quando só faltava dizer qual é o problema com o nome.
  if (!clean) {
    throw Object.assign(new Error("Nome de usuário inválido."), { status: 400 });
  }
  // O UNIQUE do banco continua sendo a garantia; esta consulta existe só para
  // que o caso comum (criar de novo o mesmo acesso) tenha resposta legível.
  if (await one("SELECT id FROM users WHERE lower(username) = ?", [clean])) {
    throw Object.assign(new Error("Já existe alguém com esse usuário."), { status: 409 });
  }
  const id = await insert(
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

export async function setPassword(userId, password) {
  await run(
    "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
    [hashPassword(password), userId]
  );
  // Trocar a senha derruba as outras sessões daquela pessoa.
  await run("DELETE FROM sessions WHERE user_id = ?", [userId]);
}

export async function findByUsername(username) {
  return one("SELECT * FROM users WHERE lower(username) = lower(?)", [
    String(username || "").trim(),
  ]);
}

export async function listUsers() {
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

// --- Tokens de agente --------------------------------------------------------
//
// A credencial do MCP (server/mcp). Um agente fala em nome de uma pessoa: o que
// ele grava sai com o nome dela, e a trilha marca "via" com o nome do token.
//
// Três escolhas que parecem soltas e não são:
//
// - Só o hash fica no banco, e SHA-256 basta. scrypt existe para senha, que é
//   curta e adivinhável; o segredo aqui tem 256 bits sorteados, e procurar pelo
//   hash é uma consulta indexada em vez de um scrypt por token a cada chamada.
// - O prefixo tdah_ é o que separa este token do RELATOS_AGENTE_TOKEN, que
//   também chega como Bearer (em /api/agente). Sem prefixo, a requisição do
//   agente de relatos viraria uma consulta a esta tabela.
// - Trocar a senha NÃO revoga os tokens, diferente das sessões. O token é
//   configuração de máquina, criado de propósito e revogável pela tela; derrubar
//   todos a cada troca de senha quebraria o agente sem ninguém saber por quê. O
//   que corta o acesso de quem saiu é desativar a conta, e isso vale aqui.
const PREFIXO_TOKEN = "tdah_";
const FORMATO_TOKEN = /^tdah_[A-Za-z0-9_-]{43}$/;
const TOKENS_POR_PESSOA = 20;

const hashDoToken = (segredo) => createHash("sha256").update(segredo).digest("hex");

export async function criarTokenDeAgente(userId, nome) {
  let limpo = "";
  for (const ch of String(nome || "")) {
    const code = ch.codePointAt(0);
    if (code >= 32 && code !== 127) limpo += ch;
  }
  limpo = limpo.trim().slice(0, 40) || "Agente";

  const { n } = await one("SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ?", [userId]);
  if (n >= TOKENS_POR_PESSOA) {
    throw Object.assign(new Error(`Limite de ${TOKENS_POR_PESSOA} tokens. Revogue um antes.`), { status: 409 });
  }

  const segredo = PREFIXO_TOKEN + randomBytes(32).toString("base64url");
  const id = await insert(
    "INSERT INTO api_tokens (user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?)",
    [userId, limpo, hashDoToken(segredo), nowIso()]
  );
  const linha = await one("SELECT * FROM api_tokens WHERE id = ?", [id]);
  // O segredo existe em texto só nesta resposta.
  return { token: tokenPublico(linha), segredo };
}

export async function tokensDe(userId) {
  const linhas = await all("SELECT * FROM api_tokens WHERE user_id = ? ORDER BY id DESC", [userId]);
  return linhas.map(tokenPublico);
}

export async function revogarToken(userId, id) {
  const r = await run("DELETE FROM api_tokens WHERE id = ? AND user_id = ?", [id, userId]);
  if (!r?.changes) throw Object.assign(new Error("Token não encontrado."), { status: 404 });
}

export async function userFromAgentToken(segredo) {
  if (!FORMATO_TOKEN.test(String(segredo || ""))) return null;
  const row = await one(
    `SELECT u.*, k.id AS token_id, k.name AS token_name, k.last_used_at AS token_uso
       FROM api_tokens k
       JOIN users u ON u.id = k.user_id
      WHERE k.token_hash = ? AND u.is_active = 1`,
    [hashDoToken(segredo)]
  );
  if (!row) return null;

  // O mesmo freio de last_seen_at: um agente chama dezenas de vezes por sessão,
  // e ninguém precisa do minuto exato do último uso.
  const ultimo = Date.parse(row.token_uso || "") || 0;
  if (Date.now() - ultimo > FRESCOR_VISTO_MS) {
    await run("UPDATE api_tokens SET last_used_at = ? WHERE id = ?", [nowIso(), row.token_id]);
  }

  const { token_id, token_name, token_uso, ...user } = row;
  return { ...user, agente: { id: token_id, nome: token_name } };
}

// Quem fez a requisição: o token de agente, se veio um, senão o cookie.
//
// As duas entradas (server/index.js e api/index.js) chamam esta função, e é de
// propósito que ela more aqui: a sequência de autenticação escrita duas vezes é
// a junção que o AGENTS.md avisa que quebra em silêncio.
export async function usuarioDaRequisicao(req) {
  const m = /^Bearer\s+(tdah_\S+)\s*$/i.exec(String(req.headers.authorization || ""));
  if (m) return userFromAgentToken(m[1]);
  return userFromToken(parseCookies(req.headers.cookie)[COOKIE]);
}

// O que a trilha grava em events.note quando a escrita vem de um agente.
export function notaDoAgente(user) {
  return user?.agente ? `agente:${user.agente.nome}` : null;
}

function tokenPublico(k) {
  return { id: k.id, name: k.name, createdAt: k.created_at, lastUsedAt: k.last_used_at || null };
}
