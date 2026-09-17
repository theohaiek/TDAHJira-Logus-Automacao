// O ticket inteiro.
//
// Todo campo com valor aparece; campo vazio não, porque "prazo: nenhum" em
// cada leitura é token pago para dizer nada. json=true devolve os objetos crus,
// com todos os campos, para quem precisa deles como dado.
//
// O último handoff vem destacado no alto só quando não está entre as mensagens
// recentes da conversa: dizer a mesma coisa duas vezes na mesma resposta é o
// que o time pediu para nunca acontecer na tela, e vale para o agente também.

import { all } from "../../db.js";
import { getTaskFull } from "../../tasks.js";
import { listComments, listAttachments } from "../../comments.js";
import { listLinks } from "../../links.js";
import { taskTimeline } from "../../events.js";
import { idDoTicket, nomes, quando, tamanho, chaveEId } from "../comum.js";

export default {
  nome: "ler",
  titulo: "Ler ticket",
  descricao: "Ticket inteiro: campos, passos, links, anexos, último handoff, conversa e trilha.",
  leitura: true,
  entrada: {
    type: "object",
    properties: {
      ticket: { type: "string" },
      conversa: { type: "integer", description: "mensagens recentes; padrão 5, 0 nenhuma" },
      trilha: { type: "integer", description: "eventos recentes; padrão 0" },
      json: { type: "boolean", description: "objetos crus, todos os campos" },
    },
    required: ["ticket"],
  },

  async executar(args) {
    const id = await idDoTicket(args.ticket);
    const [t, comentarios, anexos, links, trilha, filhos] = await Promise.all([
      getTaskFull(id),
      listComments(id),
      listAttachments(id),
      listLinks(id),
      taskTimeline(id),
      all(
        `SELECT t.id, t.number, t.status, t.title, p.key AS project_key
           FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
          WHERE t.parent_id = ? ORDER BY t.id`,
        [id]
      ),
    ]);

    if (args.json) {
      const semAnexosRepetidos = comentarios.map(({ attachments, ...c }) => c);
      return JSON.stringify({ task: t, children: filhos, comments: semAnexosRepetidos, attachments: anexos, links, timeline: trilha });
    }

    const n = await nomes();
    const pessoa = (uid) => (uid ? `@${n.pessoa.get(uid) || uid}` : null);
    const chave = (f) => (f.project_key && f.number ? `${f.project_key}-${f.number}` : `#${f.id}`);
    const linhas = [];
    const junta = (...partes) => {
      const cheias = partes.filter(Boolean);
      if (cheias.length) linhas.push(cheias.join(" · "));
    };

    linhas.push(`${chaveEId(t)} · ${t.title}`);
    junta(
      `status ${t.status} desde ${quando(t.statusSince)}`,
      t.kind !== "task" && `tipo ${t.kind}`,
      `prioridade ${t.priority}`,
      t.energy && `energia ${t.energy}`,
      t.size && `tamanho ${t.size}`,
      t.archived && "arquivada"
    );
    junta(
      t.projectKey && `projeto ${t.projectKey} (${t.projectName})`,
      t.companyName && `empresa ${t.companyName}`,
      t.assigneeIds.length && `responsáveis ${t.assigneeIds.map(pessoa).join(" ")}`,
      t.reporterId && `relator ${pessoa(t.reporterId)}`
    );
    junta(
      t.dueOn && `prazo ${t.dueOn}`,
      t.focusOn && `foco ${t.focusOn}`,
      t.waitingFor && `esperando: ${t.waitingFor}`,
      t.labels.length && `etiquetas: ${t.labels.map((l) => n.etiqueta.get(l) || l).join(", ")}`
    );
    if (t.parentId || filhos.length) {
      const pai = t.parentId ? await getTaskFull(t.parentId) : null;
      junta(
        pai && `pai ${pai.key}`,
        filhos.length && `filhos: ${filhos.map((f) => `${chave(f)} ${f.status}`).join(", ")}`
      );
    }
    junta(
      `criado ${quando(t.createdAt)}`,
      `atualizado ${quando(t.updatedAt)}`,
      t.startedAt && `iniciado ${quando(t.startedAt)}`,
      t.doneAt && `concluído ${quando(t.doneAt)}`
    );

    if (t.description) linhas.push(`descrição:\n${t.description}`);

    if (t.steps.length) {
      const feitos = t.steps.filter((s) => s.done).length;
      linhas.push(
        `passos ${feitos}/${t.steps.length}: ${t.steps.map((s) => `[${s.done ? "x" : " "}]${s.id} ${s.text}`).join(" · ")}`
      );
    }

    if (links.length) {
      linhas.push(`links: ${links.map((l) => `${l.id} ${l.kind} ${l.url}${l.title ? ` ${l.title}` : ""}`).join(" · ")}`);
    }

    if (anexos.length) {
      linhas.push(
        `anexos: ${anexos
          .map(
            (a) =>
              `${a.id} ${a.name} ${a.mime} ${tamanho(a.size)}${a.width ? ` ${a.width}x${a.height}` : ""}` +
              `${a.commentId ? ` (msg #${a.commentId})` : ""}`
          )
          .join(" · ")}`
      );
    }

    const quantas = args.conversa === undefined ? 5 : Math.max(0, Number(args.conversa) || 0);
    const recentes = quantas ? comentarios.slice(-quantas) : [];
    const handoff = comentarios.filter((c) => c.kind === "handoff").at(-1);
    if (handoff && !recentes.includes(handoff)) linhas.push(`último handoff ${mensagem(handoff, false)}`);

    if (comentarios.length) {
      const cabeca = recentes.length < comentarios.length ? `conversa (${recentes.length} de ${comentarios.length})` : "conversa";
      linhas.push(recentes.length ? `${cabeca}:\n${recentes.map(mensagem).join("\n")}` : `conversa: ${comentarios.length} mensagem(ns)`);
    }

    const eventos = Math.max(0, Number(args.trilha) || 0);
    if (eventos && trilha.length) {
      linhas.push(
        `trilha:\n${trilha
          .slice(-eventos)
          .map((e) => {
            // A descrição inteira entra no evento; na trilha, basta o começo.
            const corta = (v) => (v == null ? "" : String(v).length > 60 ? `${String(v).slice(0, 60)}…` : String(v));
            const valor = e.from || e.to ? ` ${corta(e.from)}→${corta(e.to)}` : "";
            return `${quando(e.at)} ${pessoa(e.actorId) || "?"} ${e.kind}${e.field ? `:${e.field}` : ""}${valor}${e.note ? ` (${e.note})` : ""}`;
          })
          .join("\n")}`
      );
    }

    return linhas.join("\n");

    function mensagem(c, comTipo = true) {
      const tipo = !comTipo || c.kind === "comentario" ? "" : ` ${c.kind}`;
      return `#${c.id}${tipo} ${pessoa(c.authorId) || "?"} ${quando(c.createdAt)}: ${c.body}`;
    }
  },
};
