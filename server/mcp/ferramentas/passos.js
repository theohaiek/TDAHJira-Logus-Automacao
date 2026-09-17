// Os passos do ticket: acrescentar, marcar, desmarcar, tirar. Tudo numa chamada.

import { one } from "../../db.js";
import { addStep, toggleStep, removeStep, getTaskFull, notFound } from "../../tasks.js";
import { idDoTicket, ids } from "../comum.js";

export default {
  nome: "passos",
  titulo: "Passos do ticket",
  descricao: "Adiciona, conclui, reabre ou remove passos. Ids aparecem em ler.",
  entrada: {
    type: "object",
    properties: {
      ticket: { type: "string" },
      novos: { type: "array", items: { type: "string" } },
      concluir: { type: "array", items: { type: "integer" } },
      reabrir: { type: "array", items: { type: "integer" } },
      remover: { type: "array", items: { type: "integer" } },
    },
    required: ["ticket"],
  },

  async executar(args, ctx) {
    const id = await idDoTicket(args.ticket);
    const ator = ctx.user.id;
    const concluir = ids(args.concluir, "concluir");
    const reabrir = ids(args.reabrir, "reabrir");
    const remover = ids(args.remover, "remover");

    // toggleStep e removeStep recebem só o id do passo. Conferir o dono antes
    // impede que um id errado mexa no passo de outro ticket.
    for (const passo of [...concluir, ...reabrir, ...remover]) {
      const dono = await one("SELECT task_id FROM steps WHERE id = ?", [passo]);
      if (!dono || dono.task_id !== id) throw notFound(`Passo ${passo} não é deste ticket.`);
    }

    if (args.novos !== undefined && !Array.isArray(args.novos)) {
      throw Object.assign(new Error("novos é uma lista de textos."), { status: 400 });
    }
    for (const texto of args.novos || []) await addStep(id, texto, ator);
    for (const passo of concluir) await toggleStep(passo, true, ator);
    for (const passo of reabrir) await toggleStep(passo, false, ator);
    for (const passo of remover) await removeStep(passo, ator);

    const t = await getTaskFull(id);
    if (!t.steps.length) return `${t.key}: sem passos`;
    const feitos = t.steps.filter((s) => s.done).length;
    return `${t.key} passos ${feitos}/${t.steps.length}: ${t.steps.map((s) => `[${s.done ? "x" : " "}]${s.id} ${s.text}`).join(" · ")}`;
  },
};
