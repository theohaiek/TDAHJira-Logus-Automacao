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
//
// --- O que acontece com o relato depois ------------------------------------
//
// Cada relato tem uma situação, que começa em "novo" e anda até uma das
// finais. Quem anda com ela, na maior parte das vezes, é o agente diário
// (scripts/relatos/rodar.mjs): uma tarefa agendada na máquina de quem
// administra, que lê os pendentes, decide cada um, implementa o que pode e
// publica. Ele fala com este servidor por um token próprio,
// RELATOS_AGENTE_TOKEN, e só pelas rotas de /api/agente.
//
// O resto das mudanças é de gente: quem administra autoriza o que o agente
// deixou esperando, recusa ou reabre; quem relatou responde quando o agente
// pergunta. Cada mudança vira uma linha em feedback_events, que é a história
// que a tela Sugestões mostra.

import { createHash, timingSafeEqual } from "node:crypto";
import { all, insert, one, run, tx, nowIso, getSetting, setSetting } from "./db.js";
import { badRequest } from "./tasks.js";
import { versao, relatosDoCommit, repoConfigurado } from "./versao.js";

export const TIPOS = ["bug", "ideia"];

// As situações, na ordem em que a tela agrupa. As chaves são contrato com a
// tela (SITUACAO_RELATO em web/js/format.js) e com o agente
// (scripts/relatos/plano.mjs): mudar uma aqui sem mudar lá deixa o relato numa
// situação que ninguém sabe mostrar nem decidir.
export const SITUACOES = [
  "novo",
  "autorizado",
  "detalhe",
  "todo",
  "corrigido",
  "adicionado",
  "rejeitado",
  "inviavel",
  "duplicado",
  "ja_existe",
];

// Os mesmos rótulos da tela, para as mensagens de erro dizerem a situação do
// jeito que a pessoa lê, e não pela chave.
const ROTULO = {
  novo: "Novo",
  autorizado: "Autorizado",
  detalhe: "Precisa de detalhe",
  todo: "Registrado no TODO",
  corrigido: "Corrigido",
  adicionado: "Adicionado",
  rejeitado: "Rejeitado",
  inviavel: "Tecnicamente inviável",
  duplicado: "Duplicado",
  ja_existe: "Já existe",
};

const FINAIS = ["corrigido", "adicionado", "rejeitado", "inviavel", "duplicado", "ja_existe"];

// O que o agente pode decidir. Ficam de fora "novo", que é o ponto de partida,
// e "autorizado", que é decisão de gente: o agente não pode se autorizar.
const DO_AGENTE = ["detalhe", "todo", "corrigido", "adicionado", "rejeitado", "inviavel", "duplicado", "ja_existe"];

// E sobre o que ele decide: só o que estava na fila quando ele leu. Um relato
// que quem administra recusou enquanto o agente trabalhava não pode ser
// ressuscitado pela decisão que chega depois.
const NA_FILA = ["novo", "autorizado"];

// As três ações de quem administra, e de onde cada uma pode partir.
const ACOES = {
  autorizar: { de: ["todo"], para: "autorizado", verbo: "autorizar" },
  recusar: { de: ["novo", "todo", "autorizado", "detalhe"], para: "rejeitado", verbo: "recusar" },
  reabrir: { de: ["todo", ...FINAIS], para: "novo", verbo: "reabrir" },
};

// O bastante para descrever um defeito com passos e o que se esperava. Um
// relato maior do que isto quase sempre é uma lista de coisas diferentes, e
// cada uma merecia o seu.
const TETO_DO_TEXTO = 4000;

// Quantos relatos por pessoa, por hora. Conta no banco, e não em memória: no
// modo hospedado cada instância tem a sua, e um freio em memória seria um
// freio por instância — ou seja, nenhum.
const POR_HORA = 12;

// O texto de uma situação: o que mudou, o porquê, o plano. Cabe na leitura de
// um cartão; mais do que isto é relatório, e relatório ninguém lê.
const TETO_DA_RESOLUCAO = 1500;

// A resposta de quem relatou quando o agente pergunta, e o relato com todas as
// respostas somadas. Três ou quatro idas e voltas cabem; passar disso já é
// conversa, e conversa pede outro canal.
const TETO_DO_COMPLEMENTO = 2000;
const TETO_COM_COMPLEMENTOS = 8000;

