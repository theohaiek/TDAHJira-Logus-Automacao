// O que as ferramentas do MCP dividem: achar ticket, pessoa, projeto, empresa e
// etiqueta pelo nome que o agente escreveu, e escrever a resposta no formato
// mais curto que ainda se lê sem ambiguidade.
//
// O formato de saída é texto, e não JSON, por custo: numa lista de tickets as
// aspas e as chaves repetidas do JSON dobram os tokens sem dizer nada a mais. A
// ferramenta ler aceita json=true para quem precisa do objeto cru.

import { all, one } from "../db.js";
import { badRequest, notFound, STATUSES, PRIORITIES, ENERGIES, KINDS } from "../tasks.js";

// --- Os campos do ticket -------------------------------------------------------
//
// Nome que o agente escreve → nome que server/tasks.js entende. É a tabela que
// criar e editar usam, e é o que tests/mcp.test.js confere contra FIELDS: campo
// novo na tarefa que não aparece aqui (nem em FORA_DO_MCP) derruba a suíte.
export const CAMPOS = {
  titulo: "title",
  descricao: "description",
  status: "status",
  tipo: "kind",
  prioridade: "priority",
  energia: "energy",
  tamanho: "size",
  responsaveis: "assigneeIds",
  projeto: "projectId",
  empresa: "companyId",
  pai: "parentId",
  prazo: "dueOn",
  foco: "focusOn",
  esperando: "waitingFor",
  arquivada: "archived",
  etiquetas: "labels",
};

// Campos de FIELDS que ficam de fora de propósito, com o porquê.
export const FORA_DO_MCP = {
  position: "ordem manual dentro da coluna do quadro; o agente move por status",
};

// O esquema de entrada dos campos, montado das listas do servidor: valor novo
// num enum de server/tasks.js chega ao agente sem ninguém mexer aqui.
export const PROPRIEDADES_DO_TICKET = {
  titulo: { type: "string" },
  descricao: { type: "string" },
  status: { enum: STATUSES },
  tipo: { enum: KINDS },
  prioridade: { enum: PRIORITIES },
  energia: { enum: [...ENERGIES, null] },
  tamanho: { type: ["integer", "null"], description: "blocos de 25min, 1-40" },
  responsaveis: { type: "array", items: { type: "string" }, description: "usernames; [] tira todos" },
  projeto: { type: ["string", "null"], description: "chave ou nome" },
  empresa: { type: ["string", "null"] },
  pai: { type: ["string", "null"], description: "ticket" },
  prazo: { type: ["string", "null"], description: "AAAA-MM-DD" },
  foco: { type: ["string", "null"], description: "AAAA-MM-DD" },
  esperando: { type: ["string", "null"], description: "de quem ou do quê, até 200" },
  arquivada: { type: "boolean" },
  etiquetas: { type: "array", items: { type: "string" }, description: "nomes; substitui a lista" },
};

// Traduz os argumentos do agente para o patch de updateTask/createTask. Nomes
// viram ids aqui, com erro que lista as opções: o agente corrige na chamada
// seguinte sem precisar de uma consulta a mais.
//
// `atuais` são os responsáveis que o ticket já tem. Pessoa desativada só fica
// na lista se já estava nela, a mesma regra do seletor da tela (ticket.js):
// dá para manter ou tirar quem saiu do time, e não para atribuir de novo.
export async function patchDoTicket(args, ctx, atuais = []) {
  const patch = {};
  let etiquetas = null;

  for (const [nome, campo] of Object.entries(CAMPOS)) {
    if (!(nome in args)) continue;
    const v = args[nome];

    if (nome === "responsaveis") {
      if (!Array.isArray(v)) throw badRequest("responsaveis é uma lista de usernames.");
      patch.assigneeIds = [];
      for (const ref of v) {
        const id = await idDaPessoa(ref, ctx.user, { inativos: true });
        if (!atuais.includes(id) && !(await ativa(id))) {
          throw badRequest(`Pessoa "${String(ref).replace(/^@/, "")}" está desativada e não recebe ticket novo.`);
        }
        patch.assigneeIds.push(id);
      }
    } else if (nome === "etiquetas") {
      if (!Array.isArray(v)) throw badRequest("etiquetas é uma lista de nomes.");
      etiquetas = [];
      for (const ref of v) etiquetas.push(await idDaEtiqueta(ref));
    } else if (nome === "projeto") {
      patch.projectId = v === null || v === "" ? null : await idDoProjeto(v);
    } else if (nome === "empresa") {
      patch.companyId = v === null || v === "" ? null : await idDaEmpresa(v);
    } else if (nome === "pai") {
      patch.parentId = v === null || v === "" ? null : await idDoTicket(v);
    } else if ((nome === "prazo" || nome === "foco") && v !== null && v !== "" && !dataValida(v)) {
      // createTask descarta data inválida em silêncio; aqui ela volta como erro,
      // senão o agente acredita ter marcado um prazo que não existe.
      throw badRequest(`${nome}: "${v}" não é data AAAA-MM-DD válida.`);
    } else if (nome === "esperando" && v !== null && String(v).length > ESPERANDO_MAX) {
      // createTask corta em 200 sem avisar e updateTask não corta: recusar aqui
      // deixa as duas ferramentas iguais e não perde texto em silêncio.
      throw badRequest(`esperando: ${String(v).length} caracteres; o teto é ${ESPERANDO_MAX}.`);
    } else {
      patch[campo] = v;
    }
  }
  return { patch, etiquetas };
}

