// Paleta de comandos (Ctrl+K).
//
// Busca e ações no mesmo lugar. Serve a quem já sabe o caminho e não quer
// navegar até ele — e serve especialmente bem a quem lembra do nome da
// tarefa mas não faz ideia de em qual coluna ela foi parar.

import { h, mount, $ } from "./dom.js";
import { state, visiveis } from "./store.js";
import { STATUS_LABEL } from "./format.js";
import { abrirTicket } from "./ticket.js";
import { irPara } from "./app.js";

let selecionado = 0;
let itens = [];

export function abrirPaleta(inicial = "") {
  const caixa = $("#palette");
  caixa.hidden = false;
  const campo = $("#palette-input");
  campo.value = inicial;
  campo.focus();
  campo.select();
  atualizar();
}

export function fecharPaleta() {
  $("#palette").hidden = true;
}

export function paletaAberta() {
  return !$("#palette").hidden;
}

export function iniciarPaleta() {
  const campo = $("#palette-input");
  campo.addEventListener("input", atualizar);
  campo.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selecionado = Math.min(selecionado + 1, itens.length - 1);
      pintar();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selecionado = Math.max(selecionado - 1, 0);
      pintar();
    } else if (e.key === "Enter") {
      e.preventDefault();
      itens[selecionado]?.acao();
      fecharPaleta();
    } else if (e.key === "Escape") {
      fecharPaleta();
    }
  });
}

function comandos() {
  return [
    { rotulo: "Ir para Hoje", atalho: "1", acao: () => irPara("hoje") },
    { rotulo: "Ir para o Quadro", atalho: "2", acao: () => irPara("quadro") },
    { rotulo: "Ir para a Planilha", atalho: "3", acao: () => irPara("planilha") },
    { rotulo: "Ir para o Fluxo", atalho: "4", acao: () => irPara("fluxo") },
    {
      rotulo: "Alternar tema claro e escuro",
      acao: () => document.getElementById("theme-btn").click(),
    },
    {
      rotulo: "Modo calmo",
      acao: () => document.getElementById("calm-btn").click(),
    },
    { rotulo: "Nova tarefa", atalho: "n", acao: () => $("#capture").focus() },
  ];
}

function atualizar() {
  const termo = $("#palette-input").value.trim().toLowerCase();
  selecionado = 0;

  const tarefas = visiveis()
    .filter((t) => {
      if (!termo) return t.status === "doing" || t.focusOn === state.hoje;
      return `${t.key} ${t.title}`.toLowerCase().includes(termo);
    })
    .slice(0, 8)
    .map((t) => ({
      rotulo: t.title,
      dica: `${STATUS_LABEL[t.status]}${t.projectKey ? ` · ${t.projectKey}` : ""}`,
      atalho: t.key,
      acao: () => abrirTicket(t.id),
    }));

  const cmds = comandos().filter((c) => !termo || c.rotulo.toLowerCase().includes(termo));

  itens = [...tarefas, ...cmds];

  // Quando nada casa, oferecer a criação com o que foi digitado evita o
  // beco sem saída da busca vazia.
  if (termo && !tarefas.length) {
    itens.unshift({
      rotulo: `Criar "${$("#palette-input").value.trim()}"`,
      dica: "nova tarefa",
      acao: async () => {
        const { criarDoTexto } = await import("./quickadd.js");
        criarDoTexto($("#palette-input").value.trim());
      },
    });
  }

  pintar();
}

function pintar() {
  const alvo = $("#palette-results");
  mount(
    alvo,
    itens.length
      ? itens.map((it, i) =>
          h(
            "button",
            {
              class: `pres${i === selecionado ? " is-sel" : ""}`,
              onClick: () => {
                it.acao();
                fecharPaleta();
              },
              onMouseenter: () => {
                selecionado = i;
                pintar();
              },
            },
            h("span", { class: "truncate", text: it.rotulo }),
            it.dica ? h("span", { class: "tiny muted nowrap", text: it.dica }) : null,
            it.atalho ? h("span", { class: "pres__key", text: it.atalho }) : null
          )
        )
      : h("div", { class: "empty tiny" }, "Nada encontrado.")
  );
  alvo.querySelector(".is-sel")?.scrollIntoView({ block: "nearest" });
}
