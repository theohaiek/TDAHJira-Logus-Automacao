// Relatar um bug ou uma ideia, de dentro do aplicativo.
//
// O ponto é a distância entre ver e contar. Um defeito visto e não relatado na
// hora é um defeito esquecido: quando a pessoa chega ao lugar certo para
// escrever, ela já não lembra em que tela estava nem o que tinha clicado. Por
// isso a tela e a versão vão junto sozinhas, sem ninguém precisar escrever.
//
// O que acontece com cada relato depois (corrigido, recusado, esperando uma
// resposta) aparece na tela Sugestões, e não aqui: este popup é só a porta de
// entrada, e uma porta que também é sala de espera fica cheia demais para
// quem só queria contar uma coisa rápida.

import { h, mount, $ } from "./dom.js";
import { api } from "./api.js";
import { toast, erro } from "./toast.js";

let caixa = null;
let tipo = "bug";
let enviando = false;

const TEXTO_DO_CAMPO = {
  bug: "O que aconteceu? E o que você esperava que acontecesse?",
  ideia: "O que você tem em mente?",
};

function garantirCaixa() {
  if (caixa) return caixa;
  // O mesmo <dialog> nativo dos outros popups: modal, fundo, Escape e prisão
  // de foco sem uma linha de JavaScript.
  caixa = h("dialog", { class: "popup popup--relato", id: "popup-relato" });
  document.body.appendChild(caixa);
  caixa.addEventListener("click", (e) => {
    if (e.target === caixa) caixa.close();
  });
  return caixa;
}

export function ligarRelato() {
  $("#relato-btn")?.addEventListener("click", () => abrirRelato());
}

export function abrirRelato() {
  const alvo = garantirCaixa();
  desenhar();
  if (!alvo.open) alvo.showModal();
  // O cursor já no campo: quem abriu isto veio escrever.
  alvo.querySelector("textarea")?.focus();
}

function desenhar() {
  const campoAntes = caixa.querySelector("textarea");
  // O texto sobrevive ao redesenho: trocar de bug para ideia no meio da frase
  // não pode apagar o que já foi escrito.
  const texto = campoAntes?.value || "";

  mount(
    caixa,
    h(
      "div",
      { class: "popup__corpo" },
      h(
        "div",
        { class: "popup__topo" },
        h("span", { class: "popup__eyebrow", text: "Relatar" }),
        h(
          "div",
          { class: "relato__topoacoes" },
          h("a", {
            class: "relato__ver",
            href: "#/sugestoes",
            text: "Ver sugestões",
            title: "O que foi feito com cada relato (5)",
            onClick: () => caixa.close(),
          }),
          h("button", {
            class: "icon-btn",
            text: "✕",
            title: "Fechar (Esc)",
            "aria-label": "Fechar",
            onClick: () => caixa.close(),
          })
        )
      ),

      h(
        "form",
        { class: "relato", onSubmit: enviar },

        // Dois botões que alternam, e não um <select>: são duas opções só, e as
        // duas precisam estar à vista para a pessoa saber que existe a outra.
        h(
          "div",
          { class: "relato__tipos", role: "radiogroup", "aria-label": "Tipo de relato" },
          botaoDeTipo("bug", "Bug", "Algo que não funciona como deveria"),
          botaoDeTipo("ideia", "Ideia", "Algo que poderia existir ou ser diferente")
        ),

        h("textarea", {
          class: "relato__texto",
          name: "body",
          rows: 6,
          maxlength: 4000,
          required: true,
          placeholder: TEXTO_DO_CAMPO[tipo],
          value: texto,
          onKeydown: (e) => {
            // Ctrl+Enter envia, que é o atalho de envio do resto do produto.
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              caixa.querySelector("form")?.requestSubmit();
            }
          },
        }),

        h(
          "div",
          { class: "relato__rodape" },
          // O contexto que vai junto, dito. Quem escreve precisa saber que a
          // tela e a versão já seguem sozinhas, senão perde tempo explicando.
          h("span", { class: "relato__contexto", text: `Vai junto: ${contexto().page} · ${contexto().version || "versão ?"}` }),
          h("button", {
            class: "btn btn--primary btn--sm",
            type: "submit",
            text: enviando ? "Enviando…" : "Enviar",
            disabled: enviando,
          })
        )
      )
    )
  );
}

function botaoDeTipo(valor, rotulo, descricao) {
  const ligado = tipo === valor;
  return h(
    "button",
    {
      type: "button",
      class: `relato__tipo${ligado ? " is-on" : ""}`,
      role: "radio",
      "aria-checked": ligado ? "true" : "false",
      title: descricao,
      onClick: () => {
        tipo = valor;
        desenhar();
        caixa.querySelector("textarea")?.focus();
      },
    },
    rotulo
  );
}

// Onde a pessoa estava e em que versão. Vem da própria página, e o servidor
// trata como contexto sem confiança: ele corta, limpa, e não decide nada a
// partir disto.
function contexto() {
  const page = (location.hash || "#/").replace(/^#/, "") || "/";
  const version = $("#version-btn")?.textContent?.trim() || "";
  return { page, version: /^v\d/.test(version) ? version : "" };
}

async function enviar(e) {
  e.preventDefault();
  if (enviando) return;

  const body = caixa.querySelector("textarea")?.value.trim();
  if (!body) return;

  enviando = true;
  desenhar();
  try {
    const r = await api.enviarRelato({ kind: tipo, body, ...contexto() });
    caixa.close();
    // Limpa para o próximo, e só depois de dar certo: um erro de rede não pode
    // levar junto o que a pessoa escreveu.
    caixa.querySelector("textarea").value = "";
    // A tela Sugestões escuta este aviso e busca a lista de novo. Por evento,
    // e não por import: este popup não precisa saber que ela existe.
    window.dispatchEvent(new CustomEvent("relato:enviado", { detail: { id: r.id } }));
    const nome = tipo === "bug" ? "Bug" : "Ideia";
    toast(r.encaminhado ? `${nome} recebido e encaminhado. Obrigado.` : `${nome} recebido. Obrigado.`, {
      acao: "Acompanhar",
      aoClicar: () => {
        location.hash = r.id ? `#/sugestoes/${r.id}` : "#/sugestoes";
      },
    });
  } catch (err) {
    erro(err.message);
  } finally {
    enviando = false;
    if (caixa.open) desenhar();
  }
}
