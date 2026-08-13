// O ticket.
//
// Tudo o que não cabe no cartão mora aqui — e nada aqui é obrigatório.
// A ordem da tela segue a ordem em que as perguntas aparecem na cabeça:
// o que é, em que pé está, quem faz, em que passos se divide, o que já se
// disse a respeito, e por onde andou.

import { h, frag, mount, avatar, autoGrow, $ } from "./dom.js";
import { api } from "./api.js";
import { state, tarefa, usuario, patch, mesclarTarefa, emit, removerTarefa } from "./store.js";
import {
  STATUS_LABEL,
  STATUS_ORDER,
  STATUS_COLOR,
  PRIORITY_LABEL,
  ENERGY_LABEL,
  prazoTexto,
  desde,
  dataHoraLonga,
  diasParado,
  agingTexto,
  tamanhoArquivo,
  blocos,
} from "./format.js";
import { toast, erro, comemorar } from "./toast.js";
import { abrirFoco } from "./focus.js";
import { pedir, confirmar as confirmarDialogo } from "./dialog.js";

let abertoId = null;
let dados = { comments: [], attachments: [], timeline: [] };

export function ticketAberto() {
  return abertoId;
}

export async function abrirTicket(id) {
  abertoId = Number(id);
  const drawer = $("#drawer");
  drawer.hidden = false;
  document.body.style.overflow = "hidden";
  ligarPainel(drawer);
  render();

  try {
    const r = await api.getTask(abertoId);
    mesclarTarefa(r.task);
    dados = { comments: r.comments, attachments: r.attachments, timeline: r.timeline };
    render();
  } catch (err) {
    erro(err.message);
    fecharTicket();
  }
}

export function fecharTicket() {
  abertoId = null;
  const drawer = $("#drawer");
  if (drawer) drawer.hidden = true;
  document.body.style.overflow = "";
  // Devolve o teclado a quem abriu o painel, em vez de largar o foco no corpo
  // da página — quem navega por teclado perderia o lugar.
  if (voltarFocoPara && document.contains(voltarFocoPara)) voltarFocoPara.focus();
  voltarFocoPara = null;
}

let voltarFocoPara = null;
let painelLigado = false;

function ligarPainel(drawer) {
  voltarFocoPara = document.activeElement;
  if (painelLigado) return;
  painelLigado = true;

  // Ao sair de um campo, aplica o redesenho que ficou represado enquanto
  // alguém digitava.
  drawer.addEventListener("focusout", () => {
    setTimeout(() => {
      if (redesenhoAdiado && !editandoNoPainel()) render();
    }, 0);
  });

  // Tab circula dentro do painel enquanto ele estiver aberto: um diálogo que
  // deixa o foco escapar para trás da sobreposição é impossível de operar sem
  // mouse.
  drawer.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const focaveis = drawer.querySelectorAll(
      'a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])'
    );
    if (!focaveis.length) return;
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    if (e.shiftKey && document.activeElement === primeiro) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primeiro.focus();
    }
  });
}

export function rerenderTicket() {
  if (abertoId) render();
}

// Redesenhar o painel reconstrói a árvore inteira. Se alguém estiver digitando
// numa descrição ou num comentário nesse instante, o texto ainda não salvo vive
// só no nó do DOM — e reconstruir apagaria tudo sem aviso.
//
// A sincronização roda a cada poucos segundos e dispara com qualquer mudança
// feita por qualquer pessoa do time, então isso não é hipótese remota: é o que
// aconteceria várias vezes por dia, justamente com quem se distrai no meio de
// uma frase e volta depois.
let redesenhoAdiado = false;

function editandoNoPainel() {
  const ativo = document.activeElement;
  const alvo = $("#drawer-body");
  if (!ativo || !alvo || !alvo.contains(ativo)) return false;
  return ativo.matches("input, textarea, [contenteditable]");
}

