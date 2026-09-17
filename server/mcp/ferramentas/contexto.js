// Quem é o agente, e os nomes que as outras ferramentas aceitam.

import { all, today } from "../../db.js";
import { STATUSES, PRIORITIES, ENERGIES, KINDS } from "../../tasks.js";
import { COMMENT_KINDS } from "../../comments.js";
import { LINK_KINDS } from "../../links.js";

export default {
  nome: "contexto",
  titulo: "Contexto",
  descricao: "Quem sou eu, pessoas, projetos, empresas, etiquetas e valores válidos.",
  leitura: true,
  entrada: { type: "object", properties: {} },

  async executar(_args, { user }) {
    const [pessoas, projetos, empresas, etiquetas] = await Promise.all([
      all("SELECT username, display_name, role FROM users WHERE is_active = 1 ORDER BY username"),
      all("SELECT key, name FROM projects WHERE is_archived = 0 ORDER BY position, id"),
      all("SELECT name FROM companies WHERE is_archived = 0 ORDER BY position, name"),
      all("SELECT name FROM labels ORDER BY name"),
    ]);

    const lista = (itens) => (itens.length ? itens.join(" · ") : "nenhum");
    return [
      `eu: ${user.username} (${user.display_name}) ${user.role} · hoje ${today()} · horas em UTC`,
      `pessoas: ${lista(pessoas.map((p) => `${p.username} (${p.display_name})${p.role === "admin" ? " admin" : ""}`))}`,
      `projetos: ${lista(projetos.map((p) => `${p.key} ${p.name}`))}`,
      `empresas: ${lista(empresas.map((c) => c.name))}`,
      `etiquetas: ${lista(etiquetas.map((l) => l.name))}`,
      `status: ${STATUSES.join(" ")} · tipo: ${KINDS.join(" ")} · prioridade: ${PRIORITIES.join(" ")} · energia: ${ENERGIES.join(" ")}`,
      `registro: ${COMMENT_KINDS.join(" ")} · link: ${LINK_KINDS.join(" ")}`,
    ].join("\n");
  },
};
