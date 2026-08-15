// Montagem da aplicação: entrada, navegação, atalhos e o laço de desenho.

import { h, mount, $, initials } from "./dom.js";
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
} from "./store.js";
import { viewHoje } from "./views/hoje.js";
import { viewQuadro } from "./views/quadro.js";
import { viewPlanilha } from "./views/planilha.js";
import { viewFluxo } from "./views/fluxo.js";
import { fecharTicket, ticketAberto, rerenderTicket } from "./ticket.js";
import { abrirFoco, fecharFoco, focoAtivo } from "./focus.js";
import { abrirPaleta, fecharPaleta, paletaAberta, iniciarPaleta } from "./palette.js";
import { criarDoTexto } from "./quickadd.js";
import { parseCaptura, dicas } from "./capture.js";
import { toast, erro } from "./toast.js";
import { pedir } from "./dialog.js";

const VIEWS = {
  hoje: { titulo: "Hoje", icone: "◉", render: viewHoje },
  quadro: { titulo: "Quadro", icone: "▦", render: viewQuadro },
  planilha: { titulo: "Planilha", icone: "▤", render: viewPlanilha },
  fluxo: { titulo: "Fluxo", icone: "◈", render: viewFluxo },
};

// --- Início -----------------------------------------------------------------

async function iniciar() {
  aplicarTemaSalvo();

  const boot = await api.boot().catch(() => ({ authenticated: false }));
  if (!boot.authenticated) return telaLogin();

  await entrar();
}

async function entrar() {
  $("#login").hidden = true;
  $("#app").hidden = false;

  await carregar();
  aplicarPrefs();

  subscribe(desenhar);
  iniciarSync();
  iniciarPaleta();
  ligarCaptura();
  ligarAtalhos();
  ligarBotoes();

  rota();
  window.addEventListener("hashchange", rota);
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
        toast("Você ainda está com a senha inicial. Vale trocar em Ajustes.", { ms: 8000 });
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
  const alvo = (location.hash.replace(/^#\/?/, "") || "hoje").split("/")[0];
  state.view = VIEWS[alvo] ? alvo : "hoje";
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

function desenharAgora() {
  if (!state.carregado) return;

  desenharNav();
  desenharProjetos();
  desenharUsuario();

  const view = VIEWS[state.view] || VIEWS.hoje;
  document.title = `${view.titulo} · TDAH Jira — Logus`;

  const alvo = $("#view");
  const rolagem = alvo.scrollTop;
  mount(alvo, view.render());
  alvo.scrollTop = rolagem;

  if (ticketAberto()) rerenderTicket();
}

function desenharNav() {
  const contagens = {
    hoje: agora(99).length + esperando().length,
    quadro: visiveis().filter((t) => t.status !== "done").length,
    planilha: visiveis().length,
    fluxo: visiveis().filter((t) => t.status !== "done").length,
  };

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
      if (focoAtivo()) return fecharFoco(false);
      if (ticketAberto()) return fecharTicket();
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
      case "?":
        mostrarAtalhos();
        break;
    }
  });
}

function mostrarAtalhos() {
  toast(
    "n nova · / buscar · f focar · 1–4 telas · Esc fecha · Ctrl+K comandos",
    { ms: 9000 }
  );
}

// --- Botões da moldura ------------------------------------------------------

function ligarBotoes() {
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
    descricao: "A nova senha precisa de ao menos 8 caracteres.",
    confirmar: "Trocar",
    campos: [
      { chave: "atual", rotulo: "Senha atual", tipo: "password" },
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
