// Testes da fronteira entre os dois modos de rodar.
//
// O que quebra em silêncio aqui não é regra de negócio: é uma configuração que
// existe num modo e falta no outro. O banco na nuvem com o anexo no disco, o
// limite de upload que só vale localmente, a limpeza de sessão que só o modo
// autônomo faz. Nenhum desses erros aparece na tela — aparece semanas depois,
// num upload que morre sem explicação ou numa tabela que só cresce.
//
//   node --test tests/auditoria-infra-docs.test.js

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.env.TDAH_DATA_DIR = mkdtempSync(join(tmpdir(), "tdah-test-"));

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

const { openDb, run, one, nowIso } = await import("../server/db.js");
const { DB_FILE, DATA_DIR } = await import("../server/paths.js");
const { createUser } = await import("../server/auth.js");
const { MAX_UPLOAD } = await import("../server/comments.js");
const { default: handler } = await import("../api/index.js");

// Roda um pedaço de código num processo separado, com o ambiente que o teste
// pedir. É o único jeito de observar o que os módulos decidem na importação:
// dentro deste processo eles já foram importados uma vez, sem essas variáveis.
function noAmbiente(env, codigo) {
  const saida = execFileSync(process.execPath, ["--input-type=module", "-e", codigo], {
    cwd: RAIZ,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return JSON.parse(saida.trim().split("\n").pop());
}

function url(rel) {
  return pathToFileURL(join(RAIZ, rel)).href;
}

// Resposta de mentira, no mínimo que sendJson precisa.
function respostaFalsa() {
  return {
    headersSent: false,
    status: 0,
    corpo: null,
    writeHead(status) {
      this.status = status;
      this.headersSent = true;
    },
    end(body) {
      this.corpo = body ? JSON.parse(Buffer.from(body).toString("utf8")) : null;
    },
  };
}

before(async () => {
  await openDb(DB_FILE);
});

after(() => {
  try {
    rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {}
});

// --- Limite de anexo -------------------------------------------------------

test("no modo autônomo o anexo continua cabendo em 12 MB", () => {
  assert.equal(MAX_UPLOAD, 12 * 1024 * 1024);
});

test("no modo hospedado o limite encolhe para o que a plataforma aceita", () => {
  const r = noAmbiente(
    { TURSO_DATABASE_URL: "libsql://exemplo.turso.io", TURSO_AUTH_TOKEN: "sem-valor" },
    `const m = await import(${JSON.stringify(url("server/comments.js"))});
     console.log(JSON.stringify({ max: m.MAX_UPLOAD }));`
  );
  assert.equal(r.max, 4 * 1024 * 1024);
  assert.ok(r.max < 12 * 1024 * 1024, "o limite hospedado precisa ser menor que o local");
});

// --- Banco na nuvem sem lugar para o anexo ---------------------------------

test("banco no Turso sem BLOB_READ_WRITE_TOKEN recusa a subir, dizendo o que falta", () => {
  const r = noAmbiente(
    {
      TURSO_DATABASE_URL: "libsql://exemplo.turso.io",
      TURSO_AUTH_TOKEN: "sem-valor",
      BLOB_READ_WRITE_TOKEN: "",
    },
    `const { default: handler } = await import(${JSON.stringify(url("api/index.js"))});
     let erro = "";
     console.error = (...a) => { erro += a.map(String).join(" "); };
     const res = {
       headersSent: false, status: 0,
       writeHead(s) { this.status = s; this.headersSent = true; },
       end() {},
     };
     await handler({ method: "GET", url: "/api/boot", headers: { host: "x" } }, res);
     console.log(JSON.stringify({ status: res.status, erro }));`
  );
  assert.equal(r.status, 500);
  assert.match(r.erro, /BLOB_READ_WRITE_TOKEN/);
});

// --- Sessões vencidas ------------------------------------------------------

// Precisa ser a primeira chamada ao handler no arquivo: a preparação roda uma
// vez só por instância, que é justamente a subida a frio que se quer testar.
test("a preparação da função sem servidor apaga as sessões vencidas", async () => {
  const u = await createUser({
    username: "sessoes",
    displayName: "Sessões",
    password: "apenas-para-teste",
  });

  await run("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)", [
    "token-vencido",
    u.id,
    nowIso(),
    new Date(Date.now() - 86400000).toISOString(),
  ]);
  await run("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)", [
    "token-valido",
    u.id,
    nowIso(),
    new Date(Date.now() + 86400000).toISOString(),
  ]);

  const res = respostaFalsa();
  await handler({ method: "GET", url: "/api/boot", headers: { host: "x" } }, res);
  assert.equal(res.status, 200);

  assert.equal(await one("SELECT token FROM sessions WHERE token = ?", ["token-vencido"]), null);
  assert.ok(await one("SELECT token FROM sessions WHERE token = ?", ["token-valido"]));
});

test("sem Turso o modo autônomo não exige token de anexo na nuvem", async () => {
  const res = respostaFalsa();
  await handler({ method: "GET", url: "/api/boot", headers: { host: "x" } }, res);
  assert.equal(res.status, 200);
  assert.equal(res.corpo.limits.maxUpload, MAX_UPLOAD);
});
