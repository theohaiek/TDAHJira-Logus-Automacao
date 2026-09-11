// Testes do lado servidor do ciclo de relatos: a situação de cada relato, as
// ações de quem administra e de quem relatou, e as rotas do agente diário.
//
// O que mais importa aqui é o que NÃO pode acontecer. O agente não pode se
// autorizar, nem ressuscitar um relato que alguém recusou enquanto ele
// trabalhava. Sem o token configurado, as rotas dele não podem nem existir.
// Uma decisão repetida (a rede caiu depois de gravar) não pode virar
// história duplicada. E o painel de versões não pode sujar o próprio cache.
//
//   node --test tests/relatos-servidor.test.js

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";

process.env.TDAH_DATA_DIR = mkdtempSync(join(tmpdir(), "tdah-relatos-servidor-"));

const { openDb, all, one, run } = await import("../server/db.js");
const { DATA_DIR, DB_FILE } = await import("../server/paths.js");
const { createUser } = await import("../server/auth.js");
const { registrarFeedback, comRelatos } = await import("../server/feedback.js");
const { handleApi } = await import("../server/api.js");

const TOKEN = "t".repeat(20) + "0123456789abcdefghijklmnop";
const tokenAntes = process.env.RELATOS_AGENTE_TOKEN;

let admin;
let membro;
let outro;

before(async () => {
  await openDb(DB_FILE);
  admin = await createUser({ username: "chefia", displayName: "Chefia", password: "uma-senha-boa", role: "admin" });
  membro = await createUser({ username: "bruno", displayName: "Bruno Exemplo", password: "uma-senha-boa" });
  outro = await createUser({ username: "carla", displayName: "Carla Exemplo", password: "uma-senha-boa" });
  process.env.RELATOS_AGENTE_TOKEN = TOKEN;
});

