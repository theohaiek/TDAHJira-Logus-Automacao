// A política do agente diário: o que pode ser feito sem autorização, e o que
// cada resultado vira no aplicativo.
//
// Funções puras, separadas do executor (rodar.mjs) para serem testadas uma a
// uma. Nenhuma delas fala com rede, disco, git ou modelo.
//
// A regra de fundo: o texto do relato é de quem usa, e quem usa pode ter a
// senha adivinhada. Por isso a triagem, que lê qualquer relato, só lê; e só
// chega à implementação, que escreve e roda código, o relato de autor
// confiável (papel de administrador, ou nome de usuário na lista local
// autoresConfiaveis) ou o que quem administra autorizou depois de ler.

// O que a triagem pode responder. "pronto" é só dela: no aplicativo ele não
// existe, porque vira implementação (autor confiável) ou "todo" (os outros).
export const SITUACOES_DA_TRIAGEM = ["pronto", "todo", "detalhe", "rejeitado", "inviavel", "duplicado", "ja_existe"];

export const TETO_DO_TEXTO = 800;
export const TETO_DO_PLANO = 1500;
export const TETO_DA_RESOLUCAO = 1500;

// --- Conferir o que o modelo devolveu ------------------------------------------
//
// O schema do --json-schema já pede este formato, e mesmo assim tudo é
// conferido aqui: é a fronteira entre o que um modelo produziu e o que vai ser
// gravado. Entrada torta é descartada com o motivo, e o relato fica como
// estava, para a próxima passada.

export function validarTriagem(saida, idsEnviados) {
  const permitidos = new Set(idsEnviados);
  const vistos = new Set();
  const decisoes = [];
  const problemas = [];

  if (!Array.isArray(saida?.decisoes)) {
    return { decisoes, problemas: ["a triagem não devolveu a lista de decisões"] };
  }

  for (const d of saida.decisoes) {
    const id = Number(d?.id);
    if (!Number.isSafeInteger(id) || !permitidos.has(id)) {
      problemas.push(`decisão para um relato que não foi enviado (${JSON.stringify(d?.id)})`);
      continue;
    }
    if (vistos.has(id)) {
      problemas.push(`duas decisões para o relato ${id}; ficou a primeira`);
      continue;
    }
    const situacao = String(d?.situacao || "");
    if (!SITUACOES_DA_TRIAGEM.includes(situacao)) {
      problemas.push(`situação desconhecida para o relato ${id}: ${JSON.stringify(situacao)}`);
      continue;
    }
    const texto = limparTexto(d?.texto);
    if (!texto) {
      problemas.push(`o relato ${id} veio sem texto para quem relatou`);
      continue;
    }
    const plano = limparTexto(d?.plano);
    if ((situacao === "pronto" || situacao === "todo") && !plano) {
      problemas.push(`o relato ${id} veio como ${situacao} sem plano`);
      continue;
    }
    const decisao = { id, situacao, texto: cortar(texto, TETO_DO_TEXTO) };
    if (plano) decisao.plano = cortar(plano, TETO_DO_PLANO);
    if (situacao === "duplicado") {
      const de = Number(d?.duplicadoDe);
      decisao.duplicadoDe = Number.isSafeInteger(de) && de > 0 ? de : null;
    }
    vistos.add(id);
    decisoes.push(decisao);
  }

  for (const id of permitidos) {
    if (!vistos.has(id)) problemas.push(`a triagem não decidiu o relato ${id}; ele continua novo`);
  }
  return { decisoes, problemas };
}

export function validarImplementacao(saida, idsEnviados) {
  const permitidos = new Set(idsEnviados);
  const porId = new Map();
  const problemas = [];

  if (!Array.isArray(saida?.resultados)) {
    return { resultados: porId, problemas: ["a implementação não devolveu a lista de resultados"] };
  }
  for (const r of saida.resultados) {
    const id = Number(r?.id);
    if (!Number.isSafeInteger(id) || !permitidos.has(id)) {
      problemas.push(`resultado para um item que não foi enviado (${JSON.stringify(r?.id)})`);
      continue;
    }
    if (porId.has(id)) continue;
    porId.set(id, {
      id,
      feito: r?.feito === true,
      resumo: cortar(limparTexto(r?.resumo), TETO_DO_TEXTO) || null,
      motivo: cortar(limparTexto(r?.motivo), TETO_DO_TEXTO) || null,
      inviavel: r?.inviavel === true,
    });
  }
  return { resultados: porId, problemas };
}

// --- Quem pode ser implementado sem autorização --------------------------------

export function ehConfiavel(autor, autoresConfiaveis = []) {
  if (!autor || autor.ativo === false) return false;
  if (autor.role === "admin") return true;
  const lista = new Set(autoresConfiaveis.map((u) => String(u).trim().toLowerCase()).filter(Boolean));
  return lista.has(String(autor.username || "").trim().toLowerCase());
}

