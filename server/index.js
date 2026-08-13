// Ponto de entrada do modo autônomo.
//
//   node server/index.js            sobe o servidor
//   node server/index.js --setup    cria a instância e a primeira conta
//   node server/index.js --demo     preenche com dados de exemplo
//
// Sem instalação de pacotes, sem serviço de banco, sem etapa de compilação.

// O SQLite embutido no Node ainda é marcado como experimental e imprime um
// aviso a cada execução. O aviso não muda nada em uso, e poluiria o terminal
// de quem só quer abrir o aplicativo.
const avisos = process.listeners("warning");
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name === "ExperimentalWarning" && /SQLite/i.test(w.message)) return;
  for (const l of avisos) l(w);
});

import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { existsSync, mkdirSync } from "node:fs";
import { openDb, getSetting, setSetting, one, nowIso, modo } from "./db.js";
import { DB_FILE, DATA_DIR, UPLOAD_DIR, WEB_DIR, ROOT } from "./paths.js";
import {
  COOKIE,
  createUser,
  generatePassword,
  userFromToken,
  purgeExpiredSessions,
  newInstallId,
} from "./auth.js";
import { handleApi } from "./api.js";
import { parseCookies, sendError, serveStatic, sameOrigin } from "./http.js";
import { seedDemo } from "./demo.js";

const args = process.argv.slice(2);
const flag = (nome) => args.includes(`--${nome}`);
const valor = (nome, padrao) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : padrao;
};

const PORT = Number(valor("port", process.env.PORT || 4173));
const HOST = valor("host", process.env.HOST || "0.0.0.0");

await iniciar();

async function iniciar() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(UPLOAD_DIR, { recursive: true });

  const primeiraVez = !existsSync(DB_FILE);
  await openDb(DB_FILE);

  if (!(await getSetting("install_id"))) {
    await setSetting("install_id", newInstallId());
    await setSetting("version", "1.0.0");
    await setSetting("created_at", nowIso());
  }

  if (flag("setup") || (primeiraVez && !flag("demo"))) {
    await prepararInstancia();
    if (flag("setup") && !flag("serve")) process.exit(0);
  }

  if (flag("demo")) {
    const r = await seedDemo();
    console.log(`  Dados de exemplo criados: ${r.tasks} tarefas em ${r.projects} projetos.`);
    if (r.credentials?.length) {
      console.log("");
      console.log("  ─────────────────────────────────────────────");
      for (const c of r.credentials) console.log(`  usuário: ${c.username}   senha: ${c.password}`);
      console.log("  ─────────────────────────────────────────────");
      console.log("");
    }
    if (!flag("serve")) process.exit(0);
  }

  await purgeExpiredSessions();
  subirServidor();
}

async function prepararInstancia() {
  const total = (await one("SELECT COUNT(*) AS n FROM users")).n;

  if (total === 0) {
    const usuario = valor("user", "admin");
    const nome = valor("name", "Administração");
    const senha = valor("password", generatePassword());

    await createUser({ username: usuario, displayName: nome, password: senha, role: "admin" });

    console.log("");
    console.log("  Instância criada.");
    console.log("  ─────────────────────────────────────────────");
    console.log(`  usuário: ${usuario}`);
    console.log(`  senha:   ${senha}`);
    console.log("  ─────────────────────────────────────────────");
    console.log("  Anote a senha: ela não é mostrada de novo.");
    console.log("  Troque no primeiro acesso, em Ajustes.");
    console.log("");
  } else if (flag("setup")) {
    console.log("  A instância já tem contas. Nada a fazer.");
  }
}

// --- Servidor ---------------------------------------------------------------

function subirServidor() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const path = url.pathname.replace(/^\/+/, "");

    try {
      if (!sameOrigin(req)) return sendError(res, 403, "Origem não permitida.");

      if (path === "api" || path.startsWith("api/")) {
        const cookies = parseCookies(req.headers.cookie);
        const user = await userFromToken(cookies[COOKIE]);
        return await handleApi(req, res, { path, query: url.searchParams, user });
      }

      // Arquivos da interface.
      const alvo = path === "" ? "index.html" : path;
      if (serveStatic(res, WEB_DIR, alvo, { immutable: false })) return;

      // Os arquivos de marca vivem fora de web/ porque são material da
      // empresa, não código da interface.
      if (alvo.startsWith("assets/") && serveStatic(res, ROOT, alvo)) return;

      // Rota desconhecida cai na aplicação: a navegação é resolvida no cliente.
      if (!alvo.includes(".") && serveStatic(res, WEB_DIR, "index.html")) return;

      return sendError(res, 404, "Não encontrado.");
    } catch (err) {
      const status = err.status || 500;
      // Erro esperado leva a mensagem curada adiante; erro inesperado fica no
      // log do servidor e vai embora genérico — detalhe de driver ou de SQL na
      // resposta entrega a estrutura interna a quem estiver sondando.
      if (status >= 500) {
        console.error("[erro]", err);
        if (!res.headersSent) sendError(res, 500, "Erro interno. Confira o log do servidor.");
        else res.end();
      } else {
        if (!res.headersSent) sendError(res, status, err.message || "Requisição inválida.");
        else res.end();
      }
    }
  });

  server.listen(PORT, HOST, () => {
    const enderecos = ["localhost", ...enderecosDeRede()];
    console.log("");
    console.log("  TDAH Jira — Logus Soluções em Automação");
    console.log("  ─────────────────────────────────────────────");
    for (const e of enderecos) console.log(`  http://${e}:${PORT}`);
    console.log("  ─────────────────────────────────────────────");
    console.log(`  banco: ${modo() === "turso" ? "hospedado" : DATA_DIR}`);
    console.log("  Ctrl+C para encerrar.");
    console.log("");
  });

  for (const sinal of ["SIGINT", "SIGTERM"]) {
    process.on(sinal, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1500).unref();
    });
  }
}

function enderecosDeRede() {
  const out = [];
  for (const lista of Object.values(networkInterfaces())) {
    for (const i of lista || []) {
      if (i.family === "IPv4" && !i.internal) out.push(i.address);
    }
  }
  return out;
}
