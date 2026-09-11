// Relatar um bug ou uma ideia, de dentro do aplicativo.
//
// O ponto é a distância entre ver e contar. Um defeito visto e não relatado na
// hora é um defeito esquecido: quando a pessoa chega ao lugar certo para
// escrever, ela já não lembra em que tela estava nem o que tinha clicado. Por
// isso a tela e a versão vão junto sozinhas, sem ninguém precisar escrever.
//
// Quem administra vê, no mesmo lugar, o que chegou.

import { h, mount, $ } from "./dom.js";
import { api } from "./api.js";
import { state } from "./store.js";
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
  if (state.me?.role === "admin") carregarRecebidos();
}

function desenhar(recebidos = null) {
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
        h("button", {
          class: "icon-btn",
          text: "✕",
          title: "Fechar (Esc)",
          "aria-label": "Fechar",
          onClick: () => caixa.close(),
        })
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
      ),

      recebidos ? listaDeRecebidos(recebidos) : null
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
        desenhar(ultimosRecebidos);
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
  desenhar(ultimosRecebidos);
  try {
    const r = await api.enviarRelato({ kind: tipo, body, ...contexto() });
    caixa.close();
    // Limpa para o próximo, e só depois de dar certo: um erro de rede não pode
    // levar junto o que a pessoa escreveu.
    caixa.querySelector("textarea").value = "";
    toast(
      r.encaminhado
        ? `${tipo === "bug" ? "Bug" : "Ideia"} recebido e encaminhado. Obrigado.`
        : `${tipo === "bug" ? "Bug" : "Ideia"} recebido. Obrigado.`
    );
  } catch (err) {
    erro(err.message);
  } finally {
    enviando = false;
    if (caixa.open) desenhar(ultimosRecebidos);
  }
}

// --- O que chegou, para quem administra ------------------------------------

let ultimosRecebidos = null;

async function carregarRecebidos() {
  try {
    const r = await api.relatos();
    ultimosRecebidos = r;
    if (caixa?.open) desenhar(r);
  } catch {
    // Não é essencial: o formulário de relatar continua funcionando mesmo que
    // a lista não carregue.
  }
}

const QUANDO = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function listaDeRecebidos({ feedback = [], encaminhamento = false }) {
  return h(
    "section",
    { class: "relato__recebidos" },
    h(
      "div",
      { class: "relato__recebidostopo" },
      h("span", { class: "popup__eyebrow", text: `Recebidos · ${feedback.length}` }),
      h("span", {
        class: "relato__destino",
        text: encaminhamento ? "encaminhando ao GitHub" : "só no aplicativo",
        title: encaminhamento
          ? "Cada relato também vira uma issue no repositório configurado."
          : "Para encaminhar ao GitHub, configure FEEDBACK_GITHUB_REPO e FEEDBACK_GITHUB_TOKEN no servidor.",
      })
    ),
    feedback.length
      ? h(
          "ol",
          { class: "relato__lista" },
          feedback.map((f) =>
            h(
              "li",
              { class: `relato__item relato__item--${f.kind}` },
              h(
                "div",
                { class: "relato__itemtopo" },
                h("span", { class: "relato__selo", text: f.kind === "bug" ? "bug" : "ideia" }),
                h("span", { class: "relato__quem", text: f.autor || "alguém que saiu do time" }),
                h("span", { class: "relato__quando", text: QUANDO.format(new Date(f.createdAt)) }),
                // O link só entra se o servidor devolveu um endereço do GitHub,
                // e ele só aceita esses: nada aqui aponta para outro lugar.
                f.issueUrl
                  ? h("a", {
                      class: "relato__issue",
                      href: f.issueUrl,
                      target: "_blank",
                      rel: "noopener noreferrer",
                      text: "issue ↗",
                    })
                  : null
              ),
              h("p", { class: "relato__corpo", text: f.body }),
              f.page || f.version
                ? h("span", { class: "relato__onde", text: [f.page, f.version].filter(Boolean).join(" · ") })
                : null
            )
          )
        )
      : h("p", { class: "relato__vazio", text: "Nenhum relato ainda." })
  );
}
