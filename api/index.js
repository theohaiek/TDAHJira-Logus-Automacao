// Ponto de entrada quando o aplicativo roda como função sem servidor.
//
// A lógica é a mesma do modo autônomo: este arquivo só traduz o formato de
// requisição da plataforma para o que server/api.js já entende, e cuida de
// não reabrir o banco a cada chamada.
//
// Nenhuma credencial aparece aqui. As variáveis vêm do painel da hospedagem:
//   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, BLOB_READ_WRITE_TOKEN

import { openDb, getSetting, setSetting, one, nowIso } from "../server/db.js";
import { DB_FILE } from "../server/paths.js";
import { COOKIE, userFromToken, createUser, generatePassword, newInstallId } from "../server/auth.js";
import { handleApi } from "../server/api.js";
import { parseCookies, sendError, sameOrigin } from "../server/http.js";

// Uma instância que atendeu uma requisição costuma atender as seguintes.
// Guardar a promessa (e não o resultado) evita que duas chamadas simultâneas
// abram o banco duas vezes.
let preparacao = null;

async function pronto() {
  if (!preparacao) {
    preparacao = (async () => {
      await openDb(DB_FILE);

      if (!(await getSetting("install_id"))) {
        await setSetting("install_id", newInstallId());
        await setSetting("version", "1.0.0");
        await setSetting("created_at", nowIso());
      }

      // Primeira subida em uma instalação nova: sem nenhuma conta, não há
      // como entrar. A senha é sorteada e aparece uma única vez no log da
      // plataforma — é onde a pessoa que fez o deploy vai buscá-la.
      const total = (await one("SELECT COUNT(*) AS n FROM users")).n;
      if (total === 0) {
        const senha = process.env.ADMIN_INITIAL_PASSWORD || generatePassword();
        await createUser({
          username: process.env.ADMIN_USERNAME || "admin",
          displayName: process.env.ADMIN_NAME || "Administração",
          password: senha,
          role: "admin",
        });
        console.log("");
        console.log("  Primeira conta criada.");
        console.log(`  usuário: ${process.env.ADMIN_USERNAME || "admin"}`);
        if (!process.env.ADMIN_INITIAL_PASSWORD) {
          console.log(`  senha:   ${senha}`);
          console.log("  Anote agora e troque no primeiro acesso, em Ajustes.");
        }
        console.log("");
      }
    })().catch((err) => {
      // Uma falha na preparação não pode ficar em cache, senão a instância
      // devolve erro para sempre sem nunca tentar de novo.
      preparacao = null;
      throw err;
    });
  }
  return preparacao;
}

export default async function handler(req, res) {
  try {
    await pronto();

    if (!sameOrigin(req)) return sendError(res, 403, "Origem não permitida.");

    // A plataforma entrega o caminho completo; o roteador interno espera
    // "api/..." sem a barra inicial e sem a query.
    const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
    const path = url.pathname.replace(/^\/+/, "") || "api";

    const cookies = parseCookies(req.headers.cookie);
    const user = await userFromToken(cookies[COOKIE]);

    return await handleApi(req, res, { path, query: url.searchParams, user });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) {
      console.error("[erro]", err);
      if (!res.headersSent) sendError(res, 500, "Erro interno. Confira o log do servidor.");
      else res.end();
    } else {
      if (!res.headersSent) sendError(res, status, err.message || "Requisição inválida.");
      else res.end();
    }
  }
}

// O corpo da requisição precisa chegar cru: o upload de anexo é binário puro,
// e uma análise automática de JSON o corromperia.
export const config = {
  api: { bodyParser: false },
};
