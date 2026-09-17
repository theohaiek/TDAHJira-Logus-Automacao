// A ponte local do MCP (scripts/mcp/ponte.mjs), de ponta a ponta.
//
// Sobe um servidor HTTP de verdade com a mesma sequência de server/index.js,
// roda a ponte como processo separado, e fala com ela por stdio como o Claude
// Code fala. O que se confere é o que só a ponte faz: o arquivo sai do disco e
// chega ao servidor byte a byte, e o anexo volta para o disco sem passar pelo
// modelo. Mais a linha de comando, que é por onde a automação de teste entra.
//
//   node --test tests/mcp-ponte.test.js

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

process.env.TDAH_DATA_DIR = mkdtempSync(join(tmpdir(), "tdah-ponte-"));

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const PONTE = join(RAIZ, "scripts", "mcp", "ponte.mjs");
const TEMP = mkdtempSync(join(tmpdir(), "tdah-ponte-arquivos-"));
const rodar = promisify(execFile);

const { openDb, one } = await import("../server/db.js");
const { DB_FILE, DATA_DIR } = await import("../server/paths.js");
const { createUser, criarTokenDeAgente, usuarioDaRequisicao } = await import("../server/auth.js");
const { handleApi } = await import("../server/api.js");
const { createTask } = await import("../server/tasks.js");
const { sendError, sameOrigin } = await import("../server/http.js");

let servidor;
let base;
let segredo;
let ticket;

// Um PNG 1x1 de verdade.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

before(async () => {
  await openDb(DB_FILE);
  const bruno = await createUser({ username: "bruno", displayName: "Bruno Exemplo", password: "x" });
  segredo = (await criarTokenDeAgente(bruno.id, "ponte de teste")).segredo;
  ticket = await createTask({ title: "Ticket da ponte" }, bruno.id);

  // A mesma sequência de server/index.js, sem os arquivos estáticos.
  servidor = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (!sameOrigin(req)) return sendError(res, 403, "Origem não permitida.");
      const user = await usuarioDaRequisicao(req);
      await handleApi(req, res, { path: url.pathname.replace(/^\/+/, ""), query: url.searchParams, user });
    } catch (err) {
      if (!res.headersSent) sendError(res, err.status || 500, err.message);
      else res.end();
    }
  });
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => {
  servidor?.close();
  try {
    if (DATA_DIR.startsWith(tmpdir())) rmSync(DATA_DIR, { recursive: true, force: true });
    rmSync(TEMP, { recursive: true, force: true });
  } catch {}
});