// --- Resolução por nome ----------------------------------------------------------

// "AUT-14", "#12" ou "12". O número solto é o id, que é o que aparece como #12
// nos tickets sem projeto.
export async function idDoTicket(ref) {
  const texto = String(ref ?? "").trim();
  let m = /^#?(\d+)$/.exec(texto);
  if (m) {
    const linha = await one("SELECT id FROM tasks WHERE id = ?", [Number(m[1])]);
    if (!linha) throw notFound(`Ticket #${m[1]} não existe.`);
    return linha.id;
  }
  m = /^([A-Za-z0-9]+)-(\d+)$/.exec(texto);
  if (m) {
    const linha = await one(
      `SELECT t.id FROM tasks t JOIN projects p ON p.id = t.project_id
        WHERE upper(p.key) = upper(?) AND t.number = ?`,
      [m[1], Number(m[2])]
    );
    if (!linha) throw notFound(`Ticket ${texto} não existe.`);
    return linha.id;
  }
  throw badRequest(`Ticket inválido: "${texto}". Use a chave (AUT-14) ou #id.`);
}

const ESPERANDO_MAX = 200;

async function ativa(id) {
  return !!(await one("SELECT id FROM users WHERE id = ? AND is_active = 1", [id]));
}

// Sem `inativos`, só quem está ativo: é o que a ferramenta contexto lista. Com
// ele, também quem saiu do time, para buscar o trabalho que ficou com a pessoa.
export async function idDaPessoa(ref, eu, { inativos = false } = {}) {
  const texto = String(ref ?? "").trim().replace(/^@/, "");
  if (/^(eu|me)$/i.test(texto) && eu) return eu.id;
  const pessoas = await all(
    `SELECT id, username, display_name FROM users ${inativos ? "" : "WHERE is_active = 1"} ORDER BY username`
  );
  const alvo = normal(texto);
  const achou =
    pessoas.find((p) => p.username.toLowerCase() === texto.toLowerCase()) ||
    unico(pessoas.filter((p) => normal(p.display_name) === alvo)) ||
    unico(pessoas.filter((p) => normal(p.display_name).split(" ")[0] === alvo));
  if (!achou) throw badRequest(`Pessoa "${texto}" não existe. Opções: ${opcoes(pessoas.map((p) => p.username))}.`);
  return achou.id;
}

// Projeto e empresa arquivados continuam tendo ticket vivo. `arquivados` deixa
// a busca achar esse trabalho; sem ele (criar, editar), o arquivado é recusado
// dizendo que está arquivado, e não que não existe.
export async function idDoProjeto(ref, { arquivados = false } = {}) {
  const texto = String(ref).trim();
  const todos = await all("SELECT id, key, name, is_archived FROM projects ORDER BY position, id");
  const casa = (lista) =>
    lista.find((p) => p.key.toLowerCase() === texto.toLowerCase()) ||
    unico(lista.filter((p) => normal(p.name) === normal(texto)));
  const vivos = todos.filter((p) => !p.is_archived);
  const achou = casa(vivos) || casa(todos);
  if (achou?.is_archived && !arquivados) throw badRequest(`Projeto "${texto}" está arquivado.`);
  if (!achou) throw badRequest(`Projeto "${texto}" não existe. Opções: ${opcoes(vivos.map((p) => p.key))}.`);
  return achou.id;
}

