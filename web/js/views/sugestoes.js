// Sugestões: o que foi feito com cada bug e cada ideia relatados pelo ⚑.
//
// Um pedido que some sem resposta ensina a não pedir de novo. Esta tela é a
// resposta: cada relato com a situação dele, quem relatou, o que mudou (e em
// que versão), o porquê de um "não", ou a pergunta que falta responder. Quem
// decide a maior parte é o agente diário (scripts/relatos/rodar.mjs); o que
// precisa de gente fica em "Aguardando autorização", no alto.
//
// A tela é remontada a cada emit() do aplicativo, e a sincronização emite a
// cada seis segundos. Por isso nada aqui busca dados ao desenhar: a lista mora
// num cache deste módulo e é pedida de novo só quando envelhece. E tudo que a
// pessoa abriu (um histórico, a seção de encerradas, um texto longo) é
// lembrado aqui, senão fecharia sozinho seis segundos depois.

import { h, frag } from "../dom.js";
import { api } from "../api.js";
import { state, emit } from "../store.js";
import { SITUACAO_RELATO, desde, dataHoraLonga, plural } from "../format.js";
import { toast, erro } from "../toast.js";
import { pedir } from "../dialog.js";
import { abrirVersao } from "../versao.js";

// Um minuto: o agente passa uma vez por dia, e as ações de quem administra já
// trocam o cartão na hora. Mais do que isto só serviria para gastar requisição.
const VALIDADE = 60 * 1000;
const ESPERA_DEPOIS_DE_ERRO = 30 * 1000;

// Um relato longo aparece cortado, com "ver tudo". Quatrocentos caracteres
// são umas cinco linhas do cartão: o bastante para saber do que se trata.
const TETO_DO_CORPO = 400;

const cache = { dados: null, em: 0, carregando: false, erro: null, erroEm: 0 };

// O que a pessoa abriu, por chave: "secao:encerradas", "historico:12",
// "corpo:12". Sobrevive à remontagem da tela.
const abertos = new Set();

// O texto de uma resposta em andamento, por relato. Enquanto o campo tem
// foco, o aplicativo nem remonta a tela; isto cobre o resto (a pessoa clicou
// fora sem enviar e voltou).
const rascunhos = new Map();

// Relatos com uma ação a caminho do servidor: o botão fica desligado e um
// segundo clique não manda a mesma ação duas vezes.
const ocupados = new Set();

let filtro = "todas";
let rolouAte = null;

// O ⚑ avisa por evento que um relato novo chegou, e não por import: o popup de
// relatar não precisa saber que esta tela existe.
window.addEventListener("relato:enviado", () => {
  cache.em = 0;
  carregarSugestoes({ forcar: true });
});

export async function carregarSugestoes({ forcar = false } = {}) {
  if (cache.carregando) return;
  if (!forcar && cache.erro && Date.now() - cache.erroEm < ESPERA_DEPOIS_DE_ERRO) return;
  cache.carregando = true;
  try {
    cache.dados = await api.relatos();
    cache.em = Date.now();
    cache.erro = null;
  } catch (err) {
    cache.erro = err.message || "Não consegui carregar as sugestões.";
    cache.erroEm = Date.now();
  } finally {
    cache.carregando = false;
    emit();
  }
}

// O número ao lado de "Sugestões" na barra lateral. Para quem administra, o que
// espera por ela; para os outros, o que ainda está em aberto.
export function contagemSugestoes() {
  const lista = cache.dados?.feedback;
  if (!lista) return 0;
  if (state.me?.role === "admin") return lista.filter((r) => r.status === "todo").length;
  return lista.filter((r) => ["novo", "autorizado", "detalhe", "todo"].includes(r.status)).length;
}

