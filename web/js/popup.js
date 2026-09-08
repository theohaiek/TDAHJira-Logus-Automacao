// O "Hoje" que abre sozinho, uma vez por dia.
//
// A tela inicial passou a ser o quadro, que é onde o trabalho acontece. Mas a
// pergunta que o produto existe para responder — "o que eu faço agora?" — não
// pode depender de alguém lembrar de clicar num item da navegação. Então ela
// vem até a pessoa, uma vez por dia, e sai do caminho depois.
//
// Uma vez por dia, e não a cada carga da página: um aviso que aparece toda
// hora vira clique reflexo, e um clique reflexo não é leitura.
//
// A marca fica no localStorage, ou seja, é por dispositivo. É o certo aqui —
// quem abre no computador de manhã e no celular à tarde quer ver nos dois.

import { h, mount, $ } from "./dom.js";
import { state } from "./store.js";
import { viewHoje } from "./views/hoje.js";

const CHAVE = "tdah:hoje-visto-em";

let caixa = null;

// O <dialog> nativo entrega modal, fundo, Escape e prisão de foco sem uma
// linha de JavaScript. dialog.js não serve aqui: ele só sabe formulário e
// pergunta de sim ou não, e reaproveita o elemento da paleta de comandos, que
// o Ctrl+K também usa.
function garantirCaixa() {
  if (caixa) return caixa;

  caixa = h("dialog", { class: "popup", id: "popup-hoje" });
  document.body.appendChild(caixa);

  // Clicar no fundo fecha. O <dialog> entrega o clique do ::backdrop como se
  // fosse no próprio elemento, então a comparação com o alvo é o que separa
  // "cliquei fora" de "cliquei no conteúdo".
  caixa.addEventListener("click", (e) => {
    if (e.target === caixa) caixa.close();
  });

  return caixa;
}

export function abrirHoje() {
  const alvo = garantirCaixa();

  mount(
    alvo,
    h(
      "div",
      { class: "popup__corpo" },
      h(
        "div",
        { class: "popup__topo" },
        h("span", { class: "popup__eyebrow", text: "Hoje" }),
        h("button", {
          class: "icon-btn",
          text: "✕",
          title: "Fechar (Esc)",
          "aria-label": "Fechar",
          onClick: () => alvo.close(),
        })
      ),
      viewHoje()
    )
  );

  if (!alvo.open) alvo.showModal();
}

export function fecharHoje() {
  if (caixa?.open) caixa.close();
}

// Redesenha o conteúdo se o popup estiver aberto quando a sincronização
// trouxer novidade. Sem isto, o que ele mostra congela no instante em que
// abriu, e é justamente a lista do dia que muda enquanto se lê.
export function redesenharHoje() {
  if (caixa?.open) abrirHoje();
}

export function popupAberto() {
  return !!caixa?.open;
}

// Abre no primeiro acesso do dia. state.hoje é a data do servidor, e é ela
// que manda: o relógio do navegador pode estar em outro fuso, e aí "hoje"
// vira ontem depois das 21h.
export function abrirHojeSePrimeiraVezNoDia() {
  const hoje = state.hoje;
  if (!hoje) return;

  let visto = null;
  try {
    visto = localStorage.getItem(CHAVE);
  } catch {
    // Janela anônima ou site sem permissão de armazenamento: sem memória do
    // que já foi visto, o popup abriria em toda carga. Melhor não abrir.
    return;
  }

  if (visto === hoje) return;

  try {
    localStorage.setItem(CHAVE, hoje);
  } catch {
    return;
  }

  abrirHoje();
}
