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
  companies: [],
  labels: [],
  tasks: [],
  activity: [],
  view: "quadro",
  filtroProjeto: null,
  sheet: { busca: "", status: "", pessoa: "", kind: "task", rapido: null, ordem: "position", desc: false },
  // O filtro do quadro é próprio, e não entra em visiveis().
  //
  // Se entrasse, valeria também para agora(), hojeLista() e o popup do dia:
  // alguém filtraria o quadro por uma empresa e o "o que eu faço agora"
  // mudaria junto, sem nada na tela explicando por quê. E ele não é o sheet
  // da planilha pela razão inversa — filtro compartilhado faz mexer num lugar
  // alterar o outro em silêncio.
  quadro: { pessoas: [], empresas: [] },
  // A cena do trilho é guardada por identidade, nunca por posição: um pixel de
  // scrollLeft não sobrevive ao mount() que destrói o subtree inteiro, e um
  // índice muda de significado quando a fileira muda de composição.
  //
  // Vive na sessão, e não em prefs nem no localStorage — mesma decisão já
  // tomada para filtroProjeto. Sair e voltar pelo item de navegação devolve a
  // cena geral, porque a tela principal é a de todos os negócios.
  carrossel: { atual: "geral" },
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
  // O teto de anexo muda com o modo em que o servidor roda. Guardar aqui
  // deixa a interface recusar antes de subir o arquivo.
  state.limits = s.limits || state.limits || {};
  state.users = s.users;
  state.projects = s.projects;
  // Instância antiga responde /state sem o campo: sem o padrão, toda leitura
  // de empresa quebraria até o servidor ser atualizado.
  state.companies = s.companies || [];
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

// Uma sondagem por vez. O ciclo de 6s não espera o anterior, e no modo
// hospedado uma função fria passa disso com folga: duas respostas em voo
// chegam fora de ordem e a mais velha desfaz o que a mais nova já aplicou —
// o cartão concluído reaparece e o cursor anda para trás. Com uma requisição
// de cada vez, a ordem de chegada é a ordem de saída.
let emVoo = false;

async function puxar() {
  if (emVoo) return;
  emVoo = true;
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
  } catch (err) {
    // Rede instável não é motivo para interromper o trabalho de ninguém.
    // Sessão derrubada é outra coisa: sem isso a tela fica congelada num
    // minuto antigo por tempo indefinido, sem dizer nada. Recarregar cai na
    // tela de login pelo boot, que é para onde a pessoa precisa ir.
    if (err?.status === 401) {
      parar();
      location.reload();
    }
  } finally {
    emVoo = false;
  }
}

