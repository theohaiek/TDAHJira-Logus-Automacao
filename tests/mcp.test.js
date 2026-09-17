// Testes do servidor MCP (server/mcp).
//
// Três grupos, cada um segurando uma promessa diferente:
//
// - o protocolo: o que o Claude Code espera de um servidor HTTP sem sessão, e
//   a fronteira do token, que vale no MCP e em mais nada;
// - as ferramentas: cada uma pelo caminho de verdade (handleApi), com o banco
//   real, conferindo o efeito e não só a resposta;
// - as travas de futuro: rota nova, campo novo de tarefa e ferramenta nova sem
//   registro derrubam a suíte, e o custo em token do catálogo tem teto.
//
//   node --test tests/mcp.test.js

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";

process.env.TDAH_DATA_DIR = mkdtempSync(join(tmpdir(), "tdah-mcp-"));

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

const { openDb, one, all, run } = await import("../server/db.js");
const { DB_FILE, DATA_DIR } = await import("../server/paths.js");
const { createUser, createSession, criarTokenDeAgente, usuarioDaRequisicao, COOKIE } = await import(
  "../server/auth.js"
);
const { handleApi } = await import("../server/api.js");
const { createTask } = await import("../server/tasks.js");
const { addComment, COMMENT_KINDS } = await import("../server/comments.js");
const { LINK_KINDS } = await import("../server/links.js");
const { FERRAMENTAS, COBERTURA } = await import("../server/mcp/catalogo.js");
const { CAMPOS, FORA_DO_MCP } = await import("../server/mcp/comum.js");
const { INSTRUCOES } = await import("../server/mcp/instrucoes.js");
const { VERSOES } = await import("../server/mcp/index.js");

let admin;
let bruno;
let ana;
let segredo; // token do bruno
let segredoAna;
let sessaoBruno;

before(async () => {
  await openDb(DB_FILE);
  admin = await createUser({ username: "chefia", displayName: "Chefia", password: "x", role: "admin" });
  bruno = await createUser({ username: "bruno", displayName: "Bruno Exemplo", password: "x" });
  ana = await createUser({ username: "ana", displayName: "Ana Exemplo", password: "x" });
  segredo = (await criarTokenDeAgente(bruno.id, "Claude do notebook")).segredo;
  segredoAna = (await criarTokenDeAgente(ana.id, "Claude da Ana")).segredo;
  sessaoBruno = (await createSession(bruno.id)).token;

  await run("INSERT INTO projects (key, name, created_at, updated_at) VALUES ('AUT', 'Automações', 'x', 'x')");
  await run("INSERT INTO companies (name, created_at, updated_at) VALUES ('ACME Metalurgia', 'x', 'x')");
  await run("INSERT INTO labels (name) VALUES ('cliente')");
});

after(() => {
  try {
    // A condição não é paranoia: DATA_DIR só aponta para o diretório
    // temporário porque TDAH_DATA_DIR foi definido ANTES do import de
    // paths.js. Trocar o import dinâmico por um estático faz esta linha
    // apagar o banco e os anexos de quem usa a máquina, sem erro nenhum.
    if (DATA_DIR.startsWith(tmpdir())) rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {}
});

// --- Arreio --------------------------------------------------------------------------

async function http({ method = "POST", path = "api/mcp", headers = {}, body = null, query = "" }) {
  const cab = { host: "exemplo.test", ...headers };
  // O usuário sai antes da requisição existir: o corpo é emitido no próximo
  // tique, e handleApi precisa já estar ouvindo quando ele chegar.
  const user = await usuarioDaRequisicao({ headers: cab });

  const req = new EventEmitter();
  req.method = method;
  req.headers = cab;
  req.socket = { remoteAddress: "10.0.0.1", encrypted: false };
  req.destroy = () => {};
  process.nextTick(() => {
    if (body !== null) req.emit("data", Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body)));
    req.emit("end");
  });

  const pedacos = [];
  const res = {
    statusCode: 0,
    headersSent: false,
    cabecalhos: {},
    writeHead(status, h = {}) {
      this.statusCode = status;
      Object.assign(this.cabecalhos, h);
      this.headersSent = true;
    },
    end(dado) {
      if (dado) pedacos.push(Buffer.from(dado));
    },
  };

  try {
    await handleApi(req, res, { path, query: new URLSearchParams(query), user });
  } catch (err) {
    // O que as entradas fazem com erro esperado.
    res.statusCode = err.status || 500;
    pedacos.push(Buffer.from(JSON.stringify({ error: err.message })));
  }
  const bruto = Buffer.concat(pedacos);
  let json = null;
  try {
    json = bruto.length ? JSON.parse(bruto.toString("utf8")) : null;
  } catch {}
  return { status: res.statusCode, headers: res.cabecalhos, json, bruto };
}