// Quanto a lista espera pela linha do tempo das versões antes de seguir sem
// ela. No modo hospedado a linha do tempo vem do GitHub, e a primeira consulta
// depois de o cache vencer pode levar segundos: a lista não fica refém disso.
// Sem ela, some só o número da versão do cartão; o resto chega.
const ESPERA_DA_VERSAO = 2500;

const CHAVE_DA_PASSADA = "relatos.passada";

// Menos do que isto não é segredo, é senha. O comando que gera o token
// (npm run relatos:configurar) produz 43 caracteres.
const TOKEN_MINIMO = 32;

export async function registrarFeedback(entrada, user) {
  const kind = String(entrada?.kind || "").trim();
  if (!TIPOS.includes(kind)) throw badRequest("Diga se é um bug ou uma ideia.");

  const body = semInvisiveis(entrada?.body || "").trim();
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
    throw falha(429, "Muitos relatos em pouco tempo. Tente de novo daqui a pouco.");
  }

  const agora = nowIso();
  const id = await insert(
    `INSERT INTO feedback (kind, body, author_id, page, version, status, updated_at, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [kind, body, user.id, page, version, "novo", agora, agora]
  );
  await registrarEvento(id, { status: "novo", actor: "autor", actorId: user.id });

  // O relato já está salvo. O encaminhamento é um extra: se falhar, quem
  // escreveu não pode perder o que escreveu por causa disso.
  const issueUrl = await encaminharAoGithub({ id, kind, body, page, version }).catch(() => null);
  if (issueUrl) {
    await run("UPDATE feedback SET issue_url = ? WHERE id = ?", [issueUrl, id]);
  }

  return { id, encaminhado: !!issueUrl };
}

// --- O quadro de sugestões --------------------------------------------------

const COLUNAS = `f.id, f.kind, f.body, f.author_id, f.page, f.version, f.issue_url,
                 f.status, f.resolution, f.commit_sha, f.duplicate_of, f.updated_at, f.created_at,
                 u.display_name AS autor`;

const COLUNAS_DO_EVENTO = `e.feedback_id, e.status, e.note, e.commit_sha, e.actor, e.created_at,
                           u.display_name AS ator_nome`;

// A lista inteira, para a tela Sugestões. Qualquer pessoa com sessão lê: a
// lista virou o quadro de sugestões do time, e dizer quem relatou é parte do
// ponto — quem pediu vê o que aconteceu com o pedido, e quem faz sabe a quem
// perguntar. O link da issue fica só com quem administra: ele aponta para um
// repositório privado, que os outros nem conseguem abrir.
export async function quadroDeSugestoes(user) {
  const [linhas, eventos, contexto, passada] = await Promise.all([
    all(
      `SELECT ${COLUNAS}
         FROM feedback f
         LEFT JOIN users u ON u.id = f.author_id
        ORDER BY f.id DESC`
    ),
    all(
      `SELECT ${COLUNAS_DO_EVENTO}
         FROM feedback_events e
         LEFT JOIN users u ON u.id = e.actor_id
        ORDER BY e.id`
    ),
    contextoDeVersao(),
    ultimaPassada(),
  ]);

  const porRelato = new Map();
  for (const e of eventos) {
    const chave = Number(e.feedback_id);
    if (!porRelato.has(chave)) porRelato.set(chave, []);
    porRelato.get(chave).push(e);
  }

  const admin = user?.role === "admin";
  return {
    feedback: linhas.map((r) => formatar(r, porRelato.get(Number(r.id)) || [], { admin, ...contexto })),
    passada,
    encaminhamento: encaminhamentoConfigurado(),
    repo: contexto.repo,
  };
}

// Um relato só, no mesmo formato da lista. É o que as ações devolvem, para a
// tela trocar o cartão sem buscar a lista inteira de novo.
async function relatoPorId(id, { admin = false, contexto = null } = {}) {
  const r = await one(
    `SELECT ${COLUNAS}
       FROM feedback f
       LEFT JOIN users u ON u.id = f.author_id
      WHERE f.id = ?`,
    [id]
  );
  if (!r) return null;
  const eventos = await all(
    `SELECT ${COLUNAS_DO_EVENTO}
       FROM feedback_events e
       LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.feedback_id = ?
      ORDER BY e.id`,
    [id]
  );
  return formatar(r, eventos, { admin, ...(contexto || (await contextoDeVersao())) });
}

// O agente não lê número de versão nem link de commit: devolver a ele sem
// esperar pelo GitHub economiza até dois segundos e meio por decisão.
const SEM_VERSAO = { repo: null, versoes: [] };

// De que repositório é o commit que resolveu, e em que versão ele entrou.
async function contextoDeVersao() {
  let dados = null;
  try {
    dados = await Promise.race([
      versao(),
      new Promise((pronto) => {
        const relogio = setTimeout(() => pronto(null), ESPERA_DA_VERSAO);
        relogio.unref?.();
      }),
    ]);
  } catch {
    dados = null;
  }

  let repo = dados?.repo || null;
  if (!repo) repo = await repoConfigurado().catch(() => null);

  return {
    repo: REPO_VALIDO.test(String(repo || "")) ? repo : null,
    versoes: (dados?.commits || []).filter((c) => c.sha && c.versao),
  };
}

function formatar(r, eventos, { admin, repo, versoes }) {
  const sha = r.commit_sha ? String(r.commit_sha) : null;
  // O identificador curto da linha do tempo tem sete caracteres no GitHub e
  // pode ter mais no git local, quando sete já seriam ambíguos. Comparar pelo
  // começo, nos dois sentidos, cobre os dois.
  const daVersao = sha ? versoes.find((c) => sha.startsWith(c.sha) || c.sha.startsWith(sha)) : null;

  return {
    id: Number(r.id),
    kind: r.kind,
    body: r.body,
    page: r.page || null,
    version: r.version || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at || r.created_at,
    autor: r.autor || null,
    autorId: r.author_id == null ? null : Number(r.author_id),
    status: SITUACOES.includes(r.status) ? r.status : "novo",
    resolution: r.resolution || null,
    commit: sha
      ? {
          sha,
          curto: sha.slice(0, 7),
          url: repo ? `https://github.com/${repo}/commit/${sha}` : null,
        }
      : null,
    versaoResolvida: daVersao?.versao || null,
    duplicadoDe: r.duplicate_of == null ? null : Number(r.duplicate_of),
    issueUrl: admin ? r.issue_url || null : null,
    eventos: eventos.map((e) => ({
      status: e.status,
      nota: e.note || null,
      commit: e.commit_sha ? String(e.commit_sha).slice(0, 7) : null,
      ator: e.actor,
      atorNome: e.ator_nome || null,
      em: e.created_at,
    })),
  };
}

