// O agente diário dos relatos.
//
// Uma tarefa agendada roda este arquivo uma vez por dia na máquina de quem
// administra (scripts/relatos/agendar.ps1). Ele pega os relatos pendentes na
// API de produção, decide cada um com o Claude Code sem cabeça, implementa o
// que pode, confere tudo com uma guarda que é código e não modelo, publica no
// main e conta ao aplicativo o que fez. A tela Sugestões mostra o resultado.
//
//   node scripts/relatos/rodar.mjs               a passada completa
//   node scripts/relatos/rodar.mjs --ensaio      tudo, menos publicar e gravar
//   node scripts/relatos/rodar.mjs --verificar   confere a instalação, sem gastar nada
//   node scripts/relatos/rodar.mjs --configurar  gera o token e o config
//
// O desenho de segurança, em uma frase: o texto do relato é de quem usa, então
// ele só chega a um agente que não escreve nem executa nada (a triagem), num
// clone sem segredo nenhum; o agente que escreve e roda código (a
// implementação) só recebe relato de autor confiável ou que quem administra
// autorizou; e o que esse agente produz só vai ao main depois da guarda.
//
// Tudo o que é da máquina fica em RELATOS_HOME (padrão: ~/.tdah-relatos),
// FORA do repositório: o token, o clone de trabalho, o log de cada passada.

import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { relatosDoCommit } from "../../server/versao.js";
import { avaliarCommits } from "./guarda.mjs";
import {
  validarLeitura,
  validarTriagem,
  validarImplementacao,
  mensagemDeCommit,
  aplicarPolitica,
  decisoesDaFila,
  ehConfiavel,
  SITUACOES_DA_TRIAGEM,
} from "./plano.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_DO_REPO = resolve(AQUI, "..", "..");
const HOME = resolve(process.env.RELATOS_HOME || join(homedir(), ".tdah-relatos"));
const ARQUIVO_DE_CONFIG = join(HOME, "config.json");
const PENDENTES_DE_ENVIO = join(HOME, "pendentes-de-envio.json");
const SEM_GANCHOS = join(HOME, "sem-ganchos");

// Separadores do ASCII para ler a saída do git: nenhuma mensagem de commit os
// contém, então qualquer pontuação atravessa inteira.
const RS = String.fromCharCode(30);
const US = String.fromCharCode(31);
const TAB = String.fromCharCode(9);
const NUL = String.fromCharCode(0);

const MINUTO = 60 * 1000;
const TEMPO_DA_TRIAGEM = 20 * MINUTO;
// Por relato, e não pela implementação inteira: cada um tem a sua conversa.
const TEMPO_POR_ITEM = 30 * MINUTO;
// O que cabe numa passada sem estourar as três horas da tarefa agendada. O
// que passar disso fica como está e entra na passada seguinte.
const ITENS_POR_PASSADA = 5;
const TEMPO_DOS_TESTES = 10 * MINUTO;
const TRAVA_VELHA = 3 * 60 * MINUTO;
const EXECUCOES_GUARDADAS = 30;
const TETO_DA_SAIDA = 64 * 1024 * 1024;

const PADRAO = {
  apiUrl: "https://tarefas.logusautomacao.com",
  token: "",
  repoUrl: repoDoPacote() || "",
  ramo: "main",
  // Opus no esforço máximo, sempre. Decidir sozinho o que entra no main de um
  // produto em uso e escrever a mudança pede o melhor modelo disponível, e a
  // conta de uma passada por dia cabe nisso.
  modelo: "opus",
  esforco: "max",
  // A parte mecânica, que é reler o repositório para montar o dossiê, roda no
  // modelo barato e no esforço mínimo: é leitura, não julgamento, e é ela que
  // fazia o custo de uma passada.
  modeloDeLeitura: "sonnet",
  esforcoDeLeitura: "low",
  autoresConfiaveis: [],
  claude: null,
  comandoDeTeste: null,
};

// As únicas variáveis de Claude que passam. Uma lista explícita, e não o
// prefixo inteiro: "CLAUDE_ALGUMA_API_KEY" de outra integração da máquina não
// tem por que viajar para dentro desta.
const DO_CLAUDE = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CONFIG_DIR",
]);

// --- O que cada agente pode usar -------------------------------------------------
//
// As duas chaves de atribuição repetem a regra da casa (nenhum crédito a
// agente) no único lugar que vale no modo --restricted, que ignora os
// settings de usuário e de projeto. A guarda confere de novo depois.
const SEM_CREDITO = { includeCoAuthoredBy: false, attribution: { commit: "", pr: "" } };

const PERMISSOES_DA_TRIAGEM = {
  allow: [],
  deny: ["Bash", "WebFetch", "WebSearch", "Edit", "Write"],
};

// Edit e Write precisam estar na lista, e não é detalhe: no modo dontAsk tudo
// que não foi pré-aprovado é negado, inclusive editar arquivo. A primeira
// passada de verdade, em 11/9/2026, rodou sem os dois e o agente não conseguiu
// mudar uma linha. O --restricted continua confinando a escrita ao clone, e as
// escritas em .git e em configuração continuam só com uma pessoa aprovando.
const PERMISSOES_DA_IMPLEMENTACAO = {
  allow: [
    "Edit",
    "Write",
    "Bash(npm test)",
    "Bash(npm test:*)",
    "Bash(node --test:*)",
    "Bash(node --check:*)",
    "Bash(git status:*)",
    "Bash(git diff:*)",
    "Bash(git log:*)",
    "Bash(git show:*)",
    "Bash(git restore:*)",
  ],
  deny: [
    // Quem commita é o executor, com o assunto e o corpo que o agente devolve:
    // dois turnos a menos por relato, e uma mensagem que não tem como sair fora
    // do formato que a guarda cobra.
    "Bash(git add:*)",
    "Bash(git commit:*)",
    "Bash(git push:*)",
    "Bash(git remote:*)",
    "Bash(git config:*)",
    "Bash(git reset:*)",
    "Bash(git rebase:*)",
    "Bash(curl:*)",
    "Bash(npm install:*)",
    "WebFetch",
    "WebSearch",
  ],
};

// O dossiê que a leitura devolve. Curto de propósito: o valor dele é poupar o
// modelo bom de reler o repositório inteiro, não substituir o julgamento dele.
const SCHEMA_DA_LEITURA = {
  type: "object",
  properties: {
    onde: { type: "string", maxLength: 400 },
    hoje: { type: "string", maxLength: 400 },
    plausivel: { type: "boolean" },
    areaSensivel: { type: "boolean" },
    jaExiste: { type: "boolean" },
    tamanho: { type: "string", enum: ["pequeno", "medio", "grande"] },
    observacao: { type: "string", maxLength: 300 },
  },
  required: ["onde", "hoje", "plausivel", "areaSensivel", "jaExiste", "tamanho"],
};

