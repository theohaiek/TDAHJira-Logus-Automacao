// A política do agente diário: quem pode ser implementado sem autorização, e o
// que cada resultado vira no aplicativo.
//
//   node --test tests/relatos-plano.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  validarTriagem,
  validarImplementacao,
  ehConfiavel,
  aplicarPolitica,
  decisoesDaFila,
  juntarPlano,
  limparTexto,
  TETO_DA_RESOLUCAO,
} from "../scripts/relatos/plano.mjs";

const confiavel = { id: 1, username: "confiavel", nome: "Pessoa Confiavel", role: "member", ativo: true };
const qualquer = { id: 2, username: "qualquer", nome: "Pessoa Qualquer", role: "member", ativo: true };
const chefia = { id: 3, username: "chefia", nome: "Chefia", role: "admin", ativo: true };

function pendente(id, extra = {}) {
  return { id, kind: "bug", status: "novo", body: `Relato ${id}`, resolution: null, autor: qualquer, ...extra };
}

// --- O que a triagem devolve --------------------------------------------------

test("a triagem torta é descartada item a item, e o relato não decidido continua novo", () => {
  const { decisoes, problemas } = validarTriagem(
    {
      decisoes: [
        { id: 1, situacao: "rejeitado", texto: "Não é defeito." },
        { id: 1, situacao: "todo", texto: "Repetido.", plano: "x" },
        { id: 9, situacao: "rejeitado", texto: "Não foi enviado." },
        { id: 2, situacao: "aprovado", texto: "Situação inventada." },
        { id: 3, situacao: "pronto", texto: "Sem plano." },
        { id: 4, situacao: "detalhe", texto: "   " },
        { id: "5", situacao: "ja_existe", texto: "Já existe: aperte n." },
      ],
    },
    [1, 2, 3, 4, 5, 6]
  );
  assert.deepEqual(
    decisoes.map((d) => [d.id, d.situacao]),
    [
      [1, "rejeitado"],
      [5, "ja_existe"],
    ]
  );
  assert.ok(problemas.some((p) => p.includes("não foi enviado")));
  assert.ok(problemas.some((p) => p.includes("duas decisões")));
  assert.ok(problemas.some((p) => p.includes("sem plano")));
  assert.ok(problemas.some((p) => p.includes("relato 6")), "não avisou do relato que ficou sem decisão");
});

test("sem lista de decisões, nada é decidido", () => {
  const { decisoes, problemas } = validarTriagem({ outra: [] }, [1]);
  assert.deepEqual(decisoes, []);
  assert.equal(problemas.length, 1);
});

test("o texto da triagem sai sem travessão e sem caractere de controle, e cortado", () => {
  const nulo = String.fromCharCode(0);
  const { decisoes } = validarTriagem(
    { decisoes: [{ id: 1, situacao: "detalhe", texto: `Qual tela — e quando?${nulo} ${"x".repeat(900)}` }] },
    [1]
  );
  assert.ok(!decisoes[0].texto.includes("—"));
  assert.ok(!decisoes[0].texto.includes(nulo));
  assert.ok(decisoes[0].texto.startsWith("Qual tela, e quando?"));
  assert.ok(decisoes[0].texto.length <= 800);
});

test("o resultado da implementação só vale para item enviado, e feito só com true", () => {
  const { resultados, problemas } = validarImplementacao(
    {
      resultados: [
        { id: 1, feito: true, resumo: "Mudou." },
        { id: 2, feito: "sim" },
        { id: 7, feito: true },
      ],
    },
    [1, 2]
  );
  assert.equal(resultados.get(1).feito, true);
  assert.equal(resultados.get(2).feito, false, '"sim" não é true');
  assert.ok(!resultados.has(7));
  assert.equal(problemas.length, 1);
});

// --- Quem é confiável ------------------------------------------------------------

test("confiável é quem administra ou está na lista local; inativo e anônimo nunca", () => {
  assert.equal(ehConfiavel(chefia, []), true);
  assert.equal(ehConfiavel(confiavel, ["CONFIAVEL"]), true, "a lista não pode diferenciar caixa");
  assert.equal(ehConfiavel(qualquer, ["confiavel"]), false);
  assert.equal(ehConfiavel({ ...chefia, ativo: false }, []), false);
  assert.equal(ehConfiavel(null, ["confiavel"]), false);
});

// --- A política --------------------------------------------------------------------

test("pronto de autor confiável vai para a implementação; de qualquer outro, vira TODO com o plano", () => {
  const pendentes = [pendente(1, { autor: confiavel }), pendente(2, { autor: qualquer }), pendente(3, { autor: null })];
  const decisoes = [1, 2, 3].map((id) => ({ id, situacao: "pronto", texto: "Dá para fazer.", plano: "Mudar o arquivo x." }));
  const { fila, diretas } = aplicarPolitica({ decisoes, pendentes, autoresConfiaveis: ["confiavel"] });

  assert.deepEqual(fila.map((i) => [i.id, i.autorizado]), [[1, false]]);
  assert.equal(fila[0].texto, "Relato 1");
  assert.equal(fila[0].plano, "Mudar o arquivo x.");

  assert.deepEqual(diretas.map((d) => [d.id, d.status]), [
    [2, "todo"],
    [3, "todo"],
  ]);
  assert.ok(diretas[0].resolution.includes("Plano: Mudar o arquivo x."));
});

