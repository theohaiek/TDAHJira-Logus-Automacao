// O cartão de tarefa. É a peça mais vista do produto, então carrega uma
// regra rígida: no máximo três informações além do título.
//
// A tentação de mostrar tudo é o que transforma um quadro em um painel
// ilegível. O que não couber aqui vive no ticket, a um clique de distância.

import { h } from "./dom.js";
import {
  STATUS_LABEL,
  ENERGY_ICON,
  ENERGY_LABEL,
  prazoTexto,
  prazoEstado,
  diasParado,
  agingClasse,
  agingTexto,
  blocos,
} from "./format.js";
import { usuario, projeto, patch } from "./store.js";
import { avatar } from "./dom.js";
import { comemorar, erro } from "./toast.js";
import { abrirTicket } from "./ticket.js";

export function taskCard(t, opcoes = {}) {
  const { mostrarProjeto = true, mostrarPasso = true, arrastavel = false } = opcoes;
  const feito = t.status === "done";
  const responsavel = usuario(t.assigneeId);
  const proj = mostrarProjeto ? projeto(t.projectId) : null;

  const passosFeitos = t.steps.filter((s) => s.done).length;
  const proximoPasso = t.steps.find((s) => !s.done);
  const parado = diasParado(t);

  const card = h(
    "div",
    {
      class: `task${feito ? " is-done" : ""}`,
      dataset: { status: t.status, id: t.id },
      draggable: arrastavel,
      tabindex: 0,
      role: "button",
      "aria-label": `${t.title}. ${STATUS_LABEL[t.status]}.`,
      onClick: (e) => {
        if (e.target.closest("[data-stop]")) return;
        abrirTicket(t.id);
      },
      onKeydown: (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          abrirTicket(t.id);
        }
      },
    },

    // Concluir com um clique, de qualquer lugar do produto.
    h("button", {
      class: "task__check",
      "data-stop": "1",
      title: feito ? "Reabrir" : "Concluir",
      "aria-label": feito ? "Reabrir tarefa" : "Concluir tarefa",
      text: "✓",
      onClick: () => alternarConclusao(t),
    }),

    h(
      "div",
      { class: "task__body" },
      h("span", { class: "task__title", text: t.title }),

      mostrarPasso && proximoPasso && !feito
        ? h("span", { class: "task__next", text: proximoPasso.text })
        : null,

      h("div", { class: "task__meta" }, ...metaDoCartao(t, { feito, proj, passosFeitos, parado }))
    ),

    h(
      "div",
      { class: "task__right" },
      responsavel ? avatar(responsavel, "avatar--sm") : null
    )
  );

  if (arrastavel) {
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", String(t.id));
      e.dataTransfer.effectAllowed = "move";
      card.classList.add("is-dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("is-dragging"));
  }

  return card;
}

// Os selos do cartão, em ordem de utilidade para decidir.
//
// Existe um teto de quatro, e ele é o ponto todo desta função. Mostrar tudo o
// que a tarefa tem faz cada cartão exigir leitura em vez de reconhecimento, e
// uma lista de cartões ilegíveis é a versão nova do mesmo problema que se
// queria resolver. O que não couber aqui está no ticket, a um clique.
const TETO_DE_SELOS = 4;

function metaDoCartao(t, { feito, proj, passosFeitos, parado }) {
  const fixos = [
    proj
      ? h(
          "span",
          { class: "chip chip--proj", style: { color: proj.color } },
          h("span", { class: "dot" }),
          proj.name
        )
      : null,
    t.key && !t.key.startsWith("#") ? h("span", { class: "task__key", text: t.key }) : null,
  ].filter(Boolean);

  // Do mais decisivo para o menos. O corte acontece no fim desta lista.
  const candidatos = [
    t.status === "waiting" && t.waitingFor && {
      chave: "esperando",
      el: h("span", {
        class: "chip chip--waiting",
        text: `esperando: ${t.waitingFor}`,
        title: `Esperando ${t.waitingFor}`,
      }),
    },
    !feito && parado >= 3 && {
      chave: "parada",
      el: h("span", {
        class: `chip aging ${agingClasse(parado, t.status)}`,
        text: `parada há ${agingTexto(parado)}`,
        title: `Sem mudar de estado há ${agingTexto(parado)}`,
      }),
    },
    t.dueOn && !feito && {
      chave: "prazo",
      el: h("span", {
        class: `chip${prazoEstado(t.dueOn) === "late" ? " chip--late" : ""}`,
        text: prazoTexto(t.dueOn),
        title: `Prazo: ${t.dueOn}`,
      }),
    },
    t.priority === "agora" && !feito && {
      chave: "agora",
      el: h("span", { class: "chip chip--agora", text: "Agora" }),
    },
    t.steps.length && {
      chave: "passos",
      el: h(
        "span",
        { class: "steps-mini", title: `${passosFeitos} de ${t.steps.length} passos` },
        h(
          "span",
          { class: "steps-mini__bar" },
          h("span", {
            class: "steps-mini__fill",
            style: { width: `${(passosFeitos / t.steps.length) * 100}%` },
          })
        ),
        `${passosFeitos}/${t.steps.length}`
      ),
    },
    t.energy && {
      chave: "energia",
      el: h("span", {
        class: "chip",
        text: `${ENERGY_ICON[t.energy]} ${ENERGY_LABEL[t.energy]}`,
        title: `Energia ${ENERGY_LABEL[t.energy].toLowerCase()}`,
      }),
    },
    t.size && { chave: "tamanho", el: h("span", { class: "chip", text: blocos(t.size) }) },
    t.commentCount && {
      chave: "conversa",
      el: h("span", { class: "chip", text: `💬 ${t.commentCount}`, title: "Comentários" }),
    },
    t.attachmentCount && {
      chave: "anexos",
      el: h("span", { class: "chip", text: `📎 ${t.attachmentCount}`, title: "Anexos" }),
    },
  ].filter(Boolean);

  const mostrados = candidatos.slice(0, TETO_DE_SELOS);
  const escondidos = candidatos.slice(TETO_DE_SELOS);

  return [
    ...fixos,
    ...mostrados.map((c) => c.el),
    escondidos.length
      ? h("span", {
          class: "chip muted",
          text: `+${escondidos.length}`,
          title: `Também tem: ${escondidos.map((c) => c.chave).join(", ")}`,
        })
      : null,
  ].filter(Boolean);
}

export async function alternarConclusao(t) {
  const virandoFeito = t.status !== "done";
  try {
    await patch(t.id, { status: virandoFeito ? "done" : "todo" });
    if (virandoFeito) comemorar();
  } catch (err) {
    erro(err.message);
  }
}

// Lista com estado vazio próprio. A tela vazia é um momento de decisão, e
// merece uma frase que oriente em vez de um espaço em branco.
export function listaTarefas(tarefas, { vazio = "Nada por aqui.", ...opcoes } = {}) {
  if (!tarefas.length) {
    return h("div", { class: "empty" }, h("span", { text: vazio }));
  }
  return h(
    "div",
    null,
    tarefas.map((t) => taskCard(t, opcoes))
  );
}