after(() => {
  if (tokenAntes === undefined) delete process.env.RELATOS_AGENTE_TOKEN;
  else process.env.RELATOS_AGENTE_TOKEN = tokenAntes;
  try {
    if (DATA_DIR.startsWith(tmpdir())) rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {}
});

// --- Atalhos -----------------------------------------------------------------

// Cada relato criado aqui é empurrado duas horas para trás. Sem isso, o freio
// de doze por hora (que é o comportamento certo, e tem teste próprio em
// feedback.test.js) barraria a partir do décimo terceiro relato do arquivo.
async function novoRelato(kind = "bug", body = `Relato de teste ${Math.random()}`, autor = membro) {
  const { id } = await registrarFeedback({ kind, body }, autor);
  await run("UPDATE feedback SET created_at = ? WHERE id = ?", [new Date(Date.now() - 2 * 3600e3).toISOString(), id]);
  return id;
}

const doAgente = (extra = {}) => ({ headers: { authorization: `Bearer ${TOKEN}`, ...extra } });

function decidir(id, decisao) {
  return chamar(`/api/agente/relatos/${id}`, {
    method: "POST",
    body: JSON.stringify(decisao),
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
  });
}

function acao(id, corpo, user = admin) {
  return chamar(`/api/feedback/${id}/acao`, { user, method: "POST", ...corpoJson(corpo) });
}

async function relatoNaLista(id, user = membro) {
  const res = await chamar("/api/feedback", { user });
  assert.equal(res.statusCode, 200);
  return res.dados.feedback.find((f) => f.id === id);
}

async function eventosDe(id) {
  return all("SELECT status, actor FROM feedback_events WHERE feedback_id = ? ORDER BY id", [id]);
}

// --- O relato e a sua história -----------------------------------------------

test("o relato nasce novo, com uma linha de história de quem relatou", async () => {
  const id = await novoRelato("ideia", "Um atalho para arquivar");
  const r = await relatoNaLista(id);

  assert.equal(r.status, "novo");
  assert.equal(r.autor, "Bruno Exemplo");
  assert.equal(r.autorId, membro.id);
  assert.equal(r.resolution, null);
  assert.equal(r.commit, null);
  assert.equal(r.eventos.length, 1);
  assert.equal(r.eventos[0].status, "novo");
  assert.equal(r.eventos[0].ator, "autor");
  assert.equal(r.eventos[0].atorNome, "Bruno Exemplo");
});

// --- A porta do agente -------------------------------------------------------

test("sem RELATOS_AGENTE_TOKEN, as rotas do agente não existem", async () => {
  delete process.env.RELATOS_AGENTE_TOKEN;
  try {
    const ler = await chamar("/api/agente/relatos", doAgente());
    assert.equal(ler.statusCode, 404);
    const passada = await chamar("/api/agente/passada", { method: "POST", ...doAgente() });
    assert.equal(passada.statusCode, 404);
  } finally {
    process.env.RELATOS_AGENTE_TOKEN = TOKEN;
  }
});

test("token curto demais para ser segredo conta como desligado", async () => {
  process.env.RELATOS_AGENTE_TOKEN = "curto";
  try {
    const res = await chamar("/api/agente/relatos", { headers: { authorization: "Bearer curto" } });
    assert.equal(res.statusCode, 404);
  } finally {
    process.env.RELATOS_AGENTE_TOKEN = TOKEN;
  }
});

test("credencial ausente, errada ou quase certa é recusada", async () => {
  for (const authorization of [undefined, "Bearer errado", `Bearer ${TOKEN}x`, TOKEN, `Basic ${TOKEN}`]) {
    const headers = authorization ? { authorization } : {};
    const res = await chamar("/api/agente/relatos", { headers });
    assert.equal(res.statusCode, 401, `aceitou ${authorization}`);
  }
});

test("a sessão de quem administra não abre a porta do agente", async () => {
  const res = await chamar("/api/agente/relatos", { user: admin });
  assert.equal(res.statusCode, 401);
});

test("caminho inventado sob /api/agente é 404 mesmo com o token certo", async () => {
  const res = await chamar("/api/agente/tarefas", doAgente());
  assert.equal(res.statusCode, 404);
});

test("a fila traz novo e autorizado inteiros, com o autor; o contexto traz os outros, resumidos", async () => {
  const fila = await novoRelato("bug", "Fila: o botão some");
  const longo = "x".repeat(600);
  const fechado = await novoRelato("ideia", longo, outro);
  assert.equal((await decidir(fechado, { status: "rejeitado", resolution: "Não combina com o produto." })).statusCode, 200);

  const res = await chamar("/api/agente/relatos", doAgente());
  assert.equal(res.statusCode, 200);
  assert.ok(!res.corpo.includes(TOKEN), "o token voltou na resposta");

  const pendente = res.dados.pendentes.find((p) => p.id === fila);
  assert.ok(pendente, "o relato novo não veio na fila");
  assert.equal(pendente.body, "Fila: o botão some");
  assert.deepEqual(pendente.autor, { id: membro.id, username: "bruno", nome: "Bruno Exemplo", role: "member", ativo: true });
  assert.ok(res.dados.pendentes.every((p) => ["novo", "autorizado"].includes(p.status)));

  const noContexto = res.dados.contexto.find((c) => c.id === fechado);
  assert.ok(noContexto, "o relato decidido não veio no contexto");
  assert.equal(noContexto.status, "rejeitado");
  assert.equal(noContexto.resumo.length, 280);
  assert.ok(!res.dados.pendentes.some((p) => p.id === fechado));
});

// --- As decisões do agente ---------------------------------------------------

test("o agente decide: situação, resolução e uma linha de história dele", async () => {
  const id = await novoRelato("ideia", "Tema roxo");
  const res = await decidir(id, { status: "rejeitado", resolution: "Fora da identidade visual da marca." });
  assert.equal(res.statusCode, 200);
  assert.equal(res.dados.relato.status, "rejeitado");
  assert.equal(res.dados.relato.resolution, "Fora da identidade visual da marca.");

  const eventos = await eventosDe(id);
  assert.deepEqual(eventos.at(-1), { status: "rejeitado", actor: "agente" });
});

test("o agente não se autoriza, não devolve para novo e não inventa situação", async () => {
  const id = await novoRelato();
  for (const status of ["autorizado", "novo", "aprovado", "", "__proto__"]) {
    const res = await decidir(id, { status, resolution: "Tanto faz." });
    assert.equal(res.statusCode, 400, `aceitou a situação ${JSON.stringify(status)}`);
  }
  assert.equal((await one("SELECT status FROM feedback WHERE id = ?", [id])).status, "novo");
});

test("corrigido é só de bug, adicionado só de ideia, e os dois exigem commit em hexadecimal", async () => {
  const bug = await novoRelato("bug");
  const ideia = await novoRelato("ideia");
  const sha = "a".repeat(40);

  assert.equal((await decidir(ideia, { status: "corrigido", resolution: "x", commit: sha })).statusCode, 400);
  assert.equal((await decidir(bug, { status: "adicionado", resolution: "x", commit: sha })).statusCode, 400);
  assert.equal((await decidir(bug, { status: "corrigido", resolution: "x" })).statusCode, 400);
  assert.equal((await decidir(bug, { status: "corrigido", resolution: "x", commit: "xyz" })).statusCode, 400);
  assert.equal((await decidir(bug, { status: "corrigido", resolution: "x", commit: "abc12" })).statusCode, 400);
  assert.equal((await decidir(bug, { status: "corrigido", resolution: "x", commit: "g".repeat(40) })).statusCode, 400);

  const ok = await decidir(bug, { status: "corrigido", resolution: "O botão volta a aparecer.", commit: sha.toUpperCase() });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.dados.relato.commit.sha, sha, "o commit não foi guardado em minúsculas");
  assert.equal(ok.dados.relato.commit.curto, "aaaaaaa");
});

