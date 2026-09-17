// Devolve um anexo.
//
// Pela ponte, o arquivo vai para o disco e o agente recebe só o caminho: a
// ponte intercepta esta ferramenta e baixa por GET /api/mcp/anexos/{id}, sem
// passar pelo modelo. ver=true mostra a imagem, quando é imagem.
//
// Sem ponte não há disco. Imagem volta como imagem, que o modelo enxerga, e
// texto volta como texto, ambos com teto; o resto só pela ponte ou pela tela.

import { getAttachment, readAttachment } from "../../comments.js";
import { notFound } from "../../tasks.js";
import { tamanho } from "../comum.js";

const TETO_IMAGEM = 3 * 1024 * 1024;
const TETO_TEXTO = 60 * 1024;
const TEXTO = new Set(["text/plain", "text/csv", "application/json"]);

export default {
  nome: "baixar",
  titulo: "Baixar anexo",
  descricao: (ctx) =>
    ctx.ponte
      ? "Salva anexo em disco e devolve o caminho. ver=true também mostra a imagem."
      : "Devolve o anexo: imagem para ver, texto para ler. Ids aparecem em ler.",
  leitura: true,
  entrada: {
    type: "object",
    properties: {
      anexo: { type: "integer" },
      destino: { type: "string", so: "ponte", description: "pasta ou arquivo; padrão pasta temporária" },
      ver: { type: "boolean", so: "ponte" },
    },
    required: ["anexo"],
  },

  async executar(args) {
    const id = Number(String(args.anexo).replace(/^#/, ""));
    const meta = Number.isSafeInteger(id) ? await getAttachment(id) : null;
    if (!meta) throw notFound(`Anexo ${args.anexo} não existe.`);
    const cabeca = `${meta.id} ${meta.name} ${meta.mime} ${tamanho(meta.size)}`;

    const cabe = (meta.isImage && meta.size <= TETO_IMAGEM) || (TEXTO.has(meta.mime) && meta.size <= TETO_TEXTO);
    if (!cabe) return `${cabeca}: grande ou binário demais para vir pelo MCP remoto. Use a ponte local ou a tela.`;

    const arquivo = await readAttachment(id);
    if (!arquivo) throw notFound(`O arquivo do anexo ${id} sumiu do armazenamento.`);

    if (meta.isImage) {
      return {
        content: [
          { type: "text", text: cabeca },
          { type: "image", data: arquivo.conteudo.toString("base64"), mimeType: meta.mime },
        ],
      };
    }
    return `${cabeca}\n${arquivo.conteudo.toString("utf8")}`;
  },
};