const SCHEMA_DA_TRIAGEM = {
  type: "object",
  properties: {
    decisoes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          situacao: { type: "string", enum: SITUACOES_DA_TRIAGEM },
          texto: { type: "string", maxLength: 280 },
          plano: { type: "string", maxLength: 600 },
          duplicadoDe: { type: "integer" },
        },
        required: ["id", "situacao", "texto"],
      },
    },
  },
  required: ["decisoes"],
};

const SCHEMA_DA_IMPLEMENTACAO = {
  type: "object",
  properties: {
    resultados: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          feito: { type: "boolean" },
          assunto: { type: "string", maxLength: 72 },
          corpo: { type: "string", maxLength: 400 },
          resumo: { type: "string", maxLength: 280 },
          motivo: { type: "string", maxLength: 280 },
          inviavel: { type: "boolean" },
        },
        required: ["id", "feito"],
      },
    },
  },
  required: ["resultados"],
};

// --- Entrada --------------------------------------------------------------------

const ARGS = process.argv.slice(2);
const flag = (nome) => ARGS.includes(`--${nome}`);
const valor = (nome) => {
  const i = ARGS.indexOf(`--${nome}`);
  return i >= 0 && ARGS[i + 1] && !ARGS[i + 1].startsWith("--") ? ARGS[i + 1] : undefined;
};

try {
  if (flag("configurar")) await configurar();
  else if (flag("verificar")) await verificar();
  else await passada({ ensaio: flag("ensaio") });
} catch (err) {
  console.error(`\n${err?.message || err}`);
  process.exitCode = 1;
}

// --- A passada ------------------------------------------------------------------

async function passada({ ensaio }) {
  const config = lerConfig();
  mkdirSync(HOME, { recursive: true });
  const trava = travar();

  const inicio = new Date();
  const pasta = abrirPastaDaExecucao(inicio);
  const log = registrador(pasta, config);
  const resumo = {
    inicio: inicio.toISOString(),
    fim: null,
    analisados: 0,
    decididos: 0,
    publicados: 0,
    erro: null,
  };

  try {
    log(`Passada${ensaio ? " de ensaio" : ""} começou. API: ${config.apiUrl}`);
    limparExecucoesAntigas();

    // O que ficou sem resposta na passada anterior vai primeiro: um relato
    // publicado ontem cuja decisão não chegou ao servidor ainda aparece como
    // pendente, e sem isto seria implementado de novo.
    let aReenviar = ensaio ? [] : lerPendentesDeEnvio();
    if (aReenviar.length) {
      log(`Reenviando ${aReenviar.length} decisão(ões) da passada anterior.`);
      const envio = await enviarDecisoes(config, aReenviar, log);
      resumo.decididos += envio.aceitas;
      aReenviar = envio.falhas;
      gravarPendentesDeEnvio(aReenviar);
    }
    const aindaSemResposta = new Set(aReenviar.map((d) => d.id));

    const fila = await api(config, "GET", "agente/relatos");
    if (fila.status === 404) throw new Error("O servidor não tem RELATOS_AGENTE_TOKEN configurado.");
    if (fila.status === 401) throw new Error("O token do config não é o mesmo do servidor.");
    if (!fila.ok) throw new Error(`A API respondeu ${fila.status} ao pedir a fila.`);

    const pendentes = (fila.dados?.pendentes || []).filter((p) => !aindaSemResposta.has(p.id));
    const contexto = fila.dados?.contexto || [];
    const novos = pendentes.filter((p) => p.status === "novo");
    const autorizados = pendentes.filter((p) => p.status === "autorizado");
    log(`Fila: ${novos.length} novo(s) e ${autorizados.length} autorizado(s).`);

    if (!pendentes.length) {
      log("Nada pendente. O Claude não foi chamado.");
      return;
    }

    const clone = await prepararClone(config, log);
    const base = (await git(clone, ["rev-parse", "HEAD"])).saida.trim();
    const configDoGit = resumoDoConfigDoGit(clone);

    // Cada relato novo passa por duas conversas, e o motivo é dinheiro somado a
    // segurança.
    //
    // A parte cara de decidir não é decidir: é reler o repositório inteiro toda
    // vez (AGENTS.md, o produto, o código em volta do que o relato cita). Isso é
    // trabalho mecânico, e vai num modelo barato no esforço mínimo, que devolve
    // um dossiê curto. A decisão em si, que escolhe o que fazer e escreve o que
    // as pessoas leem, roda no modelo bom lendo o dossiê em vez do repositório.
    //
    // Uma conversa por relato, e não uma por leva: se uma conta confiável for
    // tomada, o texto dela não divide conversa com o relato de mais ninguém. O
    // contexto de um relato confiável também só traz relatos confiáveis.
    const confiavel = (autor) => ehConfiavel(autor, config.autoresConfiaveis);
    const contextoConfiavel = contexto.filter((c) => confiavel(c.autor));

    const decisoes = [];
    for (const relato of novos) {
      const daVez = confiavel(relato.autor);
      const contextoDele = daVez ? contextoConfiavel : contexto;

      const l = await chamarClaude({
        config,
        clone,
        pasta,
        log,
        etapa: `leitura-${relato.id}`,
        modelo: config.modeloDeLeitura,
        esforco: config.esforcoDeLeitura,
        prompt: promptDaLeitura(relato),
        ferramentas: "Read,Glob,Grep",
        permissoes: PERMISSOES_DA_TRIAGEM,
        schema: SCHEMA_DA_LEITURA,
        tempo: TEMPO_DA_TRIAGEM,
      });
      const dossie = l.ok ? validarLeitura(l.dados) : null;
      if (!l.ok) log(`A leitura do relato #${relato.id} falhou (${l.erro}). A triagem vai sem dossiê.`);

      const t = await chamarClaude({
        config,
        clone,
        pasta,
        log,
        etapa: `triagem-${relato.id}`,
        prompt: promptDaTriagem([relato], contextoDele, dossie),
        ferramentas: "Read,Glob,Grep",
        permissoes: PERMISSOES_DA_TRIAGEM,
        schema: SCHEMA_DA_TRIAGEM,
        tempo: TEMPO_DA_TRIAGEM,
      });
      if (t.ok) {
        const v = validarTriagem(t.dados, [relato.id]);
        for (const p of v.problemas) log(`Triagem #${relato.id}: ${p}`);
        decisoes.push(...v.decisoes);
        resumo.analisados += v.decisoes.length;
      } else {
        log(`A triagem do relato #${relato.id} falhou (${t.erro}). Ele continua novo.`);
        resumo.erro = `triagem #${relato.id}: ${t.erro}`;
      }
    }

    const politica = aplicarPolitica({
      decisoes,
      pendentes,
      contexto,
      autoresConfiaveis: config.autoresConfiaveis,
    });
    salvar(pasta, "politica.json", {
      fila: politica.fila.map((i) => ({ id: i.id, autorizado: i.autorizado })),
      diretas: politica.diretas,
    });
    resumo.analisados += politica.fila.filter((i) => i.autorizado).length;

    const daImplementacao = politica.fila.length
      ? await implementar({ config, clone, base, configDoGit, fila: politica.fila, pendentes, pasta, log, ensaio, resumo })
      : [];

    const todas = [...politica.diretas, ...daImplementacao];
    salvar(pasta, "decisoes.json", todas);

    if (ensaio) {
      log("Ensaio: nada foi publicado nem gravado. O que seria gravado:");
      for (const d of todas) log(`  #${d.id} -> ${d.status}${d.commit ? ` (${d.commit.slice(0, 7)})` : ""}`);
      return;
    }

    const envio = await enviarDecisoes(config, todas, log);
    resumo.decididos += envio.aceitas;
    gravarPendentesDeEnvio([...aReenviar, ...envio.falhas]);
  } catch (err) {
    resumo.erro = mensagemSegura(err, config);
    log(`Erro: ${resumo.erro}`);
    process.exitCode = 1;
  } finally {
    resumo.fim = new Date().toISOString();
    salvar(pasta, "resumo.json", resumo);
    if (!ensaio) {
      const r = await api(config, "POST", "agente/passada", resumo).catch(() => null);
      if (!r?.ok) log("Não consegui registrar a passada na API.");
    }
    log(
      `Fim. ${resumo.analisados} analisado(s), ${resumo.decididos} decisão(ões) gravada(s), ${resumo.publicados} publicado(s).`
    );
    destravar(trava);
  }
}

