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
// Arrastar o fundo desliza a pilha, com resistência: a mão faz pouco mais da
// metade do caminho e o assentamento faz o resto, com uma curva que passa do
// destino e volta. Um para um parecia o certo e deixava o movimento seco — a
// mão chegava ao destino e não sobrava trecho para a transição percorrer.
//
// Aproximar o cursor de um painel de trás abre o convite: ele esmaece sob um
// véu e sobe um botão de entrar. Clique simples não navega, porque um arrasto
// que termina em cima de um painel não pode virar viagem que ninguém pediu.

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
    fileira.map((d) => cena(d, atual))
  );

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

// Toda cena é o mesmo quadro, montado igual. A do centro está em escala cheia
// e as outras atrás, menores — e é só isso que as separa.
//
// A versão anterior montava o quadro só no centro e cartões pequenos nos
// lados. Parecia mais barato e era pior de todas as formas: o painel trocava
// de estrutura e de largura no meio do gesto, o que aparecia como um estalo
// de formato a cada troca de cena; e a "prévia" do lado não mostrava o quadro
// que estava prestes a ser aberto, que é justamente o que se quer espiar.
//
// Montando todas iguais, mover é só transformar — e transformar é a única
// coisa que a placa de vídeo faz sozinha, sem recalcular layout nenhum.
function cena(d, atual) {
  const wip = limiteWip();
  const emCurso = emAndamento().length;
  const escopo = escopoDeCena(d.id);
  const ehAtual = d.id === atual;

  const corpo =
    d.tipo === "mais"
      ? frag(tituloDaCena(d), cenaExcedente(d))
      : frag(
          tituloDaCena(d),
          h(
            "div",
            { class: "board" },
            STATUS_ORDER.map((s) => coluna(s, wip, emCurso, escopo, d))
          )
        );

  const el = h(
    "div",
    {
      class: `cena cena--${d.lado}${ehAtual ? " is-atual" : ""}`,
      dataset: { escopo: d.id },
      // O painel de trás é um alvo inteiro, e o de frente é o quadro em uso.
      ...(ehAtual
        ? { "aria-label": `Quadro de ${d.nome}` }
        : {
            role: "button",
            tabindex: "0",
            "aria-label": `Ver o quadro de ${d.nome}, ${contagemDe(d)}`,
            onDblclick: () => entrarNaCena(d.id),
            onKeydown: (e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              entrarNaCena(d.id);
            },
          }),
    },
    // inert tira o subtree do foco e do ponteiro de uma vez: sem ele, o Tab
    // entraria nos cartões da prévia, que é um quadro que ninguém está usando.
    h("div", { class: "cena__corpo", inert: !ehAtual }, corpo),
    ehAtual ? null : veuDaCena(d)
  );

  if (!ehAtual) {
    // Um toque simples abre o convite e o deixa aberto: sem isso, quem usa
    // toque nunca veria o botão, porque toque não tem cursor a aproximar.
    el.addEventListener("click", () => {
      if (arrastouAgora) return;
      el.classList.add("is-convidando");
    });
  }

  return el;
}

// A faixa que identifica de quem é o painel de trás, e o convite para entrar
// nele. Fica sobre o quadro, porque o quadro ali é prévia, não ferramenta.
function veuDaCena(d) {
  const marca =
    d.tipo === "empresa"
      ? fotoEmpresa(d.ref, 34)
      : d.tipo === "pessoa"
        ? avatar(d.ref, "avatar--lg")
        : h("span", { class: "cena__glifo", text: d.tipo === "mais" ? "…" : "▦" });

  return h(
    "div",
    { class: "cena__veu" },
    h(
      "div",
      { class: "cena__cartao" },
      marca,
      h("span", { class: "cena__nome", text: d.nome }),
      h("span", { class: "cena__conta", text: contagemDe(d) }),
      h("button", {
        class: "cena__entrar",
        type: "button",
        text: "Entrar em visualização",
        // O painel inteiro já tem papel de botão e rótulo; o de dentro
        // repetiria o nome da cena para quem usa leitor de tela.
        tabindex: "-1",
        onClick: (e) => {
          e.stopPropagation();
          entrarNaCena(d.id);
        },
      })
    )
  );
}

function entrarNaCena(id) {
  if (arrastouAgora) return;
  irParaCena(id);
}

