// Modo foco.
//
// Uma tarefa por vez, em tela cheia, com um relógio. O resto do produto
// desaparece — não fica atrás de uma sobreposição translúcida, desaparece
// mesmo. Uma lista visível no canto é um convite permanente a trocar de
// tarefa, e trocar de tarefa é o que se está tentando evitar aqui.
//
// O relógio conta para cima depois que o tempo acaba, em vez de alarmar e
// encerrar. Quem está embalado não deve ser interrompido; quem passou do
// tempo só precisa saber disso.

import { h, mount, $ } from "./dom.js";
import { tarefa, patch, mesclarTarefa, emit } from "./store.js";
import { api } from "./api.js";
import { erro, toast, comemorar } from "./toast.js";
import { abrirTicket } from "./ticket.js";

let estado = null;
let tique = null;

export function focoAtivo() {
  return !!estado;
}

export function abrirFoco(taskId, minutos = 25) {
  const t = tarefa(taskId);
  if (!t) return;

  estado = {
    taskId,
    minutos,
    inicio: Date.now(),
    pausado: false,
    pausadoEm: 0,
    acumuladoPausa: 0,
  };

  $("#focus").hidden = false;
  document.body.style.overflow = "hidden";

  // Entrar em foco declara que a tarefa está em andamento: é o estado real,
  // e não faz sentido pedir que se marque isso à mão.
  if (t.status !== "doing") patch(taskId, { status: "doing" }).catch(() => {});
  api.focusStart(taskId, minutos).catch(() => {});

  desenhar();
  tique = setInterval(desenhar, 1000);
}

export function fecharFoco(concluido = false) {
  if (!estado) return;
  clearInterval(tique);
  tique = null;
  api.focusStop(concluido).catch(() => {});
  estado = null;
  $("#focus").hidden = true;
  document.body.style.overflow = "";
}

function decorrido() {
  if (!estado) return 0;
  const pausa = estado.acumuladoPausa + (estado.pausado ? Date.now() - estado.pausadoEm : 0);
  return Math.floor((Date.now() - estado.inicio - pausa) / 1000);
}

function desenhar() {
  if (!estado) return;
  const t = tarefa(estado.taskId);
  if (!t) return fecharFoco();

  const total = estado.minutos * 60;
  const passou = decorrido();
  const restante = total - passou;
  const estourou = restante < 0;
  const passo = t.steps.find((s) => !s.done);

  mount(
    $("#focus"),
    h(
      "div",
      { class: "focusbox" },
      h("p", { class: "focus__eyebrow", text: estourou ? "tempo extra" : "foco" }),
      h("h1", { class: "focus__title", text: t.title }),

      passo ? h("p", { class: "focus__step", text: passo.text }) : null,

      h("div", {
        class: `clock${estourou ? " is-over" : ""}`,
        text: relogio(Math.abs(restante), estourou),
      }),

      h(
        "div",
        { class: "focus__ring" },
        h("span", {
          class: "focus__fill",
          style: {
            width: `${Math.min(100, (passou / total) * 100)}%`,
            background: estourou ? "var(--st-waiting)" : "var(--accent)",
          },
        })
      ),

      h(
        "div",
        { class: "focus__actions" },

        passo
          ? h("button", {
              class: "btn",
              text: "✓ passo feito",
              onClick: async () => {
                try {
                  const r = await api.toggleStep(t.id, passo.id, true);
                  mesclarTarefa(r.task);
                  emit();
                  desenhar();
                } catch (err) {
                  erro(err.message);
                }
              },
            })
          : null,

        h("button", {
          class: "btn btn--primary",
          text: "Terminei a tarefa",
          onClick: async () => {
            try {
              await patch(t.id, { status: "done" });
              fecharFoco(true);
              comemorar();
              toast("Feito.");
            } catch (err) {
              erro(err.message);
            }
          },
        }),

        h("button", {
          class: "btn",
          text: estado.pausado ? "Retomar" : "Pausar",
          onClick: () => {
            if (estado.pausado) {
              estado.acumuladoPausa += Date.now() - estado.pausadoEm;
              estado.pausado = false;
            } else {
              estado.pausado = true;
              estado.pausadoEm = Date.now();
            }
            desenhar();
          },
        }),

        h("button", {
          class: "btn btn--ghost",
          text: "+5 min",
          onClick: () => {
            estado.minutos += 5;
            desenhar();
          },
        }),

        h("button", {
          class: "btn btn--ghost",
          text: "Sair (Esc)",
          onClick: () => fecharFoco(false),
        }),

        h("button", {
          class: "btn btn--ghost",
          text: "Abrir a tarefa",
          onClick: () => {
            const id = estado.taskId;
            fecharFoco(false);
            abrirTicket(id);
          },
        })
      ),

      estourou
        ? h("p", {
            class: "tiny muted",
            style: { marginTop: "24px" },
            text: "Passou do tempo previsto. Se ainda está rendendo, siga — isso aqui é só um cronômetro, não um chefe.",
          })
        : h("p", {
            class: "tiny muted",
            style: { marginTop: "24px" },
            text: "Só esta tarefa até o relógio zerar. O resto continua lá depois.",
          })
    )
  );
}

function relogio(segundos, negativo) {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${negativo ? "+" : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
