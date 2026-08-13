// Hoje — a tela de abertura.
//
// Ela existe para responder uma pergunta só, e responder em menos de um
// segundo: o que eu faço agora. Tudo o mais nesta tela é secundário e vem
// depois da resposta.
//
// A escolha de abrir aqui, e não no quadro, é deliberada. Um quadro mostra
// tudo o que existe; e ver tudo o que existe é justamente o que trava.

import { h, frag } from "../dom.js";
import {
  state,
  agora,
  hojeLista,
  esperando,
  entrada,
  feitasHoje,
  emAndamento,
  limiteWip,
  visiveis,
  patch,
} from "../store.js";
import { taskCard, listaTarefas } from "../taskcard.js";
import { saudacao, plural, minutosDeBlocos, diasParado, agingTexto } from "../format.js";
import { abrirFoco } from "../focus.js";
import { abrirTicket } from "../ticket.js";
import { erro, toast } from "../toast.js";

export function viewHoje() {
  const proximas = agora(3);
  const principal = proximas[0];
  const emCurso = emAndamento();
  const wip = limiteWip();
  const feitas = feitasHoje();

  return frag(
    heroi(principal, emCurso, wip),

    proximas.length > 1
      ? seção(
          "Depois desta",
          proximas.slice(1).length,
          listaTarefas(proximas.slice(1), { mostrarPasso: false })
        )
      : null,

    (() => {
      const doDia = hojeLista().filter((t) => !proximas.some((p) => p.id === t.id));
      return doDia.length
        ? seção("Puxadas para hoje", doDia.length, listaTarefas(doDia))
        : null;
    })(),

    (() => {
      const esp = esperando();
      if (!esp.length) return null;
      return seção(
        "Esperando outra pessoa",
        esp.length,
        h(
          "div",
          null,
          h("p", {
            class: "tiny muted",
            style: { marginBottom: "8px" },
            text: "Não está com você. Aparece aqui para não sumir da memória.",
          }),
          listaTarefas(esp, { mostrarPasso: false })
        )
      );
    })(),

    (() => {
      const inbox = entrada();
      if (!inbox.length) return null;
      return seção(
        "Entrada",
        inbox.length,
        h(
          "div",
          null,
          h("p", {
            class: "tiny muted",
            style: { marginBottom: "8px" },
            text: "Capturado e ainda não organizado. Decida em um clique: fazer, esperar ou descartar.",
          }),
          h(
            "div",
            null,
            inbox.map((t) => cartaoTriagem(t))
          )
        )
      );
    })(),

    feitas.length ? seção(`Concluídas hoje`, feitas.length, listaTarefas(feitas)) : null
  );
}

// --- O bloco de cima -------------------------------------------------------

function heroi(t, emCurso, wip) {
  if (!t) {
    return h(
      "div",
      { class: "today__hero" },
      h("p", { class: "today__eyebrow", text: saudacao() }),
      h("p", { class: "today__now", text: "Não há nada esperando por você agora." }),
      h("p", {
        class: "today__why",
        text: "Se sobrou tempo, a Entrada é um bom lugar para olhar. Se não sobrou, também está tudo certo.",
      })
    );
  }

  const passo = t.steps.find((s) => !s.done);
  const parado = diasParado(t);

  return h(
    "div",
    { class: "today__hero" },
    h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" } },
      h("p", { class: "today__eyebrow", text: `${saudacao()} — comece por aqui` }),
      indicadorWip(emCurso.length, wip)
    ),

    h("p", {
      class: "today__now",
      text: t.title,
      style: { cursor: "pointer" },
      onClick: () => abrirTicket(t.id),
    }),

    // Sempre que houver passos, o primeiro passo aparece. Encarar "o próximo
    // passo" é muito mais fácil do que encarar "a tarefa".
    passo ? h("p", { class: "today__why", text: `Próximo passo: ${passo.text}` }) : null,

    h("p", { class: "today__why", text: porQue(t, parado) }),

    h(
      "div",
      { class: "today__actions" },
      h("button", {
        class: "btn btn--primary",
        text: t.size ? `Focar ${minutosDeBlocos(1)} min` : "Focar 25 min",
        onClick: () => abrirFoco(t.id),
      }),
      t.status !== "doing"
        ? h("button", {
            class: "btn",
            text: "Comecei",
            onClick: () => patch(t.id, { status: "doing" }).catch((e) => erro(e.message)),
          })
        : null,
      h("button", {
        class: "btn btn--ghost",
        text: "Abrir",
        onClick: () => abrirTicket(t.id),
      }),
      h("button", {
        class: "btn btn--ghost",
        text: "Hoje não",
        title: "Tira do foco de hoje sem cobrar nada",
        onClick: () =>
          patch(t.id, { focusOn: null, status: t.status === "doing" ? "todo" : t.status }).catch(
            (e) => erro(e.message)
          ),
      }),
      h("button", {
        class: "btn btn--ghost",
        text: "Escolhe por mim",
        title: "Sorteia uma tarefa entre as que cabem agora",
        onClick: escolherPorMim,
      })
    )
  );
}

