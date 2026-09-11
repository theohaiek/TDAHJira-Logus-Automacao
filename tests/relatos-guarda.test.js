// A guarda do agente diário: cada regra, sozinha, sem git e sem modelo.
//
// A guarda é a última coisa entre um texto escrito por quem usa o aplicativo e
// o main de um repositório público que vai direto para produção. Cada teste
// aqui é um jeito de um commit tentar passar sem merecer.
//
//   node --test tests/relatos-guarda.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { avaliarCommits, nomesProibidos, LIMITES } from "../scripts/relatos/guarda.mjs";

const TOKEN = "segredo-do-agente-com-mais-de-trinta-e-dois-caracteres";

function commit({
  sha = "a".repeat(40),
  mensagem = "Corrige o rotulo da versao\n\nO rotulo cortava em tela estreita.\n\nRelato: 1",
  arquivos = [{ caminho: "web/js/versao.js", adicionadas: 3, removidas: 1, status: "M", binario: false, modo: "100644" }],
  adicionadas = ["const largura = medir(rotulo);"],
  removidas = [],
  autorNome = "Pessoa Exemplo",
  autorEmail = "pessoa@exemplo.test",
} = {}) {
  const caminho = arquivos[0]?.caminho || "web/js/versao.js";
  return {
    sha,
    mensagem,
    autorNome,
    autorEmail,
    commitNome: autorNome,
    commitEmail: autorEmail,
    arquivos,
    linhasAdicionadas: adicionadas.map((texto) => (typeof texto === "string" ? { caminho, texto } : texto)),
    linhasRemovidas: removidas.map((texto) => (typeof texto === "string" ? { caminho, texto } : texto)),
  };
}

function fila(extra = {}) {
  return new Map([
    [
      1,
      {
        kind: "bug",
        autorizado: false,
        texto: "O rótulo da versão no rodapé fica cortado quando a janela é estreita demais para caber",
        nomes: ["Márcia Exemplo", "marcia_exemplo"],
        ...extra,
      },
    ],
  ]);
}

function avaliar(commits, relatos = fila()) {
  return avaliarCommits({ commits: [].concat(commits), relatos, segredos: [TOKEN] });
}

function barrou(resultado, trecho) {
  const motivos = resultado.reprovados.flatMap((r) => r.motivos).concat(resultado.porCommit.flatMap((c) => c.motivos));
  return motivos.some((m) => m.includes(trecho));
}

// --- O caso bom --------------------------------------------------------------

test("um commit pequeno, com relato, sem nada proibido, passa", () => {
  const r = avaliar(commit());
  assert.deepEqual(r.aprovados, [1]);
  assert.deepEqual(r.commitsAprovados, ["a".repeat(40)]);
  assert.deepEqual(r.reprovados, []);
});

test("relato sem commit nenhum não é aprovado nem reprovado", () => {
  const r = avaliar([]);
  assert.deepEqual(r.aprovados, []);
  assert.deepEqual(r.reprovados, []);
});

// --- A mensagem --------------------------------------------------------------

test("commit sem a linha Relato: N não entra", () => {
  const r = avaliar(commit({ mensagem: "Corrige o rotulo\n\nSem dizer de onde veio." }));
  assert.deepEqual(r.commitsAprovados, []);
  assert.ok(r.porCommit[0].motivos.some((m) => m.includes("sem a linha Relato")));
});

test("commit que nasceu na vez de um relato e cita outro não entra", () => {
  const relatos = new Map([
    [1, { kind: "bug", autorizado: false, texto: "a", nomes: [] }],
    [2, { kind: "bug", autorizado: false, texto: "b", nomes: [] }],
  ]);
  const c = { ...commit({ mensagem: "Corrige o rotulo\n\nRelato: 2" }), vez: 1 };
  const r = avaliar(c, relatos);
  assert.deepEqual(r.commitsAprovados, []);
  assert.ok(barrou(r, "na vez do relato 1"));

  const certo = { ...commit({ mensagem: "Corrige o rotulo\n\nRelato: 1" }), vez: 1 };
  assert.deepEqual(avaliar(certo, relatos).commitsAprovados, ["a".repeat(40)]);
});