// A implementação, a guarda e a publicação. Devolve as decisões dos itens da
// fila; nunca lança por causa de um item, só por falha que impede tudo.
//
// Um relato por vez, cada um numa conversa própria com o Claude. Assim o texto
// de um relato nunca está na mesma conversa em que outro é implementado, um
// agente que trava perde só o seu relato, e cada commit tem dono conhecido: o
// que nasceu na vez do relato 8 só pode dizer "Relato: 8" (a guarda confere).
async function implementar({ config, clone, base, configDoGit, fila, pendentes, pasta, log, ensaio, resumo }) {
  const daVez = fila.slice(0, ITENS_POR_PASSADA);
  const adiados = fila.slice(ITENS_POR_PASSADA);
  if (adiados.length) {
    log(`Ficam para a próxima passada: ${adiados.map((i) => `#${i.id}`).join(", ")}.`);
  }

  const resultados = new Map();
  const vez = new Map();

  for (const item of daVez) {
    const antes = (await git(clone, ["rev-parse", "HEAD"])).saida.trim();
    const im = await chamarClaude({
      config,
      clone,
      pasta,
      log,
      etapa: `implementacao-${item.id}`,
      prompt: promptDaImplementacao([item]),
      ferramentas: "Read,Edit,Write,Glob,Grep,Bash",
      permissoes: PERMISSOES_DA_IMPLEMENTACAO,
      schema: SCHEMA_DA_IMPLEMENTACAO,
      tempo: TEMPO_POR_ITEM,
    });

    let resultado = null;
    if (im.ok) {
      const v = validarImplementacao(im.dados, [item.id]);
      for (const p of v.problemas) log(`Implementação #${item.id}: ${p}`);
      resultado = v.resultados.get(item.id) || null;
    } else {
      log(`A implementação do relato #${item.id} falhou (${im.erro}).`);
    }

    const sujo = (await git(clone, ["status", "--porcelain"])).saida.trim();

    // Não fez, não disse que fez, ou nem terminou: o que sobrou na árvore não é
    // de ninguém, e o próximo item começa do ponto de antes.
    if (!resultado?.feito) {
      if (sujo) {
        log(`O relato #${item.id} não foi dado por feito; o que ficou na árvore foi descartado.`);
        await git(clone, ["reset", "--quiet", "--hard", "HEAD"]);
        await git(clone, ["clean", "-fdq"]);
      }
      resultados.set(
        item.id,
        resultado || {
          id: item.id,
          feito: false,
          motivo: im.ok ? "não disse se fez" : `não terminou (${im.erro})`,
          inviavel: false,
        }
      );
      continue;
    }

    if (!sujo) {
      log(`O relato #${item.id} foi dado por feito sem mudar arquivo nenhum.`);
      resultados.set(item.id, { ...resultado, feito: false, motivo: "disse que fez, mas não mudou nenhum arquivo" });
      continue;
    }

    // O commit é do executor, e não do agente: assunto e corpo vêm da resposta
    // dele, a linha "Relato: N" e o formato vêm daqui. O agente não tem git de
    // escrita, então não há como o commit sair torto nem parar na conta de
    // outro relato.
    const mensagem = mensagemDeCommit(resultado.assunto, resultado.corpo, item.id);
    const arquivoDaMensagem = join(pasta, `commit-${item.id}.txt`);
    writeFileSync(arquivoDaMensagem, mensagem);
    await git(clone, ["add", "-A"]);
    const feito = await git(clone, ["commit", "--quiet", "-F", arquivoDaMensagem], { permitirFalha: true });
    if (feito.codigo !== 0) {
      log(`Não consegui commitar o relato #${item.id}: ${resumir(feito.erro || feito.saida)}`);
      await git(clone, ["reset", "--quiet", "--hard", "HEAD"]);
      await git(clone, ["clean", "-fdq"]);
      resultados.set(item.id, { ...resultado, feito: false, motivo: "a mudança não pôde ser commitada" });
      continue;
    }

    // O histórico precisa continuar sendo o de antes mais o commit novo.
    const descende = await git(clone, ["merge-base", "--is-ancestor", antes, "HEAD"], { permitirFalha: true });
    if (descende.codigo !== 0) {
      log(`O histórico foi reescrito na vez do relato #${item.id}. Voltei ao ponto de antes.`);
      await git(clone, ["reset", "--quiet", "--hard", antes]);
      resultados.set(item.id, { ...resultado, feito: false, motivo: "o histórico do repositório foi reescrito" });
      continue;
    }
    for (const c of await commitsEntre(clone, antes, "HEAD")) vez.set(c.sha, item.id);
    resultados.set(item.id, resultado);
  }

  const commits = (await coletarCommits(clone, base)).map((c) => ({ ...c, vez: vez.get(c.sha) ?? null }));
  const porId = new Map(pendentes.map((p) => [p.id, p]));
  const relatos = new Map(
    daVez.map((i) => [
      i.id,
      {
        kind: i.tipo,
        autorizado: i.autorizado,
        texto: i.texto,
        nomes: [porId.get(i.id)?.autor?.nome, porId.get(i.id)?.autor?.username].filter(Boolean),
      },
    ])
  );
  const guarda = avaliarCommits({ commits, relatos, segredos: [config.token] });
  salvar(pasta, "guarda.json", {
    commitsAprovados: guarda.commitsAprovados,
    aprovados: guarda.aprovados,
    reprovados: guarda.reprovados,
    porCommit: guarda.porCommit,
  });
  for (const c of guarda.porCommit) {
    if (c.motivos.length) log(`Guarda barrou ${c.sha.slice(0, 7)}: ${c.motivos.join("; ")}`);
  }
  const comCommit = new Set(guarda.porCommit.flatMap((c) => c.relatos));

  // Só vai ao main o commit de relato que o agente disse ter terminado. Um
  // agente que estourou o tempo depois de commitar deixou um trabalho que ele
  // mesmo não deu por pronto.
  const aPublicar = guarda.commitsAprovados.filter((sha) => {
    const ids = guarda.porCommit.find((c) => c.sha === sha)?.relatos || [];
    return ids.length > 0 && ids.every((id) => resultados.get(id)?.feito);
  });
  if (!aPublicar.length) {
    return decisoesDaFila({ fila: daVez, resultados, guarda, comCommit });
  }

  // O agente não pode mexer em .git/config (o modo restrito recusa, e git
  // config está negado), mas um remoto ou um ajudante de credencial trocado
  // ali seria executado pelo push. Conferir antes de empurrar custa uma
  // leitura de arquivo.
  if (resumoDoConfigDoGit(clone) !== configDoGit) {
    log("A configuração do git do clone mudou durante a implementação. Nada é publicado.");
    return decisoesDaFila({ fila: daVez, resultados, guarda, comCommit, falhaGeral: "a configuração do git mudou" });
  }

  const pub = await publicar({ config, clone, aprovados: aPublicar, pasta, log, ensaio });

  // Commit que não aplicou limpo sobre o main reprova os relatos dele.
  const reprovados = [...guarda.reprovados];
  for (const sha of pub.conflitos) {
    const doCommit = guarda.porCommit.find((c) => c.sha === sha)?.relatos || [];
    for (const id of doCommit) {
      if (pub.publicados.has(id)) continue;
      const ja = reprovados.find((r) => r.id === id);
      if (ja) ja.motivos.push("não aplicou limpo sobre o main atual");
      else reprovados.push({ id, motivos: ["não aplicou limpo sobre o main atual"] });
    }
  }

  resumo.publicados = pub.publicados.size;
  return decisoesDaFila({
    fila: daVez,
    resultados,
    guarda: { reprovados },
    publicados: pub.publicados,
    testes: pub.testes,
    pushAdiado: pub.pushAdiado,
    comCommit,
    falhaGeral: pub.falha || null,
  });
}

// Um pendente de autor confiável, no formato do contexto, para a leva dos
// outros relatos reconhecer um pedido repetido.
function comoContexto(p) {
  return {
    id: p.id,
    kind: p.kind,
    status: p.status,
    resumo: String(p.body || "").slice(0, 280),
    resolution: p.resolution || null,
  };
}

// Monta o ramo a publicar a partir do main de agora, só com os commits que a
// guarda aprovou, roda a suíte e empurra. Se o main andou no meio (alguém
// publicou), tenta uma segunda vez sobre o novo main.
async function publicar({ config, clone, aprovados, pasta, log, ensaio }) {
  const alvo = `origin/${config.ramo}`;

  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    if (tentativa > 1) await git(clone, ["fetch", "--quiet", "--prune", "origin"]);
    const base = (await git(clone, ["rev-parse", alvo])).saida.trim();
    await git(clone, ["checkout", "--quiet", "-B", "publicar", alvo]);

    const conflitos = [];
    for (const sha of aprovados) {
      const r = await git(clone, ["cherry-pick", sha], { permitirFalha: true });
      if (r.codigo !== 0) {
        await git(clone, ["cherry-pick", "--abort"], { permitirFalha: true });
        conflitos.push(sha);
        log(`O commit ${sha.slice(0, 7)} não aplicou limpo sobre o main.`);
      }
    }

    const aplicados = await commitsEntre(clone, base, "HEAD");
    if (!aplicados.length) return { publicados: new Map(), testes: true, pushAdiado: false, conflitos };

    const passou = await rodarTestes({ config, clone, pasta, log });
    if (!passou) {
      await git(clone, ["branch", "-f", `rejeitado-${carimbo(new Date())}`, "HEAD"], { permitirFalha: true });
      return { publicados: new Map(), testes: false, pushAdiado: false, conflitos };
    }

    if (ensaio) {
      log(`Ensaio: ${aplicados.length} commit(s) passaram na guarda e nos testes e seriam publicados.`);
      return { publicados: new Map(), testes: true, pushAdiado: true, conflitos };
    }

    // Sem --force, nunca: se o main andou, o push é recusado, e é isso que se
    // quer. Reescrever o main de todo mundo não é decisão de um agente.
    const push = await git(clone, ["push", "--porcelain", "origin", `HEAD:refs/heads/${config.ramo}`], {
      permitirFalha: true,
      tempo: 3 * MINUTO,
    });
    if (push.codigo === 0) {
      const publicados = new Map();
      for (const c of aplicados) for (const id of relatosDoCommit(c.mensagem)) publicados.set(id, c.sha);
      log(`Publicado: ${aplicados.length} commit(s) no ${config.ramo}.`);
      return { publicados, testes: true, pushAdiado: false, conflitos };
    }

    const motivo = resumir(push.erro || push.saida);
    if (!/rejected|non-fast-forward|fetch first|stale info/i.test(motivo)) {
      log(`O push falhou: ${motivo}`);
      return { publicados: new Map(), testes: true, pushAdiado: false, conflitos, falha: "o push falhou" };
    }
    log(`O main andou enquanto o agente trabalhava (tentativa ${tentativa}).`);
  }

  log("O main andou duas vezes. Nada publicado; os relatos voltam na próxima passada.");
  return { publicados: new Map(), testes: true, pushAdiado: true, conflitos: [] };
}

