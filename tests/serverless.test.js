// Testes do caminho sem servidor.
//
// Não há como subir a plataforma aqui, então o que se verifica é o que
// realmente pode quebrar no deploy e passar despercebido: o handler aceitar o
// formato de requisição da plataforma, preparar a instância uma vez só, e o
// armazenamento de anexos escolher o destino certo conforme a configuração.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

process.env.TDAH_DATA_DIR = mkdtempSync(join(tmpdir(), "tdah-sls-"));
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_INITIAL_PASSWORD = "senha-de-teste-do-handler";

const { default: handler } = await import("../api/index.js");
const { DATA_DIR } = await import("../server/paths.js");
const { tipoDeArmazenamento } = await import("../server/storage.js");

after(() => {
  try {
    rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {}
});

// Requisição e resposta no formato que a plataforma entrega ao handler.
function fingirRequisicao({ method = "GET", url = "/api/boot", headers = {}, body = null }) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { host: "exemplo.test", ...headers };
  req.socket = { remoteAddress: "127.0.0.1", encrypted: true };
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
  };
  res.espera = new Promise((r) => (res.pronto = r));
  return res;
}

async function chamar(opcoes) {
  const req = fingirRequisicao(opcoes);
  const res = fingirResposta();
  await handler(req, res);
  await res.espera;
  return res;
}

test("o handler responde /api/boot e prepara a instância sozinho", async () => {
  const res = await chamar({ url: "/api/boot" });
  assert.equal(res.statusCode, 200);

  const dados = JSON.parse(res.corpo);
  assert.equal(dados.authenticated, false);
  assert.ok(dados.vocabulary.statuses.includes("doing"));
});

test("rota protegida recusa quem não tem sessão", async () => {
  const res = await chamar({ url: "/api/state" });
  assert.equal(res.statusCode, 401);
});

test("a conta inicial é criada na primeira subida e aceita login", async () => {
  const res = await chamar({
    method: "POST",
    url: "/api/session",
    headers: { "content-type": "application/json", origin: "https://exemplo.test" },
    body: JSON.stringify({ usuario: "admin", senha: "senha-de-teste-do-handler" }),
  });

  assert.equal(res.statusCode, 200);
  const dados = JSON.parse(res.corpo);
  assert.equal(dados.user.username, "admin");
  assert.equal(dados.user.role, "admin");
});

test("senha errada é recusada sem revelar se a conta existe", async () => {
  const res = await chamar({
    method: "POST",
    url: "/api/session",
    headers: { "content-type": "application/json", origin: "https://exemplo.test" },
    body: JSON.stringify({ usuario: "admin", senha: "errada" }),
  });

  assert.equal(res.statusCode, 401);
  assert.match(JSON.parse(res.corpo).error, /usuário ou senha/i);
});

test("escrita vinda de outra origem é bloqueada", async () => {
  const res = await chamar({
    method: "POST",
    url: "/api/tasks",
    headers: { "content-type": "application/json", origin: "https://site-de-terceiro.test" },
    body: JSON.stringify({ title: "Não deveria entrar" }),
  });

  assert.equal(res.statusCode, 403);
});

test("o cookie de sessão sai fechado para leitura por script", async () => {
  const res = await chamar({
    method: "POST",
    url: "/api/session",
    headers: { "content-type": "application/json", origin: "https://exemplo.test" },
    body: JSON.stringify({ usuario: "admin", senha: "senha-de-teste-do-handler" }),
  });

  const cookie = res.cabecalhos["Set-Cookie"];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  // A requisição do teste chega cifrada, então o atributo precisa estar lá.
  assert.match(cookie, /Secure/);
});

test("sem configuração de nuvem, os anexos ficam em disco", () => {
  assert.equal(tipoDeArmazenamento(), "disco");
});

test("com o token da nuvem, o destino dos anexos muda", () => {
  process.env.BLOB_READ_WRITE_TOKEN = "apenas-para-teste";
  assert.equal(tipoDeArmazenamento(), "blob");
  delete process.env.BLOB_READ_WRITE_TOKEN;
  assert.equal(tipoDeArmazenamento(), "disco");
});