// Quando a paralisia é na escolha, e não na execução, decidir já é a
// barreira. Aqui o sorteio serve para tirar a decisão do caminho: qualquer
// tarefa começada rende mais do que a melhor tarefa não começada.
function escolherPorMim() {
  const candidatas = visiveis().filter(
    (t) =>
      t.status !== "done" &&
      t.status !== "waiting" &&
      (!t.assigneeId || t.assigneeId === state.me?.id)
  );

  if (!candidatas.length) {
    toast("Não há nada elegível agora.");
    return;
  }

  // Tarefas leves entram com peso maior: começar por algo curto costuma
  // destravar o resto do dia.
  const sorteio = [];
  for (const t of candidatas) {
    const peso = t.energy === "leve" ? 3 : t.energy === "media" ? 2 : 1;
    for (let i = 0; i < peso; i++) sorteio.push(t);
  }

  const escolhida = sorteio[Math.floor(Math.random() * sorteio.length)];
  toast(`Que tal esta: ${escolhida.title}`, {
    acao: "focar",
    aoClicar: () => abrirFoco(escolhida.id),
    ms: 7000,
  });
  abrirTicket(escolhida.id);
}

// A frase que explica por que esta tarefa está no topo. Sem isso a ordenação
// vira caixa-preta, e caixa-preta gera desconfiança e reordenação manual.
function porQue(t, parado) {
  const motivos = [];
  if (t.status === "doing") motivos.push("já está em andamento");
  if (t.focusOn === state.hoje) motivos.push("você puxou para hoje");
  if (t.priority === "agora") motivos.push("está marcada como agora");
  if (t.dueOn) {
    const d = Math.round(
      (new Date(`${t.dueOn}T00:00:00`) - new Date(new Date().toDateString())) / 86400000
    );
    if (d < 0) motivos.push(`o prazo era há ${Math.abs(d)} dia${Math.abs(d) > 1 ? "s" : ""}`);
    else if (d === 0) motivos.push("o prazo é hoje");
    else if (d <= 2) motivos.push("o prazo está perto");
  }
  if (!motivos.length && parado >= 5) motivos.push(`está parada há ${agingTexto(parado)}`);
  if (!motivos.length) return "É a primeira da fila.";
  return `Está aqui porque ${motivos.join(", ")}.`;
}

// Limite de trabalho em andamento, mostrado como pontos.
// Não bloqueia nada: avisa. Impedir alguém de começar algo é uma briga que a
// ferramenta perde; mostrar que já há três coisas abertas costuma bastar.
function indicadorWip(n, limite) {
  const excedeu = n > limite;
  return h(
    "span",
    {
      class: `wip${excedeu ? " is-over" : ""}`,
      title: excedeu
        ? `${n} tarefas em andamento. Terminar uma rende mais do que começar outra.`
        : `${n} de ${limite} em andamento`,
    },
    h(
      "span",
      { class: "wip__dots" },
      Array.from({ length: Math.max(limite, n) }, (_, i) =>
        h("span", { class: `wip__dot${i < n ? " is-on" : ""}` })
      )
    ),
    excedeu ? `${n} abertas ao mesmo tempo` : plural(n, "em andamento", "em andamento")
  );
}

// --- Triagem da entrada ----------------------------------------------------
// Três botões, três destinos. Decidir o que fazer com um item capturado tem
// que custar um clique, ou a caixa de entrada vira um depósito.

function cartaoTriagem(t) {
  const card = taskCard(t, { mostrarPasso: false });
  const acoes = h(
    "div",
    { class: "task__right", "data-stop": "1" },
    h("button", {
      class: "btn btn--sm",
      text: "Fazer",
      title: "Vai para A fazer",
      onClick: () => patch(t.id, { status: "todo" }).catch((e) => erro(e.message)),
    }),
    h("button", {
      class: "btn btn--sm",
      text: "Hoje",
      title: "Puxa para hoje",
      onClick: () =>
        patch(t.id, { status: "todo", focusOn: state.hoje }).catch((e) => erro(e.message)),
    }),
    h("button", {
      class: "btn btn--sm btn--ghost",
      text: "Arquivar",
      title: "Some da lista sem apagar o registro",
      onClick: () => patch(t.id, { archived: true }).catch((e) => erro(e.message)),
    })
  );
  card.querySelector(".task__right")?.replaceWith(acoes);
  return card;
}

function seção(titulo, contagem, conteudo) {
  return h(
    "section",
    { class: "section" },
    h(
      "div",
      { class: "section__head" },
      h("h2", { class: "section__title", text: titulo }),
      h("span", { class: "section__count", text: String(contagem) })
    ),
    conteudo
  );
}