function render() {
  const t = tarefa(abertoId);
  const alvo = $("#drawer-body");
  if (!alvo) return;

  if (editandoNoPainel()) {
    redesenhoAdiado = true;
    return;
  }
  redesenhoAdiado = false;

  if (!t) return mount(alvo, h("div", { class: "empty" }, "Carregando…"));

  const responsavel = usuario(t.assigneeId);
  const parado = diasParado(t);

  mount(
    alvo,
    h(
      "article",
      { class: "ticket" },

      h(
        "div",
        { class: "ticket__top" },
        h("span", { class: "ticket__key", text: t.key }),
        t.status !== "done"
          ? h("span", {
              class: "tiny muted",
              text: `neste estado há ${agingTexto(parado)}`,
            })
          : h("span", { class: "tiny muted", text: `concluída ${desde(t.doneAt)} atrás` }),
        h("span", { class: "spacer" }),
        h("button", {
          class: "icon-btn",
          text: "◎",
          title: "Entrar em modo foco com esta tarefa",
          "aria-label": "Entrar em modo foco com esta tarefa",
          onClick: () => abrirFoco(t.id),
        }),
        h("button", {
          class: "icon-btn",
          text: "✕",
          title: "Fechar (Esc)",
          "aria-label": "Fechar",
          onClick: fecharTicket,
        })
      ),

      // Título editável direto.
      autoGrow(
        h("textarea", {
          class: "ticket__title",
          rows: 1,
          value: t.title,
          "aria-label": "Título da tarefa",
          onBlur: (e) => {
            const v = e.target.value.trim();
            if (v && v !== t.title) salvar({ title: v });
            else e.target.value = t.title;
          },
          onKeydown: (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.target.blur();
            }
          },
        })
      ),

      barraEstado(t),
      propriedades(t, responsavel),
      secaoDescricao(t),
      secaoPassos(t),
      secaoConversa(t),
      secaoTrilha(t),
      rodape(t)
    )
  );
}

// --- Estado ----------------------------------------------------------------

function barraEstado(t) {
  return h(
    "div",
    { class: "statusbar", role: "group", "aria-label": "Estado da tarefa" },
    STATUS_ORDER.map((s) =>
      h("button", {
        class: t.status === s ? "is-on" : "",
        text: STATUS_LABEL[s],
        style: t.status === s ? { background: STATUS_COLOR[s] } : {},
        onClick: async () => {
          if (t.status === s) return;
          // Passar para "esperando" sem dizer de quem se espera esvazia o
          // estado de sentido: é a informação que faz a diferença depois.
          if (s === "waiting") {
            const r = await pedir({
              titulo: "Esperando o quê ou quem?",
              descricao:
                "Isso aparece no cartão e é o que vai lembrar você de cobrar, daqui a alguns dias.",
              confirmar: "Marcar como esperando",
              campos: [
                {
                  chave: "de",
                  rotulo: "Esperando",
                  valor: t.waitingFor || "",
                  dica: "o retorno do fornecedor",
                },
              ],
            });
            if (!r) return;
            await salvar({ status: s, waitingFor: r.de.trim() || null });
            return;
          }
          await salvar({ status: s });
          if (s === "done") comemorar();
        },
      })
    )
  );
}

// --- Propriedades ----------------------------------------------------------

