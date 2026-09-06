// Testes das rotas HTTP revisadas na auditoria.
//
// O que está aqui é o que passa despercebido: resposta que sai vazia sem
// ninguém reclamar, sessão que continua viva depois de sair, cookie que perde
// um atributo conforme o modo, e portão de administrador que existe numa rota
// e falta na vizinha.
//
//   node --test tests/auditoria-rotas-http.test.js

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

process.env.TDAH_DATA_DIR = mkdtempSync(join(tmpdir(), "tdah-rotas-"));

const { openDb, one, insert, nowIso } = await import("../server/db.js");
const { DB_FILE, DATA_DIR } = await import("../server/paths.js");
const { createUser, createSession, userFromToken, COOKIE } = await import("../server/auth.js");
const { handleApi } = await import("../server/api.js");

let admin;
let membro;

before(async () => {
  await openDb(DB_FILE);
  admin = await createUser({
    username: "chefia",
    displayName: "Chefia",
    password: "senha-do-administrador",
    role: "admin",
  });
  membro = await createUser({
    username: "ana",
    displayName: "Ana Exemplo",
    password: "senha-da-ana",
  });
});

after(() => {
  try {
    rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {}
});

// --- Arreio mínimo de requisição e resposta --------------------------------

function fingirRequisicao({ method = "GET", headers = {}, body = null, remoteAddress = "10.0.0.1", encrypted = false }) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = { host: "exemplo.test", ...headers };
  req.socket = { remoteAddress, encrypted };
  req.destroy = () => {};

  process.nextTick(() => {
    if (body) req.emit("data", Buffer.from(body));
    req.emit("end");
  });
  return req;
}

function fingirResposta() {
  const pedacos = [];
  const res = {
    statusCode: 0,
    headersSent: false,
    cabecalhos: {},
    writeHead(status, headers = {}) {
      this.statusCode = status;
      Object.assign(this.cabecalhos, headers);
      this.headersSent = true;
      return this;
    },
    end(dado) {
      if (dado) pedacos.push(Buffer.from(dado));
      this.headersSent = true;
      this.pronto?.();
      return this;
    },
    get corpo() {
      return Buffer.concat(pedacos).toString("utf8");
    },
    get dados() {
      return JSON.parse(this.corpo);
    },
  };
  res.espera = new Promise((r) => (res.pronto = r));
  return res;
}

async function chamar(caminho, { user = null, ...opcoes } = {}) {
  const url = new URL(caminho, "https://exemplo.test");
  const req = fingirRequisicao(opcoes);
  const res = fingirResposta();
  await handleApi(req, res, {
    path: url.pathname.replace(/^\/+/, ""),
    query: url.searchParams,
    user,
  });
  await res.espera;
  return res;
}

function corpoJson(objeto) {
  return { headers: { "content-type": "application/json" }, body: JSON.stringify(objeto) };
}

// --- Foco -------------------------------------------------------------------

test("GET /api/focus devolve a soma do dia, não um objeto vazio", async () => {
  await insert(
    "INSERT INTO focus_sessions (task_id, user_id, started_at, ended_at, seconds, completed) VALUES (?, ?, ?, ?, ?, ?)",
    [null, membro.id, nowIso(), nowIso(), 600, 1]
  );

  const res = await chamar("/api/focus", { user: membro });
  assert.equal(res.statusCode, 200);
  assert.ok(res.dados.today, "a chave today precisa existir na resposta");
  assert.equal(res.dados.today.s, 600);
  assert.equal(res.dados.today.n, 1);
});

// --- Sessão -----------------------------------------------------------------

test("sair da conta apaga a sessão certa mesmo com um cookie de nome parecido", async () => {
  const s = await createSession(membro.id, "teste");
  const res = await chamar("/api/session", {
    method: "DELETE",
    headers: { cookie: `outro_${COOKIE}=LIXO; ${COOKIE}=${s.token}` },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(await userFromToken(s.token), null, "o token de verdade tinha que ter morrido");
});

test("na plataforma hospedada o cookie de sessão sai com Secure", async () => {
  process.env.VERCEL = "1";
  try {
    const res = await chamar("/api/session", {
      method: "POST",
      encrypted: false,
      ...corpoJson({ usuario: "chefia", senha: "senha-do-administrador" }),
    });
    assert.equal(res.statusCode, 200);
    assert.match(res.cabecalhos["Set-Cookie"], /Secure/);
  } finally {
    delete process.env.VERCEL;
  }
});

test("sem proxy declarado e sem TLS, o cookie sai sem Secure", async () => {
  const res = await chamar("/api/session", {
    method: "POST",
    encrypted: false,
    ...corpoJson({ usuario: "chefia", senha: "senha-do-administrador" }),
  });
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.cabecalhos["Set-Cookie"], /Secure/);
});

test("atrás de proxy, o freio separa quem é quem pelo cabeçalho encaminhado", async () => {
  process.env.VERCEL = "1";
  try {
    // Todas as tentativas chegam do mesmo socket, como acontece atrás de um
    // proxy; só o cabeçalho distingue as duas pessoas.
    for (let i = 0; i < 8; i++) {
      const res = await chamar("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9, 10.1.1.1" },
        body: JSON.stringify({ usuario: "fantasma", senha: "chute" }),
      });
      assert.equal(res.statusCode, 401);
    }

    const trancado = await chamar("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify({ usuario: "fantasma", senha: "chute" }),
    });
    assert.equal(trancado.statusCode, 429, "quem errou oito vezes precisa levar o freio");

    const outraPessoa = await chamar("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.4" },
      body: JSON.stringify({ usuario: "fantasma", senha: "chute" }),
    });
    assert.equal(outraPessoa.statusCode, 401, "o erro de um estranho não pode trancar a conta de outra pessoa");
  } finally {
    delete process.env.VERCEL;
  }
});