// --- O que as pessoas fazem -------------------------------------------------

// Autorizar, recusar e reabrir. Só quem administra chega aqui: a rota confere
// o papel antes de chamar.
export async function acaoDoAdmin(id, entrada, user) {
  const nome = String(entrada?.acao || "");
  // hasOwn, e não ACOES[nome] direto: "constructor" e "__proto__" também são
  // chaves de um objeto comum, e não são ações.
  const acao = Object.hasOwn(ACOES, nome) ? ACOES[nome] : null;
  if (!acao) throw badRequest("Ação desconhecida: use autorizar, recusar ou reabrir.");
  const nota = notaOpcional(entrada?.nota);

  const atual = await one("SELECT id, status FROM feedback WHERE id = ?", [id]);
  if (!atual) throw falha(404, "Relato não encontrado.");
  if (!acao.de.includes(atual.status)) {
    throw falha(409, `Não dá para ${acao.verbo} um relato que está em "${ROTULO[atual.status] || atual.status}".`);
  }

  const campos = { status: acao.para };
  if (nome === "recusar") campos.resolution = nota || "Recusado por quem administra.";
  // Reabrir apaga o texto e o commit da situação anterior, e é de propósito:
  // um "Corrigido" reaberto não pode continuar mostrando o commit que não
  // corrigiu. O que se disse antes continua na história.
  if (nome === "reabrir") Object.assign(campos, { resolution: null, commit_sha: null, duplicate_of: null });

  await mudarSituacao(id, atual.status, campos, {
    status: acao.para,
    note: nome === "recusar" ? campos.resolution : nota,
    actor: "admin",
    actorId: user.id,
  });
  return relatoPorId(id, { admin: true });
}

