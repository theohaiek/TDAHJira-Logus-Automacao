// Que versão está rodando, e o botão que confere se ela é a última.
//
// Existe por um motivo prático: este aplicativo não tem número de build no
// nome dos arquivos. O navegador guarda `app.js` e `app.css` pelo caminho, e
// um deploy novo pode chegar sem que a aba aberta perceba — a pessoa vê um
// defeito já corrigido e reclama de algo que não existe mais. O rótulo diz em
// que commit ela está, e o clique é a saída: limpa o que o navegador guardou,
// confere com o servidor e recarrega se ficou para trás.
//
// A limpeza acontece mesmo quando não há novidade. É de propósito: quem clica
// aqui está desconfiando do próprio cache, e responder "está tudo em dia" sem
// ter mexido em nada seria responder com a mesma dúvida.

import { h, mount, $ } from "./dom.js";
import { api } from "./api.js";
import { toast, erro } from "./toast.js";

// O que o servidor disse quando esta aba carregou. É a régua: a comparação de
// "mudou?" é contra este valor, e não contra a última verificação, senão duas
// checagens seguidas sem recarregar dariam "em dia" com a página velha na tela.
let aoCarregar = null;
let caixa = null;
let verificando = false;

const QUANDO = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const QUANDO_CURTO = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });

function data(iso, curto = false) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return (curto ? QUANDO_CURTO : QUANDO).format(d);
}

// O texto do botão. Curto de propósito: ele mora num canto de barra lateral e
// concorre com o nome de quem está logado.
//
// Um número, e não o identificador do commit. Sete dígitos de hexadecimal
// respondem "qual código exatamente", que é pergunta de quem for depurar; quem
// lê o rodapé está perguntando "a minha é mais nova que a dela?", e para isso
// só serve um número que cresce. O identificador continua no title.
//
// A queda existe porque o servidor pode não saber contar commits — sem
// repositório e sem rede, ele ainda sabe em que commit está.
function rotulo(v) {
  if (!v) return "versão desconhecida";
  if (v.atual?.versao) return `v${v.atual.versao}`;

  const partes = [];
  if (v.app) partes.push(`v${v.app}`);
  if (v.atual?.sha) partes.push(v.atual.sha);
  return partes.join(" · ") || "versão desconhecida";
}

export async function iniciarVersao() {
  const btn = $("#version-btn");
  if (!btn) return;

  btn.addEventListener("click", () => abrirVersao());

  try {
    aoCarregar = await api.versao();
  } catch {
    // Uma falha aqui não pode impedir o aplicativo de subir: o rótulo é
    // informação de apoio, não parte do trabalho.
    aoCarregar = null;
  }
  pintarRotulo(aoCarregar);
}

function pintarRotulo(v) {
  const btn = $("#version-btn");
  if (!btn) return;
  btn.textContent = rotulo(v);
  // O identificador do commit vive aqui: fora do caminho de quem só quer saber
  // se está atualizado, e à mão de quem precisa dizer exatamente qual código
  // está no ar.
  btn.title = [
    v?.atual?.titulo,
    v?.atual?.sha ? `commit ${v.atual.sha}` : null,
    "Clique para ver o histórico e conferir se há atualização.",
  ]
    .filter(Boolean)
    .join("\n");
}

// --- O painel ---------------------------------------------------------------

function garantirCaixa() {
  if (caixa) return caixa;
  // Mesma escolha do popup do Hoje: o <dialog> nativo entrega modal, fundo,
  // Escape e prisão de foco sem uma linha de JavaScript.
  caixa = h("dialog", { class: "popup popup--versao", id: "popup-versao" });
  document.body.appendChild(caixa);
  caixa.addEventListener("click", (e) => {
    if (e.target === caixa) caixa.close();
  });
  return caixa;
}