const comToken = (s, extra = {}) => ({ authorization: `Bearer ${s}`, "content-type": "application/json", ...extra });

async function rpc(mensagem, { token = segredo, ponte = false } = {}) {
  return http({ body: mensagem, headers: comToken(token, ponte ? { "x-tdah-ponte": "1" } : {}) });
}

let proximoId = 1;
async function ferramenta(name, args = {}, opcoes = {}) {
  const r = await rpc({ jsonrpc: "2.0", id: proximoId++, method: "tools/call", params: { name, arguments: args } }, opcoes);
  assert.equal(r.status, 200, `tools/call ${name} respondeu ${r.status}: ${r.bruto}`);
  assert.ok(r.json.result, `sem result: ${r.bruto}`);
  const { content, isError } = r.json.result;
  return { texto: content.filter((c) => c.type === "text").map((c) => c.text).join("\n"), isError: !!isError, content };
}

async function ok(name, args, opcoes) {
  const r = await ferramenta(name, args, opcoes);
  assert.ok(!r.isError, `${name} falhou: ${r.texto}`);
  return r.texto;
}

async function listar(ponte) {
  const r = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { ponte });
  return r.json.result.tools;
}

// --- Protocolo ------------------------------------------------------------------------

test("sem token, e com cookie de sessão, o MCP responde 401 com o cabeçalho do protocolo", async () => {
  const sem = await http({ body: { jsonrpc: "2.0", id: 1, method: "ping" } });
  assert.equal(sem.status, 401);
  assert.match(sem.headers["WWW-Authenticate"], /^Bearer/);

  const cookie = await http({ body: { jsonrpc: "2.0", id: 1, method: "ping" }, headers: { cookie: `${COOKIE}=${sessaoBruno}` } });
  assert.equal(cookie.status, 401, "a sessão do navegador não abre o MCP");

  const falso = await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { token: `tdah_${"a".repeat(43)}` });
  assert.equal(falso.status, 401);
});

test("initialize devolve a versão pedida, as instruções e a série do produto", async () => {
  const r = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "teste", version: "1" } },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.result.protocolVersion, "2025-06-18");
  assert.deepEqual(r.json.result.capabilities, { tools: { listChanged: false } });
  assert.equal(r.json.result.serverInfo.name, "tdah-logus");
  assert.match(r.json.result.serverInfo.version, /^\d+\.\d+$/);
  assert.equal(r.json.result.instructions, INSTRUCOES);

  const futura = await rpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2099-01-01" } });
  assert.equal(futura.json.result.protocolVersion, VERSOES[0]);
});