test("commit que cita relato fora da fila não entra", () => {
  const r = avaliar(commit({ mensagem: "Corrige o rotulo\n\nRelato: 1\nRelato: 77" }));
  assert.deepEqual(r.commitsAprovados, []);
  assert.ok(barrou(r, "fora da fila"));
});

test("assunto com acento, longo demais ou com prefixo de tipo é barrado", () => {
  for (const [assunto, trecho] of [
    ["Corrige o rótulo da versão", "acento"],
    ["Corrige " + "x".repeat(70), "72"],
    ["fix: corrige o rotulo", "prefixo"],
    ["feat(quadro): novo filtro", "prefixo"],
  ]) {
    const r = avaliar(commit({ mensagem: `${assunto}\n\nRelato: 1` }));
    assert.ok(barrou(r, trecho), `deixou passar: ${assunto}`);
    assert.deepEqual(r.aprovados, []);
  }
});

test("travessão na mensagem é barrado, no assunto ou no corpo", () => {
  for (const mensagem of ["Corrige o rotulo\n\nCortava — agora cabe.\n\nRelato: 1", "Corrige o rotulo\n\nDe 1 – 2.\n\nRelato: 1"]) {
    assert.ok(barrou(avaliar(commit({ mensagem })), "travessão"));
  }
});

test("crédito a agente em qualquer forma é barrado", () => {
  for (const linha of [
    "Co-Authored-By: Claude <noreply@anthropic.com>",
    "co-authored-by: alguem <x@y.z>",
    "Generated with a tool",
    "Feito com ajuda do claude",
    "🤖",
  ]) {
    const r = avaliar(commit({ mensagem: `Corrige o rotulo\n\nCausa.\n\nRelato: 1\n${linha}` }));
    assert.ok(barrou(r, "agente"), `deixou passar: ${linha}`);
  }
  const autor = avaliar(commit({ autorNome: "Claude", autorEmail: "noreply@anthropic.com" }));
  assert.ok(barrou(autor, "autor do commit"));
});

// --- Os arquivos -------------------------------------------------------------

test("arquivo proibido é barrado, em qualquer caixa e com qualquer barra", () => {
  for (const caminho of [
    "package.json",
    "Package.JSON",
    "web/package.json",
    "package-lock.json",
    "vercel.json",
    ".gitignore",
    ".npmrc",
    ".github/workflows/ci.yml",
    ".claude/settings.json",
    ".env",
    ".env.local",
    "ACESSOS.local.md",
    "scripts/relatos/guarda.mjs",
    "scripts\\relatos\\rodar.mjs",
    "SCRIPTS/RELATOS/plano.mjs",
    "server/auth.js",
    "server/http.js",
    "api/index.js",
    "node_modules/pacote/index.js",
  ]) {
    const r = avaliar(commit({ arquivos: [{ caminho, adicionadas: 1, removidas: 0, status: "M", binario: false, modo: "100644" }] }), fila({ autorizado: true }));
    assert.deepEqual(r.aprovados, [], `deixou passar ${caminho}, mesmo sendo proibido até com autorização`);
    assert.ok(barrou(r, "só uma pessoa pode mudar"), `motivo errado para ${caminho}`);
  }
});

test("esquema, migração e roteador só passam com autorização", () => {
  for (const caminho of ["core/schema.sql", "server/db.js", "server/api.js", "server/paths.js", "AGENTS.md"]) {
    const arquivos = [{ caminho, adicionadas: 5, removidas: 0, status: "M", binario: false, modo: "100644" }];
    const semAutorizacao = avaliar(commit({ arquivos }));
    assert.deepEqual(semAutorizacao.aprovados, [], `deixou passar ${caminho} sem autorização`);
    assert.ok(barrou(semAutorizacao, "autorização"));

    const autorizado = avaliar(commit({ arquivos }), fila({ autorizado: true }));
    assert.deepEqual(autorizado.aprovados, [1], `barrou ${caminho} mesmo autorizado`);
  }
});

