// Onde os arquivos anexados ficam guardados.
//
//   sem configuração         → disco, dentro de data/uploads
//   BLOB_READ_WRITE_TOKEN    → repositório de arquivos da hospedagem
//
// A separação existe porque em ambiente sem servidor não há disco que
// sobreviva à requisição: o arquivo gravado some junto com a instância que
// atendeu o upload.
//
// O repositório na nuvem é privado. Isso significa que nem a escrita nem a
// leitura acontecem sem credencial, e que o endereço do arquivo sozinho não
// abre nada — o anexo sai sempre pela rota da API, que confere a sessão antes
// de entregar o conteúdo.
//
// O modo local não carrega a biblioteca da hospedagem: o import só acontece
// quando existe configuração de nuvem, então quem roda em casa continua sem
// depender de pacote nenhum.

import { writeFileSync, unlinkSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UPLOAD_DIR } from "./paths.js";

const TOKEN = () => process.env.BLOB_READ_WRITE_TOKEN;

export function tipoDeArmazenamento() {
  return TOKEN() ? "blob" : "disco";
}

let sdk = null;

async function nuvem() {
  if (!sdk) sdk = await import("@vercel/blob");
  return sdk;
}

// Grava e devolve a referência que vai para a coluna stored_name.
// Nos dois modos a referência é o nome do arquivo — no disco, dentro da pasta
// de uploads; na nuvem, o caminho dentro do repositório.
export async function guardar(nome, conteudo, mime) {
  if (!TOKEN()) {
    mkdirSync(UPLOAD_DIR, { recursive: true });
    writeFileSync(join(UPLOAD_DIR, nome), conteudo);
    return nome;
  }

  const { put } = await nuvem();
  await put(nome, conteudo, {
    access: "private",
    contentType: mime,
    // O nome já é sorteado por quem chama. Um segundo sorteio mudaria o
    // caminho gravado e impediria de encontrar o arquivo depois.
    addRandomSuffix: false,
  });

  return nome;
}

// Devolve o conteúdo do arquivo, ou null quando ele não existe mais.
export async function ler(referencia) {
  if (!referencia) return null;

  if (!TOKEN()) {
    const caminho = join(UPLOAD_DIR, referencia);
    return existsSync(caminho) ? readFileSync(caminho) : null;
  }

  try {
    const { get } = await nuvem();
    const r = await get(referencia, { access: "private" });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    return Buffer.from(await new Response(r.stream).arrayBuffer());
  } catch (err) {
    console.error("[blob] leitura falhou:", err?.message);
    return null;
  }
}

export async function remover(referencia) {
  if (!referencia) return;

  if (!TOKEN()) {
    try {
      const caminho = join(UPLOAD_DIR, referencia);
      if (existsSync(caminho)) unlinkSync(caminho);
    } catch {}
    return;
  }

  try {
    const { del } = await nuvem();
    await del(referencia);
  } catch (err) {
    // Arquivo órfão no armazenamento é bem menos grave do que uma exclusão
    // que falha pela metade e deixa a linha do banco apontando para nada.
    console.error("[blob] remoção falhou:", err?.message);
  }
}
