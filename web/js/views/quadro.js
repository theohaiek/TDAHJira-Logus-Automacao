// Quadro — um trilho de cenas, e em cada cena as cinco colunas.
//
// Cinco estados, não mais. Cada estado adicional é uma decisão a mais a cada
// movimento de cartão, e a soma dessas decisões é o que torna um quadro de
// Jira exaustivo de manter.
//
// A tela deixou de ser um quadro só. É uma fileira horizontal: as empresas à
// esquerda, as pessoas à direita, "todos os negócios" sempre no centro. Só a
// cena central é um quadro de verdade; as vizinhas são lâminas de uns cem
// pixels coladas na borda, com a marca de quem elas são. Arrastar o fundo
// desliza a fileira, e ao soltar ela assenta na cena mais próxima — o item
// selecionado abre, os vizinhos ficam como ícone.

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
import { mesclarTarefa, emit } from "../store.js";
import { erro, comemorar } from "../toast.js";
import { criarRapida } from "../quickadd.js";

// --- Estado do trilho -------------------------------------------------------
//
// Fora do DOM e fora de state, de propósito. mount() destrói #view inteiro a
// cada emit() e a cada tique de seis segundos: nada que viva como propriedade
// de um nó antigo sobrevive. E nada disto é dado de produto — é a mecânica de
// um gesto, que não tem por que atravessar o resto do aplicativo.
let trilhoEl = null;
let centros = [];
let ids = [];
let escopoVisivel = "geral";
let gesto = null;
let tween = 0;
let ocupadoDesde = 0;
let arrastouAgora = false;
let ocioso = 0;
let rafScroll = 0;
let observador = null;
// Escrever scrollLeft dispara o evento scroll, e o evento scroll conclui a
// navegação, e concluir a navegação chama emit(), e emit() remonta a view, e
// remontar reposiciona o trilho escrevendo scrollLeft. Sem este contador o
// laço não tem fim: a tela remonta a cada 120 ms para sempre.
let programatico = 0;

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
    fileira.map((d) => (d.id === atual ? cenaCheia(d) : lamina(d)))
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

// A lâmina não é um <button> na raiz de propósito: um <button> cairia no
// bail-out do gesto e mataria qualquer arrasto que começasse em cima dela.
// A acessibilidade vem do papel, do tabindex e do teclado logo abaixo.
function lamina(d) {
  const marca =
    d.tipo === "empresa"
      ? fotoEmpresa(d.ref, 40)
      : d.tipo === "pessoa"
        ? avatar(d.ref, "avatar--lg")
        : h("span", { class: "cena__glifo", text: d.tipo === "mais" ? "…" : "▦" });

  const borda = d.lado === "esq" ? "borderInlineEndColor" : "borderInlineStartColor";

  return h(
    "div",
    {
      class: `cena cena--resumo cena--${d.lado === "esq" ? "esq" : "dir"}`,
      dataset: { escopo: d.id },
      role: "button",
      tabindex: "0",
      "aria-label": `Ver o quadro de ${d.nome}, ${contagemDe(d)}`,
      style: { [borda]: d.cor || "var(--border-strong)" },
      onClick: () => {
        // Um arrasto que termina em cima de uma lâmina não pode navegar para
        // ela: ninguém pediu isso, e o clique sintético do navegador chega
        // logo depois do pointerup.
        if (arrastouAgora) return;
        irParaCena(d.id);
      },
      onKeydown: (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        irParaCena(d.id);
      },
    },
    h("div", { class: "cena__marca" }, marca, h("span", { class: "cena__conta", text: String(d.abertas) })),
    h("span", { class: "cena__agua", text: d.nome })
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
    medirCentros();
    // Reposicionamento por remonte não é movimento que alguém pediu: vai
    // instantâneo, nunca com smooth.
    aplicarPosicao(id);
    observarTamanho(el);
  });
}

function ligar(el) {
  trilhoEl = el;
  el.addEventListener("pointerdown", aoApertar);
  el.addEventListener("scroll", aoRolar, { passive: true });
  el.addEventListener("dragstart", (e) => {
    if (gesto?.arrastando) e.preventDefault();
  });
}

