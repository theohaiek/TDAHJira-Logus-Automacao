// Quadro — um trilho de cenas, e em cada cena as cinco colunas.
//
// Cinco estados, não mais. Cada estado adicional é uma decisão a mais a cada
// movimento de cartão, e a soma dessas decisões é o que torna um quadro de
// Jira exaustivo de manter.
//
// A tela deixou de ser um quadro só. É uma pilha de painéis flutuantes: as
// empresas à esquerda, as pessoas à direita, "todos os negócios" sempre no
// centro. Só o painel central é um quadro de verdade; os outros ficam atrás
// dele, menores, saindo pelas bordas, com a marca de quem eles são — e o
// vizinho imediato sempre por cima dos mais distantes daquele lado.
//
// Arrastar o fundo desliza a pilha um para um com o cursor; ao soltar, ela
// assenta no painel mais próximo. Aproximar o cursor de um painel lateral abre
// o convite: ele esmaece sob um véu e sobe um botão de entrar. Clique simples
// não navega, porque um arrasto que termina em cima de um painel não pode
// virar viagem que ninguém pediu.

import { h, frag, avatar, fotoEmpresa } from "../dom.js";
import {
  state,
  porStatus,
  limiteWip,
  emAndamento,
  visiveis,
  alternarFiltroQuadro,
  limparFiltroQuadro,
  filtroQuadroAtivo,
  escoposDoCarrossel,
  escopoDeCena,
  cenaValida,
  projeto,
} from "../store.js";
import { taskCard } from "../taskcard.js";
import { STATUS_LABEL, STATUS_ORDER, STATUS_COLOR } from "../format.js";
import { api } from "../api.js";
import { mesclarTarefa, emit, confirmar } from "../store.js";
import { erro, comemorar } from "../toast.js";
import { criarRapida } from "../quickadd.js";

// --- Estado do trilho -------------------------------------------------------
//
// Fora do DOM e fora de state, de propósito. mount() destrói #view inteiro a
// cada emit() e a cada tique de seis segundos: nada que viva como propriedade
// de um nó antigo sobrevive. E nada disto é dado de produto — é a mecânica de
// um gesto, que não tem por que atravessar o resto do aplicativo.
let trilhoEl = null;
let cenasEl = [];
let ids = [];
// Onde a pilha está, em índice fracionário. Entre 2 e 3 quer dizer "no meio do
// caminho entre a terceira e a quarta cena", e é isso que deixa o arrasto
// contínuo em vez de saltar de uma para a outra.
let posicao = 0;
let escopoVisivel = "geral";
let gesto = null;
let tween = 0;
let ocupadoDesde = 0;
let arrastouAgora = false;
let observador = null;

export function viewQuadro() {
  const fileira = escoposDoCarrossel();

  // A cena guardada pode ter deixado de existir entre um desenho e outro:
  // empresa arquivada, pessoa desativada, projeto filtrado na barra lateral.
  // Cair no centro é melhor do que ficar apontando para o nada.
  if (!fileira.some((d) => d.id === state.carrossel.atual)) {
    state.carrossel.atual = "geral";
    escreverHash("geral");
  }

  const atual = state.carrossel.atual;
  escopoVisivel = atual;
  const daVez = fileira.find((d) => d.id === atual);

  const trilho = h(
    "div",
    { class: "trilho", role: "group", "aria-label": "Telas do quadro" },
    fileira.map((d) => (d.id === atual ? cenaCheia(d) : painel(d)))
  );

  posicionarDepoisDoMonte(trilho, atual);

  return frag(cabecalho(daVez), barra(fileira, atual), trilho);
}

// --- Cabeçalho e barra ------------------------------------------------------

function cabecalho(d) {
  const p = state.filtroProjeto ? projeto(state.filtroProjeto) : null;
  return h(
    "div",
    { class: "page-head" },
    h("h1", { text: "Quadro" }),
    h("p", {
      text:
        d?.tipo === "mais"
          ? "Escolha para onde ir. As cenas do trilho mostram quem tem mais trabalho aberto."
          : `Arraste o fundo para trocar de cena, ou use [ e ]. As setas ← → movem o cartão selecionado.${
              p ? ` Filtrado por ${p.name}.` : ""
            }`,
    })
  );
}

