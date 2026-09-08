// Testes da empresa no ticket.
//
// O projeto diz de que área a tarefa é; a empresa, para quem ela é. São duas
// dimensões, e a armadilha mora justamente aí: o projeto renumera a tarefa
// quando muda, porque a chave visível (AUT-14) sai do contador dele. Copiar
// esse comportamento para a empresa faria a chave de uma tarefa mudar sozinha
// só porque alguém corrigiu o cliente — e o índice único de numeração recusaria
// criações futuras naquele projeto, para sempre.
//
//   node --test tests/empresa.test.js

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

process.env.TDAH_DATA_DIR = mkdtempSync(join(tmpdir(), "tdah-empresa-"));

const { openDb, one, insert, nowIso } = await import("../server/db.js");
const { DB_FILE, DATA_DIR } = await import("../server/paths.js");
const { createUser } = await import("../server/auth.js");
const { createTask, updateTask, getTaskFull } = await import("../server/tasks.js");
const { taskTimeline } = await import("../server/events.js");
const { handleApi } = await import("../server/api.js");
const { parseCaptura } = await import("../web/js/capture.js");

let admin;
let membro;
let projeto;
let acme;

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

  const ts = nowIso();
  projeto = await insert(
    "INSERT INTO projects (key, name, color, created_at, updated_at) VALUES (?,?,?,?,?)",
    ["AUT", "Automações", "#a2e4f0", ts, ts]
  );
  acme = await insert(
    "INSERT INTO companies (name, color, created_at, updated_at) VALUES (?,?,?,?)",
    ["ACME", "#c9b6f0", ts, ts]
  );
});

after(() => {
  try {
    if (DATA_DIR.startsWith(tmpdir())) rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {}
});

// --- A tarefa --------------------------------------------------------------

test("tarefa nasce sem empresa e aceita uma na criação", async () => {
  const sem = await createTask({ title: "Sem cliente" }, membro.id);
  assert.equal(sem.companyId, null);

  const com = await createTask({ title: "Da ACME", companyId: acme }, membro.id);
  assert.equal(com.companyId, acme);
  assert.equal(com.companyName, "ACME");
  assert.equal(com.companyColor, "#c9b6f0");
});

test("associar empresa vira evento na trilha", async () => {
  const t = await createTask({ title: "Vai ganhar cliente" }, membro.id);
  await updateTask(t.id, { companyId: acme }, membro.id);

  const linha = await taskTimeline(t.id);
  const evento = linha.find((e) => e.kind === "company");
  assert.ok(evento, `esperava evento "company", vieram: ${linha.map((e) => e.kind).join(", ")}`);
  assert.equal(evento.to, String(acme));
});

test("empresa inexistente é recusada, como já acontece com a pessoa", async () => {
  const t = await createTask({ title: "Cliente fantasma" }, membro.id);
  await assert.rejects(() => updateTask(t.id, { companyId: 9999 }, membro.id), /Empresa inexistente/);
});

test("trocar de empresa não renumera a tarefa", async () => {
  const outra = await insert(
    "INSERT INTO companies (name, created_at, updated_at) VALUES (?,?,?)",
    ["Beta", nowIso(), nowIso()]
  );

  const t = await createTask({ title: "Muda de dono", projectId: projeto, companyId: acme }, membro.id);
  const antes = await getTaskFull(t.id);

  await updateTask(t.id, { companyId: outra }, membro.id);
  const depois = await getTaskFull(t.id);

  // A chave sai do contador do projeto. Se a empresa mexesse nela, duas
  // tarefas do mesmo projeto acabariam com o mesmo número.
  assert.equal(depois.key, antes.key);
  assert.equal(depois.number, antes.number);
  assert.equal(depois.companyId, outra);
});

// --- As rotas --------------------------------------------------------------

test("empresa com nome repetido devolve a que já existe", async () => {
  const primeira = await chamar("/api/companies", {
    method: "POST",
    user: membro,
    ...corpoJson({ name: "Duplicada" }),
  });
  assert.equal(primeira.statusCode, 201);

  const segunda = await chamar("/api/companies", {
    method: "POST",
    user: membro,
    ...corpoJson({ name: "duplicada" }),
  });

  // Duas fichas para o mesmo cliente quebram o filtro em silêncio: metade das
  // tarefas fica numa, metade na outra, e nenhuma tela mostra as duas juntas.
  assert.equal(segunda.dados.company.id, primeira.dados.company.id);
});

test("arquivar empresa é só do administrador, e ela some da lista", async () => {
  const criada = await chamar("/api/companies", {
    method: "POST",
    user: membro,
    ...corpoJson({ name: "Some daqui" }),
  });
  const id = criada.dados.company.id;

  const recusado = await chamar(`/api/companies/${id}`, {
    method: "PATCH",
    user: membro,
    ...corpoJson({ archived: true }),
  });
  assert.equal(recusado.statusCode, 403);

  const aceito = await chamar(`/api/companies/${id}`, {
    method: "PATCH",
    user: admin,
    ...corpoJson({ archived: true }),
  });
  assert.equal(aceito.statusCode, 200);

  const lista = await chamar("/api/companies", { user: membro });
  assert.ok(!lista.dados.companies.some((c) => c.id === id));
});

test("renomear empresa é de qualquer pessoa", async () => {
  const criada = await chamar("/api/companies", {
    method: "POST",
    user: admin,
    ...corpoJson({ name: "Nome velho" }),
  });
  const resposta = await chamar(`/api/companies/${criada.dados.company.id}`, {
    method: "PATCH",
    user: membro,
    ...corpoJson({ name: "Nome novo" }),
  });
  assert.equal(resposta.statusCode, 200);
  assert.equal(resposta.dados.company.name, "Nome novo");
});

test("o estado inicial entrega a lista de empresas", async () => {
  const resposta = await chamar("/api/state", { user: membro });
  assert.ok(Array.isArray(resposta.dados.companies));
  assert.ok(resposta.dados.companies.some((c) => c.name === "ACME"));
});

// --- A captura rápida ------------------------------------------------------

test("a captura entende o prefixo & para a empresa", () => {
  const ctx = {
    projects: [{ id: 1, key: "AUT", name: "Automações" }],
    users: [{ id: 7, username: "bruno", name: "Bruno Exemplo" }],
    companies: [{ id: 3, name: "ACME", color: "#c9b6f0" }],
    labels: [],
  };

  const r = parseCaptura("revisar contrato &acme #aut @bruno", ctx);
  assert.equal(r.dados.companyId, 3);
  assert.equal(r.dados.projectId, 1);
  assert.equal(r.dados.assigneeId, 7);
  assert.equal(r.title, "revisar contrato");
});

test("empresa inexistente na captura fica no título, sem inventar", () => {
  const ctx = { projects: [], users: [], companies: [{ id: 3, name: "ACME" }], labels: [] };
  const r = parseCaptura("ligar para &beta", ctx);
  assert.equal(r.dados.companyId, undefined);
  assert.equal(r.title, "ligar para &beta");
});

// --- Arreio mínimo de requisição e resposta --------------------------------

function fingirRequisicao({ method = "GET", headers = {}, body = null }) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = { host: "exemplo.test", ...headers };
  req.socket = { remoteAddress: "10.0.0.1", encrypted: false };
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
  return {
    body: JSON.stringify(objeto),
    headers: { "content-type": "application/json", origin: "https://exemplo.test" },
  };
}