function observarTamanho(el) {
  observador?.disconnect();
  if (typeof ResizeObserver !== "function") return;
  // Sem isto, redimensionar a janela deixa a fileira torta: os centros foram
  // medidos numa largura que já não existe.
  observador = new ResizeObserver(() => {
    if (!trilhoEl?.isConnected) return;
    medirCentros();
    if (!gesto && !tween) aplicarPosicao(escopoVisivel);
  });
  observador.observe(el);
}

function medirCentros() {
  if (!trilhoEl) return;
  const cenas = Array.from(trilhoEl.querySelectorAll(".cena"));
  const base = trilhoEl.getBoundingClientRect().left - trilhoEl.scrollLeft;
  centros = cenas.map((el) => {
    const r = el.getBoundingClientRect();
    return r.left - base + r.width / 2;
  });
  ids = cenas.map((el) => el.dataset.escopo);
}

function aplicarPosicao(id) {
  const i = ids.indexOf(id);
  if (i < 0 || !trilhoEl) return;
  semSnap(() => {
    trilhoEl.scrollLeft = centros[i] - trilhoEl.clientWidth / 2;
  });
  marcarDistancias(i);
}

// scroll-snap-type: x mandatory briga com escrita direta de scrollLeft — o
// motor de snap puxa de volta. Desligar, escrever, religar no quadro seguinte.
//
// O inline volta sempre para vazio, e nunca para "o que estava antes": duas
// chamadas sobrepostas — o reposicionamento pós-monte e o ResizeObserver, por
// exemplo — fariam a segunda gravar "none" como valor original e o snap ficaria
// desligado para o resto da sessão, sem erro nenhum.
function semSnap(fn) {
  if (!trilhoEl) return;
  programatico += 1;
  trilhoEl.style.scrollSnapType = "none";
  fn();
  requestAnimationFrame(() => {
    programatico = Math.max(0, programatico - 1);
    if (trilhoEl?.isConnected) trilhoEl.style.scrollSnapType = "";
  });
}

function marcarDistancias(i) {
  if (!trilhoEl) return;
  Array.from(trilhoEl.querySelectorAll(".cena")).forEach((el, j) => {
    if (j === i) return el.removeAttribute("data-dist");
    el.dataset.dist = Math.abs(j - i) >= 2 ? "2" : "1";
  });
}

// --- O gesto ----------------------------------------------------------------

function aoApertar(e) {
  // Só mouse. No toque quem navega é o scroll nativo com snap e os pontos —
  // sem isso o gesto disputaria com o .board, que abaixo de 900px já rola
  // sozinho a 82vw.
  if (e.pointerType !== "mouse" || e.button !== 0) return;

  // Sem este bail-out, o dragstart HTML5 do cartão é cancelado em silêncio e
  // arrastar cartão entre colunas para de funcionar, sem um erro sequer no
  // console — e o frontend não tem suíte de comportamento para pegar isso.
  if (e.target.closest(".task, button, a, input, textarea, select, [contenteditable]")) return;

  gesto = {
    x0: e.clientX,
    y0: e.clientY,
    scroll0: trilhoEl.scrollLeft,
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
  }

  // Um para um com o cursor. Sem inércia, sem mola, sem física.
  trilhoEl.scrollLeft = gesto.scroll0 - dx;
  arrastouAgora = true;
  // Renovada a cada movimento: a trava de cinco segundos é de inatividade.
  // Gravada uma vez só, um arrasto longo expiraria no meio — o mount()
  // destruiria o trilho, os ouvintes de window continuariam escrevendo
  // scrollLeft num elemento fora do documento, e a fileira saltaria.
  ocupadoDesde = Date.now();
  e.preventDefault();
}