async function rodarTestes({ config, clone, pasta, log }) {
  const comando =
    Array.isArray(config.comandoDeTeste) && config.comandoDeTeste.length
      ? config.comandoDeTeste
      : [process.execPath, "--test", "tests/*.test.js"];
  log("Rodando a suíte no ramo a publicar.");
  const r = await executar(comando[0], comando.slice(1), {
    cwd: clone,
    env: ambienteDoFilho(),
    tempo: TEMPO_DOS_TESTES,
  });
  writeFileSync(join(pasta, "testes.txt"), `${r.saida}\n${r.erro}`);
  const ok = r.codigo === 0 && !r.estourou;
  log(ok ? "Suíte passou." : `Suíte falhou (código ${r.codigo}${r.estourou ? ", estourou o tempo" : ""}).`);
  return ok;
}

// --- O clone de trabalho --------------------------------------------------------
//
// Um clone só do agente, dentro de RELATOS_HOME. Nunca a cópia de trabalho de
// quem usa a máquina: reset e clean aqui apagam o que não está commitado, e é
// por isso que o caminho é conferido antes de qualquer um dos dois.
async function prepararClone(config, log) {
  const destino = join(HOME, "repo");
  if (!existsSync(join(destino, ".git"))) {
    if (existsSync(destino) && readdirSync(destino).length) {
      throw new Error(`${destino} existe e não é um clone. Apague a pasta ou aponte RELATOS_HOME para outro lugar.`);
    }
    log("Clonando o repositório pela primeira vez.");
    await git(HOME, ["clone", "--quiet", config.repoUrl, destino], { tempo: 10 * MINUTO });
  }

  await conferirClone(destino);
  await git(destino, ["remote", "set-url", "origin", config.repoUrl]);
  await git(destino, ["fetch", "--quiet", "--prune", "origin"], { tempo: 5 * MINUTO });
  await git(destino, ["checkout", "--quiet", "-B", "trabalho", `origin/${config.ramo}`]);
  await git(destino, ["reset", "--quiet", "--hard", `origin/${config.ramo}`]);
  await git(destino, ["clean", "-fdxq"]);
  return destino;
}

