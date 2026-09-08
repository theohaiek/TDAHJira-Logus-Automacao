// Os módulos do navegador se encaixam?
//
// O frontend não tem suíte: não há DOM aqui, e importar qualquer arquivo de
// web/js/ derruba o processo na primeira referência a document. Mas a falha
// mais cara desses arquivos não precisa de DOM para ser vista — é um import
// que não resolve. Um nome trocado, um arquivo renomeado, uma função que
// deixou de ser exportada: o navegador para no primeiro módulo, a tela fica
// branca, e nada no servidor registra o que houve.
//
// Então o teste lê os arquivos como texto e confere as junções: todo caminho
// existe, e todo nome importado é realmente exportado por quem deveria.
//
//   node --test tests/modulos-web.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const WEB = join(RAIZ, "web", "js");

const arquivos = varrer(WEB);

test("há módulos para conferir", () => {
  // Sem isto, uma varredura que devolvesse zero arquivos passaria por vazio.
  assert.ok(arquivos.length > 15, `só ${arquivos.length} módulos encontrados`);
});

test("todo import aponta para um arquivo que existe", () => {
  const quebrados = [];

  for (const arq of arquivos) {
    for (const imp of importsDe(readFileSync(arq, "utf8"))) {
      if (!imp.caminho.startsWith(".")) continue;
      const alvo = resolve(dirname(arq), imp.caminho);
      if (!existsSync(alvo)) quebrados.push(`${curto(arq)} → ${imp.caminho}`);
    }
  }

  assert.deepEqual(quebrados, [], "imports apontando para arquivo inexistente");
});

test("todo nome importado é exportado por quem deveria exportá-lo", () => {
  const faltando = [];

  for (const arq of arquivos) {
    for (const imp of importsDe(readFileSync(arq, "utf8"))) {
      if (!imp.caminho.startsWith(".")) continue;
      const alvo = resolve(dirname(arq), imp.caminho);
      if (!existsSync(alvo)) continue;

      const exportados = exportsDe(readFileSync(alvo, "utf8"));
      for (const nome of imp.nomes) {
        if (!exportados.has(nome)) faltando.push(`${curto(arq)} importa "${nome}" de ${imp.caminho}`);
      }
    }
  }

  assert.deepEqual(faltando, [], "nomes importados que ninguém exporta");
});

test("nenhum módulo do navegador usa innerHTML para conteúdo", () => {
  const usos = [];

  for (const arq of arquivos) {
    const linhas = readFileSync(arq, "utf8").split("\n");
    linhas.forEach((linha, i) => {
      if (!linha.includes("innerHTML")) return;
      // O projeto fala de innerHTML nos comentários justamente para dizer que
      // não o usa; citar a regra não é violá-la.
      if (/^\s*(\/\/|\*|\/\*)/.test(linha)) return;
      // Zerar um container é limpeza, não injeção de conteúdo. O que a regra
      // proíbe é montar HTML a partir de texto que alguém digitou.
      if (/innerHTML\s*=\s*""/.test(linha)) return;
      usos.push(`${curto(arq)}:${i + 1}`);
    });
  }

  assert.deepEqual(usos, [], "use o helper h() de web/js/dom.js");
});

// --- Leitura ---------------------------------------------------------------

function varrer(dir) {
  const achados = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) achados.push(...varrer(caminho));
    else if (nome.endsWith(".js")) achados.push(caminho);
  }
  return achados;
}

// Extrai os imports estáticos: o caminho e os nomes trazidos entre chaves.
// Import default e "* as" não interessam aqui — o projeto não usa nenhum dos
// dois, e o que quebra em silêncio é o nome que some do meio das chaves.
function importsDe(fonte) {
  const achados = [];
  const re = /import\s+(?:\{([^}]*)\}\s+from\s+)?["']([^"']+)["']/g;

  for (const m of fonte.matchAll(re)) {
    const nomes = (m[1] || "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => n.split(/\s+as\s+/)[0].trim());
    achados.push({ nomes, caminho: m[2] });
  }
  return achados;
}

function exportsDe(fonte) {
  const nomes = new Set();

  for (const m of fonte.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) {
    nomes.add(m[1]);
  }
  for (const m of fonte.matchAll(/export\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) {
    nomes.add(m[1]);
  }
  // export { a, b as c }
  for (const m of fonte.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const parte of m[1].split(",")) {
      const limpo = parte.trim();
      if (!limpo) continue;
      const pedacos = limpo.split(/\s+as\s+/);
      nomes.add((pedacos[1] || pedacos[0]).trim());
    }
  }
  return nomes;
}

function curto(caminho) {
  return caminho.slice(RAIZ.length).replace(/\\/g, "/");
}
