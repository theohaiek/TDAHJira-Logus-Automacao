// A guarda: o que um commit do agente precisa cumprir para ir ao main.
//
// É código, e não modelo, de propósito. O agente que escreve o commit leu o
// texto de um relato, e esse texto é de quem usa o aplicativo: pode ter sido
// escrito por alguém que adivinhou uma senha. Pedir ao próprio agente que se
// comporte é necessário e não basta. Esta conferência não lê instrução
// nenhuma, não se convence de nada e roda igual todo dia.
//
// O que ela garante, e por quê:
//
// - Todo commit diz de que relato veio (a linha "Relato: N") e o relato estava
//   na fila desta passada. Commit sem dono não entra.
// - Nada de crédito a agente, nada de travessão, assunto sem acento: são as
//   regras de commit do AGENTS.md, e o histórico é público.
// - Nenhum arquivo que decide segurança, dependência, publicação ou o próprio
//   agente muda por aqui. Alguns só mudam quando quem administra autorizou.
// - Nenhum nome de quem relatou e nenhum trecho do relato vai para o
//   repositório, que é público. O nome aparece na tela, vindo do banco.
// - Nenhum segredo com cara de segredo nas linhas novas.
// - Um relato não vira uma reforma: há teto de arquivos e de linhas.
//
// Funções puras: recebem o que o executor coletou do git e devolvem o
// veredito. É o que deixa testar cada regra sem repositório nenhum.

import { relatosDoCommit } from "../../server/versao.js";

// Arquivos que o agente nunca muda, nem com autorização. Cada um é uma porta:
// dependência e script de instalação (package.json), publicação (vercel.json),
// o que vai ou não para o repositório (.gitignore), a integração contínua, a
// configuração do próprio Claude, credencial local, login e sessão, os
// cabeçalhos de segurança, a entrada do modo hospedado, e o próprio agente:
// quem pode reescrever a guarda não tem guarda.
const PROIBIDOS = [
  { casa: (p) => nome(p) === "package.json", motivo: "package.json" },
  { casa: (p) => nome(p) === "package-lock.json", motivo: "package-lock.json" },
  { casa: (p) => p === "vercel.json" || p === ".vercelignore", motivo: "configuração de publicação" },
  { casa: (p) => nome(p) === ".gitignore" || nome(p) === ".gitattributes", motivo: "regras do git" },
  { casa: (p) => nome(p) === ".npmrc", motivo: "configuração do npm" },
  { casa: (p) => p.startsWith(".github/"), motivo: "integração contínua" },
  { casa: (p) => p.startsWith(".husky/"), motivo: "ganchos do git" },
  { casa: (p) => p.startsWith(".claude/") || p.includes("/.claude/"), motivo: "configuração do Claude" },
  { casa: (p) => nome(p).startsWith(".env"), motivo: "arquivo de ambiente" },
  { casa: (p) => p.endsWith(".local.md"), motivo: "anotação local" },
  { casa: (p) => p.startsWith("node_modules/") || p.includes("/node_modules/"), motivo: "dependência instalada" },
  { casa: (p) => p.startsWith("scripts/relatos/"), motivo: "o próprio agente de relatos" },
  { casa: (p) => p === "server/auth.js", motivo: "login e sessão" },
  { casa: (p) => p === "server/http.js", motivo: "cabeçalhos de segurança" },
  { casa: (p) => p === "api/index.js", motivo: "entrada do modo hospedado" },
];

// Arquivos que mudam só quando quem administra leu o plano e autorizou:
// esquema e migração (um erro aqui derrubou a produção em 8/9/2026), o
// roteador com as checagens de permissão, as entradas do servidor, onde ficam
// os dados, e o guia dos agentes.
const SO_AUTORIZADO = [
  "core/schema.sql",
  "server/db.js",
  "server/api.js",
  "server/index.js",
  "server/paths.js",
  "server/storage.js",
  "agents.md",
  "dockerfile",
  "compose.yaml",
];

