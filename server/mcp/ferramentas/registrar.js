// O registro do trabalho: comentário, sessão ou handoff, na conversa do ticket.
//
// O teto de caracteres é a regra "curto e operacional" posta em código. Pedir
// brevidade no texto das instruções não basta: o agente escreve o que acha que
// cabe, e a tela do time trunca o resto. Recusar com o motivo faz ele reescrever
// curto na mesma hora, que é o comportamento que se quer ensinar.

import { addComment, COMMENT_KINDS } from "../../comments.js";
import { badRequest } from "../../tasks.js";
import { idDoTicket } from "../comum.js";

export const TETO_REGISTRO = 1500;

export default {
  nome: "registrar",
  titulo: "Registrar no ticket",
  descricao: `Registra no ticket: comentario, sessao (o que foi feito) ou handoff (onde parou e o próximo passo). Até ${TETO_REGISTRO} caracteres, curto e operacional.`,
  entrada: {
    type: "object",
    properties: {
      ticket: { type: "string" },
      tipo: { enum: COMMENT_KINDS, description: "padrão comentario" },
      texto: { type: "string" },
    },
    required: ["ticket", "texto"],
  },

  async executar(args, ctx) {
    const id = await idDoTicket(args.ticket);
    const texto = String(args.texto).trim();
    if (texto.length > TETO_REGISTRO) {
      throw badRequest(
        `Texto com ${texto.length} caracteres; o teto é ${TETO_REGISTRO}. Corte para o operacional: fatos, ids, próximo passo.`
      );
    }
    const tipo = args.tipo || "comentario";
    const c = await addComment(id, texto, ctx.user.id, tipo);
    return `ok #${c.id} ${tipo}`;
  },
};