test("todo, rejeitado, detalhe, inviável e já existe vão direto", () => {
  const pendentes = [1, 2, 3, 4, 5].map((id) => pendente(id));
  const decisoes = [
    { id: 1, situacao: "todo", texto: "Pede decisão.", plano: "Integrar x." },
    { id: 2, situacao: "rejeitado", texto: "Contraria o produto." },
    { id: 3, situacao: "detalhe", texto: "Em qual tela?" },
    { id: 4, situacao: "inviavel", texto: "Não cabe." },
    { id: 5, situacao: "ja_existe", texto: "Aperte n." },
  ];
  const { fila, diretas } = aplicarPolitica({ decisoes, pendentes });
  assert.deepEqual(fila, []);
  assert.deepEqual(diretas.map((d) => d.status), ["todo", "rejeitado", "detalhe", "inviavel", "ja_existe"]);
  assert.equal(diretas[0].resolution, "Pede decisão.\n\nPlano: Integrar x.");
});

test("duplicado só aponta para relato que existe; senão vira TODO para alguém conferir", () => {
  const pendentes = [pendente(1), pendente(2)];
  const contexto = [{ id: 40, kind: "bug", status: "corrigido", resumo: "x", resolution: "y" }];
  const { diretas } = aplicarPolitica({
    decisoes: [
      { id: 1, situacao: "duplicado", texto: "Mesmo pedido.", duplicadoDe: 40 },
      { id: 2, situacao: "duplicado", texto: "Mesmo pedido.", duplicadoDe: 999 },
    ],
    pendentes,
    contexto,
  });
  assert.deepEqual(diretas[0], { id: 1, status: "duplicado", resolution: "Mesmo pedido.", duplicadoDe: 40 });
  assert.equal(diretas[1].status, "todo");
});

test("autorizado vai para a implementação sem passar pela triagem, com o plano que foi autorizado", () => {
  const pendentes = [pendente(8, { status: "autorizado", resolution: "Plano: mexer na migração.", autor: qualquer })];
  const { fila, diretas } = aplicarPolitica({ decisoes: [], pendentes });
  assert.deepEqual(fila, [{ id: 8, tipo: "bug", texto: "Relato 8", plano: "Plano: mexer na migração.", autorizado: true }]);
  assert.deepEqual(diretas, []);
});

// --- Depois da implementação ----------------------------------------------------------

const item = (id, tipo = "bug") => ({ id, tipo, texto: `Relato ${id}`, plano: `Plano ${id}`, autorizado: false });

test("publicado vira corrigido (bug) ou adicionado (ideia), com o commit e o resumo", () => {
  const saida = decisoesDaFila({
    fila: [item(1, "bug"), item(2, "ideia")],
    resultados: new Map([[1, { id: 1, feito: true, resumo: "O contador volta a mudar." }]]),
    publicados: new Map([
      [1, "a".repeat(40)],
      [2, "b".repeat(40)],
    ]),
    comCommit: new Set([1, 2]),
  });
  assert.deepEqual(saida, [
    { id: 1, status: "corrigido", resolution: "O contador volta a mudar.", commit: "a".repeat(40) },
    { id: 2, status: "adicionado", resolution: "Feito pelo agente diário.", commit: "b".repeat(40) },
  ]);
});

test("cada jeito de não publicar vira TODO com o motivo e o plano, e inviável vira inviável", () => {
  const casos = [
    [{ resultados: new Map([[1, { id: 1, feito: false, motivo: "Mexe na migração." }]]) }, "O agente não fez: Mexe na migração."],
    [{ resultados: new Map([[1, { id: 1, feito: true }]]), guarda: { reprovados: [{ id: 1, motivos: ["travessão na mensagem"] }] }, comCommit: new Set([1]) }, "guarda automática barrou: travessão na mensagem"],
    [{ resultados: new Map([[1, { id: 1, feito: true }]]) }, "não deixou commit"],
    [{ resultados: new Map([[1, { id: 1, feito: true }]]), testes: false, comCommit: new Set([1]) }, "não passou nos testes"],
    [{ falhaGeral: "passou de 60 minutos" }, "não terminou a implementação (passou de 60 minutos)"],
  ];
  for (const [entrada, trecho] of casos) {
    const [d] = decisoesDaFila({ fila: [item(1)], ...entrada });
    assert.equal(d.status, "todo", `não virou todo: ${trecho}`);
    assert.ok(d.resolution.includes(trecho), `sem o motivo: ${trecho}\n${d.resolution}`);
    assert.ok(d.resolution.includes("Plano: Plano 1"), "sem o plano");
  }

  const [inviavel] = decisoesDaFila({
    fila: [item(1)],
    resultados: new Map([[1, { id: 1, feito: false, inviavel: true, motivo: "Exige processo sempre ligado." }]]),
  });
  assert.deepEqual(inviavel, { id: 1, status: "inviavel", resolution: "Exige processo sempre ligado." });
});

test("main que andou duas vezes não decide nada: os relatos voltam amanhã", () => {
  const saida = decisoesDaFila({
    fila: [item(1)],
    resultados: new Map([[1, { id: 1, feito: true }]]),
    comCommit: new Set([1]),
    pushAdiado: true,
  });
  assert.deepEqual(saida, []);
});

// --- Texto -------------------------------------------------------------------------------

test("o plano junto do texto nunca passa do teto da resolução", () => {
  const junto = juntarPlano("x".repeat(1000), "y".repeat(1000));
  assert.equal(junto.length, TETO_DA_RESOLUCAO);
  assert.ok(junto.endsWith("…"));
});

test("limparTexto troca travessão por vírgula e mantém a quebra de linha", () => {
  assert.equal(limparTexto("A — B\r\nC–D"), "A, B\nC-D");
  assert.equal(limparTexto(null), "");
});