export const LIMITES = {
  confiavel: { arquivos: 8, linhas: 250 },
  autorizado: { arquivos: 25, linhas: 1200 },
};

// Com cara de segredo: tokens do GitHub, chave da Anthropic, chave privada,
// JWT (o token do Turso é um) e credencial em endereço de banco.
const SEGREDOS = [
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{30,}/,
  /sk-ant-[A-Za-z0-9_-]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /eyJhbGciOi[A-Za-z0-9_-]{10,}/,
  /authToken=[^&"' ]+/i,
];

// Crédito a agente, em qualquer forma. O histórico é público e a regra é da
// casa (AGENTS.md, "Nunca", item 9).
const CREDITO = [/co-authored-by/i, /generated with/i, /claude/i, /anthropic/i, /noreply@/i, /🤖/u];

// Nomes de conta que são palavras comuns no código ("admin" aparece em toda
// checagem de papel). Procurar por eles barraria qualquer commit sem proteger
// nome de ninguém.
const NOMES_GENERICOS = new Set(["admin", "administrador", "root", "teste", "usuario", "user", "sistema"]);

const JANELA_DO_TRECHO = 40;
const PASSO_DO_TRECHO = 10;

/**
 * commits: [{ sha, mensagem, autorNome, autorEmail, commitNome, commitEmail,
 *             arquivos: [{ caminho, adicionadas, removidas, status, binario, modo }],
 *             linhasAdicionadas: [{ caminho, texto }], linhasRemovidas: [{ caminho, texto }] }]
 * relatos: Map<id, { kind, autorizado, texto, nomes: [string] }>
 * segredos: [string], os valores exatos que não podem aparecer (o token do agente)
 */
export function avaliarCommits({ commits, relatos, segredos = [], limites = LIMITES }) {
  const porCommit = commits.map((c) => {
    const ids = relatosDoCommit(c.mensagem);
    // O dono do commit. Quando o executor sabe em que vez ele nasceu, o dono é
    // essa vez, e não o número que a mensagem diz: um commit feito na vez do
    // relato 8 que se assina "Relato: 9" derruba o 8, que é quem o fez, e não
    // o 9, que não tem nada com isso.
    const daFila = c.vez != null ? (relatos.has(c.vez) ? [c.vez] : []) : ids.filter((id) => relatos.has(id));
    const motivos = [];

    if (!ids.length) motivos.push("commit sem a linha Relato: N");
    const fora = ids.filter((id) => !relatos.has(id));
    if (fora.length) motivos.push(`cita relato fora da fila (${fora.join(", ")})`);

    // Cada relato é implementado numa conversa própria, e o executor sabe em
    // qual vez cada commit nasceu. Commit feito na vez do relato 8 que diz
    // "Relato: 9" está tentando pôr trabalho na conta de outro relato.
    if (c.vez != null && ids.some((id) => id !== c.vez)) {
      motivos.push(`cita outro relato, e nasceu na vez do relato ${c.vez}`);
    }

    motivos.push(...conferirMensagem(c));

    // Arquivo sensível só passa se TODOS os relatos do commit estiverem
    // autorizados: um commit que junta um relato autorizado com um que não
    // está não herda a autorização do primeiro.
    const autorizado = daFila.length > 0 && daFila.every((id) => relatos.get(id).autorizado);
    motivos.push(...conferirArquivos(c, { autorizado }));
    motivos.push(...conferirConteudo(c, { relatos: daFila.map((id) => relatos.get(id)), segredos }));

    return { sha: c.sha, relatos: daFila, motivos: [...new Set(motivos)] };
  });

  // Tamanho por relato, somando todos os commits dele.
  const motivosDoRelato = new Map([...relatos.keys()].map((id) => [id, []]));
  for (const [id, info] of relatos) {
    const deles = commits.filter((_, i) => porCommit[i].relatos.includes(id));
    if (!deles.length) continue;
    const arquivos = new Set(deles.flatMap((c) => c.arquivos.map((a) => a.caminho)));
    const linhas = deles.reduce((s, c) => s + c.arquivos.reduce((t, a) => t + (a.adicionadas || 0) + (a.removidas || 0), 0), 0);
    const teto = info.autorizado ? limites.autorizado : limites.confiavel;
    if (arquivos.size > teto.arquivos) {
      motivosDoRelato.get(id).push(`mexe em ${arquivos.size} arquivos, e o teto é ${teto.arquivos}`);
    }
    if (linhas > teto.linhas) {
      motivosDoRelato.get(id).push(`muda ${linhas} linhas, e o teto é ${teto.linhas}`);
    }
  }

  // Um commit reprovado reprova todos os seus relatos, e um relato reprovado
  // reprova todos os seus commits — que podem ter outros relatos, e assim por
  // diante. Repete até parar de mudar.
  const commitRuim = new Set(porCommit.filter((c) => c.motivos.length).map((c) => c.sha));
  const relatoRuim = new Set([...motivosDoRelato].filter(([, m]) => m.length).map(([id]) => id));
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const c of porCommit) {
      if (commitRuim.has(c.sha)) {
        for (const id of c.relatos) {
          if (!relatoRuim.has(id)) {
            relatoRuim.add(id);
            mudou = true;
          }
        }
      } else if (c.relatos.some((id) => relatoRuim.has(id))) {
        commitRuim.add(c.sha);
        mudou = true;
      }
    }
  }

  const comCommit = new Set(porCommit.flatMap((c) => c.relatos));
  const aprovados = [...comCommit].filter((id) => !relatoRuim.has(id));
  const reprovados = [...relatoRuim].map((id) => ({
    id,
    motivos: [
      ...new Set([
        ...motivosDoRelato.get(id),
        ...porCommit.filter((c) => c.relatos.includes(id)).flatMap((c) => c.motivos),
      ]),
    ],
  }));
  // O relato reprovado só por arrasto (o commit dele também levava outro
  // relato ruim) precisa de um motivo que diga isso, e não de uma lista vazia.
  for (const r of reprovados) {
    if (!r.motivos.length) r.motivos.push("o commit dele levava junto um relato que foi barrado");
  }

  return {
    commitsAprovados: porCommit.filter((c) => !commitRuim.has(c.sha) && c.relatos.length).map((c) => c.sha),
    aprovados,
    reprovados,
    porCommit,
  };
}

