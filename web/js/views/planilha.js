// Planilha — a visão que a ideia toda começou querendo.
//
// Tudo é editável no lugar: clica na célula, digita, sai. Sem abrir ticket,
// sem botão de salvar, sem diálogo de confirmação. É esse comportamento —
// e não a aparência de tabela — que faz uma planilha parecer fácil.
//
// A diferença para uma planilha de verdade é que cada edição aqui vira uma
// linha na trilha. Ganha-se o histórico sem pagar o preço do formulário.

import { h, frag, debounce } from "../dom.js";
import { state, visiveis, patch, usuario, projeto, emit } from "../store.js";
import {
  STATUS_LABEL,
  STATUS_ORDER,
  STATUS_COLOR,
  PRIORITY_LABEL,
  KIND_LABEL,
  ENERGY_LABEL,
  prazoTexto,
  prazoEstado,
  diasParado,
  agingClasse,
  agingTexto,
} from "../format.js";
import { abrirTicket } from "../ticket.js";
import { erro, comemorar } from "../toast.js";
import { criarRapida } from "../quickadd.js";

const COLUNAS = [
  { chave: "key", titulo: "", largura: "62px" },
  { chave: "title", titulo: "Tarefa" },
  { chave: "status", titulo: "Estado", largura: "116px" },
  { chave: "assigneeId", titulo: "Quem", largura: "116px" },
  { chave: "priority", titulo: "Prioridade", largura: "112px" },
  { chave: "energy", titulo: "Energia", largura: "96px" },
  { chave: "size", titulo: "Blocos", largura: "78px" },
  { chave: "dueOn", titulo: "Prazo", largura: "116px" },
  { chave: "statusSince", titulo: "Parada há", largura: "94px" },
];

export function viewPlanilha() {
  const f = state.sheet;

  const base = visiveis(f.kind || "task");
  const linhas = filtrar(base, f).sort(ordenador(f));

  return frag(
    h(
      "div",
      { class: "page-head" },
      h("h1", { text: "Planilha" }),
      h("p", { text: "Clique em qualquer célula para editar. A mudança grava sozinha." })
    ),

    h(
      "div",
      { class: "sheetbar" },
      h("input", {
        type: "text",
        placeholder: "Filtrar por texto…",
        value: f.busca,
        "aria-label": "Filtrar tarefas",
        onInput: debounce((e) => {
          state.sheet.busca = e.target.value;
          emit();
        }, 200),
      }),
      seletor(
        f.status,
        [["", "Todos os estados"], ...STATUS_ORDER.map((s) => [s, STATUS_LABEL[s]])],
        (v) => {
          state.sheet.status = v;
          emit();
        }
      ),
      seletor(
        f.kind || "task",
        [...Object.entries(KIND_LABEL), ["*", "Todos os tipos"]],
        (v) => {
          state.sheet.kind = v;
          emit();
        }
      ),
      seletor(
        f.pessoa,
        [
          ["", "Todo mundo"],
          ["ninguem", "Sem responsável"],
          ...state.users.map((u) => [String(u.id), u.name]),
        ],
        (v) => {
          state.sheet.pessoa = v;
          emit();
        }
      ),
      // Filtros prontos em botão. Ter a resposta pronta vale mais do que ter
      // uma linguagem de consulta poderosa — e é uma decisão a menos.
      atalho("Minhas", () => {
        state.sheet.pessoa = String(state.me?.id || "");
        state.sheet.rapido = null;
      }, f.pessoa === String(state.me?.id || "") && !f.rapido),

      atalho("Sem responsável", () => {
        state.sheet.pessoa = "ninguem";
        state.sheet.rapido = null;
      }, f.pessoa === "ninguem"),

      atalho("Paradas há +3 dias", () => {
        state.sheet.rapido = state.sheet.rapido === "paradas" ? null : "paradas";
      }, f.rapido === "paradas"),

      atalho("Esperando", () => {
        state.sheet.status = state.sheet.status === "waiting" ? "" : "waiting";
      }, f.status === "waiting"),

      f.busca || f.status || f.pessoa || f.rapido
        ? h("button", {
            class: "btn btn--sm btn--ghost",
            text: "limpar",
            onClick: () => {
              state.sheet = { busca: "", status: "", pessoa: "", kind: f.kind, rapido: null, ordem: f.ordem, desc: f.desc };
              emit();
            },
          })
        : null,

      h("span", { class: "spacer" }),
      h("span", { class: "tiny muted", text: `${linhas.length} de ${base.length}` }),
      h("button", {
        class: "btn btn--sm btn--ghost",
        text: "Exportar",
        title: "Baixa o que está filtrado em CSV — os dados são do time, não da ferramenta",
        onClick: () => exportarCsv(linhas),
      }),
      h("button", { class: "btn btn--sm", text: "+ Nova linha", onClick: () => criarRapida({}) })
    ),

    h(
      "div",
      { class: "gridwrap" },
      h(
        "table",
        { class: "sheet" },
        h(
          "thead",
          null,
          h(
            "tr",
            null,
            COLUNAS.map((c) =>
              h("th", {
                text: c.titulo,
                class: f.ordem === c.chave ? "is-sorted" : "",
                style: c.largura ? { width: c.largura } : {},
                title: c.titulo ? `Ordenar por ${c.titulo.toLowerCase()}` : "",
                onClick: () => ordenarPor(c.chave),
              })
            ),
            h("th", { style: { width: "38px" } })
          )
        ),
        h(
          "tbody",
          null,
          linhas.length
            ? linhas.map((t) => linha(t))
            : h(
                "tr",
                null,
                h("td", { colspan: COLUNAS.length + 1 }, h("div", { class: "empty" }, "Nenhuma tarefa com esses filtros."))
              )
        )
      )
    )
  );
}

