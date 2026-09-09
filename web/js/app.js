// Montagem da aplicação: entrada, navegação, atalhos e o laço de desenho.

import { h, mount, $, initials, fotoEmpresa } from "./dom.js";
import { api } from "./api.js";
import {
  state,
  carregar,
  subscribe,
  emit,
  iniciarSync,
  visiveis,
  agora,
  entrada,
  esperando,
  salvarPrefs,
  cenaValida,
} from "./store.js";
import { viewHoje } from "./views/hoje.js";
import {
  viewQuadro,
  irParaCena,
  voltarAoCentro,
  andarCena,
  carrosselOcupado,
  posicionarTrilho,
} from "./views/quadro.js";
import { viewPlanilha } from "./views/planilha.js";
import { viewFluxo } from "./views/fluxo.js";
import { fecharTicket, ticketAberto, rerenderTicket } from "./ticket.js";
import { abrirFoco, fecharFoco, focoAtivo } from "./focus.js";
import { abrirPaleta, fecharPaleta, paletaAberta, iniciarPaleta } from "./palette.js";
import { criarDoTexto } from "./quickadd.js";
import { parseCaptura, dicas } from "./capture.js";
import { abrirHoje, abrirHojeSePrimeiraVezNoDia, redesenharHoje, popupAberto } from "./popup.js";
import { toast, erro } from "./toast.js";
import { pedir } from "./dialog.js";

// O Hoje não está aqui, e é de propósito. Ele não é uma tela: é a pergunta
// "o que eu faço agora" chegando por cima do quadro e saindo do caminho
// depois. Enquanto ele figurava nesta lista, aparecia na barra lateral como
// mais uma seção para onde se navega — que é exatamente o que ele deixou de
// ser. Agora ele é uma ação, com botão próprio acima da navegação.
const VIEWS = {
  quadro: { titulo: "Quadro", icone: "▦", render: viewQuadro },
  planilha: { titulo: "Planilha", icone: "▤", render: viewPlanilha },
  fluxo: { titulo: "Fluxo", icone: "◈", render: viewFluxo },
};

// --- Início -----------------------------------------------------------------

async function iniciar() {
  aplicarTemaSalvo();

  const boot = await api.boot().catch(() => ({ authenticated: false }));
  if (boot.limits) state.limits = boot.limits;
  if (!boot.authenticated) return telaLogin();

  await entrar();
}

async function entrar() {
  // A troca de tela vem depois da carga, e não antes: se o GET /api/state
  // falhar (partida fria estourando o tempo, um 500), quem acabou de entrar
  // ficaria olhando a moldura vazia enquanto a mensagem de erro é escrita
  // dentro do #login já escondido. Assim o erro aparece onde dá para ler.
  await carregar();
  $("#login").hidden = true;
  $("#app").hidden = false;

  aplicarPrefs();

  subscribe(desenhar);
  iniciarSync();
  iniciarPaleta();
  ligarCaptura();
  ligarAtalhos();
  ligarBotoes();

  rota();
  window.addEventListener("hashchange", rota);
  // Sem guarda de view: o Hoje não é mais uma tela, então não existe mais o
  // caso de "já estou lendo isso, não abra por cima". Quem entrou por #/hoje
  // já teve o popup aberto pela rota() acima, e abrir de novo só remonta o
  // conteúdo do <dialog> que já está de pé.
  abrirHojeSePrimeiraVezNoDia();
  document.addEventListener("focusout", () => {
    setTimeout(() => {
      if (redesenhoAdiado && !editandoNaView()) desenhar();
    }, 0);
  });
  desenhar();
}

function telaLogin() {
  $("#app").hidden = true;
  const tela = $("#login");
  tela.hidden = false;

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const erroEl = $("#login-error");
    erroEl.hidden = true;
    try {
      const r = await api.login($("#login-user").value, $("#login-pass").value);
      await entrar();
      if (r.mustChangePassword) {
        toast(
          "Você ainda está com a senha inicial. Vale trocar: clique no seu nome, no canto inferior esquerdo.",
          { ms: 8000 }
        );
      }
    } catch (err) {
      erroEl.textContent = err.message;
      erroEl.hidden = false;
      $("#login-pass").select();
    }
  });
}

