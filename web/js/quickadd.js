// Criação rápida a partir de qualquer lugar.

import { criar, state } from "./store.js";
import { parseCaptura } from "./capture.js";
import { toast, erro } from "./toast.js";
import { abrirTicket } from "./ticket.js";
import { $ } from "./dom.js";

// Cria a partir do texto cru da barra de captura, já interpretando a sintaxe.
export async function criarDoTexto(texto, extra = {}) {
  const { title, dados } = parseCaptura(texto, state);
  if (!title) return null;

  try {
    const t = await criar({ ...dados, ...extra, title });
    toast(`${t.key} criada`, { acao: "abrir", aoClicar: () => abrirTicket(t.id) });
    return t;
  } catch (err) {
    erro(err.message);
    return null;
  }
}

// Usada pelos botões "+ nova" das colunas e da planilha: leva o foco para a
// barra de captura em vez de abrir um formulário. Formulário para criar
// tarefa é exatamente o atrito que se quer evitar.
export function criarRapida(preset = {}) {
  const campo = $("#capture");
  if (!campo) return;
  campo.dataset.preset = JSON.stringify(preset);
  campo.focus();
  campo.placeholder = preset.status
    ? `Nova tarefa direto em ${preset.status === "todo" ? "A fazer" : preset.status}…`
    : "O que precisa ser feito?";
}