async function conferirClone(destino) {
  const topo = (await git(destino, ["rev-parse", "--show-toplevel"])).saida.trim();
  const esperado = comparavel(destino);
  if (comparavel(topo) !== esperado || !esperado.startsWith(comparavel(HOME) + sep)) {
    throw new Error(`O clone não está onde deveria (${topo}). Parei antes de apagar qualquer coisa.`);
  }
  if (comparavel(topo) === comparavel(RAIZ_DO_REPO)) {
    throw new Error("O clone de trabalho é a própria cópia do repositório. Parei antes de apagar qualquer coisa.");
  }
}

// Caminho absoluto, com a barra do sistema e, no Windows, sem diferenciar
// caixa: o git devolve "C:/Users/..." e o Node, "C:\Users\...".
function comparavel(caminho) {
  const r = resolve(String(caminho));
  return process.platform === "win32" ? r.toLowerCase() : r;
}

function resumoDoConfigDoGit(clone) {
  try {
    return createHash("sha256").update(readFileSync(join(clone, ".git", "config"))).digest("hex");
  } catch {
    return "sem-config";
  }
}

// Os commits novos, com tudo o que a guarda confere.
async function coletarCommits(clone, base) {
  const lista = await commitsEntre(clone, base, "HEAD");
  const commits = [];
  for (const c of lista) {
    const numstat = (await git(clone, ["show", "--numstat", "--no-renames", "-z", "--format=", c.sha])).saida;
    const raw = (await git(clone, ["show", "--raw", "--no-renames", "-z", "--format=", c.sha])).saida;
    const patch = (await git(clone, ["show", "--no-renames", "--no-color", "--no-ext-diff", "--unified=0", "--format=", c.sha]))
      .saida;
    commits.push({ ...c, arquivos: lerArquivos(numstat, raw), ...lerLinhas(patch) });
  }
  return commits;
}

async function commitsEntre(clone, de, ate) {
  const saida = (
    await git(clone, [
      "log",
      "--reverse",
      // %P são os pais: a guarda recusa commit de junção, que não tem diff
      // próprio para ela ler.
      `--format=%H${US}%P${US}%an${US}%ae${US}%cn${US}%ce${US}%B${RS}`,
      `${de}..${ate}`,
    ])
  ).saida;
  return saida
    .split(RS)
    .map((r) => r.replace(/^\s+/, ""))
    .filter(Boolean)
    .map((r) => {
      const [sha, pais, autorNome, autorEmail, commitNome, commitEmail, mensagem] = r.split(US);
      return {
        sha,
        pais: String(pais || "").split(" ").filter(Boolean),
        autorNome,
        autorEmail,
        commitNome,
        commitEmail,
        mensagem: (mensagem || "").trim(),
      };
    });
}

// --numstat -z: "adicionadas<TAB>removidas<TAB>caminho<NUL>"; binário vem com "-".
// --raw -z: ":modo modo sha sha STATUS<NUL>caminho<NUL>".
function lerArquivos(numstat, raw) {
  const porCaminho = new Map();
  for (const registro of numstat.split(NUL)) {
    const linha = registro.replace(/^\s+/, "");
    if (!linha) continue;
    const [a, r, ...resto] = linha.split(TAB);
    const caminho = resto.join(TAB);
    if (!caminho) continue;
    porCaminho.set(caminho, {
      caminho,
      adicionadas: a === "-" ? 0 : Number(a) || 0,
      removidas: r === "-" ? 0 : Number(r) || 0,
      binario: a === "-" || r === "-",
      status: "M",
      modo: null,
    });
  }
  const partes = raw.split(NUL);
  for (let i = 0; i < partes.length; i++) {
    const meta = partes[i].replace(/^\s+/, "");
    if (!meta.startsWith(":")) continue;
    const caminho = partes[i + 1];
    i++;
    const [, modoNovo, , , status] = meta.slice(1).split(" ");
    const arquivo = porCaminho.get(caminho) || {
      caminho,
      adicionadas: 0,
      removidas: 0,
      binario: false,
      status: "M",
      modo: null,
    };
    arquivo.status = (status || "M")[0];
    arquivo.modo = modoNovo || null;
    porCaminho.set(caminho, arquivo);
  }
  return [...porCaminho.values()];
}

// O patch, lido com estado: cabeçalho até o primeiro "@@" de cada arquivo, e
// conteúdo depois. Sem isso, uma linha adicionada que começa com "++" seria
// confundida com o cabeçalho "+++ b/arquivo".
function lerLinhas(patch) {
  const linhasAdicionadas = [];
  const linhasRemovidas = [];
  let caminho = null;
  let noCabecalho = false;

  for (const bruta of patch.split("\n")) {
    const linha = bruta.replace(/\r$/, "");
    if (linha.startsWith("diff --git ")) {
      noCabecalho = true;
      caminho = null;
      continue;
    }
    if (noCabecalho) {
      if (linha.startsWith("+++ ")) {
        const alvo = linha.slice(4);
        if (alvo !== "/dev/null") caminho = alvo.replace(/^b[/]/, "");
      } else if (linha.startsWith("--- ")) {
        const origem = linha.slice(4);
        if (origem !== "/dev/null" && !caminho) caminho = origem.replace(/^a[/]/, "");
      } else if (linha.startsWith("@@")) {
        noCabecalho = false;
      }
      continue;
    }
    if (linha.startsWith("@@")) continue;
    if (linha.startsWith("+")) linhasAdicionadas.push({ caminho, texto: linha.slice(1) });
    else if (linha.startsWith("-")) linhasRemovidas.push({ caminho, texto: linha.slice(1) });
  }
  return { linhasAdicionadas, linhasRemovidas };
}