function conferirMensagem(c) {
  const motivos = [];
  const mensagem = String(c.mensagem || "");
  const assunto = mensagem.split("\n")[0].replace(/\r$/, "");

  if (!assunto.trim()) motivos.push("commit sem assunto");
  if (assunto.length > 72) motivos.push("assunto com mais de 72 caracteres");
  // ASCII imprimível e nada mais: o assunto é sem acento pela regra da casa,
  // e isso também tira do assunto qualquer caractere invisível.
  if (!/^[ -~]*$/.test(assunto)) motivos.push("assunto com acento ou caractere fora do ASCII");
  if (/^[A-Za-z]+([(][^)]*[)])?!?:/.test(assunto)) motivos.push('assunto com prefixo do tipo "fix:"');

  if (mensagem.includes("—") || mensagem.includes("–")) motivos.push("travessão na mensagem");
  for (const padrao of CREDITO) {
    if (padrao.test(mensagem)) {
      motivos.push("crédito ou menção a agente na mensagem");
      break;
    }
  }

  const identidade = [c.autorNome, c.autorEmail, c.commitNome, c.commitEmail].join(" ");
  if (/claude|anthropic/i.test(identidade)) motivos.push("autor do commit é um agente");

  return motivos;
}

function conferirArquivos(c, { autorizado }) {
  const motivos = [];

  for (const a of c.arquivos) {
    const p = normalizar(a.caminho);

    for (const regra of PROIBIDOS) {
      if (regra.casa(p)) motivos.push(`mexe em ${a.caminho} (${regra.motivo}), que só uma pessoa pode mudar`);
    }
    if (!autorizado && SO_AUTORIZADO.includes(p)) {
      motivos.push(`mexe em ${a.caminho}, que só muda com autorização`);
    }
    if (a.binario) motivos.push(`arquivo binário: ${a.caminho}`);
    // Link simbólico e submódulo apontam para fora do que a guarda consegue
    // ler: o conteúdo de verdade estaria em outro lugar.
    if (a.modo === "120000") motivos.push(`link simbólico: ${a.caminho}`);
    if (a.modo === "160000") motivos.push(`submódulo: ${a.caminho}`);
    if (a.status === "D" && p.startsWith("tests/")) motivos.push(`apaga o teste ${a.caminho}`);
  }

  // Tirar um teste é o jeito mais curto de fazer a suíte passar, e o único que
  // a suíte não pega. Mudar um teste existente continua possível; tirar, só
  // com autorização.
  if (!autorizado) {
    const tirados = c.linhasRemovidas.filter(
      (l) => normalizar(l.caminho).startsWith("tests/") && /^[ \t]*(test|it|describe)[(]/.test(l.texto)
    );
    if (tirados.length) motivos.push("remove teste existente");
  }

  return motivos;
}

function conferirConteudo(c, { relatos, segredos }) {
  const motivos = [];
  const adicionado = c.linhasAdicionadas.map((l) => l.texto).join("\n");
  const tudo = `${c.mensagem}\n${adicionado}`;

  for (const valor of segredos) {
    if (valor && String(valor).length >= 8 && tudo.includes(valor)) motivos.push("o token do agente aparece no commit");
  }
  for (const padrao of SEGREDOS) {
    if (padrao.test(tudo)) {
      motivos.push("algo com cara de credencial nas linhas novas");
      break;
    }
  }

  const palavras = new Set(palavrasDe(tudo));
  for (const r of relatos) {
    for (const n of nomesProibidos(r.nomes)) {
      if (palavras.has(n)) {
        motivos.push("o nome de quem relatou aparece no commit");
        break;
      }
    }
    if (temTrechoDoRelato(r.texto, tudo)) motivos.push("trecho copiado do relato no commit");
  }

  return motivos;
}

// As palavras de um nome que vale procurar: quatro letras ou mais (menos que
// isso casa com pedaço de qualquer palavra), sem acento e sem caixa, mais o
// nome de usuário inteiro.
export function nomesProibidos(nomes = []) {
  const saida = new Set();
  for (const nomeCompleto of nomes) {
    if (!nomeCompleto) continue;
    for (const p of palavrasDe(nomeCompleto)) {
      if (p.length >= 4 && !NOMES_GENERICOS.has(p)) saida.add(p);
    }
  }
  return [...saida];
}

function palavrasDe(texto) {
  return (
    String(texto)
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}_]+/gu) || []
  );
}

function temTrechoDoRelato(texto, alvo) {
  const relato = compactar(texto);
  if (relato.length < JANELA_DO_TRECHO) return false;
  const onde = compactar(alvo);
  for (let i = 0; i + JANELA_DO_TRECHO <= relato.length; i += PASSO_DO_TRECHO) {
    if (onde.includes(relato.slice(i, i + JANELA_DO_TRECHO))) return true;
  }
  // A última janela, para o fim do texto não escapar por causa do passo.
  return onde.includes(relato.slice(-JANELA_DO_TRECHO));
}

function compactar(texto) {
  return String(texto || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Caminho do jeito que o git escreve, sem diferenciar caixa. No Windows,
// "Package.json" e "package.json" são o mesmo arquivo no disco: a guarda não
// pode deixar a variação de caixa passar por outro arquivo.
function normalizar(caminho) {
  return String(caminho || "")
    .split(String.fromCharCode(92))
    .join("/")
    .replace(/^[.][/]/, "")
    .toLowerCase();
}

function nome(p) {
  return p.split("/").pop();
}
