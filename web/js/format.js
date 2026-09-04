// Datas e rótulos.
//
// Uma decisão de produto atravessa este arquivo: prazo e tempo parado são
// ditos em linguagem comum ("amanhã", "parada há 3 dias"), nunca em carimbo
// de data. Quem tem dificuldade com noção de tempo não ganha nada com
// "2026-08-20"; ganha com "daqui a uma semana".

export const STATUS_LABEL = {
  inbox: "Entrada",
  todo: "A fazer",
  doing: "Fazendo",
  waiting: "Esperando",
  done: "Feito",
};

export const STATUS_ORDER = ["inbox", "todo", "doing", "waiting", "done"];

export const STATUS_COLOR = {
  inbox: "var(--st-inbox)",
  todo: "var(--st-todo)",
  doing: "var(--st-doing)",
  waiting: "var(--st-waiting)",
  done: "var(--st-done)",
};

// "task" é o fluxo do dia. Os outros três são horizontes mais longos e vivem
// em quadros próprios na tela inicial, na ordem abaixo.
export const KIND_LABEL = {
  task: "Tarefa",
  longa: "Validade longa",
  oportunidade: "Oportunidade",
  meta: "Meta longa",
};

export const KIND_BOARDS = ["longa", "oportunidade", "meta"];

// Título de cada quadro lateral, já no plural certo.
export const KIND_BOARD_TITLE = {
  longa: "Validade longa",
  oportunidade: "Oportunidades",
  meta: "Metas longas",
};

export const KIND_HINT = {
  longa: "Não vence e não tem pressa. Fica aqui para não se perder.",
  oportunidade: "Ainda não é tarefa — é algo que pode valer a pena.",
  meta: "Para onde isso tudo está indo.",
};

export const PRIORITY_LABEL = {
  agora: "Agora",
  normal: "Normal",
  quando_der: "Quando der",
};

export const ENERGY_LABEL = {
  leve: "Leve",
  media: "Média",
  pesada: "Pesada",
};

export const ENERGY_ICON = {
  leve: "○",
  media: "◐",
  pesada: "●",
};

// --- Datas -----------------------------------------------------------------

export function hoje() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function parseDia(iso) {
  if (!iso) return null;
  const [a, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!a || !m || !d) return null;
  return new Date(a, m - 1, d);
}

export function isoDia(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function diasAte(iso) {
  const d = parseDia(iso);
  if (!d) return null;
  return Math.round((d - hoje()) / 86400000);
}

const SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

// Prazo em linguagem falada. Sem alarme: "atrasada há 2 dias" informa,
// "VENCIDA!" só produz culpa e não move a tarefa um centímetro.
export function prazoTexto(iso) {
  const n = diasAte(iso);
  if (n === null) return null;
  if (n === 0) return "hoje";
  if (n === 1) return "amanhã";
  if (n === -1) return "era ontem";
  if (n < -1) return `${Math.abs(n)} dias atrás`;
  if (n < 7) return SEMANA[parseDia(iso).getDay()];
  if (n < 14) return "semana que vem";
  if (n < 31) return `em ${Math.round(n / 7)} semanas`;
  const d = parseDia(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export function prazoEstado(iso) {
  const n = diasAte(iso);
  if (n === null) return null;
  if (n < 0) return "late";
  if (n === 0) return "today";
  return "future";
}

// Tempo relativo curto, para a trilha e a atividade.
export function desde(isoTs) {
  if (!isoTs) return "";
  const ms = Date.now() - new Date(isoTs).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d`;
  if (d < 30) return `${Math.round(d / 7)} sem`;
  const meses = Math.round(d / 30);
  if (meses < 12) return `${meses} m`;
  return `${Math.round(meses / 12)} a`;
}

export function dataHoraLonga(isoTs) {
  if (!isoTs) return "";
  return new Date(isoTs).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Há quantos dias a tarefa está no estado atual. É o número que responde
// "isso aqui empacou?" sem precisar de relatório.
export function diasParado(task) {
  if (!task.statusSince) return 0;
  return Math.floor((Date.now() - new Date(task.statusSince).getTime()) / 86400000);
}

export function agingClasse(dias, status) {
  if (status === "done") return "";
  const limite = status === "waiting" ? 3 : 7;
  if (dias >= limite * 2) return "aging--stuck";
  if (dias >= limite) return "aging--warn";
  return "";
}

export function agingTexto(dias) {
  if (dias <= 0) return "hoje";
  if (dias === 1) return "1 dia";
  return `${dias} dias`;
}

// --- Números e texto -------------------------------------------------------

export function blocos(n) {
  if (!n) return null;
  return n === 1 ? "1 bloco" : `${n} blocos`;
}

export function minutosDeBlocos(n) {
  return (n || 1) * 25;
}

export function plural(n, um, muitos) {
  return `${n} ${n === 1 ? um : muitos}`;
}

export function tamanhoArquivo(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function saudacao() {
  const h = new Date().getHours();
  if (h < 5) return "Boa madrugada";
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}