// --- O Claude --------------------------------------------------------------------

async function chamarClaude({ config, clone, pasta, log, etapa, prompt, ferramentas, permissoes, schema, tempo, modelo, esforco }) {
  const modeloDaVez = modelo || config.modelo;
  const esforcoDaVez = esforco || config.esforco;
  const comando = resolverClaude(config);
  if (!comando) return { ok: false, erro: "não achei o executável do Claude Code" };

  const settings = join(pasta, `${etapa}.settings.json`);
  writeFileSync(settings, JSON.stringify({ ...SEM_CREDITO, permissions: permissoes }, null, 2));
  // O prompt fica guardado na pasta da execução, que é desta máquina e de
  // mais ninguém: é o que permite entender depois por que o agente decidiu o
  // que decidiu.
  writeFileSync(join(pasta, `${etapa}.prompt.txt`), prompt);

  const args = [
    ...comando.slice(1),
    "-p",
    "--restricted",
    "--strict-mcp-config",
    "--mcp-config",
    JSON.stringify({ mcpServers: {} }),
    "--tools",
    ferramentas,
    "--settings",
    settings,
    "--permission-mode",
    "dontAsk",
    "--model",
    modeloDaVez,
    "--effort",
    esforcoDaVez,
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(schema),
  ];

  log(`Chamando o Claude para a ${etapa} (${modeloDaVez}, esforço ${esforcoDaVez}).`);
  const r = await executar(comando[0], args, { cwd: clone, env: ambienteDoFilho(), entrada: prompt, tempo });
  writeFileSync(join(pasta, `${etapa}.saida.json`), r.saida);
  if (r.erro) writeFileSync(join(pasta, `${etapa}.erro.txt`), r.erro);

  if (r.estourou) return { ok: false, erro: `passou de ${Math.round(tempo / MINUTO)} minutos` };

  let bruto = null;
  try {
    bruto = JSON.parse(r.saida);
  } catch {
    return { ok: false, erro: `saída que não é JSON (código ${r.codigo}): ${resumir(r.erro || r.saida)}` };
  }

  if (bruto?.total_cost_usd != null) log(`Custo da ${etapa}: US$ ${Number(bruto.total_cost_usd).toFixed(2)}.`);
  const negados = Array.isArray(bruto?.permission_denials) ? bruto.permission_denials : [];
  if (negados.length) log(`Pedidos negados na ${etapa}: ${negados.map((d) => d?.tool_name).join(", ")}.`);
  if (bruto?.is_error) return { ok: false, erro: resumir(String(bruto.result || bruto.subtype || "erro do Claude")) };

  const dados = bruto?.structured_output ?? extrairJson(bruto?.result);
  if (!dados) return { ok: false, erro: "o Claude não devolveu o formato pedido" };
  return { ok: true, dados };
}

function promptDaLeitura(relato) {
  const dados = {
    id: relato.id,
    tipo: relato.kind,
    texto: relato.body,
    tela: relato.page,
    versao: relato.version,
    respostaAnterior: relato.resolution,
  };
  return `${instrucoes("leitura.md")}\n\n<dados-do-relato>\n${jsonSeguro(dados)}\n</dados-do-relato>\n`;
}

function promptDaTriagem(novos, contexto, dossie) {
  const dados = {
    relatos: novos.map((p) => ({
      id: p.id,
      tipo: p.kind,
      texto: p.body,
      tela: p.page,
      versao: p.version,
      respostaAnterior: p.resolution,
    })),
    contexto: contexto.map((c) => ({
      id: c.id,
      tipo: c.kind,
      situacao: c.status,
      resumo: c.resumo,
      resolucao: c.resolution,
    })),
  };
  const comDossie = dossie
    ? `\n\n<leitura-do-codigo>\n${jsonSeguro(dossie)}\n</leitura-do-codigo>\n`
    : "";
  return `${instrucoes("triagem.md")}\n\n<dados-dos-relatos>\n${jsonSeguro(dados)}\n</dados-dos-relatos>\n${comDossie}`;
}

function promptDaImplementacao(fila) {
  const dados = {
    itens: fila.map((i) => ({ id: i.id, tipo: i.tipo, texto: i.texto, plano: i.plano, autorizado: i.autorizado })),
  };
  return `${instrucoes("implementacao.md")}\n\n<dados-dos-itens>\n${jsonSeguro(dados)}\n</dados-dos-itens>\n`;
}

function instrucoes(arquivo) {
  return readFileSync(join(AQUI, arquivo), "utf8");
}

// JSON com os sinais de menor e maior escapados: um relato que escreva
// "</dados-dos-relatos>" no meio do texto não fecha o bloco de dados e não
// ganha a aparência de instrução fora dele.
function jsonSeguro(dados) {
  const barra = String.fromCharCode(92);
  return JSON.stringify(dados, null, 2).replaceAll("<", `${barra}u003c`).replaceAll(">", `${barra}u003e`);
}

function extrairJson(texto) {
  const t = String(texto || "");
  const de = t.indexOf("{");
  const ate = t.lastIndexOf("}");
  if (de < 0 || ate <= de) return null;
  try {
    return JSON.parse(t.slice(de, ate + 1));
  } catch {
    return null;
  }
}