function barra(fileira, atual) {
  return h(
    "div",
    { class: "trilho__barra" },
    h("span", {
      class: "trilho__rotulo",
      "aria-live": "polite",
      text: rotuloDaCena(fileira, atual),
    }),
    h(
      "div",
      { class: "trilho__pontos", role: "group", "aria-label": "Cenas do quadro" },
      fileira.map((d) =>
        h("button", {
          class: `trilho__ponto${d.id === atual ? " is-on" : ""}`,
          dataset: { escopo: d.id },
          // A cor da entidade vai em propriedade CSS padrão, e não em custom
          // property: h() faz Object.assign(el.style, v), que ignora --var em
          // silêncio, sem erro e sem aviso.
          style: { color: d.cor || "var(--text-2)" },
          // Na cena "mais", a contagem é de quem ficou fora da fileira, e não
          // de tarefa aberta: dizer "em aberto" ali seria mentira.
          title: `${d.nome} — ${contagemDe(d)}`,
          "aria-label": `${d.nome}, ${contagemDe(d)}`,
          "aria-current": d.id === atual ? "true" : "false",
          onClick: () => irParaCena(d.id),
        })
      )
    )
  );
}

function contagemDe(d) {
  return d.tipo === "mais" ? `${d.abertas} fora do trilho` : `${d.abertas} em aberto`;
}

function rotuloDaCena(fileira, id) {
  const d = fileira.find((x) => x.id === id);
  if (!d) return "";
  const p = state.filtroProjeto ? projeto(state.filtroProjeto) : null;
  return `${d.nome} · ${contagemDe(d)}${p ? ` · ${p.name}` : ""}`;
}

// --- As cenas ---------------------------------------------------------------

function cenaCheia(d) {
  const wip = limiteWip();
  const emCurso = emAndamento().length;
  const escopo = escopoDeCena(d.id);

  return h(
    "div",
    { class: "cena is-atual", dataset: { escopo: d.id } },
    d.tipo === "mais"
      ? cenaExcedente(d)
      : frag(
          // O cabeçalho de ícones só existe na cena geral: nas laterais o
          // escopo já foi decidido pela posição na fileira, e dois controles
          // para a mesma pergunta na mesma tela é a ambiguidade que este
          // produto evita.
          d.tipo === "geral" ? filtros() : rotuloFixo(d),
          h(
            "div",
            { class: "board" },
            STATUS_ORDER.map((s) => coluna(s, wip, emCurso, escopo, d))
          )
        )
  );
}

// Nas cenas laterais o cabeçalho vira etiqueta, sem clique.
function rotuloFixo(d) {
  return h(
    "div",
    { class: "cena__fixo" },
    d.tipo === "empresa" ? fotoEmpresa(d.ref, 20) : avatar(d.ref, "avatar--sm"),
    h("span", { class: "cena__fixonome", text: d.nome }),
    h("span", {
      class: "cena__fixoconta",
      text: d.abertas ? `${d.abertas} em aberto` : "nada aberto",
    })
  );
}

function cenaExcedente(d) {
  const cabe = d.itens.slice(0, 24);
  return h(
    "div",
    { class: "cena__mais" },
    h("p", { class: "cena__maistitulo", text: d.nome }),
    h("p", {
      class: "cena__maisdica",
      text: "Quem não coube no trilho. As cenas mostram quem tem mais trabalho aberto.",
    }),
    h(
      "div",
      { class: "cena__maislista" },
      cabe.map((x) =>
        h(
          "button",
          { class: "cena__maisitem", onClick: () => irParaCena(x.id) },
          x.tipo === "empresa" ? fotoEmpresa(x.ref, 20) : avatar(x.ref, "avatar--sm"),
          h("span", { class: "truncate", text: x.nome }),
          h("span", { class: "cena__maisconta", text: String(x.abertas) })
        )
      )
    ),
    // Uma parede de sessenta botões é a paralisia que o cabeçalho de filtros
    // evita de propósito. Depois de vinte e quatro, a planilha faz melhor.
    d.itens.length > cabe.length
      ? h("p", {
          class: "cena__maisdica",
          text: `E mais ${d.itens.length - cabe.length}. Para essa lista inteira, a Planilha filtra melhor.`,
        })
      : null
  );
}