export function viewSugestoes() {
  if (!cache.dados || Date.now() - cache.em > VALIDADE) carregarSugestoes();

  const dados = cache.dados;
  const admin = state.me?.role === "admin";
  const todos = dados?.feedback || [];
  const alvo = alvoDoEndereco();

  // Veio de um link para um relato (o painel de versões, um "duplicado do
  // #N"): mostra o relato mesmo que o filtro o esconda, abre a seção dele se
  // estiver fechada, e rola até ele uma vez só.
  if (alvo && alvo !== rolouAte) {
    const relato = todos.find((r) => r.id === alvo);
    if (relato) {
      rolouAte = alvo;
      if (filtro === "minhas" && relato.autorId !== state.me?.id) filtro = "todas";
      if (grupoDe(relato) === "encerradas") abertos.add("secao:encerradas");
      requestAnimationFrame(() =>
        document.getElementById(`sugestao-${alvo}`)?.scrollIntoView({ block: "center", behavior: "smooth" })
      );
    }
  } else if (!alvo) {
    rolouAte = null;
  }

  const lista = filtro === "minhas" ? todos.filter((r) => r.autorId === state.me?.id) : todos;
  const grupos = { aguardando: [], abertas: [], feitas: [], encerradas: [] };
  for (const r of lista) grupos[grupoDe(r)].push(r);

  return frag(
    h(
      "div",
      { class: "page-head" },
      h("h1", { text: "Sugestões" }),
      h("p", { text: "Bugs e ideias relatados pelo ⚑, e o que foi feito com cada um." })
    ),

    h(
      "div",
      { class: "sugestoes" },
      barra(dados),

      !dados
        ? estadoSemDados()
        : !lista.length
          ? vazio()
          : [
              secao(
                "aguardando",
                "Aguardando autorização",
                admin ? "Aprovadas na triagem, esperando o seu sim." : "Aprovadas na triagem, esperando quem administra.",
                grupos.aguardando,
                alvo
              ),
              secao(
                "abertas",
                "Abertas",
                "Na fila do agente, ou esperando uma resposta de quem relatou.",
                grupos.abertas,
                alvo
              ),
              secao("feitas", "Feitas", null, grupos.feitas, alvo),
              encerradas(grupos.encerradas, alvo),
            ]
    )
  );
}

// --- Partes da tela ---------------------------------------------------------

function barra(dados) {
  return h(
    "div",
    { class: "sugestoes__barra" },
    h("p", { class: "sugestoes__passada", text: linhaDaPassada(dados) }),
    h(
      "div",
      { class: "sugestoes__acoes" },
      h(
        "div",
        { class: "relato__tipos", role: "radiogroup", "aria-label": "Quais sugestões mostrar" },
        botaoDeFiltro("todas", "Todas"),
        botaoDeFiltro("minhas", "Minhas")
      ),
      // O mesmo botão da barra de cima, e não uma segunda porta: um relato só
      // tem um jeito de nascer.
      h("button", {
        class: "btn btn--primary btn--sm",
        type: "button",
        text: "⚑ Relatar",
        onClick: () => document.getElementById("relato-btn")?.click(),
      })
    )
  );
}

function botaoDeFiltro(valor, rotulo) {
  const ligado = filtro === valor;
  return h("button", {
    type: "button",
    class: `relato__tipo${ligado ? " is-on" : ""}`,
    role: "radio",
    "aria-checked": ligado ? "true" : "false",
    text: rotulo,
    onClick: () => {
      filtro = valor;
      emit();
    },
  });
}

// Se o agente está vivo, e o que fez da última vez. É o que responde "alguém
// está olhando para isto?" antes de a pessoa precisar perguntar.
function linhaDaPassada(dados) {
  const p = dados?.passada;
  if (!dados) return "";
  if (!p) return "O agente ainda não passou por aqui.";
  if (p.erro) return `A última passada do agente falhou: ${p.erro}`;
  const quando = desde(p.fim || p.inicio);
  return [
    `Última passada do agente: ${quando === "agora" ? "agora" : `há ${quando}`}`,
    plural(p.analisados || 0, "analisado", "analisados"),
    plural(p.publicados || 0, "publicado", "publicados"),
  ].join(" · ");
}

function estadoSemDados() {
  if (cache.erro && !cache.carregando) {
    return h(
      "div",
      { class: "empty" },
      h("span", { text: cache.erro }),
      h("button", {
        class: "btn btn--sm",
        type: "button",
        text: "Tentar de novo",
        onClick: () => carregarSugestoes({ forcar: true }),
      })
    );
  }
  return h("div", { class: "empty" }, h("span", { text: "Carregando as sugestões…" }));
}

function vazio() {
  if (filtro === "minhas") {
    return h(
      "div",
      { class: "empty" },
      h("strong", { text: "Você ainda não relatou nada." }),
      h("span", { text: "Viu algo errado ou teve uma ideia? O ⚑ no alto da tela manda direto para cá." })
    );
  }
  return h(
    "div",
    { class: "empty" },
    h("strong", { text: "Nenhum relato ainda." }),
    h("span", { text: "Viu algo errado ou teve uma ideia? O ⚑ no alto da tela manda direto para cá." })
  );
}

