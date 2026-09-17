// O servidor MCP dos tickets.
//
// MCP (Model Context Protocol) é como um agente de código, o Claude Code por
// exemplo, descobre e chama ferramentas externas. Este arquivo fala o protocolo
// por HTTP ("Streamable HTTP", sem sessão e sem SSE), em /api/mcp, dentro da
// mesma função que serve o resto da API. Não há biblioteca: o protocolo que se
// usa aqui são quatro métodos de JSON-RPC, e uma dependência traria mais
// superfície do que ajuda, como o driver do Turso já decidiu antes.
//
// Duas formas de conectar, a mesma lista de ferramentas:
//
//   remoto  o Claude Code fala direto com /api/mcp, com o token no cabeçalho
//   ponte   scripts/mcp/ponte.mjs roda na máquina, repassa tudo para cá e
//           resolve localmente o que precisa de disco: anexar por caminho de
//           arquivo e baixar anexo para uma pasta. Vem com X-TDAH-Ponte: 1.
//
// Ferramenta nova: um arquivo em ferramentas/ e uma linha em catalogo.js. O
// resto (lista, validação, erro, trilha "via agente") acontece aqui sozinho.
// O passo a passo está em docs/MCP.md.

import { readJson, readBody, sendJson } from "../http.js";
import { MAX_UPLOAD, getAttachment, readAttachment } from "../comments.js";
import { serieAtual } from "../versao.js";
import { FERRAMENTAS } from "./catalogo.js";
import { INSTRUCOES } from "./instrucoes.js";
import { anexarConteudo } from "./ferramentas/anexar.js";

// Da mais nova para a mais antiga. O servidor responde com a versão que o
// cliente pediu quando a conhece, senão com a primeira desta lista.
export const VERSOES = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const POR_NOME = new Map(FERRAMENTAS.map((f) => [f.nome, f]));

// Cabe um anexo inteiro em base64 dentro do JSON, e mais nada.
const TETO_JSON = Math.ceil((MAX_UPLOAD * 4) / 3) + 64 * 1024;

export async function rotaMcp(req, res, { parts, method, query, user }) {
  if (!user?.agente) {
    return sendJson(
      res,
      401,
      { error: "O MCP exige um token de agente. Gere um no aplicativo: menu da sua conta, Conectar um agente." },
      { "WWW-Authenticate": 'Bearer realm="tdah"' }
    );
  }

  const ctx = { user, ponte: req.headers["x-tdah-ponte"] === "1" };
  const [, recurso, alvo, resto] = parts;

  if (!recurso) {
    if (method === "POST") return jsonRpc(req, res, ctx);
    // Sem fluxo de eventos do servidor (GET) e sem sessão para encerrar
    // (DELETE): o protocolo manda responder 405, e o cliente segue só com POST.
    return sendJson(res, 405, { error: "Use POST." }, { Allow: "POST" });
  }

  // O caminho binário da ponte. Anexo pela ponte não passa por base64 nem pelo
  // contexto do modelo: o arquivo vai do disco da máquina direto para cá.
  if (recurso === "anexos" && !alvo && method === "POST") {
    const buffer = await readBody(req, MAX_UPLOAD + 1024);
    const tipo = String(req.headers["content-type"] || "").split(";")[0].trim();
    const texto = await anexarConteudo(
      {
        ticket: query.get("ticket"),
        nome: query.get("nome"),
        mime: tipo && tipo !== "application/octet-stream" ? tipo : null,
        comentario: query.get("comentario"),
        buffer,
      },
      ctx
    );
    return sendJson(res, 201, { texto });
  }

  const id = Number(alvo);
  if (recurso === "anexos" && Number.isSafeInteger(id) && id > 0 && !resto && method === "GET") {
    const meta = await getAttachment(id);
    const arquivo = meta ? await readAttachment(id) : null;
    if (!arquivo) return sendJson(res, 404, { error: `Anexo #${alvo} não existe.` });
    res.writeHead(200, {
      "Content-Type": meta.mime,
      "Content-Length": arquivo.conteudo.length,
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
      "Cache-Control": "no-store",
    });
    return res.end(arquivo.conteudo);
  }

  return sendJson(res, 404, { error: "Recurso do MCP não encontrado." });
}

// --- JSON-RPC --------------------------------------------------------------------