// O título da visualização, colado no alto dela e sobre um fundo esmaecido.
//
// Toda cena tem um: sem ele, o que se vê são cinco colunas idênticas em cada
// painel e nada dizendo de quem elas são. Fica grudado no topo enquanto o
// quadro rola por baixo, porque a pergunta "de quem é este quadro" precisa ter
// resposta em qualquer ponto da rolagem.
//
// O cabeçalho de ícones aparece só na cena geral, e é a única diferença de
// comportamento entre ela e as outras: as laterais já são um filtro aplicado
// pela própria posição na fileira, e oferecer um segundo filtro ali seria dar
// dois controles para a mesma pergunta na mesma tela.
function tituloDaCena(d) {
  const marca =
    d.tipo === "empresa"
      ? fotoEmpresa(d.ref, 22)
      : d.tipo === "pessoa"
        ? avatar(d.ref, "avatar--sm")
        : h("span", { class: "cena__tituloglifo", text: d.tipo === "mais" ? "…" : "▦" });

  return h(
    "div",
    { class: `cena__titulo${d.tipo === "geral" ? " cena__titulo--geral" : ""}` },
    h(
      "div",
      { class: "cena__tituloalvo" },
      marca,
      h("span", { class: "cena__titulonome", text: d.nome }),
      h("span", { class: "cena__titulomarca", text: rotuloDoEscopo(d) })
    ),
    d.tipo === "geral" ? filtros() : null
  );
}