// O painel de uma cena que não está no centro.
//
// A raiz não é um <button> de propósito: um <button> cairia no bail-out do
// gesto e mataria qualquer arrasto que começasse em cima dele. O papel, o
// tabindex e o teclado dão a acessibilidade; quem entra de verdade é o botão
// do véu, que é um <button> como manda o figurino.
//
// Clique simples não navega. O painel responde ao cursor abrindo o convite —
// véu mais botão — e a entrada acontece no botão, no duplo clique ou no
// teclado. Um arrasto que termina em cima de um painel não pode virar
// navegação que ninguém pediu.
function painel(d) {
  const marca =
    d.tipo === "empresa"
      ? fotoEmpresa(d.ref, 44)
      : d.tipo === "pessoa"
        ? avatar(d.ref, "avatar--lg")
        : h("span", { class: "cena__glifo", text: d.tipo === "mais" ? "…" : "▦" });

  // A borda que fica à vista é a de fora: a de dentro some atrás do painel
  // central, e colorir o que ninguém vê não identifica nada.
  const borda = d.lado === "esq" ? "borderInlineStartColor" : "borderInlineEndColor";
  const entrar = () => {
    if (arrastouAgora) return;
    irParaCena(d.id);
  };

  const el = h(
    "div",
    {
      class: `cena cena--resumo cena--${d.lado === "esq" ? "esq" : "dir"}`,
      dataset: { escopo: d.id },
      role: "button",
      tabindex: "0",
      "aria-label": `Ver o quadro de ${d.nome}, ${contagemDe(d)}`,
      style: { [borda]: d.cor || "var(--border-strong)" },
      onDblclick: entrar,
      onKeydown: (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        entrar();
      },
    },

    h(
      "div",
      { class: "cena__marca" },
      marca,
      h("span", { class: "cena__nome", text: d.nome }),
      h("span", { class: "cena__conta", text: contagemDe(d) })
    ),

    h(
      "div",
      { class: "cena__veu" },
      h("button", {
        class: "cena__entrar",
        type: "button",
        text: "Entrar em visualização",
        // O painel inteiro já tem role de botão e aria-label; o de dentro
        // repetiria o nome da cena para quem usa leitor de tela.
        tabindex: "-1",
        onClick: (e) => {
          e.stopPropagation();
          entrar();
        },
      })
    )
  );

  // Um clique simples abre o convite e o deixa aberto: sem isso, quem usa
  // toque nunca veria o botão, porque toque não tem hover.
  el.addEventListener("click", () => {
    if (arrastouAgora) return;
    el.classList.add("is-convidando");
  });

  return el;
}