// --- Diagnóstico ------------------------------------------------------------

test("/api/boot informa o driver de banco realmente em uso", async () => {
  const res = await chamar("/api/boot");
  assert.equal(res.statusCode, 200);
  assert.equal(res.dados.mode, "local");
});

// --- Portões de administrador -----------------------------------------------

test("apagar etiqueta é só do administrador", async () => {
  const lid = await insert("INSERT INTO labels (name, color) VALUES (?, ?)", ["urgente", "#8fa9b5"]);

  const recusado = await chamar(`/api/labels/${lid}`, { method: "DELETE", user: membro });
  assert.equal(recusado.statusCode, 403);
  assert.ok(await one("SELECT id FROM labels WHERE id = ?", [lid]), "a etiqueta não podia ter sumido");

  const aceito = await chamar(`/api/labels/${lid}`, { method: "DELETE", user: admin });
  assert.equal(aceito.statusCode, 200);
  assert.equal(await one("SELECT id FROM labels WHERE id = ?", [lid]), null);
});

test("arquivar projeto é só do administrador, renomear não", async () => {
  const ts = nowIso();
  const pid = await insert(
    "INSERT INTO projects (key, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ["AUD", "Auditoria", "#a2e4f0", 0, ts, ts]
  );

  const recusado = await chamar(`/api/projects/${pid}`, {
    method: "PATCH",
    user: membro,
    ...corpoJson({ archived: true }),
  });
  assert.equal(recusado.statusCode, 403);
  assert.equal((await one("SELECT is_archived FROM projects WHERE id = ?", [pid])).is_archived, 0);

  const renomeou = await chamar(`/api/projects/${pid}`, {
    method: "PATCH",
    user: membro,
    ...corpoJson({ name: "Auditoria interna" }),
  });
  assert.equal(renomeou.statusCode, 200);
  assert.equal(renomeou.dados.project.name, "Auditoria interna");
});

// --- Redefinir senha e cortar acesso ----------------------------------------

test("PATCH /api/users/:id é recusado para quem não é administrador", async () => {
  const res = await chamar(`/api/users/${membro.id}`, {
    method: "PATCH",
    user: membro,
    ...corpoJson({ senha: "quero-ser-outra-pessoa" }),
  });
  assert.equal(res.statusCode, 403);
});

test("o administrador redefine a senha de quem esqueceu e derruba as sessões", async () => {
  const antiga = await createSession(membro.id, "teste");

  const res = await chamar(`/api/users/${membro.id}`, {
    method: "PATCH",
    user: admin,
    ...corpoJson({ senha: "" }),
  });
  assert.equal(res.statusCode, 200);
  assert.ok(res.dados.senhaInicial, "a senha sorteada precisa voltar uma vez na resposta");
  assert.equal(await userFromToken(antiga.token), null, "a sessão anterior tinha que cair");
  assert.equal((await one("SELECT must_change_password FROM users WHERE id = ?", [membro.id])).must_change_password, 1);

  const entrou = await chamar("/api/session", {
    method: "POST",
    encrypted: true,
    ...corpoJson({ usuario: "ana", senha: res.dados.senhaInicial }),
  });
  assert.equal(entrou.statusCode, 200);
  assert.equal(entrou.dados.mustChangePassword, true);
});

test("desativar alguém corta a sessão que já estava aberta", async () => {
  const viva = await createSession(membro.id, "teste");
  assert.ok(await userFromToken(viva.token));

  const res = await chamar(`/api/users/${membro.id}`, {
    method: "PATCH",
    user: admin,
    ...corpoJson({ active: false }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.dados.user.active, false);
  assert.equal(await userFromToken(viva.token), null);

  // E a senha para de valer no login, que é o outro caminho de entrada.
  const tentou = await chamar("/api/session", {
    method: "POST",
    ...corpoJson({ usuario: "ana", senha: "senha-da-ana" }),
  });
  assert.equal(tentou.statusCode, 401);

  const voltou = await chamar(`/api/users/${membro.id}`, {
    method: "PATCH",
    user: admin,
    ...corpoJson({ active: true }),
  });
  assert.equal(voltou.dados.user.active, true);
});

test("o administrador não consegue desativar a própria conta", async () => {
  const res = await chamar(`/api/users/${admin.id}`, {
    method: "PATCH",
    user: admin,
    ...corpoJson({ active: false }),
  });
  assert.equal(res.statusCode, 400);
  assert.equal((await one("SELECT is_active FROM users WHERE id = ?", [admin.id])).is_active, 1);
});
