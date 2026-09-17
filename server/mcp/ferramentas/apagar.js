// Desfaz um registro errado: comentário, anexo ou link.
//
// As regras de quem pode são as mesmas da tela, e moram nas funções chamadas:
// quem escreveu, enviou ou ligou, ou quem administra. Tarefa não se apaga por
// aqui: é irreversível, leva a trilha junto, e fica com a pessoa na tela.

import { one } from "../../db.js";
import { deleteComment, deleteAttachment } from "../../comments.js";
import { removeLink } from "../../links.js";
import { notFound, badRequest } from "../../tasks.js";

export default {
  nome: "apagar",
  titulo: "Apagar registro",
  descricao: "Apaga um comentário, anexo ou link seu (admin: de qualquer um). Um por chamada.",
  destrutiva: true,
  entrada: {
    type: "object",
    properties: {
      comentario: { type: "integer" },
      anexo: { type: "integer" },
      link: { type: "integer" },
    },
  },

  async executar(args, { user }) {
    const alvos = ["comentario", "anexo", "link"].filter((k) => args[k] !== undefined);
    if (alvos.length !== 1) throw badRequest("Diga um só: comentario, anexo ou link.");
    const [qual] = alvos;
    const id = Number(args[qual]);

    if (qual === "comentario") {
      if (!(await one("SELECT id FROM comments WHERE id = ?", [id]))) throw notFound(`Comentário #${id} não existe.`);
      await deleteComment(id, user);
    } else if (qual === "anexo") {
      if (!(await one("SELECT id FROM attachments WHERE id = ?", [id]))) throw notFound(`Anexo ${id} não existe.`);
      await deleteAttachment(id, user);
    } else {
      await removeLink(id, user);
    }
    return `apagado ${qual} ${id}`;
  },
};