function secao(chave, titulo, sub, itens, alvo) {
  if (!itens.length) return null;
  return h(
    "section",
    { class: `section sugestoes__secao sugestoes__secao--${chave}` },
    h(
      "div",
      { class: "section__head" },
      h("h2", { class: "section__title", text: titulo }),
      h("span", { class: "section__count", text: String(itens.length) })
    ),
    sub ? h("p", { class: "sugestoes__sub", text: sub }) : null,
    h(
      "div",
      { class: "sugestoes__lista" },
      itens.map((r) => cartao(r, alvo))
    )
  );
}

// As encerradas ficam fechadas: são respostas já dadas, e a tela serve
// primeiro ao que ainda anda.
function encerradas(itens, alvo) {
  if (!itens.length) return null;
  const chave = "secao:encerradas";
  return h(
    "details",
    {
      class: "section sugestoes__secao sugestoes__encerradas",
      open: abertos.has(chave),
      onToggle: lembrar(chave),
    },
    h(
      "summary",
      { class: "section__head" },
      h("span", { class: "section__title", text: "Encerradas" }),
      h("span", { class: "section__count", text: String(itens.length) })
    ),
    h(
      "div",
      { class: "sugestoes__lista" },
      itens.map((r) => cartao(r, alvo))
    )
  );
}

// --- O cartão ---------------------------------------------------------------

function cartao(r, alvo) {
  const s = SITUACAO_RELATO[r.status] || SITUACAO_RELATO.novo;
  const meu = r.autorId != null && r.autorId === state.me?.id;

  return h(
    "article",
    {
      class: `sugestao sugestao--${r.kind} sugestao--${s.tom}${r.id === alvo ? " is-destaque" : ""}`,
      id: `sugestao-${r.id}`,
    },
    h(
      "div",
      { class: "sugestao__topo" },
      h("span", { class: `sugestao__tipo sugestao__tipo--${r.kind}`, text: r.kind === "bug" ? "Bug" : "Ideia" }),
      h("span", { class: "sugestao__numero", text: `#${r.id}` }),
      h("span", { class: `situacao situacao--${s.tom}`, text: s.rotulo }),
      h("span", {
        class: "sugestao__autor",
        text: r.autor ? `de ${r.autor}${meu ? " (você)" : ""}` : "de alguém que saiu do time",
      }),
      h("time", {
        class: "sugestao__quando",
        datetime: r.createdAt,
        title: dataHoraLonga(r.createdAt),
        text: desde(r.createdAt),
      })
    ),
    corpo(r),
    pilha(r),
    acoes(r, meu)
  );
}

function corpo(r) {
  const texto = String(r.body || "");
  const longo = texto.length > TETO_DO_CORPO;
  const chave = `corpo:${r.id}`;
  const inteiro = !longo || abertos.has(chave);
  return h(
    "div",
    { class: "sugestao__corpo" },
    h("p", { class: "sugestao__texto", text: inteiro ? texto : `${texto.slice(0, TETO_DO_CORPO).trimEnd()}…` }),
    longo
      ? h("button", {
          type: "button",
          class: "sugestao__mais",
          text: inteiro ? "ver menos" : "ver tudo",
          onClick: () => {
            alternar(chave);
            emit();
          },
        })
      : null
  );
}

// A pilha de atualizações: a mais nova em cima, empurrando as anteriores para
// baixo. É o que faz o processo ser lido de relance, sem abrir nada: o plano
// que estava no topo desce quando o agente implementa, e no lugar dele entra o
// "Corrigido" com a versão e o commit.
//
// A fonte é a história do relato (feedback_events), e não o texto da situação
// atual: só ela guarda o que foi dito em cada passo.
function pilha(r) {
  const eventos = r.eventos || [];
  const duplicado =
    r.status === "duplicado" && r.duplicadoDe
      ? h("a", {
          class: "sugestao__duplicado",
          href: `#/sugestoes/${r.duplicadoDe}`,
          text: `Duplicado do #${r.duplicadoDe}`,
        })
      : null;

  if (!eventos.length) {
    // Relato anterior à história por evento: mostra o que existe.
    if (!r.resolution && !duplicado) return null;
    const s = SITUACAO_RELATO[r.status] || SITUACAO_RELATO.novo;
    return h(
      "ol",
      { class: "sugestao__pilha" },
      h(
        "li",
        { class: `sugestao__passo sugestao__passo--${s.tom} is-atual` },
        duplicado,
        r.resolution ? h("p", { class: "sugestao__resposta", text: r.resolution }) : null,
        entrega(r)
      )
    );
  }

  return h(
    "ol",
    { class: "sugestao__pilha" },
    [...eventos].reverse().map((e, i) => passo(e, r, i === 0, i === eventos.length - 1, duplicado))
  );
}