function propriedades(t, responsavel) {
  const linha = (rotulo, ...conteudo) =>
    frag(h("span", { class: "props__label", text: rotulo }), h("div", null, ...conteudo));

  return h(
    "div",
    { class: "props" },

    linha(
      "Quem faz",
      select(
        t.assigneeId ? String(t.assigneeId) : "",
        [["", "Ninguém ainda"], ...state.users.map((u) => [String(u.id), u.name])],
        (v) => salvar({ assigneeId: v ? Number(v) : null })
      )
    ),

    linha(
      "Projeto",
      select(
        t.projectId ? String(t.projectId) : "",
        [["", "Sem projeto"], ...state.projects.map((p) => [String(p.id), p.name])],
        (v) => salvar({ projectId: v ? Number(v) : null })
      )
    ),

    linha(
      "Prioridade",
      select(t.priority, Object.entries(PRIORITY_LABEL), (v) => salvar({ priority: v }))
    ),

    linha(
      "Energia",
      select(
        t.energy || "",
        [["", "Não sei ainda"], ...Object.entries(ENERGY_LABEL)],
        (v) => salvar({ energy: v || null })
      )
    ),

    // Estimativa em blocos de 25 minutos, nunca em horas. Perguntar "quantas
    // horas isso leva" pede uma precisão que ninguém tem; perguntar "cabe em
    // quantos blocos" pede uma comparação, que é bem mais fácil de acertar.
    linha("Tamanho", select(t.size ? String(t.size) : "", opcoesTamanho(t.size), (v) =>
      salvar({ size: v ? Number(v) : null })
    )),

    linha(
      "Prazo",
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: "8px" } },
        h("input", {
          type: "date",
          value: t.dueOn || "",
          onChange: (e) => salvar({ dueOn: e.target.value || null }),
        }),
        t.dueOn ? h("span", { class: "tiny muted", text: prazoTexto(t.dueOn) }) : null
      )
    ),

    linha(
      "Hoje",
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: "8px" } },
        h("button", {
          class: "btn btn--sm",
          text: t.focusOn === state.hoje ? "✓ puxada para hoje" : "Puxar para hoje",
          onClick: () => salvar({ focusOn: t.focusOn === state.hoje ? null : state.hoje }),
        })
      )
    ),

    t.status === "waiting"
      ? linha(
          "Esperando",
          h("input", {
            type: "text",
            value: t.waitingFor || "",
            placeholder: "de quem ou do quê",
            onBlur: (e) => salvar({ waitingFor: e.target.value.trim() || null }),
          })
        )
      : null
  );
}

// Blocos de 25 minutos. A lista é curta de propósito — escolher entre seis
// opções é rápido, escolher entre quarenta é uma decisão a mais no caminho.
// O valor já gravado entra na lista mesmo fora da escala, senão trocar
// qualquer outro campo apagaria silenciosamente a estimativa existente.
function opcoesTamanho(atual) {
  const escala = [1, 2, 3, 4, 6, 8, 12, 16];
  const valores = atual && !escala.includes(atual) ? [...escala, atual].sort((a, b) => a - b) : escala;
  return [
    ["", "Não estimado"],
    ...valores.map((n) => [String(n), `${n} ${n === 1 ? "bloco" : "blocos"} · ${duracao(n)}`]),
  ];
}

function duracao(blocos) {
  const min = blocos * 25;
  if (min < 60) return `${min} min`;
  const h = min / 60;
  if (h >= 7) return "um dia";
  if (h >= 3.5) return "meio dia";
  return `~${Number.isInteger(h) ? h : h.toFixed(1).replace(".", ",")} h`;
}

function select(valor, opcoes, aoMudar) {
  return h(
    "select",
    { onChange: (e) => aoMudar(e.target.value) },
    opcoes.map(([v, rotulo]) =>
      h("option", { value: v, selected: String(v) === String(valor), text: rotulo })
    )
  );
}

// --- Descrição -------------------------------------------------------------

function secaoDescricao(t) {
  return h(
    "section",
    { class: "ticket__section" },
    h("div", { class: "ticket__label" }, "Contexto"),
    h("textarea", {
      class: "notes",
      value: t.description || "",
      placeholder: "O que precisa ser sabido para fazer isso? Cole links, decisões, o que veio do cliente…",
      onBlur: (e) => {
        if (e.target.value !== t.description) salvar({ description: e.target.value });
      },
    })
  );
}

// --- Passos ----------------------------------------------------------------