test("fora de corrigido e adicionado, o commit não é guardado", async () => {
  const id = await novoRelato("bug");
  const res = await decidir(id, { status: "todo", resolution: "Plano: mexer no quadro.", commit: "b".repeat(40) });
  assert.equal(res.statusCode, 200);
  assert.equal(res.dados.relato.commit, null);
});

test("duplicado precisa apontar para outro relato que exista", async () => {
  const original = await novoRelato("ideia", "Exportar para planilha");
  const repetido = await novoRelato("ideia", "Exportar em CSV");

  assert.equal((await decidir(repetido, { status: "duplicado", resolution: "x" })).statusCode, 400);
  assert.equal((await decidir(repetido, { status: "duplicado", resolution: "x", duplicadoDe: repetido })).statusCode, 400);
  assert.equal((await decidir(repetido, { status: "duplicado", resolution: "x", duplicadoDe: 999999 })).statusCode, 400);

  const ok = await decidir(repetido, { status: "duplicado", resolution: "É o mesmo pedido.", duplicadoDe: original });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.dados.relato.duplicadoDe, original);
});

test("a mesma decisão reenviada é aceita sem história repetida", async () => {
  const id = await novoRelato("bug");
  const decisao = { status: "corrigido", resolution: "Corrigido no quadro.", commit: "c".repeat(40) };

  assert.equal((await decidir(id, decisao)).statusCode, 200);
  const antes = (await eventosDe(id)).length;

  const de_novo = await decidir(id, decisao);
  assert.equal(de_novo.statusCode, 200);
  assert.equal((await eventosDe(id)).length, antes, "o reenvio gravou história repetida");
});

test("decisão sobre relato que já saiu da fila é conflito", async () => {
  const id = await novoRelato("bug");
  assert.equal((await decidir(id, { status: "todo", resolution: "Plano: x." })).statusCode, 200);
  const res = await decidir(id, { status: "rejeitado", resolution: "Mudei de ideia." });
  assert.equal(res.statusCode, 409);
});

