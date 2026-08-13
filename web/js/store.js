// Estado da aplicação.
//
// O time é pequeno e a base é pequena: cabe tudo na memória do navegador.
// Isso permite filtrar, ordenar e trocar de visão sem nenhuma ida ao
// servidor — a interface responde no mesmo quadro em que se clica, que é
// exatamente o que sustenta a atenção de quem se distrai fácil.

import { api } from "./api.js";

const ouvintes = new Set();

export const state = {
  carregado: false,
  cursor: 0,
  hoje: null,
  me: null,
  prefs: {},
  users: [],
  projects: [],
  labels: [],
  tasks: [],
  activity: [],
  view: "hoje",
  filtroProjeto: null,
  sheet: { busca: "", status: "", pessoa: "", rapido: null, ordem: "position", desc: false },
};

export function subscribe(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

export function emit() {
  for (const fn of ouvintes) fn();
}

// --- Carga -----------------------------------------------------------------

export async function carregar() {
  const s = await api.state();
  state.cursor = s.cursor;
  state.hoje = s.today;
  state.me = s.me;
  state.prefs = s.prefs || {};
  state.users = s.users;
  state.projects = s.projects;
  state.labels = s.labels;
  state.tasks = s.tasks;
  state.activity = s.activity;
  state.carregado = true;
  emit();
}

// Sincronização por sondagem. Para três pessoas numa rede local, uma
// verificação a cada poucos segundos é indistinguível de tempo real e não
// exige conexão persistente nem um servidor que saiba manter estado.
let timer = null;

export function iniciarSync(intervalo = 6000) {
  parar();
  timer = setInterval(async () => {
    if (document.hidden) return;
    try {
      const r = await api.sync(state.cursor);
      if (r.cursor === state.cursor) return;
      state.cursor = r.cursor;
      if (r.tasks?.length) for (const t of r.tasks) mesclarTarefa(t);
      if (r.removed?.length) {
        state.tasks = state.tasks.filter((t) => !r.removed.includes(t.id));
      }
      if (r.events?.length) state.activity = r.events;
      emit();
    } catch {
      // Rede instável não é motivo para interromper o trabalho de ninguém.
    }
  }, intervalo);
}

export function parar() {
  if (timer) clearInterval(timer);
  timer = null;
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.carregado) sincronizarAgora();
});

export async function sincronizarAgora() {
  try {
    const r = await api.sync(state.cursor);
    if (r.cursor === state.cursor) return;
    state.cursor = r.cursor;
    for (const t of r.tasks || []) mesclarTarefa(t);
    if (r.removed?.length) state.tasks = state.tasks.filter((t) => !r.removed.includes(t.id));
    if (r.events?.length) state.activity = r.events;
    emit();
  } catch {}
}

// --- Mutação local ---------------------------------------------------------

export function mesclarTarefa(t) {
  const i = state.tasks.findIndex((x) => x.id === t.id);
  if (i >= 0) state.tasks[i] = t;
  else state.tasks.push(t);
  return t;
}

export function removerTarefa(id) {
  state.tasks = state.tasks.filter((t) => t.id !== id);
}

export function tarefa(id) {
  return state.tasks.find((t) => t.id === Number(id)) || null;
}

export function usuario(id) {
  return state.users.find((u) => u.id === Number(id)) || null;
}

export function projeto(id) {
  return state.projects.find((p) => p.id === Number(id)) || null;
}

export function etiqueta(id) {
  return state.labels.find((l) => l.id === Number(id)) || null;
}

// Aplica a mudança na tela antes de o servidor responder, e desfaz se falhar.
// A espera de rede entre o clique e o efeito é onde o fio se perde.
export async function patch(id, mudanca) {
  const antes = tarefa(id);
  if (!antes) return null;
  const copia = { ...antes };
  Object.assign(antes, mudanca);
  emit();
  try {
    const r = await api.patchTask(id, mudanca);
    mesclarTarefa(r.task);
    emit();
    return r.task;
  } catch (err) {
    // Desfaz só as chaves desta chamada. Repor o objeto inteiro apagaria
    // qualquer outra edição que tenha sido concluída no meio do caminho.
    const atual = tarefa(id);
    if (atual) {
      for (const chave of Object.keys(mudanca)) atual[chave] = copia[chave];
    }
    emit();
    throw err;
  }
}

export async function criar(dados) {
  const r = await api.createTask(dados);
  mesclarTarefa(r.task);
  emit();
  return r.task;
}

// --- Consultas de produto --------------------------------------------------
// A regra de negócio das visões mora aqui, não espalhada pelas telas.

export function visiveis() {
  const f = state.filtroProjeto;
  return state.tasks.filter((t) => !t.archived && (!f || t.projectId === f));
}

export function minhas() {
  return visiveis().filter((t) => !state.me || t.assigneeId === state.me.id || !t.assigneeId);
}

export function emAndamento(userId = state.me?.id) {
  return visiveis().filter((t) => t.status === "doing" && t.assigneeId === userId);
}

// O núcleo do produto: a lista curta do que fazer agora.
//
// A ordem não é a de prioridade declarada, e sim a da pergunta "o que faz
// sentido pegar neste instante": o que já está em andamento vem primeiro,
// porque terminar vale mais do que começar.
export function agora(limite = 3) {
  const meu = (t) => !t.assigneeId || t.assigneeId === state.me?.id;
  const lista = visiveis().filter((t) => t.status !== "done" && t.status !== "waiting");

  const pontua = (t) => {
    let p = 0;
    if (t.status === "doing") p += 1000;
    if (t.focusOn === state.hoje) p += 400;
    if (t.priority === "agora") p += 300;
    const d = t.dueOn ? diasAte(t.dueOn) : null;
    if (d !== null) {
      if (d < 0) p += 260;
      else if (d === 0) p += 240;
      else if (d <= 2) p += 120;
      else if (d <= 7) p += 40;
    }
    if (t.assigneeId === state.me?.id) p += 60;
    if (t.status === "inbox") p -= 200;
    if (t.priority === "quando_der") p -= 150;
    // Tarefa leve empata para cima: começar por algo curto destrava o resto.
    if (t.energy === "leve") p += 25;
    return p;
  };

  return lista
    .filter(meu)
    .sort((a, b) => pontua(b) - pontua(a))
    .slice(0, limite);
}

function diasAte(iso) {
  const [a, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  const alvo = new Date(a, m - 1, d);
  const hj = new Date();
  hj.setHours(0, 0, 0, 0);
  return Math.round((alvo - hj) / 86400000);
}

export function hojeLista() {
  return visiveis().filter(
    (t) => t.focusOn === state.hoje && t.status !== "done" && t.status !== "inbox"
  );
}

export function esperando() {
  return visiveis().filter((t) => t.status === "waiting");
}

export function entrada() {
  return visiveis().filter((t) => t.status === "inbox");
}

export function feitasHoje() {
  return state.tasks.filter(
    (t) => t.status === "done" && t.doneAt && t.doneAt.slice(0, 10) === state.hoje
  );
}

export function porStatus(status) {
  return visiveis()
    .filter((t) => t.status === status)
    .sort((a, b) => a.position - b.position);
}

export function limiteWip() {
  return Number(state.prefs.wip) || 3;
}

export async function salvarPrefs(mudanca) {
  Object.assign(state.prefs, mudanca);
  emit();
  try {
    await api.savePrefs(mudanca);
  } catch {}
}