// A frase curta que diz o que aquela visualização é. Na geral, que ela é a
// única em que o filtro se escolhe; nas outras, que o filtro já veio pronto.
function rotuloDoEscopo(d) {
  if (d.tipo === "geral") return "o filtro se escolhe aqui";
  if (d.tipo === "mais") return `${d.abertas} fora do trilho`;
  const quem = d.tipo === "empresa" ? "empresa" : "responsável";
  return d.abertas ? `${quem} · ${d.abertas} em aberto` : `${quem} · nada aberto`;
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

// O quanto a pilha acompanha a mão. Abaixo de um, de propósito: o resto do
// caminho é feito pelo assentamento, que é onde mora a curva com peso. Ver o
// comentário longo em aoMover.
const ARRASTO_ACOMPANHA = 0.58;

// Como a faixa que sobra de cada lado é repartida entre as camadas de trás.
//
// O primeiro vizinho fica com a maior fatia porque é o que se quer ler; os de
// trás aparecem como abas cada vez mais estreitas, e é isso que faz a pilha
// parecer uma pilha em vez de uma mancha. Sem repartir, cada camada some
// inteira atrás da anterior — que foi o defeito da primeira tentativa.
const FATIAS = [0.62, 0.24, 0.14];

function medidas() {
  if (!trilhoEl) return null;
  const largura = trilhoEl.clientWidth;
  const cenaW = cenasEl[0]?.offsetWidth || 0;
  if (!largura || !cenaW) return null;
  return { largura, cenaW, espia: Math.max(0, (largura - cenaW) / 2 - 6) };
}

function escalaEm(k) {
  return 1 - 0.14 * Math.min(k, 1) - 0.07 * Math.max(0, k - 1);
}

// Onde termina o painel a distância k, medido do centro. Cada camada avança a
// sua fatia da faixa, e k fracionário avança a fatia proporcionalmente — é o
// que mantém o leque abrindo e fechando sem degraus durante o arrasto.
function bordaEm(k, m) {
  let acum = 0;
  const inteiro = Math.floor(k);
  for (let i = 0; i < inteiro && i < FATIAS.length; i++) acum += FATIAS[i] * m.espia;
  if (inteiro < FATIAS.length) acum += (k - inteiro) * FATIAS[inteiro] * m.espia;
  return m.cenaW / 2 + acum;
}

// A posição sai da borda que se quer ver, e não do quanto o painel deveria
// andar. Deslocá-lo por "meia tela" o joga para fora da janela, e o que sobra
// à vista é o meio dele: uma faixa sem canto, sem borda e sem forma.
function posicaoEm(k, m) {
  return Math.max(0, bordaEm(k, m) - (m.cenaW * escalaEm(k)) / 2);
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

    // Tudo sai da mesma conta, para todas as cenas: não existe mais um painel
    // com regra própria. Era a regra própria que produzia o estalo de formato
    // — dois elementos de tamanhos diferentes trocando de papel no meio do
    // caminho. Agora só muda a escala, e escala interpola sozinha.
    const x = sinal * posicaoEm(k, m);
    const escala = escalaEm(k);
    const opacidade = entre(k, 1, perto, longe);

    el.style.transform = `translate(-50%, 0) translateX(${x.toFixed(2)}px) scale(${escala.toFixed(4)})`;
    el.style.opacity = opacidade.toFixed(3);

    // O vizinho imediato sempre por cima dos mais distantes daquele lado: sem
    // isto a pilha vira uma mancha em que não se distingue o que vem antes.
    el.style.zIndex = String(Math.round(100 - k * 10));
    // Painel encoberto não recebe cursor: o convite de entrar só pode abrir em
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

// Chamada por app.js logo depois do mount(), de forma síncrona.
//
// Isto era um requestAnimationFrame, e o quadro de atraso era visível: entre
// o mount() e o quadro seguinte, as cenas ficavam no documento SEM transform
// nenhum — todas empilhadas na âncora de left:50%, fora de lugar. Como o
// mount() acontece a cada movimento de cartão e a cada tique de seis segundos,
// isso aparecia como um tremor na tela inteira toda vez que alguém arrastava
// um ticket de coluna.
//
// Síncrono, o navegador nunca chega a pintar o estado intermediário: o DOM
// entra e sai posicionado no mesmo turno.
export function posicionarTrilho() {
  const el = document.querySelector(".trilho");
  if (!el?.isConnected) {
    trilhoEl = null;
    return;
  }

  ligar(el);
  // A posição vem da identidade da cena, nunca de um pixel guardado: o nó
  // anterior foi destruído, e um índice sozinho muda de significado quando a
  // fileira muda de composição.
  posicao = Math.max(0, ids.indexOf(state.carrossel.atual));
  // Sem animação: isto é reposicionamento por remonte, não movimento que
  // alguém pediu. A classe sai no quadro seguinte, quando a posição já está
  // escrita e não há mais o que interpolar.
  el.classList.add("is-mudo");
  aplicarLayout();
  requestAnimationFrame(() => el.classList.remove("is-mudo"));
  observarTamanho(el);
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
    trilhoEl.classList.add("is-mudo");
    aplicarLayout();
    requestAnimationFrame(() => trilhoEl?.classList.remove("is-mudo"));
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
  if (!m) return;

  const passo = passoDoGesto(m);
  if (!passo) return;

  // A pilha acompanha a mão com resistência, e não um para um.
  //
  // Um para um parecia o certo e era a causa do movimento seco: a mão levava a
  // pilha até quase o destino, e ao soltar sobravam poucos pixels para o
  // assentamento percorrer — a transição rodava inteira, os 420 ms
  // completos, mas sobre um trecho tão curto que não dava para ver. O que se
  // via era um encaixe.
  //
  // Com resistência, a mão faz pouco mais da metade do caminho e o resto é
  // feito ao soltar, com a curva que passa do destino e volta. É o mesmo peso
  // que uma porta pesada tem: ela acompanha o empurrão e termina de fechar
  // sozinha.
  const cru = gesto.posicao0 - (dx / passo) * ARRASTO_ACOMPANHA;

  // Velocidade média, e não instantânea: dois eventos de ponteiro separados por
  // um milissegundo dão uma velocidade absurda, e era ela que atirava a pilha
  // para longe. A média de três quartos com um quarto absorve o pico sem
  // atrasar o reconhecimento de um movimento de verdade.
  const agora = performance.now();
  const dt = Math.max(8, agora - (gesto.instante || agora - 16));
  const bruta = (cru - posicao) / dt;
  gesto.velocidade = (gesto.velocidade || 0) * 0.75 + bruta * 0.25;
  gesto.instante = agora;
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
  const velocidade = gesto?.velocidade || 0;
  soltarOuvintes();
  if (!arrastou || !trilhoEl) return;
  trilhoEl.classList.remove("is-arrastando");
  // Depois do clique sintético que o navegador dispara no pointerup. É isto
  // que impede um arrasto terminado em cima de um painel de abrir o convite
  // dele sem ninguém ter pedido.
  setTimeout(() => {
    arrastouAgora = false;
  }, 0);
  assentar(velocidade);
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

// A distância que a pilha percorre para avançar uma cena. É a mesma que o
// layout usa, então o painel anda junto com a mão.
function passoDoGesto(m) {
  return Math.max(60, posicaoEm(1, m));
}


function maisProxima() {
  if (!cenasEl.length) return -1;
  return Math.max(0, Math.min(cenasEl.length - 1, Math.round(posicao)));
}

// Para onde a pilha assenta ao soltar. Parada, vai para o vizinho mais
// próximo; com impulso, completa a cena na direção do movimento.
//
// O impulso avança no máximo UMA cena além de onde a mão parou. Sem esse
// limite, um movimento curto e rápido — que dá uma velocidade instantânea
// altíssima, porque o intervalo entre dois eventos de ponteiro é de poucos
// milissegundos — atirava a pilha para o fim da fileira, como se alguém
// tivesse dado um empurrão que ninguém deu.
function destinoAoSoltar(velocidade) {
  const teto = cenasEl.length - 1;
  const base = Math.round(posicao);
  // O limiar é calibrado em cenas por milissegundo: 0,0038 equivale a
  // atravessar uma cena em pouco mais de 260 ms, que é rápido para uma mão e
  // lento para um tremor. Abaixo disso o movimento foi deliberado, e quem
  // decide é a posição em que a mão parou.
  const forte = Math.abs(velocidade || 0) > 0.0038;
  const alvo = forte
    ? velocidade > 0
      ? Math.ceil(posicao)
      : Math.floor(posicao)
    : base;
  const umaSo = Math.max(base - 1, Math.min(base + 1, alvo));
  return Math.max(0, Math.min(teto, umaSo));
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

function assentar(velocidade = 0) {
  if (!cenasEl.length) return;
  const i = destinoAoSoltar(velocidade);
  deslizarAte(i, () => concluirNavegacao(ids[i]));
}

// A duração vem do CSS e é lida a cada movimento, nunca cacheada: é assim que
// o modo calmo, ligado no meio da sessão, passa a valer sem recarregar.
//
// O trilho tem token próprio, --dur-trilho, e não usa --dur-slow. Ele não é
// enfeite: é o deslocamento que responde a um gesto, e responder rápido demais
// dá a sensação de a tela ter pulado em vez de andado. O modo calmo zera; o
// movimento reduzido do sistema encurta e tira o balanço, que é a parte que
// incomoda quem pediu menos movimento. Nunca crave milissegundos aqui.
function duracaoDoMovimento() {
  if (document.documentElement.dataset.calm === "1") return 0;
  const v = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--dur-trilho")
  );
  return Number.isFinite(v) ? v : 420;
}

// O assentamento é feito pela transição do CSS, e não quadro a quadro por
// JavaScript.
//
// Escrever o transform a cada quadro COM a transição ligada é o pior dos dois
// mundos: cada escrita vira uma transição nova, o navegador reinterpola do
// meio do caminho e o resultado chega seco e atrasado, por mais correta que
// seja a curva. Aqui a posição final é escrita uma vez e o navegador interpola
// sozinho, na placa de vídeo, com a curva de --ease-trilho — que passa um triz
// além do destino e volta, dando o peso que uma curva de só desacelerar não
// tem.
//
// Durante o arrasto é o contrário: a transição fica desligada e o transform
// vem de JavaScript, porque ali o painel tem de acompanhar a mão sem atraso.
function deslizarAte(destino, aoChegar) {
  cancelarTween();

  const ms = duracaoDoMovimento();
  if (!ms || !trilhoEl?.isConnected) {
    posicao = destino;
    aplicarLayout();
    aoChegar?.();
    return;
  }

  // A classe de arrasto já saiu; este reflow é o que separa os dois estados
  // para o navegador. Sem ele, remover a classe e escrever a posição no mesmo
  // quadro conta como um estado só, e não há transição nenhuma para animar.
  void trilhoEl.offsetHeight;

  posicao = destino;
  aplicarLayout();
  ocupadoDesde = Date.now();

  // Uma folga sobre a duração: o fim da transição não precisa ser ao
  // milissegundo, e concluir antes dela deixaria o mount() cortar o movimento
  // pela metade.
  tween = setTimeout(() => {
    tween = 0;
    aoChegar?.();
  }, ms + 40);
}

function cancelarTween() {
  if (!tween) return;
  clearTimeout(tween);
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