test("relato recusado enquanto o agente trabalhava não é ressuscitado pela decisão dele", async () => {
  const id = await novoRelato("bug", "Corrida entre o agente e quem administra");
  const lido = await chamar("/api/agente/relatos", doAgente());
  assert.ok(lido.dados.pendentes.some((p) => p.id === id));

  assert.equal((await acao(id, { acao: "recusar", nota: "Não é defeito." })).statusCode, 200);

  const tarde = await decidir(id, { status: "corrigido", resolution: "Corrigido.", commit: "d".repeat(40) });
  assert.equal(tarde.statusCode, 409);
  const r = await one("SELECT status, commit_sha FROM feedback WHERE id = ?", [id]);
  assert.equal(r.status, "rejeitado");
  assert.equal(r.commit_sha, null);
});

test("resolução vazia ou longa demais é recusada; caractere de controle sai e a quebra de linha fica", async () => {
  const id = await novoRelato();
  assert.equal((await decidir(id, { status: "detalhe", resolution: "   " })).statusCode, 400);
  assert.equal((await decidir(id, { status: "detalhe", resolution: "x".repeat(1501) })).statusCode, 400);

  const nulo = String.fromCharCode(0);
  const res = await decidir(id, { status: "detalhe", resolution: `Em qual tela?${nulo}\r\nE em que horário?` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.dados.relato.resolution, "Em qual tela?\nE em que horário?");
});

test("decisão sobre relato que não existe é 404", async () => {
  const res = await decidir(987654, { status: "rejeitado", resolution: "x" });
  assert.equal(res.statusCode, 404);
});

// --- Quem administra -----------------------------------------------------------

test("autorizar é de quem administra, e só a partir do TODO", async () => {
  const id = await novoRelato("ideia", "Um modo foco mais longo");

  assert.equal((await acao(id, { acao: "autorizar" })).statusCode, 409, "autorizou um relato que nem foi triado");

  assert.equal((await decidir(id, { status: "todo", resolution: "Plano: aumentar o limite do foco." })).statusCode, 200);
  assert.equal((await acao(id, { acao: "autorizar" }, membro)).statusCode, 403);

  const ok = await acao(id, { acao: "autorizar" });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.dados.relato.status, "autorizado");
  assert.equal(ok.dados.relato.resolution, "Plano: aumentar o limite do foco.", "autorizar apagou o plano");
  assert.equal(ok.dados.relato.eventos.at(-1).ator, "admin");
  assert.equal(ok.dados.relato.eventos.at(-1).atorNome, "Chefia");

  // Autorizado volta para a fila do agente, que é o que o faz ser implementado.
  const fila = await chamar("/api/agente/relatos", doAgente());
  assert.ok(fila.dados.pendentes.some((p) => p.id === id && p.status === "autorizado"));
});

test("recusar guarda o motivo; reabrir limpa o texto e o commit, e a história fica", async () => {
  const id = await novoRelato("bug");
  assert.equal((await decidir(id, { status: "corrigido", resolution: "Feito.", commit: "e".repeat(40) })).statusCode, 200);

  assert.equal((await acao(id, { acao: "recusar" })).statusCode, 409, "recusou o que já estava corrigido");

  const reaberto = await acao(id, { acao: "reabrir", nota: "Voltou a acontecer." });
  assert.equal(reaberto.statusCode, 200);
  assert.equal(reaberto.dados.relato.status, "novo");
  assert.equal(reaberto.dados.relato.resolution, null);
  assert.equal(reaberto.dados.relato.commit, null);
  assert.deepEqual(
    reaberto.dados.relato.eventos.map((e) => e.status),
    ["novo", "corrigido", "novo"]
  );
  assert.equal(reaberto.dados.relato.eventos.at(-1).nota, "Voltou a acontecer.");

  const recusado = await acao(id, { acao: "recusar", nota: "Não é defeito, é o limite do plano." });
  assert.equal(recusado.dados.relato.status, "rejeitado");
  assert.equal(recusado.dados.relato.resolution, "Não é defeito, é o limite do plano.");

  const semNota = await novoRelato("ideia");
  const r2 = await acao(semNota, { acao: "recusar" });
  assert.equal(r2.dados.relato.resolution, "Recusado por quem administra.");
});

test("ação desconhecida é recusada, inclusive as que todo objeto tem", async () => {
  const id = await novoRelato();
  for (const nome of ["apagar", "constructor", "__proto__", "toString", ""]) {
    const res = await acao(id, { acao: nome });
    assert.equal(res.statusCode, 400, `aceitou a ação ${JSON.stringify(nome)}`);
  }
});