export function iniciarSync(intervalo = 6000) {
  parar();
  timer = setInterval(() => {
    if (document.hidden) return;
    puxar();
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
  await puxar();
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

export function empresa(id) {
  return state.companies.find((c) => c.id === Number(id)) || null;
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

// O fluxo principal é o das tarefas comuns. Os outros tipos ficam fora da
// fila do dia, do quadro e do fluxo — passar "*" traz todos.
export function visiveis(kind = "task") {
  const f = state.filtroProjeto;
  return state.tasks.filter(
    (t) =>
      !t.archived &&
      (!f || t.projectId === f) &&
      (kind === "*" || (t.kind || "task") === kind)
  );
}

// Itens de um quadro lateral, abertos primeiro, na ordem manual.
export function doQuadro(kind) {
  return visiveis(kind).sort((a, b) => {
    const fa = a.status === "done" ? 1 : 0;
    const fb = b.status === "done" ? 1 : 0;
    return fa - fb || a.position - b.position;
  });
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
  // Passa por visiveis() como todas as outras: sem isso uma meta concluída
  // aparece no fim do dia como se fosse trabalho da fila.
  return visiveis().filter(
    (t) => t.status === "done" && t.doneAt && t.doneAt.slice(0, 10) === state.hoje
  );
}

// Liga e desliga um valor do filtro do quadro. É o que faz o ícone se
// comportar como no Jira: clicar acumula, clicar de novo tira.
export function alternarFiltroQuadro(dimensao, id) {
  const atual = state.quadro[dimensao];
  const chave = Number(id);
  state.quadro[dimensao] = atual.includes(chave)
    ? atual.filter((x) => x !== chave)
    : [...atual, chave];
  emit();
}

export function limparFiltroQuadro() {
  state.quadro = { pessoas: [], empresas: [] };
  emit();
}

export function filtroQuadroAtivo() {
  return state.quadro.pessoas.length > 0 || state.quadro.empresas.length > 0;
}

// Vários valores da mesma dimensão somam (ou uma pessoa, ou a outra); as duas
// dimensões se cruzam (daquelas pessoas E daquela empresa). É o que se espera
// de quem já usou um quadro com avatares no cabeçalho.
export function aplicarFiltroQuadro(tarefas, escopo = state.quadro) {
  const { pessoas, empresas } = escopo;
  if (!pessoas.length && !empresas.length) return tarefas;

  return tarefas.filter((t) => {
    if (pessoas.length && !pessoas.includes(Number(t.assigneeId))) return false;
    if (empresas.length && !empresas.includes(Number(t.companyId))) return false;
    return true;
  });
}

export function porStatus(status, escopo = state.quadro) {
  return aplicarFiltroQuadro(visiveis(), escopo)
    .filter((t) => t.status === status)
    .sort((a, b) => a.position - b.position);
}

// --- O trilho de cenas do quadro -------------------------------------------
//
// O quadro deixou de ser um quadro só: é uma fileira de cenas, com as empresas
// à esquerda, as pessoas à direita e "todos os negócios" sempre no centro.

// Cinco por lado, mais a cena atual quando ela cair fora do teto, mais a cena
// "mais" quando sobrar gente. Máximo absoluto de quinze cenas; o caso típico
// deste time é três.
const TETO_LADO = 5;

// O escopo de uma cena. NUNCA devolve null: parâmetro padrão em JavaScript só
// vale para undefined, então um null chegando aqui viraria TypeError na
// desestruturação de aplicarFiltroQuadro e deixaria o quadro em tela branca.
export function escopoDeCena(id) {
  const [tipo, cru] = String(id || "geral").split(":");
  const n = Number(cru);
  if (tipo === "empresa" && n) return { pessoas: [], empresas: [n] };
  if (tipo === "pessoa" && n) return { pessoas: [n], empresas: [] };
  // A cena geral é a única que obedece ao cabeçalho de ícones. As laterais
  // não leem nem escrevem state.quadro: ali o escopo já foi decidido pela
  // posição na fileira.
  return state.quadro;
}

// O id existe de verdade? Id que não resolve cai na cena geral, e é isso que
// impede um #/quadro/empresa/999 de deixar a tela vazia sem explicação.
export function cenaValida(id) {
  const [tipo, cru] = String(id || "geral").split(":");
  const n = Number(cru);
  if (tipo === "empresa") return empresa(n) ? `empresa:${n}` : "geral";
  if (tipo === "pessoa") {
    const u = usuario(n);
    return u && u.active !== false ? `pessoa:${n}` : "geral";
  }
  if (tipo === "mais" && (cru === "empresas" || cru === "pessoas")) return `mais:${cru}`;
  return "geral";
}

// A fileira inteira, já ordenada, em uma passada sobre visiveis().
//
// A ordem exibida é alfabética. A contagem de tarefas abertas decide quem
// entra, nunca onde fica: ordem por contagem se reorganizaria sozinha assim
// que alguém concluísse uma tarefa, e a fileira mudaria debaixo de quem está
// olhando para ela.
export function escoposDoCarrossel() {
  const atual = state.carrossel.atual;
  const abertas = visiveis().filter((t) => t.status !== "done");

  const porEmpresa = new Map();
  const porPessoa = new Map();
  for (const t of abertas) {
    if (t.companyId) porEmpresa.set(t.companyId, (porEmpresa.get(t.companyId) || 0) + 1);
    if (t.assigneeId) porPessoa.set(t.assigneeId, (porPessoa.get(t.assigneeId) || 0) + 1);
  }

  const empresas = garantirAtual(
    [...porEmpresa].map(([id, n]) => daEmpresa(empresa(id), n)).filter(Boolean),
    atual,
    "empresa"
  );
  const pessoas = garantirAtual(
    [...porPessoa].map(([id, n]) => daPessoa(usuario(id), n)).filter(Boolean),
    atual,
    "pessoa"
  );

  const esq = recortar(empresas, atual);
  const dir = recortar(pessoas, atual);

  const fileira = [];
  if (esq.excedente.length) fileira.push(cenaMais("empresas", "esq", esq.excedente));
  for (const d of esq.cenas) fileira.push({ ...d, lado: "esq" });
  fileira.push({
    id: "geral",
    tipo: "geral",
    nome: "Todos os negócios",
    cor: null,
    avatar: null,
    ref: null,
    abertas: abertas.length,
    lado: "centro",
  });
  for (const d of dir.cenas) fileira.push({ ...d, lado: "dir" });
  if (dir.excedente.length) fileira.push(cenaMais("pessoas", "dir", dir.excedente));

  return fileira;
}

function daEmpresa(c, abertas) {
  if (!c) return null;
  return {
    id: `empresa:${c.id}`,
    tipo: "empresa",
    nome: c.name,
    cor: c.color,
    avatar: c.avatar ?? null,
    ref: c,
    abertas,
  };
}

function daPessoa(u, abertas) {
  // Quem saiu do time não vira cena: a fileira é de trabalho em aberto, e
  // conta desativada não tem trabalho em aberto que interesse a alguém.
  if (!u || u.active === false) return null;
  return {
    id: `pessoa:${u.id}`,
    tipo: "pessoa",
    nome: u.name,
    cor: u.color,
    avatar: null,
    ref: u,
    abertas,
  };
}

// A cena em que se está permanece na fileira mesmo com zero tarefas abertas,
// mostrando as cinco colunas vazias. Sem isto, concluir a última tarefa de
// alguém faria a cena sumir debaixo de quem estava em cima dela.
function garantirAtual(lista, atual, tipo) {
  if (!atual.startsWith(`${tipo}:`)) return lista;
  if (lista.some((d) => d.id === atual)) return lista;

  const id = Number(atual.slice(tipo.length + 1));
  const d = tipo === "empresa" ? daEmpresa(empresa(id), 0) : daPessoa(usuario(id), 0);
  return d ? [...lista, d] : lista;
}

function recortar(lista, atual) {
  const porContagem = [...lista].sort(
    (a, b) => b.abertas - a.abertas || a.nome.localeCompare(b.nome, "pt-BR")
  );
  const dentro = porContagem.slice(0, TETO_LADO);
  const fora = porContagem.slice(TETO_LADO);
  const forcada = fora.find((d) => d.id === atual) || null;

  return {
    cenas: (forcada ? [...dentro, forcada] : dentro).sort((a, b) =>
      a.nome.localeCompare(b.nome, "pt-BR")
    ),
    excedente: fora.filter((d) => d !== forcada),
  };
}

function cenaMais(qual, lado, itens) {
  return {
    id: `mais:${qual}`,
    tipo: "mais",
    nome: qual === "empresas" ? "Mais empresas" : "Mais pessoas",
    cor: null,
    avatar: null,
    ref: null,
    abertas: itens.length,
    lado,
    itens: [...itens].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
  };
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