// `estado` é o que a verificação está fazendo agora, e muda enquanto o painel
// já está aberto — por isso desenhar é uma função, e não um trecho solto.
export function abrirVersao(estado = { fase: "verificando" }) {
  const alvo = garantirCaixa();
  const v = estado.dados || aoCarregar;

  mount(
    alvo,
    h(
      "div",
      { class: "popup__corpo" },
      h(
        "div",
        { class: "popup__topo" },
        h("span", { class: "popup__eyebrow", text: "Versão" }),
        h("button", {
          class: "icon-btn",
          text: "✕",
          title: "Fechar (Esc)",
          "aria-label": "Fechar",
          onClick: () => alvo.close(),
        })
      ),

      cabecalho(v, estado),
      linhaDoTempo(v)
    )
  );

  if (!alvo.open) alvo.showModal();
  if (estado.fase === "verificando" && !verificando) verificar();
}

function cabecalho(v, estado) {
  return h(
    "div",
    { class: "versao__topo" },
    h(
      "div",
      { class: "versao__agora" },
      h("span", { class: "versao__numero", text: rotulo(v) }),
      h("span", {
        class: "versao__quando",
        text: v?.atual?.data ? `publicada em ${data(v.atual.data)}` : "sem data de publicação",
      })
    ),
    h("div", { class: `versao__estado versao__estado--${estado.fase}` }, frase(estado, v)),
    h("button", {
      class: "btn btn--sm",
      text: estado.fase === "verificando" ? "Verificando…" : "Limpar cache e verificar",
      disabled: estado.fase === "verificando",
      onClick: () => verificar(),
    })
  );
}

function frase(estado, v) {
  if (estado.fase === "verificando") {
    return h("span", { text: "Limpando o cache e conferindo com o servidor…" });
  }
  if (estado.fase === "erro") {
    return h("span", { text: estado.mensagem || "Não consegui conferir agora." });
  }
  if (estado.fase === "atualizando") {
    return h("span", { text: "Versão nova encontrada. Recarregando…" });
  }
  if (estado.fase === "recarregando") {
    return h("span", {
      text: "Cache limpo. Recarregando para pegar os arquivos direto do servidor…",
    });
  }
  // Em dia. Vale distinguir "conferi e está igual" de "conferi e o servidor nem
  // sabe em que commit está": a segunda não é garantia de nada.
  if (!v?.atual?.sha) {
    return h("span", {
      text: "Cache limpo. O servidor não sabe informar o commit, então não dá para comparar.",
    });
  }
  if (v.atras) {
    return h("span", {
      text: `Cache limpo. O servidor está ${v.atras} commit${
        v.atras > 1 ? "s" : ""
      } atrás do repositório — o deploy ainda não chegou.`,
    });
  }
  return h("span", { text: "Cache limpo. Você está na versão mais recente." });
}

function linhaDoTempo(v) {
  const commits = v?.commits || [];
  if (!commits.length) {
    return h("div", { class: "empty" }, h("span", { text: "Sem histórico para mostrar aqui." }));
  }

  const atual = v?.atual?.sha;
  return h(
    "ol",
    { class: "linha" },
    commits.map((c) =>
      h(
        "li",
        { class: `linha__item${c.sha === atual ? " is-atual" : ""}` },
        h("span", { class: "linha__ponto", "aria-hidden": "true" }),
        h(
          "div",
          { class: "linha__corpo" },
          h(
            "div",
            { class: "linha__cabeca" },
            // O número é o rótulo; o identificador do commit fica no title,
            // para quem precisar dizer exatamente qual código é este.
            h("code", {
              class: "linha__versao",
              text: c.versao || c.sha,
              title: `commit ${c.sha}`,
            }),
            h("span", { class: "linha__data", text: data(c.data, true) || "" }),
            c.sha === atual ? h("span", { class: "linha__marca", text: "no ar" }) : null
          ),
          h("span", { class: "linha__titulo", text: c.titulo || "(sem mensagem)" }),
          // O corpo fica fechado. Neste repositório ele costuma ter parágrafos,
          // e vinte commits abertos dariam nove mil pixels de rolagem para
          // achar a data de um deles — que é o que a pessoa veio ver. O <details>
          // nativo entrega o abrir e fechar, o estado e o teclado de graça.
          c.corpo
            ? h(
                "details",
                { class: "linha__mais" },
                h("summary", { text: "por quê" }),
                h("p", { class: "linha__nota", text: c.corpo })
              )
            : null
        )
      )
    )
  );
}