// O executável de verdade, nunca o .cmd do npm: um .cmd só roda com shell, e
// os argumentos (JSON do schema, das permissões) passariam pelo cmd.exe.
function resolverClaude(config) {
  if (Array.isArray(config.claude) && config.claude.length) return config.claude.map(String);
  if (typeof config.claude === "string" && config.claude) return [config.claude];

  const candidatos = [
    process.env.APPDATA && join(process.env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
    join(homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude"),
  ].filter(Boolean);
  for (const c of candidatos) if (existsSync(c)) return [c];

  if (process.platform === "win32") {
    try {
      const saida = execFileSync("where.exe", ["claude"], { encoding: "utf8", windowsHide: true });
      const exe = saida
        .split("\n")
        .map((s) => s.trim())
        .find((s) => s.toLowerCase().endsWith(".exe"));
      if (exe) return [exe];
    } catch {}
  }
  return null;
}

// O ambiente do Claude e da suíte: o do processo, menos o que tem cara de
// segredo. O token do agente nem está no ambiente (fica no config), mas
// qualquer outro que a máquina tenha exportado também não vai junto.
function ambienteDoFilho() {
  const env = {};
  for (const [chave, v] of Object.entries(process.env)) {
    if (DO_CLAUDE.has(chave.toUpperCase())) {
      env[chave] = v;
      continue;
    }
    if (/TOKEN|SECRET|PASSWORD|SENHA|KEY|TURSO|VERCEL|GITHUB|GH_|RELATOS_AGENTE|ANTHROPIC|CLAUDE/i.test(chave)) continue;
    env[chave] = v;
  }
  env.GIT_TERMINAL_PROMPT = "0";
  // Os ganchos também ficam desligados nos git que o próprio agente roda, e
  // não só nos do executor: ele commita sozinho, e um pre-commit escrito no
  // clone seria código rodando fora de qualquer lista de permissão.
  mkdirSync(SEM_GANCHOS, { recursive: true });
  env.GIT_CONFIG_COUNT = "2";
  env.GIT_CONFIG_KEY_0 = "core.hooksPath";
  env.GIT_CONFIG_VALUE_0 = SEM_GANCHOS;
  env.GIT_CONFIG_KEY_1 = "core.fsmonitor";
  env.GIT_CONFIG_VALUE_1 = "false";
  return env;
}

// --- A API ----------------------------------------------------------------------

async function api(config, metodo, caminho, corpo) {
  const url = `${String(config.apiUrl).replace(/[/]+$/, "")}/api/${caminho}`;
  const r = await fetch(url, {
    method: metodo,
    headers: {
      authorization: `Bearer ${config.token}`,
      ...(corpo ? { "content-type": "application/json" } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const texto = await r.text();
  let dados = null;
  try {
    dados = JSON.parse(texto);
  } catch {}
  return { status: r.status, ok: r.ok, dados };
}

async function enviarDecisoes(config, decisoes, log) {
  const falhas = [];
  let aceitas = 0;
  for (const d of decisoes) {
    const corpo = { status: d.status, resolution: d.resolution };
    if (d.commit) corpo.commit = d.commit;
    if (d.duplicadoDe) corpo.duplicadoDe = d.duplicadoDe;
    try {
      const r = await api(config, "POST", `agente/relatos/${d.id}`, corpo);
      if (r.ok) {
        aceitas++;
        log(`#${d.id}: ${d.status}`);
      } else if (r.status >= 500 || r.status === 429) {
        falhas.push(d);
        log(`#${d.id}: o servidor respondeu ${r.status}; fica para a próxima passada.`);
      } else {
        // 4xx é resposta definitiva: 409 quer dizer que alguém decidiu antes,
        // e reenviar amanhã daria a mesma resposta.
        log(`#${d.id}: recusado (${r.status}) ${r.dados?.error || ""}`.trim());
      }
    } catch (err) {
      falhas.push(d);
      log(`#${d.id}: sem resposta (${resumir(err?.message)}); fica para a próxima passada.`);
    }
  }
  return { falhas, aceitas };
}

function lerPendentesDeEnvio() {
  try {
    const lista = JSON.parse(readFileSync(PENDENTES_DE_ENVIO, "utf8"));
    // Uma semana é o bastante para qualquer queda de rede. Depois disso a
    // decisão já não descreve o que está no main, e é melhor decidir de novo.
    const limite = Date.now() - 7 * 24 * 60 * MINUTO;
    return Array.isArray(lista) ? lista.filter((d) => Date.parse(d.guardadoEm || 0) > limite) : [];
  } catch {
    return [];
  }
}

function gravarPendentesDeEnvio(lista) {
  if (!lista.length) {
    rmSync(PENDENTES_DE_ENVIO, { force: true });
    return;
  }
  const agora = new Date().toISOString();
  writeFileSync(
    PENDENTES_DE_ENVIO,
    JSON.stringify(
      lista.map((d) => ({ ...d, guardadoEm: d.guardadoEm || agora })),
      null,
      2
    )
  );
}

// --- Configurar e verificar -------------------------------------------------------

async function configurar() {
  mkdirSync(HOME, { recursive: true });
  const atual = lerConfigBruta() || {};
  const token = String(atual.token || "").length >= 32 ? atual.token : randomBytes(32).toString("base64url");
  const confiar = valor("confiar");

  const config = {
    ...PADRAO,
    ...atual,
    token,
    ...(valor("api") ? { apiUrl: valor("api") } : {}),
    ...(confiar !== undefined
      ? {
          autoresConfiaveis: confiar
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }
      : {}),
  };
  writeFileSync(ARQUIVO_DE_CONFIG, JSON.stringify(config, null, 2), { mode: 0o600 });

  const copiado = copiarParaAreaDeTransferencia(token);
  console.log(`Config gravado em ${ARQUIVO_DE_CONFIG}.`);
  console.log(`Autores confiáveis além de quem é admin: ${config.autoresConfiaveis.join(", ") || "nenhum"}.`);
  console.log("");
  console.log("Próximos passos:");
  console.log(
    `  1. ${copiado ? "O token está na área de transferência." : "Copie o token com --mostrar-token."} Cole na Vercel,`
  );
  console.log("     em Settings > Environment Variables, como RELATOS_AGENTE_TOKEN (Production), e publique de novo.");
  console.log("  2. Confira: npm run relatos:verificar");
  console.log("  3. Agende: npm run relatos:agendar");
  if (flag("mostrar-token")) console.log(`\n${token}`);
}

function copiarParaAreaDeTransferencia(texto) {
  const comando =
    process.platform === "win32" ? ["clip"] : process.platform === "darwin" ? ["pbcopy"] : null;
  if (!comando) return false;
  const r = spawnSync(comando[0], comando.slice(1), { input: texto, windowsHide: true });
  return r.status === 0;
}

async function verificar() {
  let falhou = false;
  const item = (ok, texto) => {
    console.log(`${ok ? "ok   " : "FALHA"} ${texto}`);
    if (!ok) falhou = true;
  };

  let config = null;
  try {
    config = lerConfig();
    item(true, `config em ${ARQUIVO_DE_CONFIG}`);
  } catch (err) {
    item(false, err.message);
  }

  const claude = resolverClaude(config || PADRAO);
  item(!!claude, claude ? `Claude Code: ${claude.join(" ")}` : "não achei o claude.exe");

  const versaoDoGit = await executar("git", ["--version"], { tempo: 20000 });
  item(versaoDoGit.codigo === 0, versaoDoGit.codigo === 0 ? versaoDoGit.saida.trim() : "git não encontrado");

  if (config) {
    const remoto = await executar("git", ["ls-remote", "--heads", config.repoUrl, config.ramo], {
      tempo: 60000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    item(remoto.codigo === 0 && remoto.saida.trim(), `repositório ${config.repoUrl}, ramo ${config.ramo}`);

    try {
      const r = await api(config, "GET", "agente/relatos");
      if (r.ok) item(true, `API: ${r.dados?.pendentes?.length ?? 0} relato(s) pendente(s)`);
      else if (r.status === 404) item(false, "API: o servidor não tem RELATOS_AGENTE_TOKEN (ou não foi publicado de novo)");
      else if (r.status === 401) item(false, "API: o token do config é diferente do servidor");
      else item(false, `API respondeu ${r.status}`);
    } catch (err) {
      item(false, `API sem resposta: ${resumir(err?.message)}`);
    }
  }

  if (falhou) process.exitCode = 1;
}

function lerConfigBruta() {
  try {
    return JSON.parse(readFileSync(ARQUIVO_DE_CONFIG, "utf8"));
  } catch {
    return null;
  }
}

function lerConfig() {
  const bruto = lerConfigBruta();
  if (!bruto) throw new Error(`Sem configuração em ${ARQUIVO_DE_CONFIG}. Rode: npm run relatos:configurar`);
  const c = { ...PADRAO, ...bruto };
  if (!/^https?:[/][/][^ ]+$/.test(String(c.apiUrl))) throw new Error("apiUrl do config não é um endereço http(s).");
  if (String(c.token).length < 32) throw new Error("O token do config tem menos de 32 caracteres. Rode: npm run relatos:configurar");
  if (!c.repoUrl) throw new Error("repoUrl vazio no config.");
  if (!/^[A-Za-z0-9._/-]+$/.test(String(c.ramo)) || String(c.ramo).startsWith("-")) throw new Error("ramo inválido no config.");
  if (!/^[A-Za-z0-9._-]+$/.test(String(c.modelo))) throw new Error("modelo inválido no config.");
  for (const campo of ["esforco", "esforcoDeLeitura"]) {
    if (!["low", "medium", "high", "xhigh", "max"].includes(String(c[campo]))) {
      throw new Error(`${campo} do config precisa ser low, medium, high, xhigh ou max.`);
    }
  }
  if (!/^[A-Za-z0-9._-]+$/.test(String(c.modeloDeLeitura))) throw new Error("modeloDeLeitura inválido no config.");
  if (!Array.isArray(c.autoresConfiaveis)) c.autoresConfiaveis = [];
  return c;
}

function repoDoPacote() {
  try {
    const url = JSON.parse(readFileSync(join(RAIZ_DO_REPO, "package.json"), "utf8")).repository?.url;
    return url ? String(url).replace(/^git[+]/, "") : null;
  } catch {
    return null;
  }
}

// --- Trava, pasta e log ----------------------------------------------------------

function travar() {
  const arquivo = join(HOME, "rodando.lock");
  try {
    const atual = JSON.parse(readFileSync(arquivo, "utf8"));
    const idade = Date.now() - Date.parse(atual.em);
    if (idade < TRAVA_VELHA && processoVivo(atual.pid)) {
      throw new Error(`Outra passada está rodando (processo ${atual.pid}, desde ${atual.em}).`);
    }
  } catch (err) {
    if (String(err?.message).startsWith("Outra passada")) throw err;
  }
  writeFileSync(arquivo, JSON.stringify({ pid: process.pid, em: new Date().toISOString() }));
  return arquivo;
}

function destravar(arquivo) {
  try {
    const atual = JSON.parse(readFileSync(arquivo, "utf8"));
    if (atual.pid === process.pid) rmSync(arquivo, { force: true });
  } catch {}
}

function processoVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function abrirPastaDaExecucao(inicio) {
  const raiz = join(HOME, "execucoes");
  let pasta = join(raiz, carimbo(inicio));
  for (let n = 2; existsSync(pasta); n++) pasta = join(raiz, `${carimbo(inicio)}-${n}`);
  mkdirSync(pasta, { recursive: true });
  return pasta;
}

function limparExecucoesAntigas() {
  const raiz = join(HOME, "execucoes");
  let nomes = [];
  try {
    nomes = readdirSync(raiz)
      .filter((n) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}/.test(n))
      .sort();
  } catch {
    return;
  }
  for (const n of nomes.slice(0, Math.max(0, nomes.length - EXECUCOES_GUARDADAS))) {
    rmSync(join(raiz, n), { recursive: true, force: true });
  }
}

function carimbo(d) {
  const dois = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}_` +
    `${dois(d.getHours())}${dois(d.getMinutes())}${dois(d.getSeconds())}`
  );
}

function registrador(pasta, config) {
  const arquivo = join(pasta, "log.txt");
  return (mensagem) => {
    const linha = `[${new Date().toISOString()}] ${semToken(mensagem, config)}`;
    console.log(linha);
    appendFileSync(arquivo, `${linha}\n`);
  };
}

function salvar(pasta, nome, dados) {
  writeFileSync(join(pasta, nome), JSON.stringify(dados, null, 2));
}

function semToken(texto, config) {
  const t = String(texto ?? "");
  return config?.token ? t.split(config.token).join("***") : t;
}

function mensagemSegura(err, config) {
  return resumir(semToken(err?.message || err, config));
}

function resumir(texto) {
  return String(texto || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
}

// --- Processos --------------------------------------------------------------------

function git(cwd, args, { permitirFalha = false, tempo = 2 * MINUTO } = {}) {
  mkdirSync(SEM_GANCHOS, { recursive: true });
  // Nenhum gancho roda, nem o de dentro do clone: um pre-push escrito ali
  // seria código executado com a credencial de quem publica.
  const comGuarda = [
    "-c",
    `core.hooksPath=${SEM_GANCHOS}`,
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.quotepath=false",
    ...args,
  ];
  return executar("git", comGuarda, { cwd, tempo, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).then((r) => {
    if (r.codigo !== 0 && !permitirFalha) {
      throw new Error(`git ${args[0]} falhou: ${resumir(r.erro || r.saida)}`);
    }
    return r;
  });
}

function executar(comando, args, { cwd, env = process.env, entrada = null, tempo = 2 * MINUTO } = {}) {
  return new Promise((pronto) => {
    let saida = "";
    let erro = "";
    let estourou = false;
    let terminou = false;
    const fim = (codigo) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(relogio);
      pronto({ codigo, saida, erro, estourou });
    };

    let filho;
    try {
      filho = spawn(comando, args, { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      pronto({ codigo: -1, saida: "", erro: String(err?.message || err), estourou: false });
      return;
    }

    const relogio = setTimeout(() => {
      estourou = true;
      matarArvore(filho);
    }, tempo);

    filho.stdout.setEncoding("utf8");
    filho.stderr.setEncoding("utf8");
    filho.stdout.on("data", (d) => {
      if (saida.length < TETO_DA_SAIDA) saida += d;
    });
    filho.stderr.on("data", (d) => {
      if (erro.length < TETO_DA_SAIDA) erro += d;
    });
    filho.on("error", (err) => {
      erro += String(err?.message || err);
      fim(-1);
    });
    filho.on("close", (codigo) => fim(codigo ?? -1));
    filho.stdin.on("error", () => {});
    if (entrada !== null) filho.stdin.end(entrada, "utf8");
    else filho.stdin.end();
  });
}

// No Windows, matar só o processo deixa os filhos dele vivos (o Claude abre
// shells, a suíte abre servidores). taskkill /T derruba a árvore inteira.
function matarArvore(filho) {
  if (!filho?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(filho.pid), "/T", "/F"], { windowsHide: true });
  } else {
    try {
      filho.kill("SIGKILL");
    } catch {}
  }
}