function secaoPassos(t) {
  const feitos = t.steps.filter((s) => s.done).length;

  const entrada = h("input", {
    type: "text",
    placeholder: "+ um passo pequeno…",
    onKeydown: async (e) => {
      if (e.key !== "Enter") return;
      const v = e.target.value.trim();
      if (!v) return;
      e.target.value = "";
      try {
        const r = await api.addStep(t.id, v);
        mesclarTarefa(r.task);
        emit();
        render();
        setTimeout(() => $(".ticket__section input[placeholder^='+']")?.focus(), 0);
      } catch (err) {
        erro(err.message);
      }
    },
  });

  return h(
    "section",
    { class: "ticket__section" },
    h(
      "div",
      { class: "ticket__label" },
      "Passos",
      t.steps.length ? h("span", { class: "muted", text: `${feitos}/${t.steps.length}` }) : null,
      h("span", { class: "spacer" }),
      !t.steps.length
        ? h("span", {
            class: "tiny muted",
            style: { textTransform: "none", letterSpacing: "0" },
            text: "quebrar em partes menores ajuda a começar",
          })
        : null
    ),
    h(
      "div",
      null,
      t.steps.map((s) =>
        h(
          "div",
          { class: `step${s.done ? " is-done" : ""}` },
          h("button", {
            class: "step__check",
            text: "✓",
            "aria-label": s.done ? "Desmarcar passo" : "Marcar passo",
            onClick: async () => {
              try {
                const r = await api.toggleStep(t.id, s.id, !s.done);
                mesclarTarefa(r.task);
                emit();
                render();
              } catch (err) {
                erro(err.message);
              }
            },
          }),
          h("span", { class: "step__text", text: s.text }),
          h("button", {
            class: "step__del",
            text: "✕",
            title: "Remover passo",
            onClick: async () => {
              try {
                const r = await api.removeStep(t.id, s.id);
                mesclarTarefa(r.task);
                emit();
                render();
              } catch (err) {
                erro(err.message);
              }
            },
          })
        )
      )
    ),
    entrada
  );
}

// --- Conversa --------------------------------------------------------------

function secaoConversa(t) {
  const anexosSoltos = dados.attachments.filter((a) => !a.commentId);

  return h(
    "section",
    { class: "ticket__section" },
    h(
      "div",
      { class: "ticket__label" },
      "Conversa",
      dados.comments.length ? h("span", { class: "muted", text: String(dados.comments.length) }) : null
    ),

    h(
      "div",
      null,
      dados.comments.map((c) => comentario(c, t))
    ),

    anexosSoltos.length
      ? h(
          "div",
          { style: { marginTop: "12px" } },
          h("div", { class: "ticket__label" }, "Anexos"),
          h("div", { class: "files" }, anexosSoltos.map((a) => anexo(a, t)))
        )
      : null,

    compositor(t)
  );
}

function comentario(c, t) {
  const meu = c.authorId === state.me?.id;

  const corpo = h("div", { class: "comment__body" });
  formatar(corpo, c.body);

  return h(
    "div",
    { class: "comment" },
    avatar({ name: c.authorName, color: c.authorColor }),
    h(
      "div",
      { style: { flex: 1, minWidth: 0 } },
      h(
        "div",
        { class: "comment__head" },
        h("span", { class: "comment__author", text: c.authorName || "Alguém" }),
        h("span", {
          class: "comment__when",
          text: desde(c.createdAt),
          title: dataHoraLonga(c.createdAt),
        }),
        c.edited ? h("span", { class: "comment__when", text: "· editado" }) : null
      ),
      corpo,
      c.attachments.length
        ? h("div", { class: "files" }, c.attachments.map((a) => anexo(a, t)))
        : null,
      meu
        ? h(
            "div",
            { class: "comment__actions" },
            h("button", {
              text: "editar",
              onClick: () => editarComentario(c, corpo, t),
            }),
            h("button", {
              text: "apagar",
              onClick: async () => {
                const ok = await confirmarDialogo({
                  titulo: "Apagar este comentário?",
                  acao: "Apagar",
                  destrutivo: true,
                });
                if (!ok) return;
                try {
                  const r = await api.deleteComment(c.id);
                  dados.comments = r.comments;
                  render();
                } catch (err) {
                  erro(err.message);
                }
              },
            })
          )
        : null
    )
  );
}

function editarComentario(c, corpo, t) {
  const area = autoGrow(
    h("textarea", {
      class: "notes",
      value: c.body,
      onKeydown: async (e) => {
        if (e.key === "Escape") render();
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          try {
            const r = await api.editComment(c.id, area.value);
            dados.comments = r.comments;
            render();
          } catch (err) {
            erro(err.message);
          }
        }
      },
    })
  );
  corpo.replaceWith(area);
  area.focus();
}