export async function idDaEmpresa(ref, { arquivados = false } = {}) {
  const texto = String(ref).trim();
  const todas = await all("SELECT id, name, is_archived FROM companies ORDER BY position, name");
  const casa = (lista) =>
    unico(lista.filter((c) => normal(c.name) === normal(texto))) ||
    unico(lista.filter((c) => normal(c.name).startsWith(normal(texto))));
  const vivas = todas.filter((c) => !c.is_archived);
  const achou = casa(vivas) || casa(todas);
  if (achou?.is_archived && !arquivados) throw badRequest(`Empresa "${texto}" está arquivada.`);
  if (!achou) throw badRequest(`Empresa "${texto}" não existe. Opções: ${opcoes(vivas.map((c) => c.name))}.`);
  return achou.id;
}

export async function idDaEtiqueta(ref) {
  const texto = String(ref).trim();
  const etiquetas = await all("SELECT id, name FROM labels ORDER BY name");
  const achou = unico(etiquetas.filter((l) => normal(l.name) === normal(texto)));
  if (!achou) throw badRequest(`Etiqueta "${texto}" não existe. Opções: ${opcoes(etiquetas.map((l) => l.name))}.`);
  return achou.id;
}

// Ids inteiros positivos numa lista, com erro legível.
export function ids(lista, nome) {
  if (lista === undefined) return [];
  if (!Array.isArray(lista)) throw badRequest(`${nome} é uma lista de ids.`);
  return lista.map((v) => {
    const n = Number(String(v).replace(/^#/, ""));
    if (!Number.isSafeInteger(n) || n <= 0) throw badRequest(`${nome}: id inválido "${v}".`);
    return n;
  });
}

function dataValida(v) {
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function unico(lista) {
  return lista.length === 1 ? lista[0] : null;
}

function opcoes(nomes) {
  if (!nomes.length) return "nenhuma cadastrada";
  const corte = nomes.slice(0, 30).join(", ");
  return nomes.length > 30 ? `${corte} e mais ${nomes.length - 30}` : corte;
}

export function normal(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

// --- Escrita da resposta -----------------------------------------------------------

// A chave e o id, sem repetir quando a chave já é o id (ticket sem projeto).
export function chaveEId(t) {
  return t.key === `#${t.id}` ? t.key : `${t.key} #${t.id}`;
}

// Nomes que a resposta precisa e a tarefa só guarda como id.
export async function nomes() {
  const [pessoas, etiquetas] = await Promise.all([
    all("SELECT id, username FROM users"),
    all("SELECT id, name FROM labels"),
  ]);
  return {
    pessoa: new Map(pessoas.map((p) => [p.id, p.username])),
    etiqueta: new Map(etiquetas.map((l) => [l.id, l.name])),
  };
}

// 2026-09-17T17:02:33.120Z → 2026-09-17 17:02. UTC, dito uma vez no contexto.
export function quando(iso) {
  return iso ? String(iso).slice(0, 16).replace("T", " ") : "";
}

export function tamanho(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

// Uma linha por ticket: o que se lê numa varredura, e nada que esteja vazio ou
// no valor padrão.
export function linhaDoTicket(t, n) {
  const partes = [t.key, t.status];
  if (t.priority !== "normal") partes.push(t.priority);
  if (t.kind !== "task") partes.push(t.kind);
  const quem = (t.assigneeIds || []).map((id) => `@${n.pessoa.get(id) || id}`);
  if (quem.length) partes.push(quem.join(","));
  if (t.companyName) partes.push(`[${t.companyName}]`);
  if (t.dueOn) partes.push(`prazo:${t.dueOn}`);
  if (t.status === "waiting" && t.waitingFor) partes.push(`espera:${t.waitingFor}`);
  if (t.archived) partes.push("arquivada");
  return `${partes.join(" ")} · ${t.title}`;
}