function linha(t) {
  const parado = diasParado(t);

  return h(
    "tr",
    { class: t.status === "done" ? "is-done" : "", dataset: { id: t.id } },

    h("td", { class: "col-key", text: t.key }),

    // Título editável no lugar.
    h(
      "td",
      null,
      campoTexto(t.title, "cell cell-title", async (v) => {
        if (!v.trim() || v === t.title) return;
        await salvar(t.id, { title: v.trim() });
      })
    ),

    h(
      "td",
      null,
      campoSelect(
        t.status,
        STATUS_ORDER.map((s) => [s, STATUS_LABEL[s]]),
        async (v) => {
          await salvar(t.id, { status: v });
          if (v === "done") comemorar();
        },
        { color: STATUS_COLOR[t.status] }
      )
    ),

    h(
      "td",
      null,
      campoSelect(
        t.assigneeId ? String(t.assigneeId) : "",
        [["", "—"], ...state.users.map((u) => [String(u.id), u.name])],
        (v) => salvar(t.id, { assigneeId: v ? Number(v) : null })
      )
    ),

    h(
      "td",
      null,
      campoSelect(
        t.priority,
        Object.entries(PRIORITY_LABEL),
        (v) => salvar(t.id, { priority: v }),
        t.priority === "agora" ? { color: "var(--alert)", fontWeight: "600" } : {}
      )
    ),

    h(
      "td",
      null,
      campoSelect(
        t.energy || "",
        [["", "—"], ...Object.entries(ENERGY_LABEL)],
        (v) => salvar(t.id, { energy: v || null })
      )
    ),

    h(
      "td",
      null,
      campoTexto(t.size ? String(t.size) : "", "cell", (v) => {
        const n = v.trim() === "" ? null : Math.max(1, Math.min(40, Number(v) || 1));
        return salvar(t.id, { size: n });
      })
    ),

    h(
      "td",
      null,
      // Campo de data vazio some até receber o cursor. Quinze linhas repetindo
      // "dd/mm/aaaa" pesam mais na leitura do que a informação que carregam.
      h("input", {
        type: "date",
        class: `cell${t.dueOn ? "" : " is-empty"}`,
        value: t.dueOn || "",
        style: prazoEstado(t.dueOn) === "late" ? { color: "var(--alert)" } : {},
        title: t.dueOn ? prazoTexto(t.dueOn) : "Sem prazo",
        onChange: (e) => salvar(t.id, { dueOn: e.target.value || null }),
      })
    ),

    h("td", null,
      h("span", {
        class: `cell aging ${t.status === "done" ? "" : agingClasse(parado, t.status)}`,
        text: t.status === "done" || parado < 1 ? "—" : agingTexto(parado),
        style: { display: "block" },
      })
    ),

    h(
      "td",
      { class: "col-open" },
      h("button", {
        class: "rowopen",
        text: "↗",
        title: "Abrir a tarefa",
        "aria-label": "Abrir a tarefa",
        onClick: () => abrirTicket(t.id),
      })
    )
  );
}

// --- Células ---------------------------------------------------------------

function campoTexto(valor, classe, aoSalvar) {
  const el = h("input", { type: "text", class: classe, value: valor || "" });

  // Grava ao sair do campo ou no Enter. Não grava a cada tecla: isso encheria
  // a trilha de eventos com meia palavra digitada.
  el.addEventListener("blur", () => aoSalvar(el.value));
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      el.blur();
    }
    if (e.key === "Escape") {
      el.value = valor || "";
      el.blur();
    }
    // Navegação vertical como em planilha.
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const tr = el.closest("tr");
      const idx = Array.from(tr.children).indexOf(el.closest("td"));
      const alvo = e.key === "ArrowDown" ? tr.nextElementSibling : tr.previousElementSibling;
      const campo = alvo?.children[idx]?.querySelector("input, select");
      if (campo) {
        e.preventDefault();
        campo.focus();
        campo.select?.();
      }
    }
  });
  return el;
}

function campoSelect(valor, opcoes, aoSalvar, estilo = {}) {
  return h(
    "select",
    {
      class: "cell",
      style: estilo,
      onChange: (e) => aoSalvar(e.target.value),
    },
    opcoes.map(([v, rotulo]) =>
      h("option", { value: v, selected: String(v) === String(valor), text: rotulo })
    )
  );
}