// Compositor com colagem de imagem.
//
// Colar um print direto na conversa é o caminho mais curto entre "vi o
// problema" e "registrei o problema". Qualquer passo a mais (salvar em
// arquivo, procurar a pasta, escolher no seletor) é onde o registro morre.
function compositor(t) {
  const pendentes = [];

  const previa = h("div", { class: "files" });

  // Rascunho guardado enquanto se digita.
  //
  // Escrever um comentário é interrompido o tempo todo — alguém chama, a aba
  // troca, o painel fecha sem querer. Se o texto evapora nessas horas, o
  // comentário simplesmente nunca acontece, e o contexto se perde junto.
  const chaveRascunho = `tdah-rascunho-${t.id}`;
  const salvo = localStorage.getItem(chaveRascunho) || "";

  const area = h("textarea", {
    placeholder: "Escreva um comentário… (Ctrl+Enter envia, Ctrl+V cola um print)",
    value: salvo,
    onInput: () => {
      if (area.value.trim()) localStorage.setItem(chaveRascunho, area.value);
      else localStorage.removeItem(chaveRascunho);
      aviso.textContent = area.value.trim() ? "rascunho guardado" : "prints podem ser colados direto";
    },
    onKeydown: (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        enviar();
      }
    },
  });

  const aviso = h("span", {
    class: "composer__tip",
    text: salvo ? "rascunho guardado" : "prints podem ser colados direto",
  });

  const caixa = h(
    "div",
    { class: "composer" },
    area,
    previa,
    h(
      "div",
      { class: "composer__foot" },
      h("label", { class: "btn btn--sm" },
        "📎 Anexar",
        h("input", {
          type: "file",
          multiple: true,
          style: { display: "none" },
          onChange: (e) => {
            for (const f of e.target.files) adicionar(f);
            e.target.value = "";
          },
        })
      ),
      aviso,
      h("span", { class: "spacer" }),
      h("button", { class: "btn btn--primary btn--sm", text: "Comentar", onClick: enviar })
    )
  );

  // Colar
  area.addEventListener("paste", (e) => {
    const itens = Array.from(e.clipboardData?.items || []);
    const imagens = itens.filter((i) => i.kind === "file" && i.type.startsWith("image/"));
    if (!imagens.length) return;
    e.preventDefault();
    for (const item of imagens) {
      const arquivo = item.getAsFile();
      if (arquivo) {
        // Um print colado não tem nome: dar um nome legível evita uma lista
        // de "image.png, image.png, image.png" dali a duas semanas.
        const nomeado = new File([arquivo], `print ${carimbo()}.png`, { type: arquivo.type });
        adicionar(nomeado);
      }
    }
  });

  // Arrastar e soltar
  for (const ev of ["dragenter", "dragover"]) {
    caixa.addEventListener(ev, (e) => {
      e.preventDefault();
      caixa.classList.add("is-drop");
    });
  }
  for (const ev of ["dragleave", "drop"]) {
    caixa.addEventListener(ev, (e) => {
      if (ev === "dragleave" && caixa.contains(e.relatedTarget)) return;
      caixa.classList.remove("is-drop");
    });
  }
  caixa.addEventListener("drop", (e) => {
    e.preventDefault();
    for (const f of e.dataTransfer.files) adicionar(f);
  });

  // Cada prévia cria um endereço temporário para o arquivo. Eles precisam ser
  // devolvidos, senão a imagem fica presa na memória da aba até recarregar.
  const enderecos = new Map();

  function adicionar(arquivo) {
    pendentes.push(arquivo);
    const ehImagem = arquivo.type.startsWith("image/");
    if (ehImagem) enderecos.set(arquivo, URL.createObjectURL(arquivo));

    const item = h(
      "div",
      { class: "file" },
      ehImagem
        ? h("img", { src: enderecos.get(arquivo), alt: arquivo.name })
        : h("div", { class: "file__doc" }, `📄 ${arquivo.name}`),
      h("button", {
        class: "file__del",
        text: "✕",
        title: "Tirar",
        "aria-label": `Tirar ${arquivo.name}`,
        onClick: () => {
          const i = pendentes.indexOf(arquivo);
          if (i >= 0) pendentes.splice(i, 1);
          liberar(arquivo);
          item.remove();
        },
      })
    );
    previa.appendChild(item);
  }

  function liberar(arquivo) {
    const url = enderecos.get(arquivo);
    if (url) {
      URL.revokeObjectURL(url);
      enderecos.delete(arquivo);
    }
  }

  function liberarTudo() {
    for (const url of enderecos.values()) URL.revokeObjectURL(url);
    enderecos.clear();
  }

  async function enviar() {
    const texto = area.value.trim();
    if (!texto && !pendentes.length) return;

    try {
      let comentarioId = null;
      if (texto) {
        const r = await api.addComment(t.id, texto);
        dados.comments = r.comments;
        comentarioId = r.comments.at(-1)?.id ?? null;
        if (r.task) mesclarTarefa(r.task);
      }
      for (const arquivo of pendentes) {
        const r = await api.upload(t.id, arquivo, comentarioId);
        if (r.task) mesclarTarefa(r.task);
      }
      if (pendentes.length) {
        const novo = await api.getTask(t.id);
        dados = {
          comments: novo.comments,
          attachments: novo.attachments,
          timeline: novo.timeline,
        };
      }
      // O rascunho só é descartado depois que o comentário existe de fato
      // no servidor. Se a chamada falhar, o texto continua onde estava.
      localStorage.removeItem(chaveRascunho);
      liberarTudo();
      emit();
      render();
    } catch (err) {
      erro(err.message);
    }
  }

  return caixa;
}