test("ação sobre relato que não existe é 404", async () => {
  const res = await acao(876543, { acao: "reabrir" });
  assert.equal(res.statusCode, 404);
});

// --- Quem relatou --------------------------------------------------------------

test("complemento: só quem relatou, só quando o agente perguntou, e o relato volta para a fila", async () => {
  const id = await novoRelato("bug", "O quadro trava");

  const cedo = await chamar(`/api/feedback/${id}/complemento`, { user: membro, method: "POST", ...corpoJson({ texto: "No Chrome." }) });
  assert.equal(cedo.statusCode, 409, "aceitou resposta sem pergunta");

  assert.equal((await decidir(id, { status: "detalhe", resolution: "Em qual navegador?" })).statusCode, 200);

  const deOutro = await chamar(`/api/feedback/${id}/complemento`, { user: outro, method: "POST", ...corpoJson({ texto: "Não sei." }) });
  assert.equal(deOutro.statusCode, 403);

  const vazio = await chamar(`/api/feedback/${id}/complemento`, { user: membro, method: "POST", ...corpoJson({ texto: "  " }) });
  assert.equal(vazio.statusCode, 400);

  const ok = await chamar(`/api/feedback/${id}/complemento`, { user: membro, method: "POST", ...corpoJson({ texto: "No Chrome, ao arrastar." }) });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.dados.relato.status, "novo");
  assert.equal(ok.dados.relato.body, "O quadro trava\n\nComplemento: No Chrome, ao arrastar.");
  assert.equal(ok.dados.relato.resolution, "Em qual navegador?", "a pergunta sumiu antes de o agente ler a resposta");
  assert.deepEqual(ok.dados.relato.eventos.at(-1), {
    status: "novo",
    nota: "No Chrome, ao arrastar.",
    commit: null,
    ator: "autor",
    atorNome: "Bruno Exemplo",
    em: ok.dados.relato.eventos.at(-1).em,
  });
});

test("complemento que estoura o tamanho total é recusado", async () => {
  const id = await novoRelato("bug", "y".repeat(3990));
  assert.equal((await decidir(id, { status: "detalhe", resolution: "Pode detalhar?" })).statusCode, 200);
  const res = await chamar(`/api/feedback/${id}/complemento`, {
    user: membro,
    method: "POST",
    ...corpoJson({ texto: "z".repeat(1990) }),
  });
  assert.equal(res.statusCode, 200);

  assert.equal((await decidir(id, { status: "detalhe", resolution: "Mais?" })).statusCode, 200);
  const segunda = await chamar(`/api/feedback/${id}/complemento`, {
    user: membro,
    method: "POST",
    ...corpoJson({ texto: "w".repeat(1990) }),
  });
  assert.equal(segunda.statusCode, 200);

  assert.equal((await decidir(id, { status: "detalhe", resolution: "E mais?" })).statusCode, 200);
  const terceira = await chamar(`/api/feedback/${id}/complemento`, {
    user: membro,
    method: "POST",
    ...corpoJson({ texto: "v".repeat(1990) }),
  });
  assert.equal(terceira.statusCode, 400);
});

// --- A passada -----------------------------------------------------------------

test("a última passada aparece na lista, saneada", async () => {
  const nulo = String.fromCharCode(0);
  const res = await chamar("/api/agente/passada", {
    method: "POST",
    body: JSON.stringify({
      inicio: "2026-09-11T05:17:00.000Z",
      fim: "não é data",
      analisados: 3,
      decididos: "abc",
      publicados: -1,
      erro: `falhou${nulo} no push ${"!".repeat(400)}`,
    }),
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
  });
  assert.equal(res.statusCode, 200);

  const lista = await chamar("/api/feedback", { user: membro });
  const p = lista.dados.passada;
  assert.equal(p.inicio, "2026-09-11T05:17:00.000Z");
  assert.equal(p.fim, null);
  assert.equal(p.analisados, 3);
  assert.equal(p.decididos, 0);
  assert.equal(p.publicados, 0);
  assert.ok(p.erro.startsWith("falhou  no push"));
  assert.ok(p.erro.length <= 300);
});

