// Fluxo — onde está cada coisa.
//
// Esta é a resposta ao pedido de "rastreabilidade do Jira" sem virar Jira.
// Nenhum relatório, nenhum filtro a configurar, nenhum gráfico a montar:
// uma tela que já abre respondendo onde está tudo, o que está empacado e o
// que andou.
//
// A ordem dentro de cada faixa é pelo tempo parado, do mais velho para o
// mais novo. É a ordem que faz uma tarefa esquecida aparecer sozinha.

import { h, frag, avatar } from "../dom.js";
import { state, visiveis, usuario } from "../store.js";
import { taskCard } from "../taskcard.js";
import {
  STATUS_LABEL,
  STATUS_ORDER,
  STATUS_COLOR,
  diasParado,
  agingTexto,
  desde,
  dataHoraLonga,
} from "../format.js";
import { abrirTicket } from "../ticket.js";

export function viewFluxo() {
  const tarefas = visiveis().filter((t) => t.status !== "done");
  const porEstado = Object.fromEntries(
    STATUS_ORDER.map((s) => [s, tarefas.filter((t) => t.status === s)])
  );
  const total = tarefas.length || 1;

  const empacadas = tarefas
    .filter((t) => diasParado(t) >= (t.status === "waiting" ? 3 : 7))
    .sort((a, b) => diasParado(b) - diasParado(a));

  return frag(
    h(
      "div",
      { class: "page-head" },
      h("h1", { text: "Fluxo" }),
      h("p", { text: "Onde está cada coisa, e há quanto tempo está lá." })
    ),

    h(
      "div",
      { class: "flow" },

      h(
        "div",
        null,

        // A barra de distribuição: uma linha só que mostra o formato do
        // trabalho. Muito em "esperando" é um problema diferente de muito
        // em "fazendo", e a barra deixa isso óbvio de longe.
        h(
          "div",
          { class: "flowbar" },
          STATUS_ORDER.filter((s) => s !== "done").map((s) =>
            porEstado[s].length
              ? h("span", {
                  class: "flowbar__seg",
                  style: {
                    width: `${(porEstado[s].length / total) * 100}%`,
                    background: STATUS_COLOR[s],
                  },
                  title: `${STATUS_LABEL[s]}: ${porEstado[s].length}`,
                })
              : null
          )
        ),
        h(
          "div",
          { class: "flowlegend" },
          STATUS_ORDER.filter((s) => s !== "done").map((s) =>
            h(
              "span",
              null,
              h("span", { class: "dot", style: { color: STATUS_COLOR[s] } }),
              `${STATUS_LABEL[s]}: ${porEstado[s].length}`
            )
          )
        ),

        empacadas.length
          ? h(
              "section",
              { class: "flowlane" },
              h(
                "div",
                { class: "flowlane__head" },
                // Âmbar, e não a cor de alerta: o texto ao lado diz que isto
                // não é cobrança, e pintar de vermelho diria o contrário.
                h("span", { class: "dot", style: { color: "var(--st-waiting)" } }),
                h("span", { class: "flowlane__name", text: "Empacadas" }),
                h("span", { class: "section__count", text: String(empacadas.length) }),
                h("span", {
                  class: "tiny muted",
                  text: `a mais parada há ${agingTexto(diasParado(empacadas[0]))}`,
                })
              ),
              h("p", {
                class: "tiny muted",
                style: { marginBottom: "8px" },
                text: "Sem mudar de estado há bastante tempo. Não é cobrança: é para decidir se ainda faz sentido.",
              }),
              empacadas.map((t) => taskCard(t, { mostrarPasso: false }))
            )
          : null,

        STATUS_ORDER.filter((s) => s !== "done").map((s) => faixa(s, porEstado[s]))
      ),

      // Coluna da direita: o que andou.
      h(
        "aside",
        { class: "activity" },
        h(
          "div",
          { class: "section__head" },
          h("h2", { class: "section__title", text: "O que andou" })
        ),
        h(
          "div",
          { class: "activity__list" },
          state.activity.length
            ? state.activity.map((e) => atividade(e))
            : h("p", { class: "tiny muted", text: "Nada registrado ainda." })
        )
      )
    )
  );
}

function faixa(status, tarefas) {
  if (!tarefas.length) return null;
  const ordenadas = [...tarefas].sort((a, b) => diasParado(b) - diasParado(a));

  return h(
    "section",
    { class: "flowlane" },
    h(
      "div",
      { class: "flowlane__head" },
      h("span", { class: "dot", style: { color: STATUS_COLOR[status] } }),
      h("span", { class: "flowlane__name", text: STATUS_LABEL[status] }),
      h("span", { class: "section__count", text: String(tarefas.length) }),
      status === "waiting"
        ? h("span", { class: "tiny muted", text: "— depende de outra pessoa" })
        : null
    ),
    ordenadas.map((t) => taskCard(t, { mostrarPasso: false }))
  );
}

// --- Atividade -------------------------------------------------------------

const FRASE = {
  created: () => "criou",
  status: (e) => `moveu para ${STATUS_LABEL[e.to] || e.to}`,
  assignee: (e) => (e.to ? `passou para ${usuario(e.to)?.name || "alguém"}` : "tirou o responsável"),
  priority: (e) => `marcou como ${e.to === "quando_der" ? "quando der" : e.to}`,
  comment: () => "comentou em",
  attachment: (e) => `anexou ${e.to || "um arquivo"} em`,
  step_add: () => "adicionou um passo em",
  step_done: (e) => `concluiu "${corta(e.to)}" em`,
  step_undone: () => "reabriu um passo em",
  waiting: (e) => (e.to ? `passou a esperar ${corta(e.to)} em` : "parou de esperar em"),
  due: (e) => (e.to ? "definiu prazo em" : "removeu o prazo de"),
  focus: (e) => (e.to ? "puxou para hoje" : "tirou do foco"),
  title: () => "renomeou",
  description: () => "editou a descrição de",
  energy: (e) => `marcou energia ${e.to} em`,
  size: (e) => `estimou ${e.to} bloco(s) em`,
  archived: (e) => (e.to === "1" ? "arquivou" : "restaurou"),
};

function atividade(e) {
  const quem = { name: e.actorName, color: e.actorColor };
  const descricao = FRASE[e.kind] ? FRASE[e.kind](e) : e.kind;

  return h(
    "div",
    { class: "act", title: dataHoraLonga(e.at) },
    avatar(e.actorName ? quem : null, "avatar--sm"),
    h(
      "div",
      { class: "act__text" },
      h("b", { text: primeiroNome(e.actorName) }),
      ` ${descricao} `,
      e.taskId
        ? h("a", {
            class: "act__task",
            text: corta(e.taskTitle || e.taskKey || "tarefa", 46),
            href: "#",
            onClick: (ev) => {
              ev.preventDefault();
              abrirTicket(e.taskId);
            },
          })
        : null
    ),
    h("span", { class: "act__when", text: desde(e.at) })
  );
}

function primeiroNome(nome) {
  return String(nome || "Alguém").split(" ")[0];
}

function corta(s, n = 34) {
  const t = String(s || "");
  return t.length > n ? `${t.slice(0, n)}…` : t;
}