function passo(e, r, atual, primeiro, duplicado) {
  const s = SITUACAO_RELATO[e.status] || SITUACAO_RELATO.novo;
  const quem =
    e.ator === "agente" ? "pelo agente" : e.atorNome ? `por ${e.atorNome}` : e.ator === "autor" ? "por quem relatou" : "por quem administra";

  return h(
    "li",
    { class: `sugestao__passo sugestao__passo--${s.tom}${atual ? " is-atual" : ""}` },
    h(
      "div",
      { class: "sugestao__passotopo" },
      h("span", { class: `situacao situacao--${s.tom}`, text: rotuloDoPasso(e, primeiro) }),
      h("span", { class: "sugestao__passoquem", text: quem }),
      h("time", {
        class: "sugestao__quando",
        datetime: e.em,
        title: dataHoraLonga(e.em),
        text: desde(e.em),
      })
    ),
    atual && duplicado ? duplicado : null,
    e.nota ? h("p", { class: "sugestao__resposta", text: e.nota }) : null,
    atual ? entrega(r) : null
  );
}

// "Novo" quer dizer coisas diferentes conforme onde está na pilha: o primeiro
// é o pedido chegando; os de depois são o relato voltando para a fila, porque
// quem relatou respondeu ou quem administra reabriu.
function rotuloDoPasso(e, primeiro) {
  const s = SITUACAO_RELATO[e.status] || SITUACAO_RELATO.novo;
  if (e.status !== "novo") return s.rotulo;
  if (primeiro) return "Relatado";
  return e.ator === "autor" ? "Respondido, de volta à fila" : "Reaberto";
}

// Em que versão a mudança entrou, e o commit. O número abre o painel de
// versões já no lugar certo; o commit leva ao GitHub, e só ao GitHub.
function entrega(r) {
  if (!r.commit || !["corrigido", "adicionado"].includes(r.status)) return null;
  const link = String(r.commit.url || "").startsWith("https://github.com/");
  return h(
    "div",
    { class: "sugestao__entrega" },
    r.versaoResolvida
      ? h("button", {
          type: "button",
          class: "sugestao__versao",
          text: `na v${r.versaoResolvida}`,
          title: "Ver no histórico de versões",
          onClick: () => abrirVersao({ fase: "parado", destaque: r.commit.curto }),
        })
      : null,
    link
      ? h("a", {
          class: "sugestao__commit",
          href: r.commit.url,
          target: "_blank",
          rel: "noopener noreferrer",
          text: `commit ${r.commit.curto} ↗`,
        })
      : h("code", { class: "sugestao__commit", text: r.commit.curto })
  );
}

function acoes(r, meu) {
  const admin = state.me?.role === "admin";
  const ocupado = ocupados.has(r.id);
  const botoes = [];

  if (admin) {
    if (r.status === "todo") {
      botoes.push(
        // Autorizar é mandar o plano acima para o agente seguir, sem ninguém
        // olhando: o aviso fica no próprio botão, que é onde a decisão acontece.
        botao("Autorizar", () => agir(r, "autorizar"), {
          primario: true,
          ocupado,
          dica: "O agente vai seguir o plano acima na próxima passada. Leia antes de autorizar.",
        }),
        botao("Recusar", () => agir(r, "recusar"), { ocupado })
      );
    } else if (["novo", "autorizado", "detalhe"].includes(r.status)) {
      botoes.push(botao("Recusar", () => agir(r, "recusar"), { ocupado }));
    } else {
      botoes.push(botao("Reabrir", () => agir(r, "reabrir"), { ocupado }));
    }
  }

  const resposta = meu && r.status === "detalhe" ? formularioDeResposta(r) : null;
  if (!botoes.length && !resposta) return null;
  return h(
    "div",
    { class: "sugestao__acoes" },
    resposta,
    botoes.length ? h("div", { class: "sugestao__botoes" }, botoes) : null
  );
}