// --- A verificação ----------------------------------------------------------

async function verificar() {
  if (verificando) return;
  verificando = true;
  if (caixa?.open) abrirVersao({ fase: "verificando" });

  let novo = null;
  try {
    novo = await api.versao();
  } catch (err) {
    verificando = false;
    if (caixa?.open) abrirVersao({ fase: "erro", mensagem: err.message });
    else erro("Não consegui conferir a versão agora.");
    return;
  }

  await limparCaches();
  await revalidar();

  const antes = aoCarregar?.atual?.sha;
  const agora = novo?.atual?.sha;
  const mudou = !!antes && !!agora && antes !== agora;

  verificando = false;

  // Recarrega dos dois jeitos, e a diferença é só o que se diz antes.
  //
  // Houve uma versão que só recarregava quando o commit mudava, e ela errava
  // no caso mais comum: o commit do servidor é o novo, o JavaScript da aba é
  // o novo, e o CSS ainda é o velho — porque a borda da hospedagem serviu o
  // arquivo antigo por mais alguns segundos depois do deploy. O commit
  // comparava igual, a limpeza acontecia, e a folha velha continuava pintando
  // a tela. Quem clica aqui está pedindo a página que o servidor tem agora, e
  // limpar o cache sem recarregar não entrega isso.
  //
  // O estado da tela não se perde: o que existe mora no servidor.
  if (caixa?.open) abrirVersao({ fase: mudou ? "atualizando" : "recarregando", dados: novo });
  toast(mudou ? "Versão nova. Recarregando…" : "Cache limpo. Recarregando…", { ms: 1600 });

  // O reload vem depois de revalidar: sem isso ele reencontraria no cache
  // exatamente os arquivos velhos que motivaram o clique.
  setTimeout(() => location.reload(), 700);
}

// Tudo que o navegador guarda por conta própria e que este aplicativo não
// controla. Nada disto existe hoje — não há service worker nem Cache Storage —
// e é justamente por isso que a limpeza é escrita defensiva: no dia em que
// existir, o botão continua fazendo o que promete sem ninguém lembrar de vir
// aqui atualizar.
async function limparCaches() {
  try {
    if (globalThis.caches?.keys) {
      const nomes = await caches.keys();
      await Promise.all(nomes.map((n) => caches.delete(n)));
    }
  } catch {}

  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {}
}

// O cache que de fato atrapalha aqui é o de HTTP, e ele não tem API de
// limpeza. O que existe é `cache: "reload"`: o navegador ignora o que tem
// guardado, vai ao servidor e substitui a entrada. Feito antes do reload, é o
// que garante que a página que volta é a nova.
//
// A lista sai do que a própria página carregou, e não de um inventário escrito
// à mão: arquivo novo entra sozinho, arquivo removido some sozinho.
async function revalidar() {
  const alvos = new Set([location.pathname]);
  try {
    for (const r of performance.getEntriesByType("resource")) {
      const u = new URL(r.name, location.href);
      if (u.origin !== location.origin) continue;
      if (!/\.(?:js|css|svg|png|jpe?g|webp|woff2?)$/i.test(u.pathname)) continue;
      alvos.add(u.pathname);
    }
  } catch {}

  await Promise.allSettled(
    [...alvos].map((p) => fetch(p, { cache: "reload", credentials: "same-origin" }))
  );
}