// Sobe a ponte e devolve uma função que manda uma mensagem e espera a resposta
// do mesmo id.
function abrirPonte(env = {}) {
  const filho = spawn(process.execPath, [PONTE], {
    env: { ...process.env, TDAH_URL: base, TDAH_TOKEN: segredo, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const esperando = new Map();
  let sobra = "";
  filho.stdout.on("data", (pedaco) => {
    sobra += pedaco.toString("utf8");
    let i;
    while ((i = sobra.indexOf("\n")) >= 0) {
      const linha = sobra.slice(0, i);
      sobra = sobra.slice(i + 1);
      if (!linha.trim()) continue;
      const m = JSON.parse(linha);
      esperando.get(m.id)?.(m);
      esperando.delete(m.id);
    }
  });
  let id = 0;
  const pedir = (method, params) =>
    new Promise((ok, falha) => {
      const meu = ++id;
      const relogio = setTimeout(() => falha(new Error(`sem resposta para ${method}`)), 15000);
      esperando.set(meu, (m) => {
        clearTimeout(relogio);
        ok(m);
      });
      filho.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: meu, method, params })}\n`);
    });
  const avisar = (method) => filho.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  const fechar = () => filho.stdin.end();
  return { pedir, avisar, fechar, filho };
}

test("pela ponte: conecta, lista com caminho, anexa do disco e baixa para o disco byte a byte", async () => {
  const ponte = abrirPonte();
  try {
    const ini = await ponte.pedir("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    assert.equal(ini.result.serverInfo.name, "tdah-logus");
    ponte.avisar("notifications/initialized");

    const lista = await ponte.pedir("tools/list");
    const anexar = lista.result.tools.find((f) => f.name === "anexar");
    assert.ok(anexar.inputSchema.properties.caminho, "a ponte se identifica e recebe o esquema com caminho");

    const arquivo = join(TEMP, "print do teste.png");
    writeFileSync(arquivo, PNG);
    const subiu = await ponte.pedir("tools/call", { name: "anexar", arguments: { ticket: `#${ticket.id}`, caminho: arquivo } });
    assert.ok(!subiu.result.isError, subiu.result.content[0].text);
    const id = Number(subiu.result.content[0].text.match(/anexo (\d+)/)[1]);

    const linha = await one("SELECT original_name, mime, size_bytes FROM attachments WHERE id = ?", [id]);
    assert.deepEqual(linha, { original_name: "print do teste.png", mime: "image/png", size_bytes: PNG.length });

    const pasta = join(TEMP, "baixados");
    const desceu = await ponte.pedir("tools/call", { name: "baixar", arguments: { anexo: id, destino: `${pasta}/`, ver: true } });
    assert.ok(!desceu.result.isError, desceu.result.content[0].text);
    const salvo = join(pasta, `${id}-print do teste.png`);
    assert.ok(existsSync(salvo), desceu.result.content[0].text);
    assert.equal(readFileSync(salvo).compare(PNG), 0);
    assert.equal(desceu.result.content[1].type, "image", "ver=true devolve a imagem ao modelo");

    const semArquivo = await ponte.pedir("tools/call", { name: "anexar", arguments: { ticket: `#${ticket.id}`, caminho: join(TEMP, "nao-existe.png") } });
    assert.ok(semArquivo.result.isError);

    const buscar = await ponte.pedir("tools/call", { name: "buscar", arguments: {} });
    assert.match(buscar.result.content[0].text, /Ticket da ponte/, "o resto passa direto para o servidor");
  } finally {
    ponte.fechar();
  }
});

test("token errado vira mensagem legível, e não silêncio", async () => {
  const ponte = abrirPonte({ TDAH_TOKEN: `tdah_${"b".repeat(43)}` });
  try {
    const ini = await ponte.pedir("initialize", { protocolVersion: "2025-06-18" });
    assert.match(ini.error.message, /Token recusado \(401\)/);

    const chamada = await ponte.pedir("tools/call", { name: "buscar", arguments: {} });
    assert.ok(chamada.result.isError, "ferramenta devolve o erro como resultado, que o modelo lê");
  } finally {
    ponte.fechar();
  }
});

test("linha de comando: a automação de teste anexa, registra e verifica sem MCP nenhum", async () => {
  const env = { ...process.env, TDAH_URL: base, TDAH_TOKEN: segredo };
  const arquivo = join(TEMP, "falha.log");
  writeFileSync(arquivo, "erro na etapa 3\n");

  const anexou = await rodar(process.execPath, [PONTE, "anexar", `#${ticket.id}`, arquivo], { env });
  assert.match(anexou.stdout, /^ok anexo \d+ falha\.log/);

  const registrou = await rodar(
    process.execPath,
    [PONTE, "chamar", "registrar", `ticket=#${ticket.id}`, "tipo=sessao", "texto=Feito: suíte e2e. Resultado: 1 falha. Próximo: corrigir etapa 3."],
    { env }
  );
  assert.match(registrou.stdout, /^ok #\d+ sessao/);
  const c = await one("SELECT kind, body FROM comments WHERE task_id = ? ORDER BY id DESC LIMIT 1", [ticket.id]);
  assert.equal(c.kind, "sessao");
  assert.match(c.body, /Próximo: corrigir etapa 3\.$/, "acento atravessa a linha de comando e o HTTP inteiro");

  const verificou = await rodar(process.execPath, [PONTE, "verificar"], { env });
  assert.match(verificou.stdout, /^ok http:\/\/127\.0\.0\.1:\d+ · versão \d+\.\d+ · \d+ ferramentas\neu: bruno/);

  await assert.rejects(
    rodar(process.execPath, [PONTE, "chamar", "editar", `ticket=#${ticket.id}`, "status=feito"], { env }),
    (err) => err.code === 1 && /não vale/.test(err.stdout),
    "erro de ferramenta sai com código 1, para o script de teste perceber"
  );
});