// Quem relatou responde à pergunta do agente. A resposta entra no próprio
// relato, e não só na história: é o texto do relato que o agente lê na
// passada seguinte, e ele precisa ver a pergunta respondida junto do pedido.
export async function complementar(id, entrada, user) {
  const texto = semInvisiveis(entrada?.texto).trim();
  if (!texto) throw badRequest("Escreva a resposta.");
  if (texto.length > TETO_DO_COMPLEMENTO) {
    throw badRequest(`Ficou longo demais: o limite é ${TETO_DO_COMPLEMENTO} caracteres.`);
  }

  const atual = await one("SELECT id, status, author_id, body FROM feedback WHERE id = ?", [id]);
  if (!atual) throw falha(404, "Relato não encontrado.");
  if (atual.author_id == null || Number(atual.author_id) !== Number(user.id)) {
    throw falha(403, "Só quem relatou responde à pergunta do relato.");
  }
  if (atual.status !== "detalhe") throw falha(409, "Este relato não está esperando resposta.");

  const corpo = `${atual.body}\n\nComplemento: ${texto}`;
  if (corpo.length > TETO_COM_COMPLEMENTOS) {
    throw badRequest("Com esta resposta o relato passa do tamanho que cabe. Mande um relato novo.");
  }

  await mudarSituacao(
    id,
    "detalhe",
    { status: "novo", body: corpo },
    { status: "novo", note: texto, actor: "autor", actorId: user.id }
  );
  return relatoPorId(id, { admin: user.role === "admin" });
}

// --- O agente diário --------------------------------------------------------
//
// O agente não tem sessão nem usuário: ele tem um token, definido em
// RELATOS_AGENTE_TOKEN no servidor e no config local da máquina que o roda.
// Sem a variável, ou com ela curta demais para ser segredo, as rotas dele não
// existem: a resposta é 404, igual à de qualquer caminho inventado, e quem
// sonda não descobre que há algo ali.

export function agenteLigado() {
  return String(process.env.RELATOS_AGENTE_TOKEN || "").length >= TOKEN_MINIMO;
}

// Comparação em tempo constante, e sobre o resumo dos dois lados, não sobre o
// texto: timingSafeEqual exige o mesmo tamanho, e comparar os tamanhos antes
// já entregaria o tamanho do token a quem mede o tempo da resposta.
export function credencialDoAgente(cabecalho) {
  if (!agenteLigado()) return false;
  const m = /^Bearer +(.+)$/i.exec(String(cabecalho || ""));
  if (!m) return false;
  const recebido = createHash("sha256").update(m[1].trim()).digest();
  const esperado = createHash("sha256").update(String(process.env.RELATOS_AGENTE_TOKEN)).digest();
  return timingSafeEqual(recebido, esperado);
}

// O que o agente precisa para decidir: os relatos da fila, inteiros, e um
// resumo dos outros, para ele reconhecer um pedido repetido.
//
// Quem relatou vai junto, com papel e username, porque é isso que decide se o
// relato pode ser implementado sem autorização. O nome não vai ao modelo: o
// executor usa só para conferir que ele não escapou para o commit, que é
// público.
export async function pendentesDoAgente() {
  const [fila, outros] = await Promise.all([
    all(
      `SELECT f.id, f.kind, f.status, f.body, f.page, f.version, f.created_at, f.resolution,
              u.id AS autor_id, u.username AS autor_username, u.display_name AS autor_nome,
              u.role AS autor_role, u.is_active AS autor_ativo
         FROM feedback f
         LEFT JOIN users u ON u.id = f.author_id
        WHERE f.status IN ('novo', 'autorizado')
        ORDER BY f.id`
    ),
    // O contexto também leva papel e username de quem relatou, pelo mesmo
    // motivo: a triagem dos relatos de autor confiável só pode ver texto de
    // autor confiável, e o executor precisa saber qual é qual para separar.
    all(
      `SELECT f.id, f.kind, f.status, f.body, f.resolution,
              u.username AS autor_username, u.role AS autor_role, u.is_active AS autor_ativo
         FROM feedback f
         LEFT JOIN users u ON u.id = f.author_id
        WHERE f.status NOT IN ('novo', 'autorizado')
        ORDER BY f.id DESC
        LIMIT 80`
    ),
  ]);

  return {
    pendentes: fila.map((r) => ({
      id: Number(r.id),
      kind: r.kind,
      status: r.status,
      body: r.body,
      page: r.page || null,
      version: r.version || null,
      createdAt: r.created_at,
      resolution: r.resolution || null,
      autor:
        r.autor_id == null
          ? null
          : {
              id: Number(r.autor_id),
              username: r.autor_username,
              nome: r.autor_nome,
              role: r.autor_role,
              ativo: !!Number(r.autor_ativo),
            },
    })),
    contexto: outros.map((r) => ({
      id: Number(r.id),
      kind: r.kind,
      status: r.status,
      resumo: String(r.body || "").slice(0, 280),
      resolution: r.resolution || null,
      autor: r.autor_username
        ? { username: r.autor_username, role: r.autor_role, ativo: !!Number(r.autor_ativo) }
        : null,
    })),
  };
}

