#!/usr/bin/env node
// A ponte local do MCP.
//
// O servidor MCP mora no aplicativo (server/mcp, em /api/mcp). Esta ponte roda
// na máquina do agente, fala stdio com o Claude Code e repassa cada mensagem
// para lá. Ela existe por uma razão só: o disco. Pelo MCP remoto, anexar um
// print obriga o modelo a escrever o arquivo em base64 dentro da chamada, o que
// custa mais token que o resto da sessão inteira. Aqui o agente passa o caminho,
// e os bytes vão do disco direto para o servidor.
//
// Por isso ela conhece duas ferramentas e mais nada:
//   anexar com caminho  lê o arquivo e envia por POST /api/mcp/anexos
//   baixar              salva o anexo em disco e devolve o caminho
// Todo o resto (lista de ferramentas, descrições, regras) vem do servidor a cada
// sessão. Ferramenta nova no servidor chega aqui sem atualizar a ponte.
//
// Sem dependência: Node 22 ou mais novo, e só.
//
// Como servidor MCP (o Claude Code chama):
//   claude mcp add tdah -s user -e TDAH_URL=https://tarefas.logusautomacao.com -e TDAH_TOKEN=tdah_... -- node "<clone>/scripts/mcp/ponte.mjs"
//
// Como linha de comando (automação de teste, script de print):
//   node scripts/mcp/ponte.mjs anexar AUT-14 C:/prints/login.png [comentario=34]
//   node scripts/mcp/ponte.mjs baixar 7 [C:/pasta]
//   node scripts/mcp/ponte.mjs chamar registrar ticket=AUT-14 tipo=sessao "texto=Feito: ..."
//   node scripts/mcp/ponte.mjs chamar buscar '{"status":["doing"]}'
//   node scripts/mcp/ponte.mjs verificar
//
// Detalhes e o porquê de cada escolha: docs/MCP.md.

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const BASE = String(process.env.TDAH_URL || "https://tarefas.logusautomacao.com").replace(/\/+$/, "");
const TOKEN = String(process.env.TDAH_TOKEN || "").trim();
const TEMPO_MS = Number(process.env.TDAH_TEMPO_MS) || 60000;

// Os mesmos tipos que o servidor aceita (MIME_DA_EXTENSAO, server/comments.js).
// Repetidos aqui porque a ponte roda sem o resto do repositório, e o servidor
// continua sendo quem decide: extensão fora da lista volta recusada de lá.
const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".md": "text/plain",
  ".csv": "text/csv",
  ".zip": "application/zip",
  ".json": "application/json",
};

// Imagem acima disto não volta para o modelo nem com ver=true: o arquivo está
// salvo, e a imagem inteira no contexto custaria mais do que ajuda.
const TETO_VER = 5 * 1024 * 1024;

// --- Servidor ----------------------------------------------------------------------

function cabecalhos(extra = {}) {
  return { Authorization: `Bearer ${TOKEN}`, "X-TDAH-Ponte": "1", ...extra };
}

async function falarComServidor(mensagem) {
  const r = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: cabecalhos({ "Content-Type": "application/json", Accept: "application/json, text/event-stream" }),
    body: JSON.stringify(mensagem),
    signal: AbortSignal.timeout(TEMPO_MS),
  });
  if (r.status === 202) return null;
  const corpo = await r.text();
  if (!r.ok) throw new Error(motivo(r.status, corpo));
  return JSON.parse(corpo);
}

function motivo(status, corpo) {
  let texto = "";
  try {
    texto = JSON.parse(corpo).error || "";
  } catch {}
  if (status === 401) return `Token recusado (401). ${texto || "Gere outro no aplicativo: menu da conta, Conectar um agente."}`;
  return `Servidor respondeu ${status}. ${texto}`.trim();
}

// --- As duas ferramentas que precisam de disco ---------------------------------------