async function jsonRpc(req, res, ctx) {
  let corpo;
  try {
    corpo = await readJson(req, TETO_JSON);
  } catch (err) {
    if (err.status === 400) return sendJson(res, 400, falhaRpc(null, -32700, "JSON inválido."));
    throw err;
  }

  // Lote (lista de mensagens) saiu do protocolo em 2025-06-18, mas cliente de
  // versão anterior ainda pode mandar. Atende em ordem: escrita depende dela.
  const lote = Array.isArray(corpo);
  const mensagens = lote ? corpo : [corpo];
  if (lote && !mensagens.length) return sendJson(res, 400, falhaRpc(null, -32600, "Lote vazio."));

  const respostas = [];
  for (const m of mensagens) {
    const r = await atender(m, ctx);
    if (r) respostas.push(r);
  }

  // Só notificação ou resposta: nada a devolver, e o protocolo pede 202.
  if (!respostas.length) {
    res.writeHead(202, { "Content-Length": 0, "Cache-Control": "no-store" });
    return res.end();
  }
  return sendJson(res, 200, lote ? respostas : respostas[0]);
}

export async function atender(m, ctx) {
  if (!m || typeof m !== "object" || Array.isArray(m) || m.jsonrpc !== "2.0") {
    return falhaRpc(m?.id ?? null, -32600, "Mensagem JSON-RPC inválida.");
  }
  // Resposta do cliente a um pedido nosso (não fazemos nenhum) ou notificação
  // (notifications/initialized, cancelled): não se responde.
  if (!("method" in m) || !("id" in m)) return null;

  switch (m.method) {
    case "initialize":
      return sucesso(m.id, {
        protocolVersion: VERSOES.includes(m.params?.protocolVersion) ? m.params.protocolVersion : VERSOES[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "tdah-logus", title: "TDAH Jira Logus", version: serieAtual() },
        instructions: INSTRUCOES,
      });
    case "ping":
      return sucesso(m.id, {});
    case "tools/list":
      return sucesso(m.id, { tools: listar(ctx) });
    case "tools/call": {
      const f = POR_NOME.get(m.params?.name);
      if (!f) return falhaRpc(m.id, -32602, `Ferramenta desconhecida: ${m.params?.name}.`);
      return sucesso(m.id, await chamar(f, m.params?.arguments, ctx));
    }
    default:
      return falhaRpc(m.id, -32601, `Método não suportado: ${m.method}.`);
  }
}

// --- Ferramentas -------------------------------------------------------------------

export function listar(ctx) {
  return FERRAMENTAS.map((f) => {
    const anotacoes = {};
    if (f.leitura) anotacoes.readOnlyHint = true;
    if (f.destrutiva) anotacoes.destructiveHint = true;
    return {
      name: f.nome,
      title: f.titulo,
      description: typeof f.descricao === "function" ? f.descricao(ctx) : f.descricao,
      inputSchema: esquema(f.entrada, ctx),
      ...(Object.keys(anotacoes).length ? { annotations: anotacoes } : {}),
    };
  });
}

// O esquema que o cliente vê. Propriedade marcada `so: "ponte"` só existe pela
// ponte (caminho de arquivo local), `so: "remoto"` só sem ela (base64): cada
// agente enxerga só o que funciona para ele, e não paga token pelo resto.
function esquema(entrada, ctx) {
  const properties = {};
  for (const [nome, spec] of Object.entries(entrada.properties || {})) {
    if (!visivel(spec, ctx)) continue;
    const { so, ...limpo } = spec;
    properties[nome] = limpo;
  }
  return { type: "object", properties, ...(entrada.required?.length ? { required: entrada.required } : {}) };
}

function visivel(spec, ctx) {
  return !spec.so || (spec.so === "ponte") === ctx.ponte;
}

// Erro de uso volta como resultado com isError, e não como erro de JSON-RPC: é
// assim que o texto chega ao modelo, que corrige a chamada seguinte sozinho.
export async function chamar(f, bruto, ctx) {
  const args = bruto ?? {};
  if (typeof args !== "object" || Array.isArray(args)) return erro("Argumentos precisam ser um objeto.");

  const aceitos = esquema(f.entrada, ctx).properties;
  const estranhos = Object.keys(args).filter((k) => !(k in aceitos));
  if (estranhos.length) {
    return erro(`Campo desconhecido: ${estranhos.join(", ")}. Aceitos: ${Object.keys(aceitos).join(", ")}.`);
  }
  for (const r of f.entrada.required || []) {
    if (args[r] === undefined || args[r] === null || args[r] === "") return erro(`Falta ${r}.`);
  }
  for (const [nome, spec] of Object.entries(aceitos)) {
    if (spec.enum && nome in args && !spec.enum.includes(args[nome])) {
      return erro(`${nome}: "${args[nome]}" não vale. Aceitos: ${spec.enum.filter((v) => v !== null).join(", ")}.`);
    }
  }

  try {
    const saida = await f.executar(args, ctx);
    return typeof saida === "string" ? { content: [{ type: "text", text: saida }] } : saida;
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) {
      console.error("[mcp]", f.nome, err);
      return erro("Erro interno. Confira o log do servidor.");
    }
    return erro(err.message || "Requisição inválida.");
  }
}

function erro(texto) {
  return { content: [{ type: "text", text: texto }], isError: true };
}

function sucesso(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function falhaRpc(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