// --- O cabeçalho de filtros da cena geral -----------------------------------
//
// Os rostos de quem tem tarefa aberta, e as empresas para quem elas são.
// Clicar liga, clicar de novo desliga.
//
// Só aparece quem tem tarefa no quadro agora — uma fileira com o time inteiro
// e o cadastro de clientes completo seria uma parede de ícones para decidir.
// Com uma exceção: quem já está ligado no filtro aparece mesmo sem tarefa
// aberta, senão concluir a última tarefa de alguém filtrado faria o botão
// sumir e não sobraria controle nenhum na tela para desligar o filtro.
function filtros() {
  const abertas = visiveis();
  const pessoas = state.users.filter(
    (u) => abertas.some((t) => t.assigneeId === u.id) || state.quadro.pessoas.includes(u.id)
  );
  const empresas = state.companies.filter(
    (c) => abertas.some((t) => t.companyId === c.id) || state.quadro.empresas.includes(c.id)
  );

  if (!pessoas.length && !empresas.length) return null;

  return h(
    "div",
    { class: "filtros", role: "group", "aria-label": "Filtrar o quadro" },

    pessoas.length
      ? h(
          "div",
          { class: "filtros__grupo" },
          pessoas.map((u) => {
            const ligado = state.quadro.pessoas.includes(u.id);
            return h(
              "button",
              {
                class: `filtros__btn${ligado ? " is-on" : ""}`,
                title: ligado ? `Tirar ${u.name} do filtro` : `Ver só o que é de ${u.name}`,
                "aria-pressed": ligado ? "true" : "false",
                onClick: () => alternarFiltroQuadro("pessoas", u.id),
              },
              avatar(u, "avatar--sm")
            );
          })
        )
      : null,

    pessoas.length && empresas.length ? h("span", { class: "filtros__risco" }) : null,

    empresas.length
      ? h(
          "div",
          { class: "filtros__grupo" },
          empresas.map((c) => {
            const ligado = state.quadro.empresas.includes(c.id);
            return h(
              "button",
              {
                class: `filtros__empresa${ligado ? " is-on" : ""}`,
                style: { color: c.color },
                title: ligado ? `Tirar ${c.name} do filtro` : `Ver só o que é da ${c.name}`,
                "aria-pressed": ligado ? "true" : "false",
                onClick: () => alternarFiltroQuadro("empresas", c.id),
              },
              fotoEmpresa(c, 20),
              c.name
            );
          })
        )
      : null,

    filtroQuadroAtivo()
      ? h("button", {
          class: "filtros__limpar",
          text: "limpar",
          onClick: () => limparFiltroQuadro(),
        })
      : null
  );
}

// --- As colunas -------------------------------------------------------------

function coluna(status, wip, emCurso, escopo, cena) {
  const tarefas = porStatus(status, escopo);
  const excedeu = status === "doing" && emCurso > wip;

  const corpo = h(
    "div",
    { class: "col__body" },
    tarefas.map((t) => {
      const card = taskCard(t, { arrastavel: true, mostrarPasso: status === "doing" });

      // Arrastar precisa de mouse. As setas fazem o mesmo movimento pelo
      // teclado: sem isso, quem não usa mouse simplesmente não tem como
      // mudar o estado de uma tarefa a partir desta tela.
      card.addEventListener("keydown", async (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const i = STATUS_ORDER.indexOf(t.status);
        const destino = STATUS_ORDER[e.key === "ArrowRight" ? i + 1 : i - 1];
        if (!destino) return;
        try {
          const r = await api.moveTask(t.id, { status: destino });
          mesclarTarefa(r.task);
          confirmar(t.id);
          emit();
          if (destino === "done") comemorar();
          // Devolve o foco ao mesmo cartão, já na coluna nova.
          requestAnimationFrame(() => {
            document.querySelector(`.task[data-id="${t.id}"]`)?.focus();
          });
        } catch (err) {
          erro(err.message);
        }
      });

      return card;
    })
  );

  const col = h(
    "section",
    {
      class: `col col--${status}${excedeu ? " is-over-wip" : ""}`,
      dataset: { status },
    },
    h(
      "div",
      { class: "col__head" },
      h("span", { class: "dot", style: { color: STATUS_COLOR[status] } }),
      h("span", {
        class: "col__title",
        text: STATUS_LABEL[status],
        style: { color: STATUS_COLOR[status] },
      }),
      h("span", {
        class: "col__count",
        text: status === "doing" ? `${tarefas.length}${wip ? ` / ${wip}` : ""}` : String(tarefas.length),
        title: excedeu ? "Acima do limite que você definiu para trabalho simultâneo" : "",
      })
    ),
    corpo,
    tarefas.length === 0 && cena?.abertas === 0 && status === "inbox"
      ? h("p", { class: "cena__vazia", text: `Nada aberto para ${cena.nome} agora.` })
      : null,
    status !== "done"
      ? h("button", {
          class: "col__add",
          text: "+ nova",
          // O "+ nova" herda o escopo da cena: numa cena de empresa a tarefa
          // já nasce daquele cliente, numa de pessoa já nasce de quem faz.
          onClick: () => criarRapida({ status, ...presetDaCena(cena) }),
        })
      : null
  );

  // Soltar cartão na coluna.
  col.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    col.classList.add("is-over");
  });
  col.addEventListener("dragleave", (e) => {
    if (!col.contains(e.relatedTarget)) col.classList.remove("is-over");
  });
  col.addEventListener("drop", async (e) => {
    e.preventDefault();
    col.classList.remove("is-over");
    const id = Number(e.dataTransfer.getData("text/plain"));
    if (!id) return;

    // Calcula a vizinhança pelo ponto onde o cartão foi solto, para que a
    // ordem manual dentro da coluna seja preservada.
    const cartoes = Array.from(corpo.querySelectorAll(".task")).filter(
      (el) => Number(el.dataset.id) !== id
    );
    let beforeId = null;
    for (const el of cartoes) {
      const r = el.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        beforeId = Number(el.dataset.id);
        break;
      }
    }
    const indice = beforeId ? cartoes.findIndex((el) => Number(el.dataset.id) === beforeId) : cartoes.length;
    const afterId = indice > 0 ? Number(cartoes[indice - 1].dataset.id) : null;

    try {
      const r = await api.moveTask(id, { status, beforeId, afterId });
      mesclarTarefa(r.task);
      confirmar(id);
      emit();
      if (status === "done") comemorar();
    } catch (err) {
      erro(err.message);
    }
  });

  return col;
}