// A triagem decidiu; aqui se decide o que cada decisão vira.
//
//   fila     o que vai para a implementação: "pronto" de autor confiável e
//            todo "autorizado" que estava pendente
//   diretas  o que vai direto para o aplicativo, sem código
export function aplicarPolitica({ decisoes, pendentes, contexto = [], autoresConfiaveis = [] }) {
  const porId = new Map(pendentes.map((p) => [p.id, p]));
  const existentes = new Set([...pendentes.map((p) => p.id), ...contexto.map((c) => c.id)]);
  const fila = [];
  const diretas = [];

  for (const d of decisoes) {
    const relato = porId.get(d.id);
    if (!relato) continue;

    if (d.situacao === "pronto") {
      if (ehConfiavel(relato.autor, autoresConfiaveis)) {
        fila.push({ id: d.id, tipo: relato.kind, texto: relato.body, plano: d.plano, autorizado: false });
      } else {
        diretas.push({
          id: d.id,
          status: "todo",
          resolution: juntarPlano(`${d.texto} Pronto para fazer, aguardando autorização.`, d.plano),
        });
      }
      continue;
    }

    if (d.situacao === "todo") {
      diretas.push({ id: d.id, status: "todo", resolution: juntarPlano(d.texto, d.plano) });
      continue;
    }

    if (d.situacao === "duplicado") {
      if (d.duplicadoDe && d.duplicadoDe !== d.id && existentes.has(d.duplicadoDe)) {
        diretas.push({ id: d.id, status: "duplicado", resolution: d.texto, duplicadoDe: d.duplicadoDe });
      } else {
        diretas.push({
          id: d.id,
          status: "todo",
          resolution: cortar(
            `${d.texto}\n\nA triagem achou que este relato repete outro, mas não apontou um relato que exista. Fica para quem administra conferir.`,
            TETO_DA_RESOLUCAO
          ),
        });
      }
      continue;
    }

    diretas.push({ id: d.id, status: d.situacao, resolution: d.texto });
  }

  // Autorizado não passa pela triagem de novo: quem administra já leu o plano
  // e disse sim. O plano é o texto que estava no relato quando foi autorizado.
  for (const p of pendentes) {
    if (p.status !== "autorizado") continue;
    fila.push({
      id: p.id,
      tipo: p.kind,
      texto: p.body,
      plano: p.resolution || "Sem plano escrito: siga o relato.",
      autorizado: true,
    });
  }

  return { fila, diretas };
}

// --- O que cada item da fila vira depois da implementação ----------------------
//
// publicados   Map id -> sha (40) do commit que foi ao main
// resultados   Map id -> o que o agente disse (validarImplementacao)
// guarda       { reprovados: [{ id, motivos }] }
// testes       false quando a suíte falhou no ramo a publicar
// pushAdiado   true quando o main andou duas vezes e nada foi publicado: os
//              relatos ficam como estão e voltam amanhã
// comCommit    Set dos ids que têm ao menos um commit
// falhaGeral   texto, quando a implementação nem terminou (erro, tempo)
export function decisoesDaFila({
  fila,
  resultados = new Map(),
  guarda = { reprovados: [] },
  publicados = new Map(),
  testes = true,
  pushAdiado = false,
  comCommit = new Set(),
  falhaGeral = null,
}) {
  const barrados = new Map(guarda.reprovados.map((r) => [r.id, r.motivos]));
  const saida = [];

  for (const item of fila) {
    const r = resultados.get(item.id);

    if (publicados.has(item.id)) {
      saida.push({
        id: item.id,
        status: item.tipo === "bug" ? "corrigido" : "adicionado",
        resolution: r?.resumo || "Feito pelo agente diário.",
        commit: publicados.get(item.id),
      });
      continue;
    }

    if (pushAdiado && !falhaGeral) continue;

    let motivo;
    if (falhaGeral) {
      motivo = `O agente não terminou a implementação (${falhaGeral}).`;
    } else if (r && !r.feito) {
      if (r.inviavel) {
        saida.push({ id: item.id, status: "inviavel", resolution: r.motivo || "Não cabe na arquitetura atual." });
        continue;
      }
      motivo = r.motivo ? `O agente não fez: ${r.motivo}` : "O agente não conseguiu fazer com segurança.";
    } else if (barrados.has(item.id)) {
      motivo = `Ficou pronto, mas a guarda automática barrou: ${barrados.get(item.id).join("; ")}.`;
    } else if (!comCommit.has(item.id)) {
      motivo = r ? "O agente disse que fez, mas não deixou commit com este relato." : "O agente não disse nada sobre este relato.";
    } else if (!testes) {
      motivo = "Ficou pronto, mas não passou nos testes.";
    } else {
      motivo = "Ficou pronto, mas não chegou a ser publicado.";
    }

    saida.push({
      id: item.id,
      status: "todo",
      resolution: juntarPlano(`${motivo} Autorize para tentar de novo.`, item.plano),
    });
  }

  return saida;
}

// --- Texto ----------------------------------------------------------------------

export function juntarPlano(texto, plano) {
  const base = String(texto || "").trim();
  const junto = plano ? `${base}\n\nPlano: ${String(plano).trim()}` : base;
  return cortar(junto, TETO_DA_RESOLUCAO);
}

export function cortar(texto, teto) {
  const t = String(texto || "");
  return t.length > teto ? `${t.slice(0, teto - 1).trimEnd()}…` : t;
}

// Travessão vira vírgula (a regra da casa para texto que alguém lê), e sai
// todo caractere de controle que não seja quebra de linha.
export function limparTexto(valor) {
  if (valor === null || valor === undefined) return "";
  return String(valor)
    .replace(/\r\n?/g, "\n")
    .split("")
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c === 10 || (c >= 32 && c !== 127);
    })
    .join("")
    .replace(/\s+[—–]\s+/g, ", ")
    .replace(/[—–]/g, "-")
    .trim();
}