test("notificação responde 202 sem corpo; ping, lote e erros seguem o JSON-RPC", async () => {
  const aviso = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(aviso.status, 202);
  assert.equal(aviso.bruto.length, 0);

  const ping = await rpc({ jsonrpc: "2.0", id: "p", method: "ping" });
  assert.deepEqual(ping.json, { jsonrpc: "2.0", id: "p", result: {} });

  const lote = await rpc([
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 1, method: "ping" },
    { jsonrpc: "2.0", id: 2, method: "resources/list" },
  ]);
  assert.equal(lote.json.length, 2, "notificação dentro do lote não ganha resposta");
  assert.equal(lote.json[1].error.code, -32601);

  const semFerramenta = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "inventada" } });
  assert.equal(semFerramenta.json.error.code, -32602);

  const quebrado = await http({ body: "{nao é json", headers: comToken(segredo) });
  assert.equal(quebrado.status, 400);
  assert.equal(quebrado.json.error.code, -32700);

  const get = await http({ method: "GET", headers: comToken(segredo) });
  assert.equal(get.status, 405, "sem SSE: GET recusa e o cliente segue só com POST");
});

test("o token de agente vale no MCP e em mais nada", async () => {
  for (const [method, path] of [
    ["GET", "api/state"],
    ["GET", "api/tasks"],
    ["POST", "api/me/tokens"],
    ["PATCH", "api/me/prefs"],
    ["POST", "api/users"],
  ]) {
    const r = await http({ method, path, headers: comToken(segredo), body: {} });
    assert.equal(r.status, 403, `${method} ${path} aceitou token de agente`);
  }
});

test("token revogado e conta desativada perdem o acesso na hora", async () => {
  const { token, segredo: s } = await criarTokenDeAgente(bruno.id, "descartável");
  assert.equal((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { token: s })).status, 200);

  const revoga = await http({ method: "DELETE", path: `api/me/tokens/${token.id}`, headers: { cookie: `${COOKIE}=${sessaoBruno}` } });
  assert.equal(revoga.status, 200);
  assert.equal((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { token: s })).status, 401);

  const outra = await createUser({ username: "sai", displayName: "Sai Exemplo", password: "x" });
  const t2 = await criarTokenDeAgente(outra.id, "x");
  await run("UPDATE users SET is_active = 0 WHERE id = ?", [outra.id]);
  assert.equal((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { token: t2.segredo })).status, 401);
});

test("tokens pela tela: o segredo aparece uma vez, a lista nunca o mostra, e ninguém revoga o token alheio", async () => {
  const cookie = { cookie: `${COOKIE}=${sessaoBruno}`, "content-type": "application/json" };
  const criado = await http({ path: "api/me/tokens", headers: cookie, body: { nome: "Máquina de teste" } });
  assert.equal(criado.status, 201);
  assert.match(criado.json.segredo, /^tdah_[A-Za-z0-9_-]{43}$/);
  assert.equal(criado.json.token.name, "Máquina de teste");

  const lista = await http({ method: "GET", path: "api/me/tokens", headers: cookie });
  assert.ok(lista.json.tokens.length >= 2);
  assert.ok(!lista.bruto.toString().includes("tdah_"), "a lista vazou segredo");
  assert.ok(!lista.bruto.toString().includes("hash"), "a lista vazou o hash");

  const daAna = (await all("SELECT id FROM api_tokens WHERE user_id = ?", [ana.id]))[0].id;
  const alheio = await http({ method: "DELETE", path: `api/me/tokens/${daAna}`, headers: cookie });
  assert.equal(alheio.status, 404);
});

test("a lista de ferramentas mostra a cada modo só o que funciona nele", async () => {
  const remoto = await listar(false);
  const ponte = await listar(true);
  const anexarRemoto = remoto.find((f) => f.name === "anexar");
  const anexarPonte = ponte.find((f) => f.name === "anexar");

  assert.ok(anexarPonte.inputSchema.properties.caminho, "a ponte precisa de caminho");
  assert.ok(!anexarRemoto.inputSchema.properties.caminho, "remoto não tem disco");
  assert.ok(anexarRemoto.inputSchema.properties.base64);
  assert.ok(!anexarPonte.inputSchema.properties.base64, "pela ponte, base64 só gastaria token");
  assert.ok(ponte.find((f) => f.name === "baixar").inputSchema.properties.destino);

  for (const f of [...remoto, ...ponte]) {
    assert.equal(f.inputSchema.type, "object");
    assert.ok(f.description && f.description.length <= 200, `${f.name}: descrição vazia ou longa`);
    assert.ok(!JSON.stringify(f).includes('"so"'), `${f.name}: a marca interna vazou para o cliente`);
  }
  assert.ok(remoto.find((f) => f.name === "buscar").annotations.readOnlyHint);
  assert.ok(remoto.find((f) => f.name === "apagar").annotations.destructiveHint);
});