async function anexarDoDisco(args) {
  if (!args.ticket) return erro("Falta ticket.");
  const caminho = resolve(String(args.caminho));
  let conteudo;
  try {
    conteudo = await readFile(caminho);
  } catch (err) {
    return erro(`Não consegui ler ${caminho}: ${err.code || err.message}.`);
  }

  const nome = args.nome || basename(caminho);
  const tipo = MIME[extname(nome).toLowerCase()] || "application/octet-stream";
  const consulta = new URLSearchParams({ ticket: String(args.ticket), nome });
  if (args.comentario !== undefined && args.comentario !== null) consulta.set("comentario", String(args.comentario));

  const r = await fetch(`${BASE}/api/mcp/anexos?${consulta}`, {
    method: "POST",
    headers: cabecalhos({ "Content-Type": tipo }),
    body: conteudo,
    signal: AbortSignal.timeout(TEMPO_MS),
  });
  const corpo = await r.text();
  if (!r.ok) return erro(motivo(r.status, corpo));
  return texto(JSON.parse(corpo).texto);
}

async function baixarParaDisco(args) {
  const id = Number(String(args.anexo ?? "").replace(/^#/, ""));
  if (!Number.isSafeInteger(id) || id <= 0) return erro("Falta anexo (id).");

  const r = await fetch(`${BASE}/api/mcp/anexos/${id}`, {
    headers: cabecalhos(),
    signal: AbortSignal.timeout(TEMPO_MS),
  });
  if (!r.ok) return erro(motivo(r.status, await r.text()));

  const conteudo = Buffer.from(await r.arrayBuffer());
  const mime = String(r.headers.get("content-type") || "").split(";")[0];
  const nome = nomeSeguro(nomeDoCabecalho(r.headers.get("content-disposition")) || `anexo-${id}`);

  // destino pode ser pasta (existente, ou terminada em barra) ou arquivo.
  let alvo;
  const destino = args.destino ? resolve(String(args.destino)) : join(tmpdir(), "tdah-anexos");
  const ehPasta =
    !args.destino ||
    /[\\/]$/.test(String(args.destino)) ||
    (await stat(destino).then((s) => s.isDirectory()).catch(() => false));
  if (ehPasta) {
    await mkdir(destino, { recursive: true });
    alvo = join(destino, `${id}-${nome}`);
  } else {
    await mkdir(dirname(destino), { recursive: true });
    alvo = destino;
  }
  await writeFile(alvo, conteudo);

  const content = [{ type: "text", text: `salvo ${alvo} (${tamanho(conteudo.length)} ${mime})` }];
  if (args.ver && mime.startsWith("image/") && conteudo.length <= TETO_VER) {
    content.push({ type: "image", data: conteudo.toString("base64"), mimeType: mime });
  }
  return { content };
}

function nomeDoCabecalho(cabecalho) {
  const m = /filename\*=UTF-8''([^;]+)/i.exec(String(cabecalho || ""));
  try {
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

// O nome veio de quem enviou o anexo: sem caminho e sem caractere que o Windows
// recusa, para nunca escrever fora da pasta escolhida.
function nomeSeguro(nome) {
  return String(nome).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "_").slice(0, 120);
}

function tamanho(bytes) {
  return bytes < 1024 ? `${bytes}B` : bytes < 1048576 ? `${Math.round(bytes / 1024)}KB` : `${(bytes / 1048576).toFixed(1)}MB`;
}

const texto = (t) => ({ content: [{ type: "text", text: t }] });
const erro = (t) => ({ content: [{ type: "text", text: t }], isError: true });

// --- Uma mensagem ---------------------------------------------------------------------

export async function tratar(m) {
  try {
    if (m?.method === "tools/call") {
      const nome = m.params?.name;
      const args = m.params?.arguments || {};
      if (nome === "anexar" && args.caminho) return resposta(m.id, await anexarDoDisco(args));
      if (nome === "baixar") return resposta(m.id, await baixarParaDisco(args));
    }
    if (!TOKEN && m && "id" in m) {
      throw new Error("TDAH_TOKEN ausente. Gere um no aplicativo: menu da conta, Conectar um agente.");
    }
    return await falarComServidor(m);
  } catch (err) {
    if (!m || !("id" in m)) return null;
    // Falha de rede numa ferramenta volta como resultado com erro, que o modelo
    // lê; em qualquer outro método, como erro de protocolo.
    if (m.method === "tools/call") return resposta(m.id, erro(err.message));
    return { jsonrpc: "2.0", id: m.id, error: { code: -32603, message: err.message } };
  }
}

function resposta(id, result) {
  return { jsonrpc: "2.0", id, result };
}

// --- stdio ----------------------------------------------------------------------------

async function servir() {
  const pendentes = new Set();
  const escrever = (obj) => {
    if (obj) process.stdout.write(`${JSON.stringify(obj)}\n`);
  };

  const linhas = createInterface({ input: process.stdin, crlfDelay: Infinity });
  linhas.on("line", (linha) => {
    if (!linha.trim()) return;
    let m;
    try {
      m = JSON.parse(linha);
    } catch {
      return escrever({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido." } });
    }
    // Em paralelo: um download lento não segura o ping que chega atrás dele.
    const vez = (Array.isArray(m) ? lote(m) : tratar(m)).then(escrever, (err) =>
      process.stderr.write(`[ponte] ${err?.stack || err}\n`)
    );
    pendentes.add(vez);
    vez.finally(() => pendentes.delete(vez));
  });
  linhas.on("close", async () => {
    await Promise.allSettled([...pendentes]);
    process.exit(0);
  });
}

async function lote(mensagens) {
  const saida = [];
  for (const m of mensagens) {
    const r = await tratar(m);
    if (r) saida.push(r);
  }
  return saida.length ? saida : null;
}

// --- Linha de comando -----------------------------------------------------------------

async function linhaDeComando(argv) {
  const [acao, ...resto] = argv;
  let chamada;

  if (acao === "anexar") {
    const [ticket, caminho, ...extra] = resto;
    chamada = { name: "anexar", arguments: { ticket, caminho, ...pares(extra) } };
  } else if (acao === "baixar") {
    const [anexo, destino] = resto;
    chamada = { name: "baixar", arguments: { anexo: Number(anexo), ...(destino ? { destino } : {}) } };
  } else if (acao === "chamar") {
    const [name, ...extra] = resto;
    const args = extra.length === 1 && extra[0].trim().startsWith("{") ? JSON.parse(extra[0]) : pares(extra);
    chamada = { name, arguments: args };
  } else if (acao === "verificar") {
    const ini = await tratar({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ponte-cli", version: "1" } } });
    if (ini.error) return falhar(ini.error.message);
    const lista = await tratar({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    if (lista.error) return falhar(lista.error.message);
    const quem = await tratar({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "contexto", arguments: {} } });
    console.log(`ok ${BASE} · versão ${ini.result.serverInfo.version} · ${lista.result.tools.length} ferramentas`);
    console.log(quem.result.content[0].text.split("\n")[0]);
    return;
  } else {
    console.log("uso: ponte.mjs [anexar <ticket> <arquivo> | baixar <anexo> [destino] | chamar <ferramenta> chave=valor... | verificar]");
    console.log("sem argumentos, serve MCP por stdio.");
    process.exitCode = acao ? 1 : 0;
    return;
  }

  const r = await tratar({ jsonrpc: "2.0", id: 1, method: "tools/call", params: chamada });
  if (r.error) return falhar(r.error.message);
  for (const bloco of r.result.content) {
    if (bloco.type === "text") console.log(bloco.text);
  }
  if (r.result.isError) process.exitCode = 1;
}

// chave=valor; o valor que é JSON válido (número, true, lista) vira o tipo dele.
function pares(lista) {
  const saida = {};
  for (const item of lista) {
    const i = item.indexOf("=");
    if (i < 1) throw new Error(`Argumento sem chave=valor: ${item}`);
    const bruto = item.slice(i + 1);
    let valor = bruto;
    try {
      valor = JSON.parse(bruto);
    } catch {}
    saida[item.slice(0, i)] = valor;
  }
  return saida;
}

function falhar(mensagem) {
  console.error(mensagem);
  process.exitCode = 1;
}

// Importada pelos testes, a ponte não sobe nada.
const direto = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (direto) {
  if (process.argv.length > 2) {
    linhaDeComando(process.argv.slice(2)).catch((err) => falhar(err.message));
  } else {
    servir();
  }
}