// --- O painel de versões -------------------------------------------------------

test("comRelatos acrescenta os relatos pelo trailer e não mexe no objeto que recebeu", async () => {
  const id = await novoRelato("bug", "O rótulo corta");
  assert.equal((await decidir(id, { status: "corrigido", resolution: "O rótulo cabe inteiro.", commit: "f".repeat(40) })).statusCode, 200);

  const original = {
    fonte: "git",
    commits: [
      { sha: "fffffff", titulo: "Corrige o rotulo", corpo: `Porque cortava.\n\nRelato: ${id}\nRelato: 999999` },
      { sha: "1234567", titulo: "Outro commit", corpo: null },
    ],
  };
  original.atual = original.commits[0];
  const copia = JSON.parse(JSON.stringify(original));

  const saida = await comRelatos(original);

  assert.deepEqual(original, copia, "comRelatos escreveu no objeto do cache");
  assert.deepEqual(saida.commits[0].relatos, [
    { id, kind: "bug", status: "corrigido", autor: "Bruno Exemplo", resolution: "O rótulo cabe inteiro." },
  ]);
  assert.equal(saida.commits[1].relatos, undefined);
});

test("sem trailer nenhum, comRelatos nem consulta: devolve o que recebeu", async () => {
  const dados = { commits: [{ sha: "1", titulo: "x", corpo: "sem relato" }] };
  assert.equal(await comRelatos(dados), dados);
});

test("o commit que resolveu vira link do repositório e número de versão", async () => {
  let head;
  try {
    head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return; // sem git na máquina que roda o teste, não há linha do tempo para conferir
  }

  const id = await novoRelato("bug", "Relato resolvido pelo commit atual");
  assert.equal((await decidir(id, { status: "corrigido", resolution: "Feito.", commit: head })).statusCode, 200);

  const r = await relatoNaLista(id);
  assert.match(r.commit.url, /^https:[/][/]github[.]com[/][A-Za-z0-9_.-]+[/][A-Za-z0-9_.-]+[/]commit[/][0-9a-f]{40}$/);
  assert.match(r.versaoResolvida || "", /^1[.][0-9]+[.][0-9]+$/);
});

test("GET /api/versao responde com a linha do tempo, com sessão", async () => {
  const semSessao = await chamar("/api/versao");
  assert.equal(semSessao.statusCode, 401);
  const res = await chamar("/api/versao", { user: membro });
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.dados.commits));
});

// --- Arreio mínimo de requisição e resposta --------------------------------

function fingirRequisicao({ method = "GET", headers = {}, body = null }) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = { host: "exemplo.test", ...headers };
  req.socket = { remoteAddress: "10.0.0.1", encrypted: false };
  req.destroy = () => {};
  process.nextTick(() => {
    if (body) req.emit("data", Buffer.from(body));
    req.emit("end");
  });
  return req;
}

function fingirResposta() {
  const pedacos = [];
  const res = {
    statusCode: 0,
    headersSent: false,
    cabecalhos: {},
    writeHead(status, headers = {}) {
      this.statusCode = status;
      Object.assign(this.cabecalhos, headers);
      this.headersSent = true;
      return this;
    },
    end(dado) {
      if (dado) pedacos.push(Buffer.from(dado));
      this.headersSent = true;
      this.pronto?.();
      return this;
    },
    get corpo() {
      return Buffer.concat(pedacos).toString("utf8");
    },
    get dados() {
      return JSON.parse(this.corpo);
    },
  };
  res.espera = new Promise((r) => (res.pronto = r));
  return res;
}

async function chamar(caminho, { user = null, ...opcoes } = {}) {
  const url = new URL(caminho, "https://exemplo.test");
  const req = fingirRequisicao(opcoes);
  const res = fingirResposta();
  try {
    await handleApi(req, res, { path: url.pathname.replace(/^\/+/, ""), query: url.searchParams, user });
  } catch (err) {
    const status = err.status || 500;
    if (!res.headersSent) {
      const corpo = status >= 500 ? "Erro interno." : err.message;
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: corpo }));
    }
  }
  await res.espera;
  return res;
}