test("commit que junta relato autorizado com relato não autorizado não herda a autorização", () => {
  const relatos = new Map([
    [1, { kind: "bug", autorizado: true, texto: "a", nomes: [] }],
    [2, { kind: "bug", autorizado: false, texto: "b", nomes: [] }],
  ]);
  const c = commit({
    mensagem: "Ajusta a migracao\n\nRelato: 1\nRelato: 2",
    arquivos: [{ caminho: "core/schema.sql", adicionadas: 2, removidas: 0, status: "M", binario: false, modo: "100644" }],
  });
  const r = avaliar(c, relatos);
  assert.deepEqual(r.aprovados, []);
});

test("binário, link simbólico e submódulo são barrados", () => {
  const casos = [
    [{ caminho: "web/img/x.png", adicionadas: 0, removidas: 0, status: "A", binario: true, modo: "100644" }, "binário"],
    [{ caminho: "web/atalho", adicionadas: 1, removidas: 0, status: "A", binario: false, modo: "120000" }, "link simbólico"],
    [{ caminho: "vendor/lib", adicionadas: 1, removidas: 0, status: "A", binario: false, modo: "160000" }, "submódulo"],
  ];
  for (const [arquivo, trecho] of casos) {
    assert.ok(barrou(avaliar(commit({ arquivos: [arquivo] })), trecho), `deixou passar ${trecho}`);
  }
});

test("apagar arquivo de teste é barrado, mesmo autorizado", () => {
  const arquivos = [{ caminho: "tests/regras.test.js", adicionadas: 0, removidas: 40, status: "D", binario: false, modo: "000000" }];
  assert.ok(barrou(avaliar(commit({ arquivos }), fila({ autorizado: true })), "apaga o teste"));
});

test("tirar um teste existente só passa com autorização", () => {
  const arquivos = [{ caminho: "tests/regras.test.js", adicionadas: 0, removidas: 3, status: "M", binario: false, modo: "100644" }];
  const removidas = [{ caminho: "tests/regras.test.js", texto: '  test("o prazo vencido aparece em vermelho", () => {' }];
  assert.ok(barrou(avaliar(commit({ arquivos, removidas, adicionadas: [] })), "remove teste"));
  assert.deepEqual(avaliar(commit({ arquivos, removidas, adicionadas: [] }), fila({ autorizado: true })).aprovados, [1]);
});

// --- O tamanho ---------------------------------------------------------------

test("o teto de linhas e de arquivos depende de o relato estar autorizado", () => {
  const grande = [{ caminho: "web/js/app.js", adicionadas: LIMITES.confiavel.linhas, removidas: 1, status: "M", binario: false, modo: "100644" }];
  assert.ok(barrou(avaliar(commit({ arquivos: grande })), "linhas"));
  assert.deepEqual(avaliar(commit({ arquivos: grande }), fila({ autorizado: true })).aprovados, [1]);

  const muitos = Array.from({ length: LIMITES.confiavel.arquivos + 1 }, (_, i) => ({
    caminho: `web/js/arquivo${i}.js`,
    adicionadas: 1,
    removidas: 0,
    status: "M",
    binario: false,
    modo: "100644",
  }));
  assert.ok(barrou(avaliar(commit({ arquivos: muitos })), "arquivos"));
});

test("o tamanho soma todos os commits do mesmo relato", () => {
  const metade = (sha) =>
    commit({
      sha,
      arquivos: [{ caminho: "web/js/app.js", adicionadas: 130, removidas: 0, status: "M", binario: false, modo: "100644" }],
    });
  const r = avaliar([metade("b".repeat(40)), metade("c".repeat(40))]);
  assert.ok(barrou(r, "linhas"));
  assert.deepEqual(r.commitsAprovados, []);
});

// --- O conteúdo --------------------------------------------------------------