// O que o agente decidiu sobre um relato.
export async function decisaoDoAgente(id, entrada) {
  const status = String(entrada?.status || "");
  if (!DO_AGENTE.includes(status)) throw badRequest("Situação que o agente não pode decidir.");
  const resolution = textoDaResolucao(entrada?.resolution);

  const atual = await one("SELECT id, kind, status, commit_sha FROM feedback WHERE id = ?", [id]);
  if (!atual) throw falha(404, "Relato não encontrado.");

  // Corrigido é de bug e adicionado é de ideia: trocar um pelo outro faria a
  // tela dizer "Corrigido" sobre uma coisa que nunca esteve quebrada.
  let commit = null;
  if (status === "corrigido" || status === "adicionado") {
    if (status === "corrigido" && atual.kind !== "bug") throw badRequest("Só bug é corrigido. Ideia é adicionada.");
    if (status === "adicionado" && atual.kind !== "ideia") throw badRequest("Só ideia é adicionada. Bug é corrigido.");
    commit = String(entrada?.commit || "").trim().toLowerCase();
    if (!/^[0-9a-f]{7,40}$/.test(commit)) throw badRequest("O commit precisa ser o identificador em hexadecimal.");
  }

  let duplicadoDe = null;
  if (status === "duplicado") {
    duplicadoDe = Number(entrada?.duplicadoDe);
    if (!Number.isSafeInteger(duplicadoDe) || duplicadoDe <= 0 || duplicadoDe === Number(id)) {
      throw badRequest("Diga de qual outro relato este é duplicado.");
    }
    if (!(await one("SELECT id FROM feedback WHERE id = ?", [duplicadoDe]))) {
      throw badRequest("O relato de que este seria duplicado não existe.");
    }
  }

  // A mesma decisão chegando de novo não é conflito: é o executor reenviando
  // o que ficou sem resposta na passada anterior (a rede caiu depois de o
  // servidor gravar). Responde como se fosse a primeira, sem história repetida.
  if (atual.status === status && (atual.commit_sha || null) === commit) {
    return relatoPorId(id, { contexto: SEM_VERSAO });
  }
  if (!NA_FILA.includes(atual.status)) throw falha(409, "O relato mudou de situação desde a leitura.");

  await mudarSituacao(
    id,
    atual.status,
    { status, resolution, commit_sha: commit, duplicate_of: duplicadoDe },
    { status, note: resolution, commitSha: commit, actor: "agente", actorId: null }
  );
  return relatoPorId(id, { contexto: SEM_VERSAO });
}

// A última passada do agente, para a tela dizer se ele está vivo. Uma linha em
// settings e não uma tabela: só a última importa, e o detalhe de cada passada
// fica no log da máquina que rodou.
export async function registrarPassada(entrada) {
  const dados = {
    inicio: dataIso(entrada?.inicio),
    fim: dataIso(entrada?.fim),
    analisados: contagem(entrada?.analisados),
    decididos: contagem(entrada?.decididos),
    publicados: contagem(entrada?.publicados),
    erro: entrada?.erro ? limpar(entrada.erro, 300) : null,
  };
  await setSetting(CHAVE_DA_PASSADA, JSON.stringify(dados));
  return dados;
}

export async function ultimaPassada() {
  try {
    return JSON.parse(await getSetting(CHAVE_DA_PASSADA, "null"));
  } catch {
    return null;
  }
}

// --- O painel de versões ----------------------------------------------------