function presetDaCena(cena) {
  if (cena?.tipo === "empresa") return { companyId: cena.ref.id };
  if (cena?.tipo === "pessoa") return { assigneeId: cena.ref.id };
  return {};
}

// --- Navegação --------------------------------------------------------------

export function irParaCena(id) {
  const alvo = cenaValida(id);
  if (alvo === state.carrossel.atual) return;
  state.carrossel.atual = alvo;
  escreverHash(alvo);
  emit();
}

export function voltarAoCentro() {
  irParaCena("geral");
}

export function andarCena(passo) {
  const fileira = escoposDoCarrossel();
  const i = fileira.findIndex((d) => d.id === state.carrossel.atual);
  const destino = fileira[Math.max(0, Math.min(fileira.length - 1, i + passo))];
  if (destino) irParaCena(destino.id);
}

// replaceState, nunca location.hash: um arrasto que atravessa cinco cenas
// empilharia cinco entradas de histórico, e o botão Voltar do navegador
// viraria lixo.
function escreverHash(id) {
  const destino = id === "geral" ? "#/quadro" : `#/quadro/${String(id).replace(":", "/")}`;
  if (location.hash !== destino) history.replaceState(null, "", destino);
}

// --- A pilha: onde cada painel fica ----------------------------------------
//
// A cena central está no fluxo e é ela que dá altura ao trilho. As outras são
// absolutas por cima, e cada uma recebe deslocamento, escala, opacidade e
// ordem de empilhamento em função da distância até o centro. Como a distância
// é fracionária, o leque se abre e fecha continuamente enquanto se arrasta,
// sem nenhum salto entre uma cena e a seguinte.

// Até onde o leque se abre. A partir daqui os painéis param de encolher e de
// se afastar: acumular vinte camadas indistinguíveis não informa nada e ainda
// custa um transform por quadro.
const FUNDO = 3;

function medidas() {
  if (!trilhoEl) return null;
  const largura = trilhoEl.clientWidth;
  const central = cenasEl.find((c) => c.classList.contains("is-atual"));
  const traseiro = cenasEl.find((c) => !c.classList.contains("is-atual"));
  const painelW = traseiro?.offsetWidth || 0;
  const centralW = central?.offsetWidth || largura;
  if (!largura) return null;

  return {
    // Onde o cartão de trás repousa: encostado na borda, saindo por baixo do
    // painel central o suficiente para se ver que há mais coisa atrás.
    xLat: largura / 2 - painelW / 2 - 8,
    // O quanto o quadro central precisa andar para sair inteiro de cena. Ele é
    // muito maior que os cartões, então tem passo próprio: com o mesmo passo
    // deles, ficaria plantado no meio da tela cobrindo quem está chegando.
    xSai: centralW / 2 + painelW / 2 + 12,
  };
}

