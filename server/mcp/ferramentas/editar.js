// Muda campos do ticket, inclusive o status, que é mover de coluna.
//
// Passa pelo mesmo updateTask da tela: as regras de transição (started_at,
// done_at, limpar o "esperando" ao sair dele, puxar para hoje ao entrar em
// fazendo) e os eventos da trilha valem igual para gente e agente.
//
// A resposta diz só o que mudou, de → para. É a confirmação que o agente
// precisa, e um "nada mudou" pega na hora o argumento que não fez efeito.

import { updateTask, setLabels, getTaskFull } from "../../tasks.js";
import { CAMPOS, PROPRIEDADES_DO_TICKET, patchDoTicket, idDoTicket, nomes } from "../comum.js";

export default {
  nome: "editar",
  titulo: "Editar ticket",
  descricao: "Muda campos do ticket; mover = status. null limpa o campo.",
  entrada: {
    type: "object",
    properties: { ticket: { type: "string" }, ...PROPRIEDADES_DO_TICKET },
    required: ["ticket"],
  },

  async executar(args, ctx) {
    const id = await idDoTicket(args.ticket);
    const antes = await getTaskFull(id);
    const { patch, etiquetas } = await patchDoTicket(args, ctx, antes.assigneeIds);

    if (etiquetas) await setLabels(id, etiquetas, ctx.user.id);
    if (Object.keys(patch).length) await updateTask(id, patch, ctx.user.id);
    const depois = await getTaskFull(id);

    const n = await nomes();
    const mostrar = {
      assigneeIds: (v) => v.map((u) => `@${n.pessoa.get(u) || u}`).join(",") || "ninguém",
      labels: (v) => v.map((l) => n.etiqueta.get(l) || l).join(",") || "nenhuma",
      projectId: (_v, t) => t.projectKey || "nenhum",
      companyId: (_v, t) => t.companyName || "nenhuma",
      parentId: (v) => (v ? `#${v}` : "nenhum"),
      description: (v) => (v ? `${v.length} caracteres` : "vazia"),
    };

    const mudancas = [];
    for (const [nome, campo] of Object.entries(CAMPOS)) {
      const a = antes[campo];
      const d = depois[campo];
      if (JSON.stringify(a ?? null) === JSON.stringify(d ?? null)) continue;
      const exibe = mostrar[campo] || ((v) => (v === null || v === undefined || v === "" ? "vazio" : String(v)));
      mudancas.push(`${nome} ${exibe(a, antes)}→${exibe(d, depois)}`);
    }

    const chave = antes.key === depois.key ? depois.key : `${antes.key}→${depois.key}`;
    return mudancas.length ? `${chave}: ${mudancas.join("; ")}` : `${chave}: nada mudou`;
  },
};
