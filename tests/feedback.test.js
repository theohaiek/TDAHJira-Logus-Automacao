// Testes do relato de bug e ideia.
//
// O que mais importa aqui não é o relato chegar: é o que NÃO pode acontecer.
// O token do GitHub não pode sair do servidor. O relato não pode ir a um
// endereço que não seja o GitHub. Um @fulano no texto não pode notificar
// ninguém de fora. E sem configuração, nada sai do banco.
//
// O encaminhamento é testado com a rede simulada: fetch é trocado por uma
// função que registra cada chamada, e os testes leem o registro.
//
//   node --test tests/feedback.test.js

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

process.env.TDAH_DATA_DIR = mkdtempSync(join(tmpdir(), "tdah-relato-"));

const { openDb, all, one } = await import("../server/db.js");
const { DATA_DIR, DB_FILE } = await import("../server/paths.js");
const { createUser } = await import("../server/auth.js");
const { registrarFeedback } = await import("../server/feedback.js");
const { handleApi } = await import("../server/api.js");

const TOKEN_FALSO = "ghp_" + "x".repeat(36);

let admin;
let membro;
let outroMembro;
const fetchOriginal = globalThis.fetch;
let chamadas = [];

before(async () => {
  await openDb(DB_FILE);
  admin = await createUser({ username: "chefia", displayName: "Chefia", password: "uma-senha-boa", role: "admin" });
  membro = await createUser({ username: "bruno", displayName: "Bruno", password: "uma-senha-boa" });
  outroMembro = await createUser({ username: "carla", displayName: "Carla", password: "uma-senha-boa" });
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  delete process.env.FEEDBACK_GITHUB_TOKEN;
  delete process.env.FEEDBACK_GITHUB_REPO;
  chamadas = [];
});

after(() => {
  try {
    if (DATA_DIR.startsWith(tmpdir())) rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {}
});

// A rede, simulada. Cada chamada fica registrada com o endereço e o que foi
// enviado, e a resposta imita a do GitHub.
function simularGithub({ htmlUrl = "https://github.com/dono/relatos/issues/7", ok = true } = {}) {
  globalThis.fetch = async (url, opcoes = {}) => {
    chamadas.push({ url: String(url), opcoes });
    return {
      ok,
      status: ok ? 201 : 500,
      json: async () => ({ html_url: htmlUrl }),
    };
  };
}

function ligarEncaminhamento(repo = "dono/relatos") {
  process.env.FEEDBACK_GITHUB_TOKEN = TOKEN_FALSO;
  process.env.FEEDBACK_GITHUB_REPO = repo;
}

// --- O relato em si ---------------------------------------------------------

test("um bug e uma ideia ficam no banco, com quem mandou", async () => {
  const b = await registrarFeedback({ kind: "bug", body: "O botão de salvar some" }, membro);
  const i = await registrarFeedback({ kind: "ideia", body: "Um atalho para arquivar" }, membro);

  const linhas = await all("SELECT kind, body, author_id FROM feedback WHERE id IN (?, ?)", [b.id, i.id]);
  assert.equal(linhas.length, 2);
  assert.ok(linhas.every((l) => l.author_id === membro.id));
  assert.deepEqual(linhas.map((l) => l.kind).sort(), ["bug", "ideia"]);
});

test("tipo fora da lista é recusado", async () => {
  await assert.rejects(() => registrarFeedback({ kind: "reclamacao", body: "x" }, membro), /bug ou uma ideia/);
  await assert.rejects(() => registrarFeedback({ kind: "", body: "x" }, membro), /bug ou uma ideia/);
});

test("relato vazio e relato longo demais são recusados", async () => {
  await assert.rejects(() => registrarFeedback({ kind: "bug", body: "   " }, membro), /Escreva/);
  await assert.rejects(() => registrarFeedback({ kind: "bug", body: "a".repeat(4001) }, membro), /longo demais/);
});

test("tela e versão entram limpas de caractere de controle e cortadas", async () => {
  const r = await registrarFeedback(
    { kind: "bug", body: "Teste de contexto", page: "#/quadro\u0000\u001Finjeção", version: "v" + "9".repeat(80) },
    membro
  );
  const linha = await one("SELECT page, version FROM feedback WHERE id = ?", [r.id]);
  assert.ok(!/[\u0000-\u001F\u007F]/.test(linha.page), "sobrou caractere de controle na tela");
  assert.ok(linha.version.length <= 40, "a versão não foi cortada");
});

test("o freio de envio conta no banco e segura o décimo terceiro da hora", async () => {
  // Conta no banco, e não em memória: no modo hospedado cada instância tem a
  // sua, e um freio em memória seria um freio por instância.
  for (let n = 0; n < 12; n++) {
    await registrarFeedback({ kind: "ideia", body: `ideia ${n}` }, outroMembro);
  }
  await assert.rejects(
    () => registrarFeedback({ kind: "ideia", body: "a décima terceira" }, outroMembro),
    (err) => err.status === 429
  );
});

// --- O que não pode sair ----------------------------------------------------

test("sem configuração, nada sai do banco", async () => {
  simularGithub();
  const r = await registrarFeedback({ kind: "bug", body: "Fica só aqui" }, membro);
  assert.equal(r.encaminhado, false);
  assert.equal(chamadas.length, 0, "houve chamada de rede sem configuração");
});

test("com configuração, a chamada vai só ao GitHub, e o link volta salvo", async () => {
  ligarEncaminhamento();
  simularGithub();

  const r = await registrarFeedback({ kind: "bug", body: "Vai para a issue" }, membro);

  assert.equal(r.encaminhado, true);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, "https://api.github.com/repos/dono/relatos/issues");
  assert.equal(chamadas[0].opcoes.method, "POST");

  const linha = await one("SELECT issue_url FROM feedback WHERE id = ?", [r.id]);
  assert.equal(linha.issue_url, "https://github.com/dono/relatos/issues/7");
});