// Quanto o painel vizinho desbota. Lido do CSS a cada aplicação, e não cravado
// aqui: é assim que o modo calmo — que afunda mais os vizinhos — passa a valer
// no meio da sessão, sem recarregar e sem este arquivo saber que ele existe.
function veus() {
  const cs = getComputedStyle(document.documentElement);
  const perto = parseFloat(cs.getPropertyValue("--cena-perto"));
  const longe = parseFloat(cs.getPropertyValue("--cena-longe"));
  return {
    perto: Number.isFinite(perto) ? perto : 0.92,
    longe: Number.isFinite(longe) ? longe : 0.42,
  };
}

// Interpola entre os três degraus: o centro, o vizinho imediato e o que está
// dois atrás. Depois disso some de vez.
function entre(k, centro, perto, longe) {
  if (k <= 1) return centro + (perto - centro) * k;
  if (k <= 2) return perto + (longe - perto) * (k - 1);
  return Math.max(0.16, longe + (0.16 - longe) * Math.min(k - 2, 1));
}

function aplicarLayout() {
  if (!trilhoEl?.isConnected) return;
  const m = medidas();
  if (!m) return;
  const { perto, longe } = veus();

  cenasEl.forEach((el, i) => {
    const d = i - posicao;
    const k = Math.min(Math.abs(d), FUNDO);
    const sinal = Math.sign(d);
    const central = el.classList.contains("is-atual");

    // Os cartões de trás se afastam em passos curtos depois do primeiro: a
    // pilha comprime nas pontas em vez de jogar os distantes para fora da
    // tela, e é isso que faz uma pilha parecer uma pilha.
    const x = central
      ? d * m.xSai
      : sinal * (k <= 1 ? Math.abs(d) * m.xLat : m.xLat + (k - 1) * 14);

    // O cartão que chega ao centro cresce um pouco antes de virar quadro: é o
    // aviso de que ele está prestes a assumir a tela.
    const escala = central
      ? 1
      : 1 + 0.07 * (1 - Math.min(k, 1)) - 0.06 * Math.max(0, k - 1);

    const opacidade = central
      ? Math.max(0.25, 1 - 0.75 * Math.min(k, 1))
      : entre(k, 1, perto, longe);

    // A cena central está no fluxo e já nasce centrada pela margem automática.
    // Os cartões são absolutos ancorados em left:50%, e sem o recuo de metade
    // da própria largura ficariam todos com a borda esquerda no meio da tela.
    const centrar = central ? "" : "translateX(-50%) ";
    el.style.transform = `${centrar}translateX(${x.toFixed(2)}px) scale(${escala.toFixed(4)})`;
    el.style.opacity = opacidade.toFixed(3);

    // O vizinho imediato sempre por cima dos mais distantes daquele lado, e o
    // quadro central cedendo a frente conforme sai: sem isso a pilha vira uma
    // mancha em que não se distingue o que vem antes do quê.
    el.style.zIndex = String(
      central ? Math.round(100 - Math.min(k, 1) * 20) : Math.round(96 - k * 10)
    );
    // Cartão encoberto não recebe cursor: o convite de entrar só pode abrir em
    // quem está de fato à vista.
    el.style.pointerEvents = k > 1.6 ? "none" : "";
  });
}

// --- Sobreviver ao mount() --------------------------------------------------

// desenharAgora() remonta #view inteiro a cada emit() e a cada tique de seis
// segundos. Enquanto o gesto está em curso, o redesenho fica represado — e a
// trava é de inatividade, renovada a cada movimento, para que um pointerup
// perdido (janela sem foco, ponteiro fora da tela) nunca congele a tela.
export function carrosselOcupado() {
  if (!ocupadoDesde) return false;
  if (Date.now() - ocupadoDesde > 5000) {
    ocupadoDesde = 0;
    return false;
  }
  return true;
}

function posicionarDepoisDoMonte(el, id) {
  requestAnimationFrame(() => {
    // Quando este quadro dispara, o mount() já rodou e o nó está no documento.
    if (!el.isConnected) return;
    ligar(el);
    // A posição vem da identidade da cena, nunca de um pixel guardado: o nó
    // anterior foi destruído, e um índice sozinho muda de significado quando a
    // fileira muda de composição.
    posicao = Math.max(0, ids.indexOf(id));
    aplicarLayout();
    observarTamanho(el);
  });
}