function atalho(rotulo, aoClicar, ativo) {
  return h("button", {
    class: `btn btn--sm${ativo ? " btn--primary" : " btn--ghost"}`,
    text: rotulo,
    onClick: () => {
      aoClicar();
      emit();
    },
  });
}

// Exportação em CSV.
//
// Está aqui por uma questão de princípio: os dados pertencem a quem
// trabalha, não à ferramenta. Poder tirar tudo a qualquer momento é o que
// torna aceitável colocar tudo aqui dentro.
function exportarCsv(linhas) {
  const colunas = [
    ["Chave", (t) => t.key],
    ["Tarefa", (t) => t.title],
    ["Estado", (t) => STATUS_LABEL[t.status]],
    ["Projeto", (t) => projeto(t.projectId)?.name || ""],
    ["Quem", (t) => usuario(t.assigneeId)?.name || ""],
    ["Prioridade", (t) => PRIORITY_LABEL[t.priority]],
    ["Energia", (t) => (t.energy ? ENERGY_LABEL[t.energy] : "")],
    ["Blocos", (t) => t.size || ""],
    ["Prazo", (t) => t.dueOn || ""],
    ["Esperando", (t) => t.waitingFor || ""],
    ["Passos feitos", (t) => `${t.steps.filter((s) => s.done).length}/${t.steps.length}`],
    ["Criada em", (t) => (t.createdAt || "").slice(0, 10)],
    ["Concluída em", (t) => (t.doneAt || "").slice(0, 10)],
    ["Dias no estado", (t) => diasParado(t)],
    ["Contexto", (t) => t.description || ""],
  ];

  const escapar = (v) => {
    const s = String(v ?? "");
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  // Ponto e vírgula e BOM: é o que faz o Excel em português abrir o arquivo
  // com as colunas separadas e os acentos corretos, sem ninguém importar nada.
  const linhasCsv = [
    colunas.map((c) => escapar(c[0])).join(";"),
    ...linhas.map((t) => colunas.map((c) => escapar(c[1](t))).join(";")),
  ];

  const blob = new Blob(["﻿" + linhasCsv.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tarefas-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function seletor(valor, opcoes, aoMudar) {
  return h(
    "select",
    { onChange: (e) => aoMudar(e.target.value) },
    opcoes.map(([v, rotulo]) =>
      h("option", { value: v, selected: String(v) === String(valor), text: rotulo })
    )
  );
}

async function salvar(id, mudanca) {
  try {
    await patch(id, mudanca);
  } catch (err) {
    erro(err.message);
  }
}

// --- Filtro e ordem --------------------------------------------------------

function filtrar(lista, f) {
  const termo = f.busca.trim().toLowerCase();
  return lista.filter((t) => {
    if (f.status && t.status !== f.status) return false;
    if (f.rapido === "paradas" && (t.status === "done" || diasParado(t) < 3)) return false;
    if (f.pessoa === "ninguem" && t.assigneeId) return false;
    if (f.pessoa && f.pessoa !== "ninguem" && String(t.assigneeId) !== f.pessoa) return false;
    if (termo) {
      const alvo = `${t.key} ${t.title} ${t.description} ${t.waitingFor || ""}`.toLowerCase();
      if (!alvo.includes(termo)) return false;
    }
    return true;
  });
}

function ordenarPor(chave) {
  const f = state.sheet;
  if (f.ordem === chave) f.desc = !f.desc;
  else {
    f.ordem = chave;
    f.desc = false;
  }
  emit();
}

function ordenador(f) {
  const dir = f.desc ? -1 : 1;
  return (a, b) => {
    let x = a[f.ordem];
    let y = b[f.ordem];

    if (f.ordem === "status") {
      x = STATUS_ORDER.indexOf(a.status);
      y = STATUS_ORDER.indexOf(b.status);
    }
    if (f.ordem === "priority") {
      const ordem = ["agora", "normal", "quando_der"];
      x = ordem.indexOf(a.priority);
      y = ordem.indexOf(b.priority);
    }
    if (f.ordem === "energy") {
      const ordem = ["leve", "media", "pesada"];
      x = ordem.indexOf(a.energy || "");
      y = ordem.indexOf(b.energy || "");
    }
    if (f.ordem === "assigneeId") {
      x = usuario(a.assigneeId)?.name || "";
      y = usuario(b.assigneeId)?.name || "";
    }

    // Vazio sempre no fim, independentemente da direção: linha em branco no
    // topo não ajuda ninguém a decidir nada.
    const vazioX = x === null || x === undefined || x === "";
    const vazioY = y === null || y === undefined || y === "";
    if (vazioX && vazioY) return 0;
    if (vazioX) return 1;
    if (vazioY) return -1;

    if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
    return String(x).localeCompare(String(y), "pt-BR") * dir;
  };
}