function corpoJson(objeto) {
  return {
    body: JSON.stringify(objeto),
    headers: { "content-type": "application/json", origin: "https://exemplo.test" },
  };
}

test("caractere invisível e de direção não entra no relato nem na resolução", async () => {
  const rlo = String.fromCharCode(0x202e);
  const pdf = String.fromCharCode(0x202c);
  const zw = String.fromCharCode(0x200b);
  const bom = String.fromCharCode(0xfeff);

  const id = await novoRelato("bug", `O bot${zw}ão ${rlo}esrevni ed otxet${pdf} some${bom}`);
  const r = await relatoNaLista(id);
  for (const ch of [rlo, pdf, zw, bom]) {
    assert.ok(!r.body.includes(ch), "caractere invisível ficou no corpo do relato");
  }
  assert.ok(r.body.startsWith("O botão "));

  const decidido = await decidir(id, { status: "detalhe", resolution: `Em qual ${rlo}alet${pdf}?${zw}` });
  assert.equal(decidido.statusCode, 200);
  for (const ch of [rlo, pdf, zw]) {
    assert.ok(!decidido.dados.relato.resolution.includes(ch), "caractere invisível ficou na resolução");
  }

  const resposta = await chamar(`/api/feedback/${id}/complemento`, {
    user: membro,
    method: "POST",
    ...corpoJson({ texto: `No ${rlo}emorhC${pdf}` }),
  });
  assert.equal(resposta.statusCode, 200);
  assert.ok(!resposta.dados.relato.body.includes(rlo), "caractere de direção entrou pelo complemento");
});

// --- A agenda do agente -------------------------------------------------------------

// A tela promete uma hora a quem relatou. A promessa vale enquanto a máquina
// que roda o agente aparece na hora marcada; quando ela falta, a tela precisa
// dizer isso em vez de prometer.
test("a agenda diz a próxima passada, e avisa quando a máquina do agente faltou", async () => {
  const { agendaDoAgente } = await import("../server/feedback.js");
  const passadaDe = (dia, minutos) => ({
    inicio: `2026-09-${dia}T08:17:00Z`,
    fim: `2026-09-${dia}T${String(8 + Math.floor((17 + minutos) / 60)).padStart(2, "0")}:${String((17 + minutos) % 60).padStart(2, "0")}:00Z`,
  });

  // Meia-noite em Brasília: a passada de hoje ainda vem, e a previsão é dela.
  const antes = agendaDoAgente(passadaDe("10", 23), new Date("2026-09-11T03:00:00Z"));
  assert.equal(antes.esperando, false);
  assert.equal(antes.horario, "05:17");
  assert.equal(antes.proxima, "2026-09-11T08:17:00.000Z");
  assert.equal(antes.entrega, "2026-09-11T08:40:00.000Z", "a previsão é a passada mais o tempo da última");

  // Já passou hoje: a próxima é a de amanhã.
  const depois = agendaDoAgente(passadaDe("11", 35), new Date("2026-09-11T12:00:00Z"));
  assert.equal(depois.esperando, false);
  assert.equal(depois.proxima, "2026-09-12T08:17:00.000Z");

  // Passou da hora e ela não veio, mas ainda está na janela: a tarefa roda
  // quando o computador liga, então a previsão é para já.
  const atrasada = agendaDoAgente(passadaDe("09", 35), new Date("2026-09-11T09:00:00Z"));
  assert.equal(atrasada.esperando, false);
  assert.ok(Date.parse(atrasada.entrega) - Date.parse("2026-09-11T09:00:00Z") <= 40 * 60000);

  // A janela fechou: sem previsão nenhuma.
  for (const p of [passadaDe("09", 35), null]) {
    assert.equal(agendaDoAgente(p, new Date("2026-09-11T13:30:00Z")).esperando, true);
  }
});
