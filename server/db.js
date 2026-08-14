// Camada de banco, com dois destinos possíveis e uma interface só.
//
//   sem configuração   → SQLite em arquivo, pelo módulo embutido no Node
//   TURSO_DATABASE_URL → o mesmo SQLite, hospedado, falado por HTTP
//
// O dialeto é idêntico nos dois casos: Turso é SQLite. Foi por isso que ele
// foi escolhido no lugar de um Postgres — o esquema em core/schema.sql
// continua valendo sem tradução, e o modo local segue sendo testável de
// verdade, o que não aconteceria se o banco só existisse na nuvem.
//
// A interface é assíncrona mesmo no modo local, onde o driver é síncrono.
// Ter duas formas de chamar a mesma função seria uma armadilha permanente.

import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROOT } from "./paths.js";

let driver = null;

export function nowIso() {
  return new Date().toISOString();
}

export function today() {
  // Data local do servidor, não UTC: quem usa raciocina no fuso em que vive.
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export function modo() {
  return driver ? driver.tipo : null;
}

// --- Abertura --------------------------------------------------------------

export async function openDb(file) {
  driver = process.env.TURSO_DATABASE_URL ? criarTurso() : await criarLocal(file);
  await aplicarEsquema();
  return driver;
}

async function criarLocal(file) {
  const { DatabaseSync } = await import("node:sqlite");
  mkdirSync(dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");

  return {
    tipo: "local",
    async exec(sql) {
      db.exec(sql);
    },
    async consulta(sql, params) {
      return db
        .prepare(sql)
        .all(...params)
        .map((linha) => Object.assign({}, linha));
    },
    async executa(sql, params) {
      const r = db.prepare(sql).run(...params);
      return { lastInsertRowid: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
  };
}

// Turso pela API HTTP, sem biblioteca cliente. São duas chamadas de rede num
// formato simples; uma dependência aqui traria mais superfície do que ajuda.
function criarTurso() {
  const base = String(process.env.TURSO_DATABASE_URL)
    .replace(/^libsql:\/\//, "https://")
    .replace(/\/+$/, "");
  const token = process.env.TURSO_AUTH_TOKEN;

  if (!token) {
    throw new Error("TURSO_DATABASE_URL definido sem TURSO_AUTH_TOKEN.");
  }

  async function pipeline(pedidos) {
    const resposta = await fetch(`${base}/v2/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requests: [...pedidos, { type: "close" }] }),
    });

    if (!resposta.ok) {
      // O corpo do erro pode conter o endereço do banco; fica no log do
      // servidor e nunca é repassado para quem fez a requisição.
      const detalhe = await resposta.text().catch(() => "");
      console.error("[turso]", resposta.status, detalhe.slice(0, 500));
      throw new Error("Falha ao falar com o banco.");
    }

    const dados = await resposta.json();
    for (const r of dados.results || []) {
      if (r.type === "error") {
        console.error("[turso]", r.error?.message);
        throw new Error("Falha ao executar a consulta.");
      }
    }
    return dados.results || [];
  }

  const paraValor = (v) => {
    if (v === null || v === undefined) return { type: "null", value: null };
    if (typeof v === "number") {
      return Number.isInteger(v)
        ? { type: "integer", value: String(v) }
        : { type: "float", value: v };
    }
    if (typeof v === "boolean") return { type: "integer", value: v ? "1" : "0" };
    if (v instanceof Uint8Array) {
      return { type: "blob", base64: Buffer.from(v).toString("base64") };
    }
    return { type: "text", value: String(v) };
  };

  const doValor = (c) => {
    if (!c || c.type === "null") return null;
    if (c.type === "integer") return Number(c.value);
    if (c.type === "float") return Number(c.value);
    if (c.type === "blob") return Buffer.from(c.base64, "base64");
    return c.value;
  };

  const monta = (resultado) => {
    const r = resultado?.response?.result;
    if (!r) return [];
    const colunas = r.cols.map((c) => c.name);
    return r.rows.map((linha) => {
      const obj = {};
      linha.forEach((celula, i) => (obj[colunas[i]] = doValor(celula)));
      return obj;
    });
  };

  return {
    tipo: "turso",

    async exec(sql) {
      // Um lote de DDL vem separado por ponto e vírgula; a API executa uma
      // instrução por pedido.
      //
      // Os comentários precisam sair ANTES da divisão. Descartar o pedaço
      // inteiro só porque ele começa com "--" levaria junto a instrução que
      // vem logo abaixo do comentário — e o esquema deste projeto é comentado
      // linha a linha, então isso apagaria quase todas as tabelas.
      const instrucoes = sql
        .replace(/^[ \t]*--.*$/gm, "")
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s && !/^PRAGMA/i.test(s));

      // O serviço já cuida de journal e bloqueio, então PRAGMA não se aplica
      // e é descartado acima.
      for (const lote of pedacos(instrucoes, 20)) {
        await pipeline(lote.map((stmt) => ({ type: "execute", stmt: { sql: stmt } })));
      }
    },

    async consulta(sql, params) {
      const r = await pipeline([
        { type: "execute", stmt: { sql, args: params.map(paraValor) } },
      ]);
      return monta(r[0]);
    },

    async executa(sql, params) {
      const r = await pipeline([
        { type: "execute", stmt: { sql, args: params.map(paraValor) } },
      ]);
      const res = r[0]?.response?.result;
      return {
        lastInsertRowid: Number(res?.last_insert_rowid || 0),
        changes: Number(res?.affected_row_count || 0),
      };
    },
  };
}

function* pedacos(lista, tamanho) {
  for (let i = 0; i < lista.length; i += tamanho) yield lista.slice(i, i + tamanho);
}

async function aplicarEsquema() {
  const sql = readFileSync(join(ROOT, "core", "schema.sql"), "utf8");
  await driver.exec(sql);
}

export function getDb() {
  if (!driver) throw new Error("Banco não foi aberto.");
  return driver;
}

// --- Açúcar ----------------------------------------------------------------

export async function all(sql, params = []) {
  return getDb().consulta(sql, params);
}

export async function one(sql, params = []) {
  const linhas = await getDb().consulta(sql, params);
  return linhas.length ? linhas[0] : null;
}

export async function run(sql, params = []) {
  return getDb().executa(sql, params);
}

export async function insert(sql, params = []) {
  const r = await getDb().executa(sql, params);
  return Number(r.lastInsertRowid);
}

// Transação.
//
// No modo local é a transação real do SQLite. No Turso, cada chamada é uma
// requisição HTTP independente, e agrupá-las exigiria manter uma sessão
// aberta entre elas — o que não sobrevive a uma função serverless que pode
// ser encerrada a qualquer momento.
//
// A consequência é aceita conscientemente: uma criação de tarefa interrompida
// no meio pode deixar um número de projeto consumido sem tarefa. É um buraco
// na sequência, não uma perda de dado, e o log de eventos continua íntegro.
export async function tx(fn) {
  const d = getDb();
  if (d.tipo !== "local") return fn();

  await d.exec("BEGIN");
  try {
    const saida = await fn();
    await d.exec("COMMIT");
    return saida;
  } catch (err) {
    try {
      await d.exec("ROLLBACK");
    } catch {}
    throw err;
  }
}

// --- Configuração da instância ---------------------------------------------

export async function getSetting(key, fallback = null) {
  const linha = await one("SELECT value FROM settings WHERE key = ?", [key]);
  return linha ? linha.value : fallback;
}

export async function setSetting(key, value) {
  await run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, String(value), nowIso()]
  );
}