test("repositório com formato fora de dono/nome não encaminha", async () => {
  // Cada um destes tentaria mudar o caminho da API ou o endereço inteiro.
  for (const repo of [
    "dono/relatos/../../users",
    "dono/relatos?x=1",
    "https://outro.exemplo/dono/repo",
    "dono",
    "dono/repo/issues",
    "@outro.exemplo/repo",
  ]) {
    ligarEncaminhamento(repo);
    simularGithub();
    const r = await registrarFeedback({ kind: "bug", body: `repo ${repo}` }, admin);
    assert.equal(r.encaminhado, false, `encaminhou com repo "${repo}"`);
    assert.equal(chamadas.length, 0, `chamou a rede com repo "${repo}"`);
    chamadas = [];
  }
});

test("link de volta que não é do GitHub não é salvo", async () => {
  ligarEncaminhamento();
  simularGithub({ htmlUrl: "https://outro.exemplo/phishing" });

  const r = await registrarFeedback({ kind: "bug", body: "Resposta estranha" }, admin);
  const linha = await one("SELECT issue_url FROM feedback WHERE id = ?", [r.id]);
  assert.equal(linha.issue_url, null);
});

test("o GitHub fora do ar não perde o relato", async () => {
  ligarEncaminhamento();
  simularGithub({ ok: false });

  const r = await registrarFeedback({ kind: "bug", body: "Mesmo com o GitHub caído" }, admin);
  assert.equal(r.encaminhado, false);
  const linha = await one("SELECT body FROM feedback WHERE id = ?", [r.id]);
  assert.equal(linha.body, "Mesmo com o GitHub caído");
});

test("menção e referência no texto não notificam ninguém no GitHub", async () => {
  ligarEncaminhamento();
  simularGithub();

  await registrarFeedback({ kind: "bug", body: "Fale com @fulano sobre #12" }, admin);

  const enviado = JSON.parse(chamadas[0].opcoes.body);
  assert.ok(!/@fulano/.test(enviado.body), "a menção chegou ao GitHub funcionando");
  assert.ok(!/#12/.test(enviado.body), "a referência chegou ao GitHub funcionando");
  // E o texto continua legível: o que se insere é um espaço de largura zero.
  assert.ok(enviado.body.includes("@\u200Bfulano"));
});

// --- As rotas ---------------------------------------------------------------

test("sem sessão, o envio é recusado", async () => {
  const res = await chamar("/api/feedback", { method: "POST", ...corpoJson({ kind: "bug", body: "x" }) });
  assert.equal(res.statusCode, 401);
});

test("qualquer pessoa com sessão envia, e só quem administra lê", async () => {
  const envio = await chamar("/api/feedback", {
    user: membro,
    method: "POST",
    ...corpoJson({ kind: "ideia", body: "Pela rota" }),
  });
  assert.equal(envio.statusCode, 201);

  const deMembro = await chamar("/api/feedback", { user: membro });
  assert.equal(deMembro.statusCode, 403);

  const deAdmin = await chamar("/api/feedback", { user: admin });
  assert.equal(deAdmin.statusCode, 200);
  assert.ok(deAdmin.dados.feedback.some((f) => f.body === "Pela rota"));
});

test("o token não aparece em resposta nenhuma", async () => {
  ligarEncaminhamento();
  simularGithub();

  const envio = await chamar("/api/feedback", {
    user: admin,
    method: "POST",
    ...corpoJson({ kind: "bug", body: "Onde está o token?" }),
  });
  const lista = await chamar("/api/feedback", { user: admin });

  // O token, em nenhuma das duas.
  for (const [nome, res] of [["envio", envio], ["lista", lista]]) {
    assert.ok(!res.corpo.includes(TOKEN_FALSO), `o token vazou na resposta de ${nome}`);
  }

  // O repositório, não no envio: qualquer membro envia, e saber para onde o
  // relato foi não é informação que ele precise.
  assert.ok(!envio.corpo.includes("dono/relatos"), "o repositório vazou na resposta de envio");
  assert.deepEqual(Object.keys(envio.dados).sort(), ["encaminhado", "id"]);

  // Na lista ele aparece, e é de propósito: ela é só de quem administra, e o
  // link de cada issue é o que essa pessoa vai clicar para abrir o relato.
  assert.equal(lista.dados.encaminhamento, true);
  assert.ok(lista.dados.feedback.some((f) => f.issueUrl?.startsWith("https://github.com/")));
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
  try {
    await handleApi(req, res, { path: url.pathname.replace(/^\/+/, ""), query: url.searchParams, user });
  } catch (err) {
    const status = err.status || 500;
    if (!res.headersSent) {
      const corpo = status >= 500 ? "Erro interno." : err.message;
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: corpo }));
    }
  }
  await res.espera;
  return res;
}

function corpoJson(objeto) {
  return {
    body: JSON.stringify(objeto),
    headers: { "content-type": "application/json", origin: "https://exemplo.test" },
  };
}
