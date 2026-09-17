// Lista de tickets, uma linha cada.
//
// Lê pelo mesmo listTasks do /state, e filtra aqui: o time tem centenas de
// tarefas, não milhões, e o filtro em código acerta acento e maiúscula, que o
// LIKE do SQLite não acerta. O texto também procura na conversa e nos links,
// que é onde mora "qual ticket falou do PR 12".

import { all } from "../../db.js";
import { listTasks, badRequest, STATUSES, KINDS } from "../../tasks.js";
import { idDaPessoa, idDoProjeto, idDaEmpresa, idDaEtiqueta, nomes, linhaDoTicket, normal } from "../comum.js";

const ORDEM = { doing: 0, waiting: 1, todo: 2, inbox: 3, done: 4 };

export default {
  nome: "buscar",
  titulo: "Buscar tickets",
  descricao: "Lista tickets, uma linha cada, abertos primeiro. Filtros combinam.",
  leitura: true,
  entrada: {
    type: "object",
    properties: {
      texto: { type: "string", description: "no título, descrição, chave, conversa ou link" },
      status: { type: "array", items: { enum: STATUSES } },
      responsavel: { type: "string", description: "username, eu ou ninguem" },
      projeto: { type: "string" },
      empresa: { type: "string" },
      tipo: { enum: KINDS },
      etiqueta: { type: "string" },
      arquivadas: { type: "boolean", description: "inclui arquivadas" },
      limite: { type: "integer", description: "padrão 30, máximo 200" },
    },
  },

  async executar(args, ctx) {
    let lista = await listTasks({ includeArchived: args.arquivadas === true });

    if (args.status !== undefined) {
      const quais = [].concat(args.status);
      const invalidos = quais.filter((q) => !STATUSES.includes(q));
      if (invalidos.length) throw badRequest(`status: "${invalidos.join(", ")}" não vale. Aceitos: ${STATUSES.join(", ")}.`);
      lista = lista.filter((t) => quais.includes(t.status));
    }
    if (args.tipo) lista = lista.filter((t) => t.kind === args.tipo);
    if (args.responsavel !== undefined) {
      if (normal(args.responsavel) === "ninguem") {
        lista = lista.filter((t) => !t.assigneeIds.length);
      } else {
        const id = await idDaPessoa(args.responsavel, ctx.user, { inativos: true });
        lista = lista.filter((t) => t.assigneeIds.includes(id));
      }
    }
    if (args.projeto) {
      const id = await idDoProjeto(args.projeto, { arquivados: true });
      lista = lista.filter((t) => t.projectId === id);
    }
    if (args.empresa) {
      const id = await idDaEmpresa(args.empresa, { arquivados: true });
      lista = lista.filter((t) => t.companyId === id);
    }
    if (args.etiqueta) {
      const id = await idDaEtiqueta(args.etiqueta);
      lista = lista.filter((t) => t.labels.includes(id));
    }
    if (args.texto) {
      const alvo = normal(args.texto);
      const naConversa = await idsComTexto(String(args.texto));
      lista = lista.filter(
        (t) =>
          naConversa.has(t.id) ||
          normal(t.key) === alvo ||
          normal(t.title).includes(alvo) ||
          normal(t.description).includes(alvo)
      );
    }

    lista.sort(
      (a, b) =>
        (ORDEM[a.status] ?? 9) - (ORDEM[b.status] ?? 9) ||
        String(b.touchedAt).localeCompare(String(a.touchedAt))
    );

    const limite = Math.min(Math.max(Number(args.limite) || 30, 1), 200);
    const total = lista.length;
    if (!total) return "Nenhum ticket.";

    const n = await nomes();
    const cabecalho = total > limite ? `${limite} de ${total} (aumente limite ou filtre)` : `${total} ticket(s)`;
    return [cabecalho, ...lista.slice(0, limite).map((t) => linhaDoTicket(t, n))].join("\n");
  },
};

// Conversa e links procurados no banco. instr() em minúsculas acerta o caso
// ASCII; o acento que o SQLite não dobra fica para o título e a descrição, que
// passam pelo filtro de código logo acima.
async function idsComTexto(texto) {
  const linhas = await all(
    `SELECT task_id FROM comments WHERE instr(lower(body), lower(?)) > 0
     UNION
     SELECT task_id FROM task_links WHERE instr(lower(url), lower(?)) > 0 OR instr(lower(COALESCE(title, '')), lower(?)) > 0`,
    [texto, texto, texto]
  );
  return new Set(linhas.map((l) => l.task_id));
}
