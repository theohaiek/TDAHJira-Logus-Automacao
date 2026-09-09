// De que versão é o que está rodando, e o que mudou até chegar aqui.
//
// A pergunta parece trivial e não é: o aplicativo roda em dois lugares muito
// diferentes. No modo autônomo o repositório está no disco, ao lado do
// servidor, e `git` responde tudo. No modo hospedado não existe repositório
// nenhum — a plataforma copia os arquivos e joga o histórico fora —, então a
// única fonte do histórico é a API pública do GitHub.
//
// Este módulo esconde essa diferença atrás de uma resposta só. Quem chama não
// precisa saber de onde veio; o campo `fonte` diz, para quem for diagnosticar.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ROOT } from "./paths.js";

const exec = promisify(execFile);

// Quantos commits a linha do tempo mostra. Vinte cobre semanas de trabalho
// neste ritmo e cabe numa rolagem curta; quem quiser mais tem o repositório.
const TETO = 20;

// A API do GitHub sem credencial dá sessenta chamadas por hora por endereço.
// No modo hospedado o endereço é o da plataforma, compartilhado entre todas as
// instâncias — sem esta memória, uma sala com cinco pessoas clicando esgotaria
// a cota em minutos e o painel passaria a abrir vazio.
const VALIDADE_MS = 5 * 60 * 1000;
let cache = null;

export async function versao() {
  if (cache && Date.now() - cache.em < VALIDADE_MS) return cache.dados;

  const dados = await montar();
  dados.app = await versaoDoPacote();
  cache = { em: Date.now(), dados };
  return dados;
}

// O número que a pessoa lê. Vem do package.json, que é onde ele já é mantido —
// duplicá-lo numa constante aqui seria criar um segundo lugar para esquecer de
// mudar. Se o arquivo não vier junto no pacote publicado, o commit sozinho
// ainda identifica a versão, e é ele que a linha do tempo cruza.
async function versaoDoPacote() {
  try {
    const bruto = await readFile(join(ROOT, "package.json"), "utf8");
    return JSON.parse(bruto).version || null;
  } catch {
    return null;
  }
}

async function montar() {
  const doGit = await doRepositorioLocal();
  if (doGit) return doGit;

  const doGithub = await doGithubRemoto();
  if (doGithub) return doGithub;

  // Nem repositório nem rede. Ainda dá para dizer em que commit a plataforma
  // publicou, que é a informação que mais importa das três.
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || "";
  return {
    fonte: sha ? "plataforma" : "nenhuma",
    repo: repoConfigurado(),
    atual: sha
      ? {
          sha: sha.slice(0, 7),
          data: null,
          titulo: (process.env.VERCEL_GIT_COMMIT_MESSAGE || "").split("\n")[0] || null,
        }
      : null,
    commits: [],
    // Sem histórico não há como saber se ficou para trás. Dizer "em dia" aqui
    // seria afirmar o que não se apurou.
    atras: null,
  };
}

// --- Repositório no disco ---------------------------------------------------

async function doRepositorioLocal() {
  // A plataforma não tem git nem repositório, e tentar assim mesmo custa um
  // processo que sempre falha em cada chamada fria.
  if (process.env.VERCEL) return null;

  const linhas = await git([
    "log",
    `-${TETO}`,
    // %x1f e %x1e são os separadores de unidade e de registro do ASCII. Usar
    // caractere de controle, e não vírgula ou barra, é o que faz uma mensagem
    // de commit com qualquer pontuação atravessar inteira.
    "--pretty=format:%h%x1f%cI%x1f%s%x1f%b%x1e",
  ]);
  if (linhas === null) return null;

  const commits = linhas
    .split("\x1e")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((registro) => {
      const [sha, data, titulo, corpo] = registro.split("\x1f");
      return { sha, data, titulo, corpo: (corpo || "").trim() || null };
    });

  return {
    fonte: "git",
    repo: (await remoto()) || repoConfigurado(),
    atual: commits[0] || null,
    commits,
    atras: 0,
  };
}

// Um só lugar para lidar com o git faltando, o diretório não sendo repositório
// e o comando travando. Qualquer um dos três devolve null, e quem chamou passa
// para a próxima fonte em vez de estourar a requisição inteira.
async function git(args) {
  try {
    const { stdout } = await exec("git", args, {
      cwd: ROOT,
      timeout: 4000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch {
    return null;
  }
}

async function remoto() {
  const url = (await git(["remote", "get-url", "origin"]))?.trim();
  if (!url) return null;
  // Serve para os dois formatos que o mesmo repositório tem: o de HTTPS e o
  // de SSH.
  const m = url.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

// --- GitHub -----------------------------------------------------------------

function repoConfigurado() {
  if (process.env.GIT_REPO) return process.env.GIT_REPO;
  const dono = process.env.VERCEL_GIT_REPO_OWNER;
  const nome = process.env.VERCEL_GIT_REPO_SLUG;
  return dono && nome ? `${dono}/${nome}` : null;
}

async function doGithubRemoto() {
  const repo = repoConfigurado();
  if (!repo) return null;

  const ramo = process.env.VERCEL_GIT_COMMIT_REF || "main";
  let bruto;
  try {
    const r = await fetch(
      `https://api.github.com/repos/${repo}/commits?sha=${encodeURIComponent(ramo)}&per_page=${TETO}`,
      {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "tdah-logus" },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!r.ok) return null;
    bruto = await r.json();
  } catch {
    return null;
  }
  if (!Array.isArray(bruto)) return null;

  const commits = bruto.map((c) => {
    const [titulo, ...resto] = String(c.commit?.message || "").split("\n");
    return {
      sha: String(c.sha || "").slice(0, 7),
      data: c.commit?.committer?.date || c.commit?.author?.date || null,
      titulo: titulo || null,
      corpo: resto.join("\n").trim() || null,
    };
  });

  // O que a plataforma publicou pode não ser a ponta do ramo: um deploy que
  // ainda está subindo, ou um que falhou, deixa o servidor atrás do GitHub. A
  // distância é a única maneira honesta de responder "estou atualizado?".
  const publicado = String(process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7);
  const indice = publicado ? commits.findIndex((c) => c.sha === publicado) : 0;

  return {
    fonte: "github",
    repo,
    atual: (indice >= 0 ? commits[indice] : null) || commits[0] || null,
    commits,
    atras: indice > 0 ? indice : indice === 0 ? 0 : null,
  };
}