function anexo(a, t) {
  const conteudo = a.isImage
    ? h("img", {
        src: api.attachmentUrl(a.id),
        alt: a.name,
        loading: "lazy",
        width: a.width || undefined,
        height: a.height || undefined,
      })
    : h("div", { class: "file__doc" }, `📄 ${a.name}`, h("span", { class: "muted", text: tamanhoArquivo(a.size) }));

  return h(
    "a",
    {
      class: "file",
      href: api.attachmentUrl(a.id),
      target: "_blank",
      rel: "noopener",
      title: `${a.name} · ${tamanhoArquivo(a.size)} · enviado por ${a.uploaderName || "alguém"}`,
    },
    conteudo,
    a.uploaderId === state.me?.id
      ? h("button", {
          class: "file__del",
          text: "✕",
          title: "Remover anexo",
          onClick: async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const ok = await confirmarDialogo({
              titulo: "Remover o anexo?",
              descricao: a.name,
              acao: "Remover",
              destrutivo: true,
            });
            if (!ok) return;
            try {
              await api.deleteAttachment(a.id);
              const novo = await api.getTask(t.id);
              dados = {
                comments: novo.comments,
                attachments: novo.attachments,
                timeline: novo.timeline,
              };
              mesclarTarefa(novo.task);
              emit();
              render();
            } catch (err) {
              erro(err.message);
            }
          },
        })
      : null
  );
}