function ligar(el) {
  trilhoEl = el;
  cenasEl = Array.from(el.querySelectorAll(".cena"));
  ids = cenasEl.map((c) => c.dataset.escopo);
  el.addEventListener("pointerdown", aoApertar);
  el.addEventListener("dragstart", (e) => {
    if (gesto?.arrastando) e.preventDefault();
  });
}

function observarTamanho(el) {
  observador?.disconnect();
  if (typeof ResizeObserver !== "function") return;
  // Sem isto, redimensionar a janela deixa o leque torto: o passo foi medido
  // numa largura que já não existe.
  observador = new ResizeObserver(() => {
    if (!trilhoEl?.isConnected || gesto?.arrastando) return;
    aplicarLayout();
  });
  observador.observe(el);
}

// --- O gesto ----------------------------------------------------------------

function aoApertar(e) {
  // Só mouse. No toque quem navega são os pontos e o convite de cada painel —
  // sem isso o gesto disputaria com a rolagem vertical da página, que é o que
  // mais se faz num telefone.
  if (e.pointerType !== "mouse" || e.button !== 0) return;

  // Sem este bail-out, o dragstart HTML5 do cartão é cancelado em silêncio e
  // arrastar cartão entre colunas para de funcionar, sem um erro sequer no
  // console — e o frontend não tem suíte de comportamento para pegar isso.
  if (e.target.closest(".task, button, a, input, textarea, select, [contenteditable]")) return;

  gesto = {
    x0: e.clientX,
    y0: e.clientY,
    posicao0: posicao,
    pointerId: e.pointerId,
    arrastando: false,
  };
  // Em window, e não no trilho: o ponteiro sai da faixa durante o arrasto.
  window.addEventListener("pointermove", aoMover);
  window.addEventListener("pointerup", aoSoltar);
  window.addEventListener("pointercancel", aoSoltar);
}

function aoMover(e) {
  if (!gesto || !trilhoEl) return;
  const dx = e.clientX - gesto.x0;
  const dy = e.clientY - gesto.y0;

  if (!gesto.arrastando) {
    // Movimento claramente vertical devolve a rolagem da página.
    if (Math.abs(dy) >= 10 && Math.abs(dy) > Math.abs(dx)) return soltarOuvintes();
    if (!(Math.abs(dx) >= 6 && Math.abs(dx) > Math.abs(dy))) return;

    gesto.arrastando = true;
    cancelarTween();
    try {
      trilhoEl.setPointerCapture(gesto.pointerId);
    } catch {}
    trilhoEl.classList.add("is-arrastando");
    // Quem estava com o convite aberto perde a vez: no meio de um arrasto
    // ninguém está escolhendo para onde ir.
    for (const c of cenasEl) c.classList.remove("is-convidando");
  }

  const m = medidas();
  if (!m?.xLat) return;

  // O passo do gesto é o do cartão, e não o do quadro central: quem o olho
  // segue durante a troca é o painel que está chegando, e é ele que precisa
  // acompanhar a mão um para um. O quadro central sai mais rápido porque é
  // muito maior — e sair da frente depressa é o que se espera dele.
  //
  // Sem inércia, sem mola, sem física.
  const cru = gesto.posicao0 - dx / m.xLat;
  // Passar do fim resiste em vez de travar: o leque estica um pouco e volta.
  posicao = amortecer(cru);
  aplicarLayout();
  destacarMaisProxima();

  arrastouAgora = true;
  // Renovada a cada movimento: a trava de cinco segundos é de inatividade.
  // Gravada uma vez só, um arrasto longo expiraria no meio — o mount()
  // destruiria o trilho, os ouvintes de window continuariam mexendo em nós
  // que saíram do documento, e o leque saltaria de volta.
  ocupadoDesde = Date.now();
  e.preventDefault();
}

function amortecer(v) {
  const fim = cenasEl.length - 1;
  if (v < 0) return v * 0.32;
  if (v > fim) return fim + (v - fim) * 0.32;
  return v;
}

