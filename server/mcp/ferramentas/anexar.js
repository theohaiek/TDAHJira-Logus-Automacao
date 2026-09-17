// Anexa arquivo ao ticket.
//
// Três jeitos de o conteúdo chegar, do mais barato para o mais caro em token:
//
//   caminho  arquivo no disco da máquina do agente. Só existe pela ponte
//            (scripts/mcp/ponte.mjs), que lê o arquivo e manda os bytes para
//            POST /api/mcp/anexos. O arquivo nunca passa pelo modelo.
//   texto    log, CSV, JSON de teste: o agente já tem o texto, e texto puro
//            custa o que ele tem, sem inflar.
//   base64   binário sem ponte. Funciona, e cada 3 bytes viram 4 caracteres
//            no contexto do modelo: é o último recurso, e a descrição diz isso.

import { one } from "../../db.js";
import { saveAttachment, MIME_DA_EXTENSAO } from "../../comments.js";
import { badRequest } from "../../tasks.js";
import { idDoTicket, tamanho } from "../comum.js";

export default {
  nome: "anexar",
  titulo: "Anexar arquivo",
  descricao: (ctx) =>
    ctx.ponte
      ? "Anexa ao ticket um arquivo local (print, log de teste; caminho absoluto) ou texto."
      : "Anexa ao ticket: texto vira .txt/.log/.csv/.json; base64 para binário pequeno.",
  entrada: {
    type: "object",
    properties: {
      ticket: { type: "string" },
      caminho: { type: "string", so: "ponte", description: "arquivo local" },
      nome: { type: "string", description: "nome do arquivo; com caminho, padrão é o do arquivo" },
      texto: { type: "string", description: "conteúdo de .txt/.log/.csv/.json" },
      base64: { type: "string", so: "remoto" },
      comentario: { type: "integer", description: "id da mensagem a que o anexo pertence" },
    },
    required: ["ticket"],
  },

  async executar(args, ctx) {
    // Pela ponte, o caminho nunca chega aqui: ela resolve antes. Chegar é sinal
    // de ponte velha ou cliente remoto mandando campo que não enxerga.
    if (args.caminho) throw badRequest("caminho só funciona pela ponte local (scripts/mcp/ponte.mjs).");

    const temTexto = typeof args.texto === "string" && args.texto.length > 0;
    const temBase64 = typeof args.base64 === "string" && args.base64.length > 0;
    if (temTexto === temBase64) {
      throw badRequest(ctx.ponte ? "Mande caminho ou texto, um dos dois." : "Mande texto ou base64, um dos dois.");
    }

    const buffer = temTexto ? Buffer.from(args.texto, "utf8") : Buffer.from(args.base64, "base64");
    const nome = args.nome || (temTexto ? "nota.txt" : null);
    if (!nome) throw badRequest("Com base64, diga o nome do arquivo (a extensão decide o tipo).");

    return anexarConteudo({ ticket: args.ticket, nome, comentario: args.comentario, buffer }, ctx);
  },
};

// O miolo, dividido com a rota binária da ponte (server/mcp/index.js).
export async function anexarConteudo({ ticket, nome, mime, comentario, buffer }, ctx) {
  const id = await idDoTicket(ticket);
  const rotulo = String(nome || "").trim();
  if (!rotulo) throw badRequest("Falta o nome do arquivo.");

  const extensao = (rotulo.match(/\.[A-Za-z0-9]+$/)?.[0] || "").toLowerCase();
  const tipo = mime || MIME_DA_EXTENSAO[extensao];
  if (!tipo) {
    throw badRequest(`Extensão "${extensao || "nenhuma"}" não aceita. Aceitas: ${Object.keys(MIME_DA_EXTENSAO).join(" ")}.`);
  }

  let commentId = null;
  if (comentario !== undefined && comentario !== null && comentario !== "") {
    commentId = Number(comentario);
    const dono = Number.isSafeInteger(commentId) ? await one("SELECT task_id FROM comments WHERE id = ?", [commentId]) : null;
    if (!dono || dono.task_id !== id) throw badRequest(`Mensagem #${comentario} não é deste ticket.`);
  }

  const a = await saveAttachment({
    taskId: id,
    commentId,
    buffer,
    mime: tipo,
    originalName: rotulo,
    actorId: ctx.user.id,
  });
  return `ok anexo ${a.id} ${a.name} ${tamanho(a.size)}`;
}
