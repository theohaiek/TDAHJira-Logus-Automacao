// Relatos de quem usa: bug ou ideia, escritos de dentro do aplicativo.
//
// O relato mora no banco, e é lá que ele fica. Encaminhar ao GitHub é opcional
// e desligado por padrão, porque o repositório deste projeto é PÚBLICO — e um
// relato de defeito quase sempre carrega um pedaço do trabalho real: o nome de
// um cliente, o título de uma tarefa, o que alguém estava fazendo quando deu
// errado. Publicar isso sem querer é o risco que esta função existe para não
// correr.
//
// Para ligar o encaminhamento, quem publica define duas variáveis:
//
//   FEEDBACK_GITHUB_REPO   dono/nome de um repositório PRIVADO
//   FEEDBACK_GITHUB_TOKEN  token de acesso com permissão SÓ de Issues, SÓ nele
//
// O token nunca sai do servidor: não volta em resposta nenhuma, não vai para o
// navegador, não entra no log.

import { all, insert, one, run, nowIso } from "./db.js";
import { badRequest } from "./tasks.js";

export const TIPOS = ["bug", "ideia"];

// O bastante para descrever um defeito com passos e o que se esperava. Um
// relato maior do que isto quase sempre é uma lista de coisas diferentes, e
// cada uma merecia o seu.
const TETO_DO_TEXTO = 4000;

// Quantos relatos por pessoa, por hora. Conta no banco, e não em memória: no
// modo hospedado cada instância tem a sua, e um freio em memória seria um
// freio por instância — ou seja, nenhum.
const POR_HORA = 12;

export async function registrarFeedback(entrada, user) {
  const kind = String(entrada?.kind || "").trim();
  if (!TIPOS.includes(kind)) throw badRequest("Diga se é um bug ou uma ideia.");

  const body = String(entrada?.body || "").trim();
  if (!body) throw badRequest("Escreva o que aconteceu, ou o que você teve em mente.");
  if (body.length > TETO_DO_TEXTO) {
    throw badRequest(`Ficou longo demais: o limite é ${TETO_DO_TEXTO} caracteres.`);
  }

  // Tela e versão vêm do navegador e são só contexto, então entram cortadas e
  // sem confiança: ninguém decide nada a partir delas.
  const page = limpar(entrada?.page, 120);
  const version = limpar(entrada?.version, 40);

  const umaHoraAtras = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recentes = await one(
    "SELECT COUNT(*) AS n FROM feedback WHERE author_id = ? AND created_at > ?",
    [user.id, umaHoraAtras]
  );
  if ((recentes?.n || 0) >= POR_HORA) {
    const erro = new Error("Muitos relatos em pouco tempo. Tente de novo daqui a pouco.");
    erro.status = 429;
    throw erro;
  }

  const id = await insert(
    `INSERT INTO feedback (kind, body, author_id, page, version, created_at)
     VALUES (?,?,?,?,?,?)`,
    [kind, body, user.id, page, version, nowIso()]
  );

  // O relato já está salvo. O encaminhamento é um extra: se falhar, quem
  // escreveu não pode perder o que escreveu por causa disso.
  const issueUrl = await encaminharAoGithub({ id, kind, body, page, version }).catch(() => null);
  if (issueUrl) {
    await run("UPDATE feedback SET issue_url = ? WHERE id = ?", [issueUrl, id]);
  }

  return { id, encaminhado: !!issueUrl };
}

export async function listarFeedback() {
  const linhas = await all(
    `SELECT f.id, f.kind, f.body, f.page, f.version, f.issue_url, f.created_at,
            u.display_name AS autor
       FROM feedback f
       LEFT JOIN users u ON u.id = f.author_id
      ORDER BY f.id DESC`
  );
  return linhas.map((r) => ({
    id: r.id,
    kind: r.kind,
    body: r.body,
    page: r.page,
    version: r.version,
    issueUrl: r.issue_url,
    autor: r.autor,
    createdAt: r.created_at,
  }));
}

// --- GitHub ----------------------------------------------------------------

// Formato de "dono/nome", e nada além. É o que impede um valor de variável mal
// escrito de virar outro caminho da API — ou, pior, outro endereço.
const REPO_VALIDO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function encaminhamentoConfigurado() {
  const repo = process.env.FEEDBACK_GITHUB_REPO || "";
  return !!process.env.FEEDBACK_GITHUB_TOKEN && REPO_VALIDO.test(repo);
}

async function encaminharAoGithub({ id, kind, body, page, version }) {
  if (!encaminhamentoConfigurado()) return null;
  const repo = process.env.FEEDBACK_GITHUB_REPO;

  const r = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.FEEDBACK_GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "tdah-logus",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      title: `${kind === "bug" ? "Bug" : "Ideia"}: ${tituloDe(body)}`,
      body: corpoDaIssue({ id, kind, body, page, version }),
      labels: [kind],
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!r.ok) return null;
  const issue = await r.json().catch(() => null);
  // Só se aceita de volta um endereço do próprio GitHub. É o que vai ser
  // mostrado a quem administra como link, e um valor de outro lugar não teria
  // por que estar ali.
  const url = String(issue?.html_url || "");
  return url.startsWith("https://github.com/") ? url : null;
}

// O título da issue é a primeira linha do relato, curta. O GitHub corta em 256,
// e um título que se lê inteiro numa lista vale mais do que um que se corta.
function tituloDe(body) {
  const primeira = body.split("\n")[0].trim();
  return primeira.length > 80 ? `${primeira.slice(0, 77)}…` : primeira;
}

function corpoDaIssue({ id, kind, body, page, version }) {
  return [
    neutralizar(body),
    "",
    "---",
    `Tipo: ${kind}`,
    page ? `Tela: ${neutralizar(page)}` : null,
    version ? `Versão: ${neutralizar(version)}` : null,
    `Relato nº ${id} no banco do aplicativo.`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

// O relato vai para o GitHub como texto de quem escreveu, e o GitHub interpreta
// duas coisas nele que ninguém quis dizer: menção a pessoa (@fulano), que
// notifica alguém de fora, e referência a outra issue (#12), que cria ligação
// no histórico de uma issue que não tem nada a ver. Um espaço de largura zero
// depois do sinal desliga as duas e mantém o texto legível.
function neutralizar(texto) {
  return String(texto).replace(/([@#])(?=[\w-])/g, "$1\u200B");
}

function limpar(valor, teto) {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  return texto ? texto.slice(0, teto) : null;
}
