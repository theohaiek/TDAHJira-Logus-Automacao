// Liga PR, commit, branch ou documento ao ticket.

import { addLink, LINK_KINDS } from "../../links.js";
import { idDoTicket } from "../comum.js";

export default {
  nome: "vincular",
  titulo: "Vincular link",
  descricao: "Liga PR, commit, branch ou doc ao ticket. Tipo sai da URL quando omitido; repetir a URL atualiza.",
  entrada: {
    type: "object",
    properties: {
      ticket: { type: "string" },
      url: { type: "string" },
      tipo: { enum: LINK_KINDS },
      titulo: { type: "string" },
    },
    required: ["ticket", "url"],
  },

  async executar(args, ctx) {
    const id = await idDoTicket(args.ticket);
    const { link, novo } = await addLink(id, { url: args.url, kind: args.tipo, title: args.titulo }, ctx.user.id);
    return `ok link ${link.id} ${link.kind}${novo ? "" : " (já existia, atualizado)"}`;
  },
};
