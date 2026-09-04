// Captura rápida.
//
// Uma linha de texto vira uma tarefa completa. Isso importa mais do que
// parece: o custo de registrar precisa ser menor do que o custo de segurar
// na cabeça, senão nada é registrado e a ferramenta fica pela metade.
//
//   Ligar para o fornecedor #COM @bruno !agora ~2 amanhã +cliente
//
//   #  projeto      @  responsável    !  prioridade
//   *  energia      ~  blocos de 25min   +  etiqueta
//   e datas soltas: hoje, amanhã, sexta, 21/08

const DIAS = {
  domingo: 0, dom: 0,
  segunda: 1, seg: 1,
  terca: 2, terça: 2, ter: 2,
  quarta: 3, qua: 3,
  quinta: 4, qui: 4,
  sexta: 5, sex: 5,
  sabado: 6, sábado: 6, sab: 6, sáb: 6,
};

const PRIORIDADES = {
  agora: "agora",
  urgente: "agora",
  hoje: "agora",
  normal: "normal",
  depois: "quando_der",
  qualquer: "quando_der",
  quandoder: "quando_der",
};

const TIPOS = {
  longa: "longa", longo: "longa", validade: "longa",
  oportunidade: "oportunidade", oport: "oportunidade", op: "oportunidade",
  meta: "meta", metas: "meta", objetivo: "meta",
};

const ENERGIAS = { leve: "leve", media: "media", média: "media", pesada: "pesada", pesado: "pesada" };

export function parseCaptura(texto, { projects = [], users = [], labels = [] } = {}) {
  const dados = {};
  const tokens = [];
  let resto = ` ${texto} `;

  const consome = (regex, aplicar) => {
    resto = resto.replace(regex, (match, ...args) => {
      const usado = aplicar(...args);
      if (usado === false) return match;
      return " ";
    });
  };

  // Projeto: aceita a sigla (#AUT) ou o começo do nome (#automa)
  consome(/\s#([\p{L}\p{N}_-]+)/giu, (bruto) => {
    const alvo = norm(bruto);
    const p =
      projects.find((x) => norm(x.key) === alvo) ||
      projects.find((x) => norm(x.name).startsWith(alvo));
    if (!p) return false;
    dados.projectId = p.id;
    tokens.push({ tipo: "projeto", texto: p.name, cor: p.color });
    return true;
  });

  // Responsável
  consome(/\s@([\p{L}\p{N}._-]+)/giu, (bruto) => {
    const alvo = norm(bruto);
    const u =
      users.find((x) => norm(x.username) === alvo) ||
      users.find((x) => norm(x.name).startsWith(alvo));
    if (!u) return false;
    dados.assigneeId = u.id;
    tokens.push({ tipo: "responsável", texto: u.name, cor: u.color });
    return true;
  });

  // Tipo: ^longa, ^oportunidade, ^meta — cria direto no quadro certo
  consome(/\s\^([\p{L}]+)/giu, (bruto) => {
    const k = TIPOS[norm(bruto)];
    if (!k) return false;
    dados.kind = k;
    tokens.push({ tipo: "quadro", texto: k === "longa" ? "validade longa" : k });
    return true;
  });

  // Prioridade
  consome(/\s!([\p{L}]*)/giu, (bruto) => {
    const chave = norm(bruto);
    const p = chave === "" ? "agora" : PRIORIDADES[chave];
    if (!p) return false;
    dados.priority = p;
    tokens.push({ tipo: "prioridade", texto: p === "quando_der" ? "quando der" : p });
    return true;
  });

  // Energia
  consome(/\s\*([\p{L}]+)/giu, (bruto) => {
    const e = ENERGIAS[norm(bruto)];
    if (!e) return false;
    dados.energy = e;
    tokens.push({ tipo: "energia", texto: e });
    return true;
  });

  // Tamanho em blocos
  consome(/\s~(\d{1,2})/g, (n) => {
    const v = Math.min(40, Math.max(1, Number(n)));
    dados.size = v;
    tokens.push({ tipo: "tamanho", texto: `${v} bloco${v > 1 ? "s" : ""}` });
    return true;
  });

  // Etiquetas
  consome(/\s\+([\p{L}\p{N}_-]+)/giu, (bruto) => {
    const alvo = norm(bruto);
    const l = labels.find((x) => norm(x.name).startsWith(alvo));
    if (!l) return false;
    dados.labels = [...(dados.labels || []), l.id];
    tokens.push({ tipo: "etiqueta", texto: l.name, cor: l.color });
    return true;
  });

  // Datas: dia/mês
  consome(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g, (d, m, a) => {
    const ano = a ? (a.length === 2 ? 2000 + Number(a) : Number(a)) : new Date().getFullYear();
    const data = new Date(ano, Number(m) - 1, Number(d));
    if (Number.isNaN(data.getTime())) return false;
    // Sem ano explícito e data já passada: quem escreve "03/01" em dezembro
    // quer janeiro do ano que vem.
    if (!a && data < zerar(new Date())) data.setFullYear(ano + 1);
    dados.dueOn = iso(data);
    tokens.push({ tipo: "prazo", texto: rotuloData(data) });
    return true;
  });

  // Datas por palavra
  // O lookahead substitui \b de propósito: \b se apoia no \w ASCII e não
  // enxerga fronteira depois de "amanhã", justamente a palavra mais usada.
  consome(/\s(hoje|amanha|amanhã|depois de amanha|depois de amanhã)(?!\p{L})/giu, (palavra) => {
    const p = norm(palavra);
    const d = zerar(new Date());
    if (p === "amanha") d.setDate(d.getDate() + 1);
    else if (p.startsWith("depois")) d.setDate(d.getDate() + 2);
    dados.dueOn = iso(d);
    if (p === "hoje") dados.focusOn = iso(d);
    tokens.push({ tipo: "prazo", texto: p === "amanha" ? "amanhã" : palavra.trim() });
    return true;
  });

  // Dia da semana: sempre o próximo que vier
  consome(
    /\s(?:na\s+|)(domingo|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|dom\.|seg|ter\.|qua|qui|sex|s[áa]b)(?!\p{L})/giu,
    (palavra) => {
      // "ter" e "dom" são palavras comuns ("Ter um cliente", "Dom Pedro");
      // como abreviação de dia, só valem com ponto.
      const alvo = DIAS[norm(palavra).replace(".", "")];
      if (alvo === undefined) return false;
      const d = zerar(new Date());
      let delta = (alvo - d.getDay() + 7) % 7;
      if (delta === 0) delta = 7;
      d.setDate(d.getDate() + delta);
      dados.dueOn = iso(d);
      tokens.push({ tipo: "prazo", texto: rotuloData(d) });
      return true;
    }
  );

  const title = resto.replace(/\s+/g, " ").trim();
  return { title, dados, tokens };
}

// Sugestões mostradas enquanto se digita, para que a sintaxe não precise
// ser decorada.
export function dicas(texto, ctx) {
  const { tokens } = parseCaptura(texto, ctx);
  if (tokens.length) return tokens;
  if (!texto.trim()) return [];
  return [
    { tipo: "dica", texto: "#projeto" },
    { tipo: "dica", texto: "@pessoa" },
    { tipo: "dica", texto: "!agora" },
    { tipo: "dica", texto: "*leve" },
    { tipo: "dica", texto: "~2 blocos" },
    { tipo: "dica", texto: "^meta" },
    { tipo: "dica", texto: "amanhã" },
  ];
}

function norm(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

function zerar(d) {
  d.setHours(0, 0, 0, 0);
  return d;
}

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function rotuloData(d) {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
