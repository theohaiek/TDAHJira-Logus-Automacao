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
  numerar(dados);
  cache = { em: Date.now(), dados };
  return dados;
}

// O número que a pessoa lê: 1.1.07, e não 7b16447.
//
// Um identificador de commit responde "qual código exatamente", que é uma
// pergunta de quem for depurar. Quem abre o painel está perguntando outra
// coisa — "a minha é mais nova ou mais velha que a dela?" —, e sete dígitos de
// hexadecimal não se comparam de cabeça. Um número que só cresce, sim.
//
// Os dois primeiros campos vêm do package.json, que é onde a versão do produto
// já é mantida. O terceiro é a contagem de commits: cada publicação anda um, e
// ninguém precisa lembrar de mexer em lugar nenhum. Dois dígitos com zero à
// esquerda até o 99, e daí para cima cresce sozinho.
//
// O identificador não some — ele passa para o title de cada linha, que é onde
// quem for depurar vai procurá-lo.
function numerar(dados) {
  const base = String(dados.app || "")
    .split(".")
    .slice(0, 2)
    .join(".");

  if (!base || !dados.total || !dados.commits?.length) return;

  // Um total menor que a própria lista é total errado — a contagem falhou e
  // devolveu um número de mentira. Numerar assim daria "1.1.00" e "1.1.-1" na
  // tela, que é pior do que não numerar: o painel cai no identificador do
  // commit, que é feio e é verdade.
  if (dados.total < dados.commits.length) return;

  // O mais recente da lista é o de número `total`; cada um abaixo dele, um a
  // menos. É por posição, e não por contagem própria de cada commit, porque
  // contar de novo para cada um custaria uma ida ao git por linha.
  dados.commits.forEach((c, i) => {
    c.versao = `${base}.${String(dados.total - i).padStart(2, "0")}`;
  });

  const atual = dados.commits.find((c) => c.sha === dados.atual?.sha);
  if (atual && dados.atual) dados.atual.versao = atual.versao;
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
    repo: await repoConfigurado(),
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
    repo: (await remoto()) || (await repoConfigurado()),
    atual: commits[0] || null,
    commits,
    // Quantos commits existem até aqui. É o terceiro campo da versão, e sai de
    // uma pergunta só ao git — contar por commit seria uma por linha.
    total: Number((await git(["rev-list", "--count", "HEAD"]))?.trim()) || 0,
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
  return url ? doUrl(url) : null;
}

// --- GitHub -----------------------------------------------------------------

// Qual repositório é este, em ordem de confiança: o que foi dito à mão, o que a
// plataforma injeta, e o que o package.json declara. O último existe porque as
// variáveis de sistema da plataforma são opcionais — dá para desligá-las no
// painel, e sem esta rede o histórico abriria vazio no modo hospedado sem que
// nada no código explicasse por quê.
async function repoConfigurado() {
  if (process.env.GIT_REPO) return process.env.GIT_REPO;

  const dono = process.env.VERCEL_GIT_REPO_OWNER;
  const nome = process.env.VERCEL_GIT_REPO_SLUG;
  if (dono && nome) return `${dono}/${nome}`;

  try {
    const bruto = await readFile(join(ROOT, "package.json"), "utf8");
    return doUrl(JSON.parse(bruto).repository?.url || "");
  } catch {
    return null;
  }
}

// O mesmo endereço de repositório aparece em dois formatos, o de HTTPS e o de
// SSH, e os dois chegam aqui: um vindo do remoto do git, outro do package.json.
function doUrl(url) {
  const m = String(url).match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

async function doGithubRemoto() {
  const repo = await repoConfigurado();
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
    total: await totalDeCommits(repo, ramo),
    atras: indice > 0 ? indice : indice === 0 ? 0 : null,
  };
}

// Quantos commits o ramo tem, sem baixar todos eles.
//
// A API não devolve esse número em campo nenhum. O que ela devolve é
// paginação: pedindo uma página de UM commit, o número da última página é o
// total. É um truque conhecido e é a única forma de saber isto sem trazer o
// histórico inteiro pela rede a cada cinco minutos.
//
// Falhando, devolve zero — e sem total a numeração não acontece, o painel cai
// no identificador do commit e nada quebra.
async function totalDeCommits(repo, ramo) {
  try {
    const r = await fetch(
      `https://api.github.com/repos/${repo}/commits?sha=${encodeURIComponent(ramo)}&per_page=1`,
      {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "tdah-logus" },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!r.ok) return 0;
    const ultima = (r.headers.get("link") || "").match(/[?&]page=(\d+)>;\s*rel="last"/);
    return ultima ? Number(ultima[1]) : 1;
  } catch {
    return 0;
  }
}