test("segredo nas linhas novas ou na mensagem é barrado", () => {
  for (const linha of [
    `const t = "${TOKEN}";`,
    "const g = 'ghp_" + "A".repeat(36) + "';",
    "github_pat_" + "B".repeat(40),
    "sk-ant-" + "c".repeat(30),
    "-----BEGIN RSA PRIVATE KEY-----",
    "eyJhbGciOiJIUzI1NiJ9.eyJ4IjoxfQ.abc",
    "libsql://banco.turso.io?authToken=xyz123",
  ]) {
    assert.ok(barrou(avaliar(commit({ adicionadas: [linha] })), "credencial") || barrou(avaliar(commit({ adicionadas: [linha] })), "token"), `deixou passar ${linha.slice(0, 20)}`);
  }
  const naMensagem = avaliar(commit({ mensagem: `Corrige o rotulo\n\n${TOKEN}\n\nRelato: 1` }));
  assert.ok(barrou(naMensagem, "token"));
});

test("o nome de quem relatou não vai para o repositório, com ou sem acento e em qualquer caixa", () => {
  for (const linha of ["// pedido da MARCIA", "const autor = 'Márcia';", "marcia_exemplo"]) {
    assert.ok(barrou(avaliar(commit({ adicionadas: [linha] })), "nome"), `deixou passar: ${linha}`);
  }
  assert.ok(barrou(avaliar(commit({ mensagem: "Corrige o rotulo pedido pela Marcia\n\nRelato: 1" })), "nome"));
});

test("nome de conta que é palavra comum do código não barra o commit", () => {
  const relatos = fila({ nomes: ["Administrador", "admin"] });
  const r = avaliar(commit({ adicionadas: ['if (user.role !== "admin") return;'] }), relatos);
  assert.deepEqual(r.aprovados, [1]);
  assert.deepEqual(nomesProibidos(["admin", "Ana", "Márcia Vitória"]), ["marcia", "vitoria"]);
});

test("trecho copiado do relato é barrado; uma palavra em comum não", () => {
  const copiado = avaliar(commit({ adicionadas: ["// o rótulo da versão no rodapé fica cortado quando a janela é estreita"] }));
  assert.ok(barrou(copiado, "trecho copiado"));

  const palavra = avaliar(commit({ adicionadas: ["// rótulo da versão"] }));
  assert.deepEqual(palavra.aprovados, [1]);
});

// --- Arrasto -----------------------------------------------------------------

test("um relato barrado leva junto o commit que ele divide com outro, e o outro relato sabe por quê", () => {
  const relatos = new Map([
    [1, { kind: "bug", autorizado: false, texto: "a", nomes: [] }],
    [2, { kind: "bug", autorizado: false, texto: "b", nomes: [] }],
  ]);
  const ruim = commit({
    sha: "d".repeat(40),
    mensagem: "Mexe no pacote\n\nRelato: 1",
    arquivos: [{ caminho: "package.json", adicionadas: 1, removidas: 0, status: "M", binario: false, modo: "100644" }],
  });
  const junto = commit({ sha: "e".repeat(40), mensagem: "Ajusta os dois\n\nRelato: 1\nRelato: 2" });
  const r = avaliar([ruim, junto], relatos);

  assert.deepEqual(r.commitsAprovados, []);
  assert.deepEqual(r.aprovados, []);
  const dois = r.reprovados.find((x) => x.id === 2);
  assert.ok(dois, "o relato 2 não foi reprovado");
  assert.ok(dois.motivos.length > 0, "o relato 2 ficou sem motivo");
});

test("o commit impostor derruba o relato em cuja vez nasceu, e não o que ele diz ser", () => {
  const relatos = new Map([
    [1, { kind: "bug", autorizado: false, texto: "a", nomes: [] }],
    [2, { kind: "bug", autorizado: false, texto: "b", nomes: [] }],
  ]);
  const doUm = { ...commit({ sha: "1".repeat(40), mensagem: "Corrige o primeiro\n\nRelato: 1" }), vez: 1 };
  const impostor = { ...commit({ sha: "2".repeat(40), mensagem: "Corrige o segundo\n\nRelato: 1" }), vez: 2 };
  const r = avaliar([doUm, impostor], relatos);
  assert.deepEqual(r.aprovados, [1]);
  assert.deepEqual(r.commitsAprovados, ["1".repeat(40)]);
  assert.deepEqual(r.reprovados.map((x) => x.id), [2]);
});