// --- Navegação --------------------------------------------------------------

function rota() {
  // O quadro é onde o trabalho acontece, e é o que faz sentido ver ao chegar.
  const partes = (location.hash.replace(/^#\/?/, "") || "quadro").split("/");

  // O Hoje é tratado antes de tudo, e por endereço, não por estar em VIEWS:
  // ele não é uma tela, é a pergunta "o que eu faço agora" chegando por cima
  // do quadro e saindo do caminho depois. Tratar aqui, e não em cada botão,
  // é o que garante que todos os caminhos até ele — o botão da barra lateral,
  // o atalho 1, a paleta, o link Entrada, o logotipo e a URL digitada à mão —
  // se comportem igual. Tratar um por um seria esquecer um.
  if (partes[0] === "hoje") {
    abrirHoje();
    // replaceState, e não location.hash: trocar o hash aqui dispararia esta
    // mesma função de novo e empilharia uma entrada de histórico por abertura.
    history.replaceState(null, "", "#/quadro");
    partes[0] = "quadro";
  }

  state.view = VIEWS[partes[0]] ? partes[0] : "quadro";

  // Os segmentos 2 e 3 só valem para o quadro, e é onde mora a cena do trilho.
  // Antes desta versão, .split("/")[0] descartava em silêncio tudo depois da
  // primeira barra: escrever a cena no hash *parecia* funcionar — a barra de
  // endereços mudava — e não restaurava nada ao recarregar.
  if (state.view === "quadro") {
    const cena = partes[1] ? `${partes[1]}:${partes[2] || ""}` : "geral";
    const valida = cenaValida(cena);
    state.carrossel.atual = valida;
    // Id que não resolve cai no geral e corrige o endereço, em vez de deixar
    // a barra apontando para uma cena que não existe.
    if (valida === "geral" && partes[1]) history.replaceState(null, "", "#/quadro");
  }

  desenhar();
  $("#view")?.scrollTo({ top: 0 });
}

export function irPara(view) {
  location.hash = `#/${view}`;
}

// --- Desenho ----------------------------------------------------------------

let pendente = false;

function desenhar() {
  // Agrupa várias mudanças no mesmo quadro de vídeo.
  if (pendente) return;
  pendente = true;
  requestAnimationFrame(() => {
    pendente = false;
    desenharAgora();
  });
}

// Mesmo acordo do painel do ticket (ticket.js): a sincronização de 6s não
// pode apagar o que alguém está escrevendo. O redesenho fica represado
// enquanto houver campo em foco, e sai assim que o foco solta.
let redesenhoAdiado = false;

function editandoNaView() {
  const ativo = document.activeElement;
  const alvo = $("#view");
  if (!ativo || !alvo || !alvo.contains(ativo)) return false;
  return ativo.matches("input, textarea, [contenteditable]");
}

function desenharAgora() {
  if (!state.carregado) return;

  // O mesmo mecanismo que protege o campo em foco protege o gesto do trilho:
  // remontar #view no meio de um arrasto destrói o elemento que está sendo
  // arrastado. Estender o represamento que já existe, e não criar um segundo.
  if (editandoNaView() || carrosselOcupado()) {
    redesenhoAdiado = true;
    return;
  }
  redesenhoAdiado = false;

  desenharNav();
  desenharProjetos();
  desenharEmpresas();
  desenharUsuario();

  const view = VIEWS[state.view] || VIEWS.hoje;
  document.title = `${view.titulo} · TDAH Jira — Logus`;

  const alvo = $("#view");
  const rolagem = alvo.scrollTop;
  mount(alvo, view.render());
  alvo.scrollTop = rolagem;

  // O trilho se posiciona AQUI, no mesmo turno do mount e antes de o navegador
  // pintar. Num requestAnimationFrame, como era antes, sobrava um quadro em
  // que as cenas estavam no documento sem transform — todas empilhadas fora de
  // lugar. Como este mount roda a cada movimento de cartão, isso aparecia como
  // um tremor na tela inteira. É a única view que precisa disto, e é por ela
  // ser a única cujo layout mora em JavaScript.
  if (state.view === "quadro") posicionarTrilho();

  if (ticketAberto()) rerenderTicket();
  // A lista do dia muda enquanto se lê. Sem isto, o popup congela no instante
  // em que abriu e mostra tarefa que já saiu da fila.
  redesenharHoje();
}

function desenharNav() {
  const contagens = {
    quadro: visiveis().filter((t) => t.status !== "done").length,
    planilha: visiveis().length,
    fluxo: visiveis().filter((t) => t.status !== "done").length,
  };
  // O Hoje não está nesta lista nem em nenhuma: ele é uma ação da barra de
  // cima. Aqui ficam as telas para onde se navega, e ele não é uma delas.
  $("#hoje-conta").textContent = String(agora(99).length + esperando().length || "");

  mount(
    $("#nav"),
    Object.entries(VIEWS).map(([chave, v]) =>
      h(
        "a",
        {
          class: `navitem${state.view === chave ? " is-active" : ""}`,
          href: `#/${chave}`,
          onClick: () => $("#rail").classList.remove("is-open"),
        },
        h("span", { class: "navitem__icon", text: v.icone }),
        h("span", { text: v.titulo }),
        h("span", { class: "navitem__count", text: String(contagens[chave] || "") })
      )
    ),

    entrada().length
      ? h(
          "a",
          { class: "navitem", href: "#/hoje" },
          h("span", { class: "navitem__icon", text: "↓" }),
          h("span", { text: "Entrada" }),
          h("span", { class: "navitem__count", text: String(entrada().length) })
        )
      : null
  );
}

function desenharProjetos() {
  mount(
    $("#project-list"),
    h(
      "button",
      {
        class: `projitem${!state.filtroProjeto ? " is-active" : ""}`,
        onClick: () => {
          state.filtroProjeto = null;
          emit();
        },
      },
      h("span", { class: "dot", style: { color: "var(--text-faint)" } }),
      h("span", { class: "truncate", text: "Todos" })
    ),
    state.projects.map((p) =>
      h(
        "button",
        {
          class: `projitem${state.filtroProjeto === p.id ? " is-active" : ""}`,
          onClick: () => {
            state.filtroProjeto = state.filtroProjeto === p.id ? null : p.id;
            emit();
          },
        },
        h("span", { class: "dot", style: { color: p.color } }),
        h("span", { class: "truncate", text: p.name }),
        h("span", { class: "projitem__key", text: p.key })
      )
    )
  );
}

// A lista de empresas da barra lateral, no mesmo formato da de projetos.
//
// A contagem é de tarefas abertas, e não de todas: o número que interessa
// olhando para um cliente é o quanto ainda falta fazer para ele, não o
// histórico. Ordem alfabética, a mesma do trilho — contagem decide quem
// aparece em destaque, nunca onde a linha fica, senão a lista se reorganiza
// sozinha quando alguém conclui uma tarefa.
function desenharEmpresas() {
  const abertas = visiveis().filter((t) => t.status !== "done");
  const conta = new Map();
  for (const t of abertas) {
    if (t.companyId) conta.set(t.companyId, (conta.get(t.companyId) || 0) + 1);
  }

  const lista = [...state.companies].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  mount(
    $("#company-list"),
    lista.length
      ? lista.map((c) => linhaEmpresa(c, conta.get(c.id) || 0))
      : h("p", {
          class: "rail__vazio",
          text: "Nenhuma ainda. O + cadastra a primeira.",
        })
  );
}

function linhaEmpresa(c, abertas) {
  return h(
    "div",
    { class: "empitem" },
    h(
      "button",
      {
        class: "empitem__ir",
        title: `Ver o quadro de ${c.name}`,
        onClick: () => {
          $("#rail").classList.remove("is-open");
          // Leva à cena dela no trilho, e não ao filtro do cabeçalho: são
          // dois mecanismos para a mesma pergunta, e o trilho é o que a
          // barra lateral consegue endereçar sem ambiguidade.
          if (state.view !== "quadro") irPara("quadro");
          irParaCena(`empresa:${c.id}`);
        },
      },
      fotoEmpresa(c, 56),
      h(
        "span",
        { class: "empitem__texto" },
        h("span", { class: "empitem__nome truncate", text: c.name }),
        h("span", {
          class: "empitem__conta",
          text: abertas ? `${abertas} aberta${abertas > 1 ? "s" : ""}` : "nada aberto",
        })
      )
    ),
    h("button", {
      class: "empitem__cfg",
      text: "⋯",
      title: `Configurar ${c.name}`,
      "aria-label": `Configurar ${c.name}`,
      onClick: () => configurarEmpresa(c),
    })
  );
}

function desenharUsuario() {
  const me = state.me;
  if (!me) return;
  const av = $("#user-avatar");
  av.textContent = initials(me.name);
  av.style.background = me.color;
  $("#user-name").textContent = me.name;
}

// --- Captura ----------------------------------------------------------------

function ligarCaptura() {
  const campo = $("#capture");
  const dica = $("#capture-hint");

  campo.addEventListener("input", () => {
    const fichas = dicas(campo.value, state);
    if (!fichas.length) {
      dica.hidden = true;
      return;
    }
    mount(
      dica,
      fichas.map((f) =>
        h(
          "span",
          { class: "chip", style: f.cor ? { color: f.cor } : {} },
          f.tipo === "dica" ? f.texto : `${f.tipo}: ${f.texto}`
        )
      )
    );
    dica.hidden = false;
  });

  campo.addEventListener("blur", () => setTimeout(() => (dica.hidden = true), 150));

  campo.addEventListener("keydown", async (e) => {
    if (e.key === "Escape") {
      campo.value = "";
      campo.blur();
      dica.hidden = true;
      return;
    }
    if (e.key !== "Enter") return;

    const texto = campo.value.trim();
    if (!texto) return;

    let extra = {};
    try {
      extra = JSON.parse(campo.dataset.preset || "{}");
    } catch {}

    // Sem projeto explícito na frase, herda o projeto que está filtrado na
    // barra lateral: é quase sempre o que se quer, e poupa uma decisão.
    const { dados } = parseCaptura(texto, state);
    if (!dados.projectId && state.filtroProjeto) extra.projectId = state.filtroProjeto;

    campo.value = "";
    dica.hidden = true;
    delete campo.dataset.preset;
    campo.placeholder = "O que precisa ser feito?  (n)";

    await criarDoTexto(texto, extra);
  });
}

// --- Atalhos ----------------------------------------------------------------

function ligarAtalhos() {
  document.addEventListener("keydown", (e) => {
    const digitando =
      e.target.matches("input, textarea, select") || e.target.isContentEditable;

    // Ctrl+K funciona mesmo digitando.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      abrirPaleta();
      return;
    }

    if (e.key === "Escape") {
      if (paletaAberta()) return fecharPaleta();
      // O <dialog> nativo já fecha sozinho com Escape. Sem esta guarda, o
      // mesmo Escape fecharia também a camada de baixo: quem abre o Hoje por
      // cima de um ticket perderia os dois de uma vez.
      if (popupAberto()) return;
      if (focoAtivo()) return fecharFoco(false);
      if (ticketAberto()) return fecharTicket();
      // Última da cadeia: sem nada aberto por cima, Escape no quadro devolve
      // a cena central. É a saída de "me perdi numa lateral do trilho".
      if (state.view === "quadro" && state.carrossel.atual !== "geral") {
        return voltarAoCentro();
      }
      return;
    }

    if (digitando || e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.key) {
      case "n":
        e.preventDefault();
        $("#capture").focus();
        break;
      case "/":
        e.preventDefault();
        abrirPaleta();
        break;
      case "1":
        irPara("hoje");
        break;
      case "2":
        irPara("quadro");
        break;
      case "3":
        irPara("planilha");
        break;
      case "4":
        irPara("fluxo");
        break;
      case "f": {
        // Foco na primeira da fila: o caminho mais curto entre abrir o
        // aplicativo e estar trabalhando.
        const t = agora(1)[0];
        if (t) abrirFoco(t.id);
        break;
      }
      // Colchetes, e não as setas: ← e → continuam sendo exclusivamente do
      // cartão focado, que é como se move uma tarefa de coluna sem mouse.
      // No teclado ABNT2 os dois são tecla direta, ao lado do Enter.
      case "[":
        if (state.view === "quadro") {
          e.preventDefault();
          andarCena(-1);
        }
        break;
      case "]":
        if (state.view === "quadro") {
          e.preventDefault();
          andarCena(1);
        }
        break;
      case "?":
        mostrarAtalhos();
        break;
    }
  });
}

function mostrarAtalhos() {
  toast(
    "n nova · / buscar · f focar · 1–4 telas · [ ] cenas do quadro · Esc fecha · Ctrl+K comandos",
    { ms: 9000 }
  );
}

// --- Botões da moldura ------------------------------------------------------

function ligarBotoes() {
  // Passa por rota(), como todos os outros caminhos até o Hoje: um botão que
  // chamasse abrirHoje() direto seria o sétimo caminho, e o sétimo caminho é
  // sempre o que alguém esquece de atualizar depois.
  $("#hoje-btn").addEventListener("click", () => irPara("hoje"));

  $("#cmd-btn").addEventListener("click", () => abrirPaleta());

  $("#theme-btn").addEventListener("click", () => {
    const atual = document.documentElement.dataset.theme || "dark";
    const novo = atual === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = novo;
    localStorage.setItem("tdah-tema", novo);
    salvarPrefs({ tema: novo });
  });

  $("#calm-btn").addEventListener("click", () => {
    const ligado = document.documentElement.dataset.calm === "1";
    document.documentElement.dataset.calm = ligado ? "0" : "1";
    localStorage.setItem("tdah-calmo", ligado ? "0" : "1");
    salvarPrefs({ calmo: !ligado });
    toast(ligado ? "Modo calmo desligado." : "Modo calmo: menos brilho e menos movimento.");
  });

  $("#rail-toggle").addEventListener("click", () => {
    $("#rail").classList.toggle("is-open");
  });

  $("#new-project").addEventListener("click", async () => {
    const r = await pedir({
      titulo: "Novo projeto",
      descricao: "A sigla é gerada a partir do nome e aparece na chave das tarefas.",
      confirmar: "Criar",
      campos: [{ chave: "nome", rotulo: "Nome", dica: "Automações" }],
    });
    const nome = r?.nome;
    if (!nome?.trim()) return;
    try {
      const r = await api.createProject({ name: nome.trim() });
      state.projects.push(r.project);
      emit();
      toast(`Projeto ${r.project.key} criado.`);
    } catch (err) {
      erro(err.message);
    }
  });

  $("#new-company").addEventListener("click", async () => {
    const r = await pedir({
      titulo: "Nova empresa",
      descricao:
        "Para quem o trabalho é feito. O projeto continua dizendo de que área ele é.",
      confirmar: "Criar",
      campos: [{ chave: "nome", rotulo: "Nome", dica: "ACME Metalurgia" }],
    });
    const nome = r?.nome?.trim();
    if (!nome) return;
    try {
      const { company } = await api.createCompany({ name: nome });
      // O servidor devolve a que já existe quando o nome se repete.
      if (!state.companies.some((c) => c.id === company.id)) state.companies.push(company);
      emit();
      toast(`Empresa ${company.name} anotada. O ⋯ ao lado dela põe a foto.`);
    } catch (err) {
      erro(err.message);
    }
  });

  $("#user-btn").addEventListener("click", menuUsuario);

  // Fechar sobreposições clicando fora.
  for (const sel of ["#drawer", "#palette"]) {
    $(sel).addEventListener("click", (e) => {
      if (e.target.dataset.close !== undefined) {
        if (sel === "#drawer") fecharTicket();
        else fecharPaleta();
      }
    });
  }
}

// --- Empresa: configurar e reduzir a foto -----------------------------------

// A foto vai para dentro da própria linha da empresa, como data URI (ver
// docs/API.md). Isso põe um teto real de tamanho, e é o cliente que precisa
// respeitá-lo: o servidor recusa acima de 32 KB, e recusar depois de a pessoa
// ter escolhido o arquivo é o pior lugar para dizer não.
const FOTO_LADO = 96;
const FOTO_TETO = 24 * 1024;

async function reduzirFoto(arquivo) {
  const bitmap = await createImageBitmap(arquivo).catch(() => null);
  if (!bitmap) throw new Error("Não consegui ler esta imagem. Tente png, jpeg ou webp.");

  const lado = Math.min(bitmap.width, bitmap.height);

  // Onde cortar o quadrado. Logotipo de empresa costuma ser bem mais largo do
  // que alto, com o símbolo à esquerda e o nome escrito à direita; o corte
  // central pegaria o meio do lettering, que a 40 pixels não diz nada. Numa
  // imagem alongada, o começo é a aposta certa. Numa quase quadrada — uma foto,
  // um selo —, o centro continua sendo.
  const alongada = bitmap.width / bitmap.height > 1.8;
  const recorteX = alongada ? 0 : (bitmap.width - lado) / 2;
  const recorteY = (bitmap.height - lado) / 2;

  const tela = document.createElement("canvas");
  tela.width = FOTO_LADO;
  tela.height = FOTO_LADO;
  const ctx = tela.getContext("2d");
  // Logotipo costuma vir com fundo transparente, e transparência sobre o tema
  // escuro apaga o desenho. O branco por baixo é o que a marca espera ter.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, FOTO_LADO, FOTO_LADO);
  // Uma folga em volta, para o símbolo não encostar na borda do círculo.
  const folga = 6;
  ctx.drawImage(
    bitmap,
    recorteX,
    recorteY,
    lado,
    lado,
    folga,
    folga,
    FOTO_LADO - folga * 2,
    FOTO_LADO - folga * 2
  );
  bitmap.close?.();

  // Navegador que não conhece webp devolve PNG em silêncio, sem erro nenhum —
  // e PNG de fotografia não cabe no teto. Ler o prefixo é a única forma de
  // descobrir isso antes de o servidor recusar.
  let tipo = "image/webp";
  if (!tela.toDataURL(tipo, 0.82).startsWith("data:image/webp")) tipo = "image/jpeg";

  for (let q = 0.82; q >= 0.4; q -= 0.1) {
    const uri = tela.toDataURL(tipo, q);
    if (uri.length <= FOTO_TETO) return uri;
  }
  throw new Error(
    "Esta imagem não cabe em 24 KB nem na menor qualidade. Tente uma com menos detalhe."
  );
}

async function configurarEmpresa(company) {
  const r = await pedir({
    titulo: `Configurar ${company.name}`,
    descricao:
      "A foto aparece na barra lateral, no trilho do quadro e no cabeçalho de filtros. Ela é reduzida para 96 por 96 antes de subir.",
    confirmar: "Salvar",
    campos: [
      { chave: "nome", rotulo: "Nome", valor: company.name },
      { chave: "cor", rotulo: "Cor", tipo: "color", valor: company.color || "#c9b6f0" },
      {
        chave: "foto",
        rotulo: "Foto",
        tipo: "arquivo",
        accept: "image/*",
        valor: company.avatar,
        aoEscolher: reduzirFoto,
      },
    ],
  });
  if (!r) return;

  const nome = r.nome.trim();
  if (!nome) return;

  const mudanca = { name: nome, color: r.cor };
  // Só manda a foto quando ela mudou: enviar o mesmo data URI a cada salvamento
  // faria uma requisição de dezenas de KB para trocar uma letra do nome.
  if (r.foto !== (company.avatar ?? null)) mudanca.avatar = r.foto;

  try {
    const { company: nova } = await api.patchCompany(company.id, mudanca);
    const i = state.companies.findIndex((x) => x.id === nova.id);
    if (i >= 0) state.companies[i] = nova;
    emit();
    toast(`${nova.name} atualizada.`);
  } catch (err) {
    erro(err.message);
  }
}

async function menuUsuario() {
  const opcoes = [
    { rotulo: "Trocar a senha", acao: trocarSenha },
    { rotulo: "Quantas tarefas em andamento eu aguento", acao: ajustarWip },
    state.me?.role === "admin" && { rotulo: "Criar acesso para alguém", acao: criarPessoa },
    {
      rotulo: "Sair",
      acao: async () => {
        await api.logout();
        location.reload();
      },
    },
  ].filter(Boolean);

  mount(
    $("#palette-results"),
    h(
      "div",
      { style: { padding: "12px" } },
      h("p", {
        class: "tiny muted",
        style: { padding: "0 12px 8px" },
        text: state.me.name,
      }),
      opcoes.map((o) =>
        h("button", {
          class: "pres",
          text: o.rotulo,
          onClick: () => {
            $("#palette").hidden = true;
            o.acao();
          },
        })
      )
    )
  );
  const caixa = $("#palette");
  caixa.querySelector(".palette__input").hidden = true;
  caixa.hidden = false;
  caixa.querySelector(".pres")?.focus();
}

async function trocarSenha() {
  const r = await pedir({
    titulo: "Trocar a senha",
    descricao: "A senha nova vale a partir de agora, neste e nos outros aparelhos.",
    confirmar: "Trocar",
    campos: [
      {
        chave: "atual",
        rotulo: "Senha atual",
        tipo: "password",
        autocomplete: "current-password",
      },
      { chave: "nova", rotulo: "Senha nova", tipo: "password" },
    ],
  });
  if (!r) return;
  try {
    await api.changePassword(r.atual, r.nova);
    toast("Senha trocada.");
  } catch (err) {
    erro(err.message);
  }
}

// Criar acesso para outra pessoa. Só administrador enxerga esta opção.
async function criarPessoa() {
  const r = await pedir({
    titulo: "Criar acesso",
    descricao:
      "Deixe a senha em branco para o aplicativo sortear uma. Ela aparece uma única vez, logo depois de criar.",
    confirmar: "Criar",
    campos: [
      { chave: "nome", rotulo: "Nome", dica: "Como aparece nos cartões" },
      { chave: "username", rotulo: "Usuário", dica: "para entrar" },
      { chave: "senha", rotulo: "Senha", tipo: "password", dica: "opcional" },
    ],
  });
  if (!r?.nome?.trim() || !r?.username?.trim()) return;

  try {
    const resposta = await api.createUser({
      name: r.nome.trim(),
      username: r.username.trim(),
      senha: r.senha || undefined,
    });

    state.users.push(resposta.user);
    emit();

    // A senha só existe em texto neste instante. Depois disso, só o hash.
    toast(`${resposta.user.name} criada — senha: ${resposta.senhaInicial}`, { ms: 30000 });
  } catch (err) {
    erro(err.message);
  }
}

async function ajustarWip() {
  const r = await pedir({
    titulo: "Trabalho em andamento",
    descricao:
      "Quantas tarefas você consegue tocar ao mesmo tempo sem se perder? O aplicativo apenas avisa quando passa disso — nunca impede.",
    confirmar: "Salvar",
    campos: [
      { chave: "wip", rotulo: "Tarefas simultâneas", tipo: "number", valor: String(state.prefs.wip || 3) },
    ],
  });
  if (!r) return;
  const n = Math.max(1, Math.min(9, Number(r.wip) || 3));
  salvarPrefs({ wip: n });
  toast(`Limite ajustado para ${n}.`);
}

// --- Preferências -----------------------------------------------------------

function aplicarTemaSalvo() {
  const tema = localStorage.getItem("tdah-tema");
  if (tema) document.documentElement.dataset.theme = tema;

  const calmo = localStorage.getItem("tdah-calmo");
  if (calmo === "1") document.documentElement.dataset.calm = "1";
}

function aplicarPrefs() {
  if (state.prefs.tema) {
    document.documentElement.dataset.theme = state.prefs.tema;
    localStorage.setItem("tdah-tema", state.prefs.tema);
  }
  if (state.prefs.calmo) {
    document.documentElement.dataset.calm = "1";
    localStorage.setItem("tdah-calmo", "1");
  }
}

iniciar().catch((err) => {
  console.error(err);
  document.body.innerHTML = "";
  document.body.appendChild(
    h(
      "div",
      { class: "empty", style: { minHeight: "100vh" } },
      h("strong", { text: "Não consegui iniciar." }),
      h("span", { text: err.message })
    )
  );
});