function aoSoltar() {
  const arrastou = !!gesto?.arrastando;
  soltarOuvintes();
  if (!arrastou || !trilhoEl) return;
  trilhoEl.classList.remove("is-arrastando");
  // Depois do clique sintético que o navegador dispara no pointerup. É isto
  // que impede um arrasto terminado em cima de uma lâmina de navegar para ela.
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

function assentar() {
  const i = maisProxima();
  if (i < 0 || !trilhoEl) return;
  deslizarPara(centros[i] - trilhoEl.clientWidth / 2, () => concluirNavegacao(ids[i]));
}

function maisProxima() {
  if (!trilhoEl || !centros.length) return -1;
  const alvo = trilhoEl.scrollLeft + trilhoEl.clientWidth / 2;
  let melhor = -1;
  let dist = Infinity;
  centros.forEach((c, i) => {
    const d = Math.abs(c - alvo);
    if (d < dist) {
      dist = d;
      melhor = i;
    }
  });
  return melhor;
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

function deslizarPara(destino, aoChegar) {
  if (!trilhoEl) return;
  cancelarTween();

  const ms = duracaoDoMovimento();
  const inicio = trilhoEl.scrollLeft;
  const delta = destino - inicio;

  if (!ms || Math.abs(delta) < 1) {
    semSnap(() => {
      trilhoEl.scrollLeft = destino;
    });
    aoChegar?.();
    return;
  }

  trilhoEl.classList.add("is-assentando");
  const inicioEm = performance.now();
  const passo = (agora) => {
    if (!trilhoEl?.isConnected) {
      tween = 0;
      return;
    }
    const p = Math.min(1, (agora - inicioEm) / ms);
    trilhoEl.scrollLeft = inicio + delta * (1 - (1 - p) ** 3);
    ocupadoDesde = Date.now();
    if (p < 1) {
      tween = requestAnimationFrame(passo);
      return;
    }
    tween = 0;
    trilhoEl.classList.remove("is-assentando");
    aoChegar?.();
  };
  tween = requestAnimationFrame(passo);
}

function cancelarTween() {
  if (!tween) return;
  cancelAnimationFrame(tween);
  tween = 0;
  trilhoEl?.classList.remove("is-assentando");
}

// Roda, trackpad, barra de rolagem e toque não passam pelo gesto de mouse:
// eles rolam o trilho direto. Aqui a cena que chegou ao centro é trocada ao
// vivo, e um timer curto conclui a navegação quando o movimento para.
function aoRolar() {
  // Scroll que nós mesmos causamos não é navegação de ninguém: é o
  // reposicionamento por remonte, ou o próprio tween, que já sabe como
  // terminar. Tratá-lo como gesto fecha o laço descrito lá em cima.
  if (programatico || tween) return;
  if (rafScroll) return;
  rafScroll = requestAnimationFrame(() => {
    rafScroll = 0;
    if (!trilhoEl?.isConnected) return;

    const i = maisProxima();
    const id = ids[i];
    if (id && id !== escopoVisivel) {
      escopoVisivel = id;
      trocarAoVivo(i, id);
    }

    clearTimeout(ocioso);
    ocioso = setTimeout(() => {
      if (gesto?.arrastando || tween) return;
      concluirNavegacao(escopoVisivel);
    }, 120);
  });
}

// Transição CSS não roda em nó recém-criado. A classe é trocada no nó vivo
// durante o gesto — é isso que faz a cena crescer enquanto se arrasta; o
// render posterior apenas reaplica o valor final.
function trocarAoVivo(i, id) {
  if (!trilhoEl) return;
  for (const el of trilhoEl.querySelectorAll(".cena")) {
    el.classList.toggle("is-atual", el.dataset.escopo === id);
  }
  marcarDistancias(i);

  const rotulo = document.querySelector(".trilho__rotulo");
  if (rotulo) rotulo.textContent = rotuloDaCena(escoposDoCarrossel(), id);

  for (const p of document.querySelectorAll(".trilho__ponto")) {
    const ligado = p.dataset.escopo === id;
    p.classList.toggle("is-on", ligado);
    p.setAttribute("aria-current", ligado ? "true" : "false");
  }
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