// A linha do tempo com os relatos de cada commit: quem pediu, o que era e o
// que mudou. O vínculo é a linha "Relato: 12" que o agente escreve na mensagem
// (relatosDoCommit, em versao.js); o resto vem do banco, e é por isso que o
// nome de quem relatou aparece na tela sem nunca ter estado no repositório.
//
// Devolve uma CÓPIA: o objeto que chega é o cache de versao(), compartilhado
// entre todas as requisições dos próximos cinco minutos. Escrever nele
// misturaria a situação de agora com a de quem pedir depois.
export async function comRelatos(dados) {
  const commits = dados?.commits || [];
  const idsPorCommit = commits.map((c) => relatosDoCommit(`${c.titulo || ""}\n${c.corpo || ""}`));
  const ids = [...new Set(idsPorCommit.flat())];
  if (!ids.length) return dados;

  const linhas = await all(
    `SELECT f.id, f.kind, f.status, f.resolution, u.display_name AS autor
       FROM feedback f
       LEFT JOIN users u ON u.id = f.author_id
      WHERE f.id IN (${ids.map(() => "?").join(", ")})`,
    ids
  );
  const porId = new Map(
    linhas.map((r) => [
      Number(r.id),
      {
        id: Number(r.id),
        kind: r.kind,
        status: r.status,
        autor: r.autor || null,
        resolution: r.resolution || null,
      },
    ])
  );

  return {
    ...dados,
    commits: commits.map((c, i) => {
      const relatos = idsPorCommit[i].map((id) => porId.get(id)).filter(Boolean);
      return relatos.length ? { ...c, relatos } : c;
    }),
  };
}

// --- Escrita da situação ----------------------------------------------------

// Muda a situação só se ela ainda for a que foi lida. Sem transação no modo
// hospedado, é esta condição no próprio UPDATE que impede duas decisões ao
// mesmo tempo (o agente e quem administra, por exemplo) de passarem uma por
// cima da outra: a segunda encontra a situação já mudada e não escreve nada.
//
// A ordem das duas escritas também é de propósito. Primeiro a situação,
// depois a história: se a segunda falhar no meio, o relato está certo e a
// história fica com uma linha a menos. O contrário deixaria a história
// contando uma mudança que não aconteceu.
async function mudarSituacao(id, de, campos, evento) {
  // Os nomes de coluna saem deste arquivo, nunca da requisição: interpolar
  // aqui é seguro pelo mesmo motivo que seria perigoso em qualquer outro lugar.
  const nomes = Object.keys(campos);
  return tx(async () => {
    const r = await run(
      `UPDATE feedback SET ${nomes.map((n) => `${n} = ?`).join(", ")}, updated_at = ?
        WHERE id = ? AND status = ?`,
      [...nomes.map((n) => campos[n]), nowIso(), id, de]
    );
    if (!r?.changes) {
      throw falha(409, "O relato mudou de situação desde a leitura. Recarregue e tente de novo.");
    }
    await registrarEvento(id, evento);
  });
}

async function registrarEvento(feedbackId, { status, note = null, commitSha = null, actor, actorId = null }) {
  await insert(
    `INSERT INTO feedback_events (feedback_id, status, note, commit_sha, actor, actor_id, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [feedbackId, status, note, commitSha, actor, actorId, nowIso()]
  );
}

function falha(status, mensagem) {
  const erro = new Error(mensagem);
  erro.status = status;
  return erro;
}

// Caracteres que mudam a leitura sem aparecer: os de direção, que invertem
// visualmente um trecho do texto, os de largura zero e a marca de ordem de
// byte. Um relato pode chegar com eles de propósito, e o texto é lido por
// gente na tela e por um modelo no prompt do agente.
function semInvisiveis(valor) {
  return String(valor ?? "").replace(/[\u200B-\u200F\u061C\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/g, "");
}

// Tira caractere de controle, menos a quebra de linha: a resolução é lida em
// parágrafos, e o resto (retorno de carro, tabulação, nulo) só atrapalha quem
// lê e quem guarda.
function semControle(valor) {
  return semInvisiveis(valor)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "")
    .trim();
}

function textoDaResolucao(valor) {
  const texto = semControle(valor);
  if (!texto) throw badRequest("A resolução não pode ficar vazia.");
  if (texto.length > TETO_DA_RESOLUCAO) {
    throw badRequest(`A resolução passou do limite de ${TETO_DA_RESOLUCAO} caracteres.`);
  }
  return texto;
}

function notaOpcional(valor) {
  const texto = semControle(valor);
  if (texto.length > TETO_DA_RESOLUCAO) {
    throw badRequest(`O motivo passou do limite de ${TETO_DA_RESOLUCAO} caracteres.`);
  }
  return texto || null;
}

function dataIso(valor) {
  const d = new Date(String(valor || ""));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function contagem(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 0 && n <= 10000 ? n : 0;
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
