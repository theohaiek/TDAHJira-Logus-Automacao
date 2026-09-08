// A subida sobre um banco que já está em uso.
//
// Este teste existe porque a versão de 8 de setembro de 2026 derrubou a
// produção inteira por vinte minutos, e nada na suíte pegou.
//
// A causa: o esquema roda inteiro a cada subida e ANTES da lista MIGRACOES.
// Um `CREATE INDEX` sobre coluna que só nasce na migração passa no banco novo
// (onde o `CREATE TABLE` já traz a coluna) e falha no banco que já existe —
// que é exatamente o banco de produção. E como quem falha é openDb(), não é
// uma rota que quebra: é toda a aplicação, com 500 em tudo, inclusive no
// /boot.
//
// O modo local mascara: o driver manda o arquivo de uma vez só. O hospedado
// executa instrução por instrução, e é lá que o erro aparece — o mesmo padrão
// da armadilha 4.1 do HANDOFF.
//
// Por isso o teste roda o esquema como o driver hospedado roda: uma instrução
// de cada vez, sobre um banco criado pela versão anterior.
//
//   node --test tests/migracao.test.js

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const TEMP = mkdtempSync(join(tmpdir(), "tdah-migracao-"));

after(() => {
  try {
    rmSync(TEMP, { recursive: true, force: true });
  } catch {}
});

// A mesma divisão que o driver hospedado faz em server/db.js: comentários
// saem antes, PRAGMA é descartado, e cada instrução vai sozinha.
function instrucoesDe(sql) {
  return sql
    .replace(/^[ \t]*--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s && !/^PRAGMA/i.test(s));
}

// As colunas que só existem depois da lista MIGRACOES rodar. Ler direto do
// arquivo, e não do banco, é o que faz este teste valer para a coluna que
// alguém acrescentar amanhã.
function colunasMigradas() {
  const fonte = readFileSync(join(RAIZ, "server/db.js"), "utf8");
  const lista = fonte.slice(fonte.indexOf("const MIGRACOES"), fonte.indexOf("async function aplicarMigracoes"));
  // Tabela e coluna, sempre juntas: "kind" migrou em tasks, mas events.kind
  // existe desde a primeira versão. Comparar só o nome da coluna acusaria o
  // índice errado.
  return [...lista.matchAll(/tabela:\s*"(\w+)",\s*coluna:\s*"(\w+)"/g)].map((m) => ({
    tabela: m[1],
    coluna: m[2],
  }));
}

test("nenhum índice do esquema depende de coluna que só nasce na migração", () => {
  const migradas = colunasMigradas();
  assert.ok(migradas.length, "não achei as colunas de MIGRACOES — a extração quebrou");

  const esquema = readFileSync(join(RAIZ, "core/schema.sql"), "utf8");
  const indices = [...esquema.matchAll(/CREATE (?:UNIQUE )?INDEX[^;]*;/gi)].map((m) => m[0]);

  const errados = [];
  for (const indice of indices) {
    // Comentário citando a coluna é justamente onde se explica por que ela
    // não está aqui. O que importa é o corpo do CREATE INDEX.
    const corpo = indice.replace(/^[ \t]*--.*$/gm, "");
    const sobre = corpo.match(/\bON\s+(\w+)\s*\(([^)]*)\)/i);
    if (!sobre) continue;

    for (const { tabela, coluna } of migradas) {
      if (sobre[1] !== tabela) continue;
      if (new RegExp(`\\b${coluna}\\b`).test(sobre[2])) {
        errados.push(`${corpo.split("\n")[0].slice(0, 70)} usa ${tabela}.${coluna}`);
      }
    }
  }

  // O esquema roda inteiro, e ANTES de MIGRACOES. Num banco que já existe, a
  // coluna ainda não está lá: o índice falha, openDb() falha junto, e toda a
  // aplicação responde 500 — inclusive o /boot. Passa no banco novo e derruba
  // a produção. O índice pertence à migração, ao lado do ALTER TABLE.
  assert.deepEqual(errados, [], "mova este índice para a entrada de MIGRACOES em server/db.js");
});

test("o esquema atual também sobe num banco vazio", () => {
  const db = new DatabaseSync(join(TEMP, "novo.db"));
  const falhas = [];

  for (const stmt of instrucoesDe(readFileSync(join(RAIZ, "core/schema.sql"), "utf8"))) {
    try {
      db.exec(stmt);
    } catch (err) {
      falhas.push(`${stmt.split("\n")[0].slice(0, 70)} :: ${err.message}`);
    }
  }
  db.close();

  assert.deepEqual(falhas, [], "o esquema não aplica nem em banco novo");
});

test("reaplicar o esquema duas vezes seguidas não quebra", () => {
  const db = new DatabaseSync(join(TEMP, "duasvezes.db"));
  const instrucoes = instrucoesDe(readFileSync(join(RAIZ, "core/schema.sql"), "utf8"));
  const falhas = [];

  // O arquivo roda inteiro a cada subida do servidor, não só na criação.
  for (const volta of [1, 2]) {
    for (const stmt of instrucoes) {
      try {
        db.exec(stmt);
      } catch (err) {
        falhas.push(`volta ${volta}: ${stmt.split("\n")[0].slice(0, 60)} :: ${err.message}`);
      }
    }
  }
  db.close();

  assert.deepEqual(falhas, [], "todo DDL do esquema precisa ser idempotente");
});

test("a migração aplica sobre um banco que não tem a coluna", () => {
  // O cenário do banco de produção, montado à mão: o esquema atual sem as
  // colunas migradas, que é o estado de quem instalou antes delas existirem.
  const migradas = colunasMigradas();
  const esquema = readFileSync(join(RAIZ, "core/schema.sql"), "utf8");

  const semColunas = instrucoesDe(esquema).map((stmt) =>
    migradas.reduce((s, { tabela, coluna }) => {
      // Só tira a coluna da tabela que a migração toca: o mesmo nome pode
      // existir em outra tabela desde sempre.
      if (!new RegExp(`CREATE TABLE IF NOT EXISTS ${tabela}\\b`, "i").test(s)) return s;
      return s.replace(new RegExp(`^\\s*${coluna}\\s+[^,\\n]*,?$`, "gm"), "");
    }, stmt)
  );

  const db = new DatabaseSync(join(TEMP, "sem-colunas.db"));
  for (const stmt of semColunas) {
    try {
      db.exec(stmt);
    } catch {}
  }

  // Agora a subida completa: esquema inteiro de novo, e depois as migrações.
  const falhas = [];
  for (const stmt of instrucoesDe(esquema)) {
    try {
      db.exec(stmt);
    } catch (err) {
      falhas.push(`esquema: ${stmt.split("\n")[0].slice(0, 60)} :: ${err.message}`);
    }
  }

  const fonte = readFileSync(join(RAIZ, "server/db.js"), "utf8");
  const lista = fonte.slice(fonte.indexOf("const MIGRACOES"), fonte.indexOf("async function aplicarMigracoes"));
  for (const [, ddl] of lista.matchAll(/"(ALTER TABLE [^"]+|CREATE INDEX [^"]+)"/g)) {
    try {
      db.exec(ddl);
    } catch (err) {
      if (!/duplicate column/i.test(err.message)) {
        falhas.push(`migração: ${ddl.slice(0, 60)} :: ${err.message}`);
      }
    }
  }
  db.close();

  assert.deepEqual(falhas, [], "a subida quebra num banco que veio da versão anterior");
});
