// Que versão está rodando, e o botão que confere se ela é a última.
//
// Existe por um motivo prático: este aplicativo não tem número de build no
// nome dos arquivos. O navegador guarda `app.js` e `app.css` pelo caminho, e
// um deploy novo pode chegar sem que a aba aberta perceba — a pessoa vê um
// defeito já corrigido e reclama de algo que não existe mais.
//
// São dois gestos, e a separação entre eles é o ponto:
//
//   o rótulo do rodapé  →  ABRE o painel. Mostra a versão e o histórico, e não
//                          mexe em nada. Quem só quer saber onde está não perde
//                          o que estava fazendo.
//   o botão de dentro   →  LIMPA o cache do navegador e RECARREGA. É a saída de
//                          "vi um defeito que já foi corrigido".
//
// A limpeza recarrega mesmo quando o commit não mudou. É de propósito: quem
// aperta aquele botão está desconfiando do próprio cache, e o caso mais comum
// é justamente esse — commit novo, JavaScript novo e CSS ainda velho, servido
// pela borda da hospedagem por mais alguns segundos depois do deploy.

import { h, mount, $ } from "./dom.js";
import { api } from "./api.js";
import { toast, erro } from "./toast.js";

// O que o servidor disse quando esta aba carregou. É a régua: a comparação de
// "mudou?" é contra este valor, e não contra a última verificação, senão duas
// checagens seguidas sem recarregar dariam "em dia" com a página velha na tela.
let aoCarregar = null;
let caixa = null;
let verificando = false;
let buscando = false;

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
    "Clique para ver o histórico das versões.",
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

// Abrir só mostra.
//
// `estado` é o que a verificação está fazendo agora, e muda enquanto o painel
// já está aberto — por isso desenhar é uma função, e não um trecho solto.
//
// A fase padrão era "verificando", e ela dispara a limpeza no fim desta
// função. Enquanto a verificação só recarregava quando o commit tinha mudado,
// isso passava despercebido — mas ela passou a recarregar sempre, e aí abrir o
// painel virou recarregar a página. A linha do tempo ficava visível por um
// instante e sumia, o que é o mesmo que não existir.
//
// Ver e agir são gestos diferentes: o clique no rodapé mostra, e o botão de
// dentro é que limpa e recarrega. Quem quer só saber em que versão está não
// perde o que estava fazendo por causa disso.
export function abrirVersao(estado = { fase: "parado" }) {
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

  // Só a leitura que faltou, e nada além dela.
  //
  // A consulta da carga leva uma ida à rede — no modo hospedado, duas, porque
  // ela passa pelo GitHub. Quem clica no rótulo antes de ela responder abria um
  // painel dizendo "versão desconhecida", e ele ficava assim: nada mais ia
  // buscar. Antes isto não aparecia porque abrir disparava a verificação, que
  // buscava de novo — e recarregava a página junto, que é o defeito que acabou
  // de sair daqui.
  //
  // Esta busca não limpa cache e não recarrega. É a leitura, só.
  if (estado.fase === "parado" && !aoCarregar) buscarParaMostrar();
}

async function buscarParaMostrar() {
  if (buscando) return;
  buscando = true;
  try {
    aoCarregar = await api.versao();
    pintarRotulo(aoCarregar);
    // Redesenha o painel se ele ainda estiver aberto. Se a pessoa fechou no
    // meio da espera, o rótulo já foi atualizado e não há mais o que mostrar.
    if (caixa?.open) abrirVersao({ fase: "parado" });
  } catch {
    if (caixa?.open) abrirVersao({ fase: "erro", mensagem: "Não consegui falar com o servidor agora." });
  } finally {
    buscando = false;
  }
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

// O que se diz em cada fase.
//
// Nenhuma frase de "cache limpo" fora das fases que de fato limparam: abrir o
// painel não mexe em nada, e afirmar que mexeu treinaria a pessoa a não
// acreditar no que está escrito aqui.
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

  // Parado: só abriu. Diz o que se sabe e o que o botão faria.
  if (estado.fase === "parado") {
    // Sem dado nenhum ainda: ou a consulta está em voo, ou ela falhou. As duas
    // são espera do ponto de vista de quem olha, e nenhuma delas é "o servidor
    // não sabe" — dizer isso seria acusar o servidor de algo que ainda não se
    // apurou.
    if (!v) return h("span", { text: "Consultando o servidor…" });

    if (!v.atual?.versao && !v.atual?.sha) {
      return h("span", { text: "O servidor não sabe informar em que versão está." });
    }
    if (v.atras) {
      return h("span", {
        text: `O servidor está ${v.atras} versão${v.atras > 1 ? "ões" : ""} atrás do repositório — o deploy ainda não chegou.`,
      });
    }
    return h("span", {
      text: "Esta é a versão que o servidor tem. O botão abaixo limpa o cache do navegador e recarrega.",
    });
  }

  // Em dia, depois de ter verificado. Vale distinguir "conferi e está igual" de
  // "conferi e o servidor nem sabe em que commit está": a segunda não garante nada.
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