function botao(rotulo, acao, { primario = false, ocupado = false, dica = null } = {}) {
  return h("button", {
    type: "button",
    class: `btn btn--sm${primario ? " btn--primary" : ""}`,
    text: rotulo,
    title: dica,
    disabled: ocupado,
    onClick: acao,
  });
}

function formularioDeResposta(r) {
  const ocupado = ocupados.has(r.id);
  return h(
    "form",
    { class: "sugestao__responder", onSubmit: (e) => responder(e, r) },
    h("label", { class: "sugestao__rotulo", for: `resposta-${r.id}`, text: "Sua resposta" }),
    h("textarea", {
      id: `resposta-${r.id}`,
      class: "relato__texto sugestao__campo",
      rows: 3,
      maxlength: 2000,
      required: true,
      placeholder: "Responda à pergunta acima. O relato volta para a fila do agente.",
      value: rascunhos.get(r.id) || "",
      onInput: (e) => rascunhos.set(r.id, e.target.value),
      onKeydown: (e) => {
        // Ctrl+Enter envia, como no popup de relatar e no resto do produto.
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          e.target.form?.requestSubmit();
        }
      },
    }),
    h("button", {
      class: "btn btn--primary btn--sm",
      type: "submit",
      text: ocupado ? "Enviando…" : "Responder",
      disabled: ocupado,
    })
  );
}

// --- Ações ------------------------------------------------------------------

const MENSAGEM_DA_ACAO = {
  autorizar: "Autorizado. Entra na próxima passada do agente.",
  recusar: "Recusado.",
  reabrir: "Reaberto. Volta para a fila do agente.",
};

async function agir(r, acao) {
  if (ocupados.has(r.id)) return;

  let nota = null;
  if (acao !== "autorizar") {
    const resposta = await pedir({
      titulo: acao === "recusar" ? `Recusar o relato #${r.id}` : `Reabrir o relato #${r.id}`,
      descricao:
        acao === "recusar"
          ? "O motivo aparece para quem relatou. Pode deixar em branco."
          : "Ele volta para a fila do agente. Se quiser, diga o que mudou.",
      campos: [{ chave: "nota", dica: acao === "recusar" ? "Motivo (opcional)" : "O que mudou (opcional)" }],
      confirmar: acao === "recusar" ? "Recusar" : "Reabrir",
    });
    if (!resposta) return;
    nota = String(resposta.nota || "").trim() || null;
  }

  ocupados.add(r.id);
  emit();
  try {
    const { relato } = await api.relatoAcao(r.id, acao, nota);
    trocar(relato);
    toast(MENSAGEM_DA_ACAO[acao]);
  } catch (err) {
    erro(err.message);
    // Conflito quer dizer que o relato mudou desde que a tela carregou (o
    // agente passou, ou outra pessoa decidiu). A lista velha não serve mais.
    if (err.status === 409) carregarSugestoes({ forcar: true });
  } finally {
    ocupados.delete(r.id);
    emit();
  }
}

async function responder(e, r) {
  e.preventDefault();
  const texto = String(rascunhos.get(r.id) || "").trim();
  if (!texto || ocupados.has(r.id)) return;

  ocupados.add(r.id);
  // Solta o foco do campo: sem isso o aplicativo continuaria represando o
  // redesenho, e o cartão não mostraria a situação nova.
  document.activeElement?.blur?.();
  emit();
  try {
    const { relato } = await api.complementarRelato(r.id, texto);
    rascunhos.delete(r.id);
    trocar(relato);
    toast("Resposta enviada. Volta para a fila do agente.");
  } catch (err) {
    erro(err.message);
  } finally {
    ocupados.delete(r.id);
    emit();
  }
}

// --- Apoio ------------------------------------------------------------------

function trocar(relato) {
  if (!cache.dados || !relato) return;
  cache.dados = {
    ...cache.dados,
    feedback: cache.dados.feedback.map((x) => (x.id === relato.id ? relato : x)),
  };
}

function grupoDe(r) {
  return (SITUACAO_RELATO[r.status] || SITUACAO_RELATO.novo).grupo;
}

function alternar(chave) {
  if (abertos.has(chave)) abertos.delete(chave);
  else abertos.add(chave);
}

function lembrar(chave) {
  return (e) => {
    if (e.target.open) abertos.add(chave);
    else abertos.delete(chave);
  };
}

// "#/sugestoes/12" aponta para o relato 12.
function alvoDoEndereco() {
  const id = Number(location.hash.replace(/^#/, "").split("/")[2]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
