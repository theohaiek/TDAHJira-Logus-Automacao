// Ticket novo. Só o título é obrigatório, como na captura da tela.

import { createTask, setLabels, getTaskFull } from "../../tasks.js";
import { PROPRIEDADES_DO_TICKET, patchDoTicket, chaveEId } from "../comum.js";

// Arquivar na criação não tem sentido, e createTask não lê o campo.
const { arquivada, ...CAMPOS_DE_CRIACAO } = PROPRIEDADES_DO_TICKET;

export default {
  nome: "criar",
  titulo: "Criar ticket",
  descricao: "Cria ticket. Só titulo é obrigatório.",
  entrada: {
    type: "object",
    properties: {
      ...CAMPOS_DE_CRIACAO,
      passos: { type: "array", items: { type: "string" } },
    },
    required: ["titulo"],
  },

  async executar(args, ctx) {
    const { patch, etiquetas } = await patchDoTicket(args, ctx);
    if (args.passos !== undefined && !Array.isArray(args.passos)) {
      throw Object.assign(new Error("passos é uma lista de textos."), { status: 400 });
    }

    let t = await createTask({ ...patch, steps: args.passos }, ctx.user.id);
    if (etiquetas?.length) {
      await setLabels(t.id, etiquetas, ctx.user.id);
      t = await getTaskFull(t.id);
    }
    return `criado ${chaveEId(t)} ${t.status} · ${t.title}`;
  },
};
