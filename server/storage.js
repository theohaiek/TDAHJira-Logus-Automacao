// Onde os arquivos anexados ficam guardados.
//
//   sem configuração         → disco, dentro de data/uploads
//   BLOB_READ_WRITE_TOKEN    → Vercel Blob
//
// A separação existe porque em ambiente serverless não há disco que
// sobreviva à requisição: o arquivo gravado some junto com a instância que
// atendeu o upload.
//
// O endereço do arquivo nunca é entregue a quem usa. Mesmo no Blob, que
// serve por URL própria, a leitura passa pela rota da API, que confere a
// sessão antes de repassar o conteúdo.

import { writeFileSync, unlinkSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UPLOAD_DIR } from "./paths.js";

const TOKEN = () => process.env.BLOB_READ_WRITE_TOKEN;

export function tipoDeArmazenamento() {
  return TOKEN() ? "blob" : "disco";
}

// Grava e devolve a referência que vai para a coluna stored_name.
// No disco é o nome do arquivo; no Blob é a URL devolvida pelo serviço.
export async function guardar(nome, conteudo, mime) {
  if (!TOKEN()) {
    mkdirSync(UPLOAD_DIR, { recursive: true });
    writeFileSync(join(UPLOAD_DIR, nome), conteudo);
    return nome;
  }

  const resposta = await fetch(`https://blob.vercel-storage.com/${encodeURIComponent(nome)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${TOKEN()}`,
      "x-api-version": "7",
      "x-content-type": mime,
      // Sem sufixo aleatório: o nome já é sorteado por quem chama, e um
      // segundo sorteio impediria de apagar o arquivo depois pelo nome.
      "x-add-random-suffix": "0",
    },
    body: conteudo,
  });

  if (!resposta.ok) {
    const detalhe = await resposta.text().catch(() => "");
    console.error("[blob]", resposta.status, detalhe.slice(0, 300));
    throw Object.assign(new Error("Não foi possível guardar o arquivo."), { status: 500 });
  }

  const dados = await resposta.json();
  return dados.url;
}

// Devolve o conteúdo do arquivo, ou null quando ele não existe mais.
export async function ler(referencia) {
  if (!referencia) return null;

  if (!ehUrl(referencia)) {
    const caminho = join(UPLOAD_DIR, referencia);
    return existsSync(caminho) ? readFileSync(caminho) : null;
  }

  const resposta = await fetch(referencia);
  if (!resposta.ok) return null;
  return Buffer.from(await resposta.arrayBuffer());
}

export async function remover(referencia) {
  if (!referencia) return;

  if (!ehUrl(referencia)) {
    try {
      const caminho = join(UPLOAD_DIR, referencia);
      if (existsSync(caminho)) unlinkSync(caminho);
    } catch {}
    return;
  }

  try {
    await fetch("https://blob.vercel-storage.com/delete", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN()}`,
        "Content-Type": "application/json",
        "x-api-version": "7",
      },
      body: JSON.stringify({ urls: [referencia] }),
    });
  } catch {
    // Arquivo órfão no armazenamento é bem menos grave do que uma exclusão
    // que falha pela metade e deixa a linha do banco apontando para nada.
  }
}

function ehUrl(referencia) {
  return /^https?:\/\//.test(String(referencia));
}