// --- Ferramentas --------------------------------------------------------------------

test("criar, ler e buscar: nomes viram ids, e todo campo preenchido volta na leitura", async () => {
  const criado = await ok("criar", {
    titulo: "Revisar o fluxo de aprovação",
    descricao: "Contexto do fluxo.",
    status: "todo",
    prioridade: "agora",
    projeto: "aut",
    empresa: "acme",
    responsaveis: ["eu", "Ana Exemplo"],
    etiquetas: ["Cliente"],
    prazo: "2026-10-01",
    energia: "media",
    tamanho: 3,
    passos: ["Reproduzir", "Corrigir"],
  });
  assert.match(criado, /^criado AUT-1 #\d+ todo · Revisar o fluxo de aprovação$/);

  const lido = await ok("ler", { ticket: "AUT-1" });
  for (const trecho of [
    "AUT-1 #",
    "status todo",
    "prioridade agora",
    "energia media",
    "tamanho 3",
    "projeto AUT (Automações)",
    "empresa ACME Metalurgia",
    "responsáveis @bruno @ana",
    "relator @bruno",
    "prazo 2026-10-01",
    "etiquetas: cliente",
    "descrição:\nContexto do fluxo.",
    "passos 0/2",
  ]) {
    assert.ok(lido.includes(trecho), `ler não trouxe "${trecho}":\n${lido}`);
  }
  assert.ok(!lido.includes("foco"), "campo vazio não deveria aparecer");

  const json = JSON.parse(await ok("ler", { ticket: "AUT-1", json: true }));
  assert.equal(json.task.key, "AUT-1");
  assert.ok("focusOn" in json.task, "json traz todos os campos, inclusive os vazios");

  const meus = await ok("buscar", { responsavel: "eu" });
  assert.match(meus, /^1 ticket\(s\)\nAUT-1 todo agora @bruno,@ana \[ACME Metalurgia\] prazo:2026-10-01 · Revisar/);
  assert.equal(await ok("buscar", { status: ["done"] }), "Nenhum ticket.");

  const errado = await ferramenta("criar", { titulo: "x", projeto: "NAOEXISTE" });
  assert.ok(errado.isError);
  assert.match(errado.texto, /Opções: AUT/, "o erro lista as opções para a próxima chamada acertar");
});

test("editar move o ticket pelas mesmas regras da tela e diz só o que mudou", async () => {
  const t = await createTask({ title: "Mover pelo agente", status: "todo" }, bruno.id);
  const chave = `#${t.id}`;

  const moveu = await ok("editar", { ticket: chave, status: "doing", responsaveis: ["bruno"] });
  // O foco também muda, pela regra de entrar em doing: a resposta conta o
  // efeito colateral, que é justamente o que o agente não previu.
  assert.match(moveu, new RegExp(`^${chave}: status todo→doing; responsaveis ninguém→@bruno; foco vazio→\\d{4}-\\d{2}-\\d{2}$`));

  const linha = await one("SELECT started_at, focus_on FROM tasks WHERE id = ?", [t.id]);
  assert.ok(linha.started_at, "entrar em doing grava started_at");
  assert.ok(linha.focus_on, "entrar em doing puxa para hoje");

  assert.equal(await ok("editar", { ticket: chave, status: "doing" }), `${chave}: nada mudou`);

  const estranho = await ferramenta("editar", { ticket: chave, state: "done" });
  assert.ok(estranho.isError);
  assert.match(estranho.texto, /Campo desconhecido: state/);

  const enumRuim = await ferramenta("editar", { ticket: chave, status: "feito" });
  assert.ok(enumRuim.isError);
  assert.match(enumRuim.texto, /Aceitos: inbox, todo, doing, waiting, done/);

  const dataRuim = await ferramenta("editar", { ticket: chave, prazo: "2026-02-30" });
  assert.ok(dataRuim.isError, "data impossível não pode passar em silêncio");

  await ok("editar", { ticket: chave, empresa: "ACME", esperando: "retorno do cliente", status: "waiting" });
  const limpou = await ok("editar", { ticket: chave, empresa: null, status: "todo" });
  assert.match(limpou, /status waiting→todo/);
  assert.match(limpou, /empresa ACME Metalurgia→nenhuma/);
  assert.match(limpou, /esperando retorno do cliente→vazio/, "sair de waiting limpa o esperando, como na tela");
});

test("registrar grava sessão e handoff com o tipo, a trilha marca o agente, e o teto recusa texto longo", async () => {
  const t = await createTask({ title: "Com registro", projectId: null }, bruno.id);
  const chave = `#${t.id}`;

  assert.match(await ok("registrar", { ticket: chave, tipo: "sessao", texto: "Feito: x. Resultado: y. Próximo: z." }), /^ok #\d+ sessao$/);
  await ok("registrar", { ticket: chave, tipo: "handoff", texto: "Estado: parado no deploy. Próximo: publicar." });

  const tipos = await all("SELECT kind FROM comments WHERE task_id = ? ORDER BY id", [t.id]);
  assert.deepEqual(tipos.map((c) => c.kind), ["sessao", "handoff"]);

  const eventos = await all("SELECT field, note FROM events WHERE task_id = ? AND kind = 'comment' ORDER BY id", [t.id]);
  assert.deepEqual(eventos.map((e) => e.field), ["sessao", "handoff"]);
  assert.ok(eventos.every((e) => e.note === "agente:Claude do notebook"), JSON.stringify(eventos));

  const longo = await ferramenta("registrar", { ticket: chave, texto: "x".repeat(1501) });
  assert.ok(longo.isError);
  assert.match(longo.texto, /teto é 1500/);

  // Pela tela, a mesma escrita não leva marca de agente.
  await http({
    path: `api/tasks/${t.id}/comments`,
    headers: { cookie: `${COOKIE}=${sessaoBruno}`, "content-type": "application/json" },
    body: { body: "pela tela" },
  });
  const humano = await one("SELECT note FROM events WHERE task_id = ? AND kind = 'comment' ORDER BY id DESC LIMIT 1", [t.id]);
  assert.equal(humano.note, null);
});

test("ler destaca o último handoff só quando ele não está entre as mensagens mostradas", async () => {
  const t = await createTask({ title: "Handoff antigo" }, bruno.id);
  await addComment(t.id, "Estado: A. Próximo: B.", bruno.id, "handoff");
  for (let i = 0; i < 6; i++) await addComment(t.id, `conversa ${i}`, ana.id);

  const lido = await ok("ler", { ticket: `#${t.id}` });
  assert.match(lido, /último handoff #\d+ @bruno [\d-]+ [\d:]+: Estado: A/);
  assert.match(lido, /conversa \(5 de 7\)/);

  const tudo = await ok("ler", { ticket: `#${t.id}`, conversa: 20 });
  assert.ok(!tudo.includes("último handoff"), "o handoff já está na conversa mostrada: repetir é token pago à toa");
  assert.equal(tudo.split("Estado: A").length - 1, 1);
});

test("vincular infere o tipo, não duplica a URL, recusa o que não é http e aparece para a tela", async () => {
  const t = await createTask({ title: "Com PR" }, bruno.id);
  const chave = `#${t.id}`;

  assert.match(await ok("vincular", { ticket: chave, url: "https://github.com/dono/repo/pull/12" }), /^ok link \d+ pr$/);
  assert.match(
    await ok("vincular", { ticket: chave, url: "https://github.com/dono/repo/pull/12", titulo: "Corrige o fluxo" }),
    /já existia/
  );
  const linhas = await all("SELECT kind, title FROM task_links WHERE task_id = ?", [t.id]);
  assert.deepEqual(linhas, [{ kind: "pr", title: "Corrige o fluxo" }]);

  const js = await ferramenta("vincular", { ticket: chave, url: "javascript:alert(1)" });
  assert.ok(js.isError, "javascript: viraria href na tela");

  const tela = await http({ method: "GET", path: `api/tasks/${t.id}`, headers: { cookie: `${COOKIE}=${sessaoBruno}` } });
  assert.equal(tela.json.links.length, 1);
  assert.ok(tela.json.timeline.some((e) => e.kind === "link_add"));

  const achou = await ok("buscar", { texto: "pull/12" });
  assert.ok(achou.includes(chave), "buscar procura nos links");
});

test("passos: acrescenta, conclui e recusa passo de outro ticket", async () => {
  const a = await createTask({ title: "Passos A", steps: ["um"] }, bruno.id);
  const b = await createTask({ title: "Passos B", steps: ["do outro"] }, bruno.id);
  const [passoA] = (await all("SELECT id FROM steps WHERE task_id = ?", [a.id])).map((s) => s.id);
  const [passoB] = (await all("SELECT id FROM steps WHERE task_id = ?", [b.id])).map((s) => s.id);

  const r = await ok("passos", { ticket: `#${a.id}`, novos: ["dois"], concluir: [passoA] });
  assert.match(r, /passos 1\/2: \[x\]\d+ um · \[ \]\d+ dois$/);

  const alheio = await ferramenta("passos", { ticket: `#${a.id}`, concluir: [passoB] });
  assert.ok(alheio.isError);
  assert.equal((await one("SELECT is_done FROM steps WHERE id = ?", [passoB])).is_done, 0);
});

test("anexar por texto e base64, baixar de volta, e a rota binária da ponte", async () => {
  const t = await createTask({ title: "Com anexo" }, bruno.id);
  const chave = `#${t.id}`;

  assert.match(await ok("anexar", { ticket: chave, nome: "teste.log", texto: "linha 1\nlinha 2" }), /^ok anexo \d+ teste\.log/);

  // Um PNG de verdade, mínimo: 1x1.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const img = await ok("anexar", { ticket: chave, nome: "print.png", base64: png.toString("base64") });
  const idImg = Number(img.match(/anexo (\d+)/)[1]);

  const visto = await ferramenta("baixar", { anexo: idImg });
  assert.equal(visto.content[1].type, "image");
  assert.equal(Buffer.from(visto.content[1].data, "base64").compare(png), 0);

  const idLog = (await one("SELECT id FROM attachments WHERE original_name = 'teste.log'")).id;
  const log = await ok("baixar", { anexo: idLog });
  assert.ok(log.endsWith("linha 1\nlinha 2"));

  const semDisco = await ferramenta("anexar", { ticket: chave, caminho: "C:/x.png" });
  assert.ok(semDisco.isError, "caminho não existe sem a ponte");

  const exe = await ferramenta("anexar", { ticket: chave, nome: "virus.exe", base64: "AA==" });
  assert.ok(exe.isError);

  const outro = await createTask({ title: "Outro" }, bruno.id);
  const msgOutro = await addComment(outro.id, "msg", bruno.id);
  const cruzado = await ferramenta("anexar", { ticket: chave, nome: "a.txt", texto: "a", comentario: msgOutro.id });
  assert.ok(cruzado.isError, "anexo preso a mensagem de outro ticket");

  const subiu = await http({
    path: "api/mcp/anexos",
    query: `ticket=${encodeURIComponent(chave)}&nome=binario.png`,
    headers: { authorization: `Bearer ${segredo}`, "content-type": "image/png" },
    body: png,
  });
  assert.equal(subiu.status, 201, String(subiu.bruto));
  const idBin = Number(subiu.json.texto.match(/anexo (\d+)/)[1]);

  const desceu = await http({ method: "GET", path: `api/mcp/anexos/${idBin}`, headers: { authorization: `Bearer ${segredo}` } });
  assert.equal(desceu.status, 200);
  assert.equal(desceu.bruto.compare(png), 0, "o arquivo volta byte a byte");
  assert.match(desceu.headers["Content-Disposition"], /binario\.png/);
});

test("apagar segue a regra da tela: o seu sim, o alheio não", async () => {
  const t = await createTask({ title: "Apagáveis" }, bruno.id);
  const daAna = await addComment(t.id, "da Ana", ana.id);
  const meu = await addComment(t.id, "meu", bruno.id);

  const alheio = await ferramenta("apagar", { comentario: daAna.id });
  assert.ok(alheio.isError);
  assert.ok(await one("SELECT id FROM comments WHERE id = ?", [daAna.id]));

  assert.equal(await ok("apagar", { comentario: meu.id }), `apagado comentario ${meu.id}`);
  assert.equal(await one("SELECT id FROM comments WHERE id = ?", [meu.id]), null);

  const dois = await ferramenta("apagar", { comentario: 1, link: 1 });
  assert.ok(dois.isError);

  const daAnaPeloToken = await ferramenta("apagar", { comentario: daAna.id }, { token: segredoAna });
  assert.ok(!daAnaPeloToken.isError, daAnaPeloToken.texto);
});

test("pessoa desativada não recebe ticket novo, mas continua achável e pode ser mantida", async () => {
  const carla = await createUser({ username: "carla", displayName: "Carla Exemplo", password: "x" });
  const t = await createTask({ title: "Da Carla", assigneeIds: [carla.id] }, bruno.id);
  const novo = await createTask({ title: "Sem ninguém" }, bruno.id);
  await run("UPDATE users SET is_active = 0 WHERE id = ?", [carla.id]);

  const atribuir = await ferramenta("editar", { ticket: `#${novo.id}`, responsaveis: ["carla"] });
  assert.ok(atribuir.isError, "a tela não deixa atribuir quem saiu do time, e o MCP também não");
  assert.match(atribuir.texto, /desativada/);
  assert.ok((await ferramenta("criar", { titulo: "x", responsaveis: ["carla"] })).isError);

  assert.match(await ok("editar", { ticket: `#${t.id}`, responsaveis: ["carla", "bruno"] }), /@carla→@carla,@bruno/);
  assert.match(await ok("buscar", { responsavel: "carla" }), /Da Carla/);
});

test("projeto e empresa arquivados: buscar acha o trabalho vivo, editar diz que está arquivado", async () => {
  await run("INSERT INTO projects (key, name, is_archived, created_at, updated_at) VALUES ('OLD', 'Antigo', 1, 'x', 'x')");
  const projeto = await one("SELECT id FROM projects WHERE key = 'OLD'");
  const t = await createTask({ title: "Vivo em projeto arquivado", projectId: projeto.id }, bruno.id);

  assert.match(await ok("buscar", { projeto: "OLD" }), /OLD-1/);
  assert.ok(t.key === "OLD-1");
  const outro = await createTask({ title: "Fora" }, bruno.id);
  const levar = await ferramenta("editar", { ticket: `#${outro.id}`, projeto: "OLD" });
  assert.ok(levar.isError);
  assert.match(levar.texto, /está arquivado/);
});

test("esperando acima do teto é recusado igual em criar e editar, sem cortar em silêncio", async () => {
  const longo = "x".repeat(201);
  assert.match((await ferramenta("criar", { titulo: "x", esperando: longo })).texto, /teto é 200/);
  const t = await createTask({ title: "Esperando" }, bruno.id);
  assert.match((await ferramenta("editar", { ticket: `#${t.id}`, esperando: longo })).texto, /teto é 200/);
});

test("contexto diz quem é o agente e os nomes que as ferramentas aceitam", async () => {
  const texto = await ok("contexto");
  assert.match(texto, /^eu: bruno \(Bruno Exemplo\) member/);
  assert.match(texto, /projetos: AUT Automações/);
  assert.match(texto, /empresas: ACME Metalurgia/);
  assert.match(texto, /registro: comentario sessao handoff/);
});

// --- Travas de futuro -------------------------------------------------------------------

test("todo campo que a API de tarefa altera tem nome no MCP, ou motivo escrito para não ter", () => {
  const fonte = readFileSync(join(RAIZ, "server/tasks.js"), "utf8");
  const abre = fonte.indexOf("const FIELDS = {");
  const fecha = fonte.indexOf("\n};", abre);
  const campos = (fonte.slice(abre, fecha).match(/^ {2}([A-Za-z_]+):/gm) || []).map((s) => s.trim().slice(0, -1));
  assert.ok(campos.length > 10, "extração de FIELDS falhou");

  const cobertos = new Set([...Object.values(CAMPOS), ...Object.keys(FORA_DO_MCP)]);
  const faltam = campos.filter((c) => !cobertos.has(c));
  assert.deepEqual(faltam, [], "campo novo em FIELDS: ponha em CAMPOS (server/mcp/comum.js) ou em FORA_DO_MCP com o motivo");
});

test("toda rota da API está coberta por ferramenta, ou fora com motivo", () => {
  const fonte = readFileSync(join(RAIZ, "server/api.js"), "utf8");
  const rotas = [...new Set([...fonte.matchAll(/head === "(\w+)"/g)].map((m) => m[1]))];
  assert.ok(rotas.length > 10, "extração das rotas falhou");

  const faltam = rotas.filter((r) => !(r in COBERTURA));
  assert.deepEqual(faltam, [], "rota nova: cubra no MCP ou registre em COBERTURA (server/mcp/catalogo.js) com o motivo");

  const nomes = new Set(FERRAMENTAS.map((f) => f.nome));
  for (const [rota, quem] of Object.entries(COBERTURA)) {
    if (!Array.isArray(quem)) {
      assert.ok(quem.fora, `${rota}: fora sem motivo`);
      continue;
    }
    for (const nome of quem) {
      if (rota !== "mcp") assert.ok(nomes.has(nome), `${rota} aponta para ferramenta inexistente: ${nome}`);
    }
  }
});

test("todo arquivo de ferramentas/ está no catálogo, com nome único", () => {
  const arquivos = readdirSync(join(RAIZ, "server/mcp/ferramentas")).filter((f) => f.endsWith(".js"));
  const fonte = readFileSync(join(RAIZ, "server/mcp/catalogo.js"), "utf8");
  for (const arq of arquivos) {
    assert.ok(fonte.includes(`./ferramentas/${arq}`), `${arq} não está em catalogo.js: a ferramenta não existe para o agente`);
  }
  assert.equal(new Set(FERRAMENTAS.map((f) => f.nome)).size, FERRAMENTAS.length);
  assert.equal(FERRAMENTAS.length, arquivos.length);
});

test("tipo novo de registro ou de link chega sozinho ao enum da ferramenta", async () => {
  const tools = await listar(false);
  assert.deepEqual(tools.find((f) => f.name === "registrar").inputSchema.properties.tipo.enum, COMMENT_KINDS);
  assert.deepEqual(tools.find((f) => f.name === "vincular").inputSchema.properties.tipo.enum, LINK_KINDS);
});

// O custo fixo do MCP: o catálogo e as instruções entram no contexto de toda
// sessão com o servidor ligado. O teto é folga sobre o tamanho de hoje, e não
// meta; estourar pede enxugar descrição antes de subir o número.
test("o catálogo e as instruções cabem no orçamento de tokens", async () => {
  for (const ponte of [false, true]) {
    const tamanho = JSON.stringify(await listar(ponte)).length;
    assert.ok(tamanho <= 7500, `tools/list ${ponte ? "da ponte" : "remoto"} com ${tamanho} caracteres`);
  }
  assert.ok(INSTRUCOES.length <= 1000, `instruções com ${INSTRUCOES.length} caracteres`);
});