// Formatação mínima do comentário, montada em nós de texto.
// Nada de innerHTML: o conteúdo vem de quem digita, e por aqui ele nunca
// chega a ser interpretado como marcação.
function formatar(destino, texto) {
  const linhas = String(texto).split("\n");
  linhas.forEach((linha, i) => {
    if (i) destino.appendChild(document.createElement("br"));
    const padrao = /(`[^`]+`)|(@[\p{L}\p{N}._-]+)|(https?:\/\/[^\s]+)/giu;
    let ultimo = 0;
    let m;
    while ((m = padrao.exec(linha))) {
      if (m.index > ultimo) {
        destino.appendChild(document.createTextNode(linha.slice(ultimo, m.index)));
      }
      if (m[1]) {
        destino.appendChild(h("code", { text: m[1].slice(1, -1) }));
      } else if (m[2]) {
        const nome = m[2].slice(1).toLowerCase();
        const achou = state.users.some((u) => u.username.toLowerCase() === nome);
        destino.appendChild(
          achou ? h("span", { class: "comment__mention", text: m[2] }) : document.createTextNode(m[2])
        );
      } else if (m[3]) {
        destino.appendChild(
          h("a", { href: m[3], target: "_blank", rel: "noopener noreferrer", text: m[3] })
        );
      }
      ultimo = m.index + m[0].length;
    }
    if (ultimo < linha.length) {
      destino.appendChild(document.createTextNode(linha.slice(ultimo)));
    }
  });
}

// --- Trilha ----------------------------------------------------------------

const NARRA = {
  created: () => "criou a tarefa",
  status: (e) => `moveu de ${STATUS_LABEL[e.from] || "—"} para ${STATUS_LABEL[e.to] || e.to}`,
  assignee: (e) => (e.to ? `passou para ${usuario(e.to)?.name || "outra pessoa"}` : "tirou o responsável"),
  priority: (e) => `prioridade: ${PRIORITY_LABEL[e.to] || e.to}`,
  energy: (e) => `energia: ${ENERGY_LABEL[e.to] || e.to || "—"}`,
  size: (e) => (e.to ? `estimou em ${blocos(Number(e.to))}` : "tirou a estimativa"),
  title: (e) => `renomeou para "${e.to}"`,
  description: () => "editou o contexto",
  due: (e) => (e.to ? `prazo para ${prazoTexto(e.to)}` : "removeu o prazo"),
  focus: (e) => (e.to ? "puxou para hoje" : "tirou do foco de hoje"),
  waiting: (e) => (e.to ? `passou a esperar: ${e.to}` : "não espera mais nada"),
  project: () => "mudou de projeto",
  comment: () => "comentou",
  attachment: (e) => `anexou ${e.to}`,
  step_add: (e) => `passo novo: ${e.to}`,
  step_done: (e) => `concluiu o passo: ${e.to}`,
  step_undone: (e) => `reabriu o passo: ${e.to}`,
  step_remove: (e) => `removeu o passo: ${e.from}`,
  label_add: () => "marcou uma etiqueta",
  label_remove: () => "tirou uma etiqueta",
  archived: (e) => (e.to === "1" ? "arquivou" : "restaurou"),
};

function secaoTrilha(t) {
  if (!dados.timeline.length) return null;

  return h(
    "section",
    { class: "ticket__section" },
    h("div", { class: "ticket__label" }, "Por onde andou"),
    h(
      "div",
      { class: "timeline" },
      dados.timeline
        .slice()
        .reverse()
        .map((e) =>
          h(
            "div",
            { class: `tl${e.kind === "status" ? " tl--status" : ""}`, title: dataHoraLonga(e.at) },
            h("b", { text: (e.actorName || "Alguém").split(" ")[0] }),
            ` ${NARRA[e.kind] ? NARRA[e.kind](e) : e.kind} · `,
            h("span", { class: "muted", text: desde(e.at) })
          )
        )
    )
  );
}

function rodape(t) {
  return h(
    "div",
    { style: { display: "flex", gap: "8px", marginTop: "24px", flexWrap: "wrap" } },
    h("button", {
      class: "btn btn--sm btn--ghost",
      text: t.archived ? "Restaurar" : "Arquivar",
      title: "Some das listas, mas o histórico continua registrado",
      onClick: async () => {
        await salvar({ archived: !t.archived });
        if (!t.archived) {
          toast("Arquivada.", { acao: "desfazer", aoClicar: () => patch(t.id, { archived: false }) });
          fecharTicket();
        }
      },
    }),
    state.me?.role === "admin"
      ? h("button", {
          class: "btn btn--sm btn--ghost",
          text: "Apagar de vez",
          style: { color: "var(--alert)" },
          onClick: async () => {
            const ok = await confirmarDialogo({
              titulo: `Apagar ${t.key}?`,
              descricao: "O histórico e os comentários vão junto. Isso não tem volta.",
              acao: "Apagar de vez",
              destrutivo: true,
            });
            if (!ok) return;
            try {
              await api.deleteTask(t.id);
              removerTarefa(t.id);
              emit();
              fecharTicket();
              toast("Apagada.");
            } catch (err) {
              erro(err.message);
            }
          },
        })
      : null,
    h("span", { class: "spacer" }),
    h("span", {
      class: "tiny muted",
      text: `criada ${desde(t.createdAt)} atrás`,
      title: dataHoraLonga(t.createdAt),
    })
  );
}

async function salvar(mudanca) {
  try {
    await patch(abertoId, mudanca);
    const r = await api.timeline(abertoId);
    dados.timeline = r.timeline;
    render();
  } catch (err) {
    erro(err.message);
    render();
  }
}

function carimbo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)} ${p(d.getHours())}h${p(d.getMinutes())}`;
}