function aoSoltar() {
  const arrastou = !!gesto?.arrastando;
  soltarOuvintes();
  if (!arrastou || !trilhoEl) return;
  trilhoEl.classList.remove("is-arrastando");
  // Depois do clique sintético que o navegador dispara no pointerup. É isto
  // que impede um arrasto terminado em cima de um painel de abrir o convite
  // dele sem ninguém ter pedido.
  setTimeout(() => {
    arrastouAgora = false;
  }, 0);
  assentar();
}

function soltarOuvintes() {
  window.removeEventListener("pointermove", aoMover);
  window.removeEventListener("pointerup", aoSoltar);
  window.removeEventListener("pointercancel", aoSoltar);
  if (gesto?.arrastando) {
    try {
      trilhoEl?.releasePointerCapture(gesto.pointerId);
    } catch {}
  }
  gesto = null;
}

function maisProxima() {
  if (!cenasEl.length) return -1;
  return Math.max(0, Math.min(cenasEl.length - 1, Math.round(posicao)));
}

// Durante o arrasto, a cena que chegou ao centro é marcada no nó vivo. É o que
// faz o painel crescer enquanto a mão ainda está no botão: transição de CSS
// não roda em nó recém-criado, e o render posterior só reaplica o valor final.
function destacarMaisProxima() {
  const i = maisProxima();
  const id = ids[i];
  if (!id || id === escopoVisivel) return;
  escopoVisivel = id;

  const rotulo = document.querySelector(".trilho__rotulo");
  if (rotulo) rotulo.textContent = rotuloDaCena(escoposDoCarrossel(), id);

  for (const p of document.querySelectorAll(".trilho__ponto")) {
    const ligado = p.dataset.escopo === id;
    p.classList.toggle("is-on", ligado);
    p.setAttribute("aria-current", ligado ? "true" : "false");
  }
}

function assentar() {
  const i = maisProxima();
  if (i < 0) return;
  deslizarAte(i, () => concluirNavegacao(ids[i]));
}

// A duração é lida a cada movimento, nunca cacheada.
//
// prefers-reduced-motion já zera --dur-slow em tokens.css, então a media query
// passa a valer de graça para um movimento que é JavaScript. E o modo calmo
// pode ser ligado no meio da sessão. Nunca crave milissegundos aqui: foi assim
// que .celebrate e .focus__fill ficaram de fora do movimento reduzido.
function duracaoDoMovimento() {
  if (document.documentElement.dataset.calm === "1") return 0;
  const v = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--dur-slow")
  );
  return Number.isFinite(v) ? v : 260;
}

function deslizarAte(destino, aoChegar) {
  cancelarTween();

  const ms = duracaoDoMovimento();
  const inicio = posicao;
  const delta = destino - inicio;

  if (!ms || Math.abs(delta) < 0.001) {
    posicao = destino;
    aplicarLayout();
    aoChegar?.();
    return;
  }

  const inicioEm = performance.now();
  const passo = (agora) => {
    if (!trilhoEl?.isConnected) {
      tween = 0;
      return;
    }
    const p = Math.min(1, (agora - inicioEm) / ms);
    posicao = inicio + delta * (1 - (1 - p) ** 3);
    aplicarLayout();
    ocupadoDesde = Date.now();
    if (p < 1) {
      tween = requestAnimationFrame(passo);
      return;
    }
    tween = 0;
    aoChegar?.();
  };
  tween = requestAnimationFrame(passo);
}

function cancelarTween() {
  if (!tween) return;
  cancelAnimationFrame(tween);
  tween = 0;
}

function concluirNavegacao(id) {
  // Antes de qualquer outra coisa: enquanto isto não zera, app.js continua
  // represando o redesenho.
  ocupadoDesde = 0;
  escopoVisivel = id || escopoVisivel;

  if (id && id !== state.carrossel.atual) {
    state.carrossel.atual = id;
    escreverHash(id);
  }

  // Sempre, mesmo quando o id não mudou. Se um sync de seis segundos chegou
  // durante o gesto, redesenhoAdiado ficou ligado e só o focusout o soltaria —
  // e focusout não dispara num gesto de mouse. Sem este emit(), a tela fica
  // mostrando dado velho até alguém clicar em algum campo.
  emit();
}
