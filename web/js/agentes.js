// Conectar um agente pelo MCP.
//
// Gera o token com que o Claude Code (ou uma automação de teste) lê e registra
// nos tickets em nome de quem está na tela, e entrega o comando pronto para
// colar no terminal. O segredo aparece uma vez, nesta caixa, e só o hash fica no
// servidor. Como tudo funciona do outro lado: docs/MCP.md.

import { h, mount, $ } from "./dom.js";
import { api } from "./api.js";
import { toast, erro } from "./toast.js";
import { desde, dataHoraLonga } from "./format.js";

export async function abrirAgentes() {
  const caixa = $("#palette");
  caixa.querySelector(".palette__input").hidden = true;
  caixa.hidden = false;

  let tokens = [];
  let gerado = null;
  let revogando = null;

  try {
    tokens = (await api.tokens()).tokens;
  } catch (err) {
    erro(err.message);
  }
  desenhar();

  function desenhar() {
    const nome = h("input", {
      type: "text",
      placeholder: "Nome da máquina ou do agente",
      autocomplete: "off",
      maxLength: 40,
    });

    const gerar = async () => {
      try {
        const r = await api.createToken(nome.value.trim() || "Claude");
        gerado = { nome: r.token.name, segredo: r.segredo };
        tokens = [r.token, ...tokens];
        desenhar();
      } catch (err) {
        erro(err.message);
      }
    };

    mount(
      $("#palette-results"),
      h(
        "div",
        { class: "agentes" },
        h("h2", { class: "agentes__titulo", text: "Conectar um agente (MCP)" }),
        h("p", {
          class: "tiny muted",
          text: "O agente lê os tickets e registra sessão, handoff, PR e anexo em seu nome. Um token por máquina.",
        }),

        gerado ? blocoGerado(gerado) : null,

        h(
          "form",
          {
            class: "agentes__novo",
            onSubmit: (e) => {
              e.preventDefault();
              gerar();
            },
          },
          nome,
          h("button", { class: "btn btn--primary btn--sm", type: "submit", text: "Gerar token" })
        ),

        tokens.length
          ? h(
              "div",
              { class: "agentes__lista" },
              tokens.map((t) =>
                h(
                  "div",
                  { class: "agentes__token" },
                  h("span", { class: "agentes__nome", text: t.name }),
                  h("span", {
                    class: "tiny muted",
                    text: t.lastUsedAt ? `usado há ${desde(t.lastUsedAt)}` : "nunca usado",
                    title: `criado em ${dataHoraLonga(t.createdAt)}`,
                  }),
                  h("span", { class: "spacer" }),
                  // Dois cliques, e não o diálogo de confirmação: ele ocupa esta
                  // mesma caixa e fecharia o painel no meio.
                  h("button", {
                    class: "btn btn--ghost btn--sm",
                    type: "button",
                    text: revogando === t.id ? "confirmar" : "revogar",
                    style: revogando === t.id ? { color: "var(--alert)" } : {},
                    onClick: async () => {
                      if (revogando !== t.id) {
                        revogando = t.id;
                        return desenhar();
                      }
                      try {
                        await api.revokeToken(t.id);
                        tokens = tokens.filter((x) => x.id !== t.id);
                        revogando = null;
                        desenhar();
                        toast(`${t.name} revogado.`);
                      } catch (err) {
                        erro(err.message);
                      }
                    },
                  })
                )
              )
            )
          : null
      )
    );

    if (!gerado) nome.focus();
  }
}

function blocoGerado({ nome, segredo }) {
  // Endereços montados a partir de onde a tela está: a mesma instalação serve
  // o MCP, seja o domínio próprio, o endereço de reserva ou uma instância local.
  const base = new URL(".", location.href).href.replace(/\/$/, "");
  const remoto = `claude mcp add -s user -t http tdah ${base}/api/mcp -H "Authorization: Bearer ${segredo}"`;
  const ponte = `claude mcp add tdah -s user -e TDAH_URL=${base} -e TDAH_TOKEN=${segredo} -- node "C:/caminho/do/clone/scripts/mcp/ponte.mjs"`;

  return h(
    "div",
    { class: "agentes__gerado" },
    h("p", { class: "tiny", text: `Token de ${nome} criado. Copie agora: ele não aparece de novo.` }),
    comando("Direto, sem instalar nada", remoto),
    comando("Com o clone do repositório: anexa e baixa arquivo por caminho", ponte)
  );
}

function comando(rotulo, texto) {
  const area = h("textarea", { class: "agentes__cmd", readOnly: true, rows: 3, value: texto });
  return h(
    "div",
    { class: "field" },
    h("span", { class: "field__label", text: rotulo }),
    area,
    h("button", {
      class: "btn btn--sm",
      type: "button",
      text: "Copiar",
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(texto);
          toast("Copiado.");
        } catch {
          area.select();
          toast("Selecionado. Ctrl+C copia.");
        }
      },
    })
  );
}
