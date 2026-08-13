// Diálogos próprios, no lugar de window.prompt e window.confirm.
//
// Os diálogos do navegador travam a página inteira, não aceitam campo de
// senha mascarado, não seguem o tema e não são estilizáveis. Para um produto
// que promete resposta imediata e baixo estímulo, eles são o oposto do que se
// quer — e para quem usa leitor de tela, são um beco.

import { h, mount, $ } from "./dom.js";

// Formulário em sobreposição. Devolve um objeto com os valores, ou null se
// a pessoa desistir.
export function pedir({ titulo, descricao, campos, confirmar = "Confirmar" }) {
  return new Promise((resolve) => {
    const caixa = $("#palette");
    const anterior = document.activeElement;

    const entradas = campos.map((c) =>
      h("input", {
        type: c.tipo || "text",
        value: c.valor || "",
        placeholder: c.dica || "",
        autocomplete: c.tipo === "password" ? "current-password" : "off",
        id: `dlg-${c.chave}`,
      })
    );

    const fechar = (resultado) => {
      caixa.hidden = true;
      mount($("#palette-results"));
      if (anterior && document.contains(anterior)) anterior.focus();
      resolve(resultado);
    };

    const enviar = () => {
      const saida = {};
      campos.forEach((c, i) => (saida[c.chave] = entradas[i].value));
      fechar(saida);
    };

    const form = h(
      "form",
      {
        style: { padding: "20px 24px 24px" },
        onSubmit: (e) => {
          e.preventDefault();
          enviar();
        },
      },
      h("h2", { style: { fontSize: "1.0625rem", marginBottom: "6px" }, text: titulo }),
      descricao
        ? h("p", { class: "tiny muted", style: { marginBottom: "16px" }, text: descricao })
        : null,
      campos.map((c, i) =>
        h(
          "label",
          { class: "field" },
          h("span", { class: "field__label", text: c.rotulo }),
          entradas[i]
        )
      ),
      h(
        "div",
        { style: { display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "16px" } },
        h("button", {
          type: "button",
          class: "btn btn--ghost",
          text: "Cancelar",
          onClick: () => fechar(null),
        }),
        h("button", { type: "submit", class: "btn btn--primary", text: confirmar })
      )
    );

    // Reaproveita a sobreposição da paleta: mesma moldura, mesmo comportamento
    // de fundo, um lugar só para manter.
    const box = caixa.querySelector(".palette__box");
    const input = caixa.querySelector(".palette__input");
    input.hidden = true;
    mount($("#palette-results"), form);
    $("#palette-results").style.maxHeight = "none";
    caixa.hidden = false;
    entradas[0]?.focus();

    caixa.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          fechar(null);
        }
      },
      { once: false }
    );

    // Restaura a paleta ao estado normal quando este diálogo sair.
    const observador = new MutationObserver(() => {
      if (caixa.hidden) {
        input.hidden = false;
        $("#palette-results").style.maxHeight = "";
        observador.disconnect();
      }
    });
    observador.observe(caixa, { attributes: true, attributeFilter: ["hidden"] });

    box.dataset.dialogo = "1";
  });
}

// Confirmação com peso proporcional ao estrago. Ações destrutivas ganham
// botão em cor de alerta; o resto é uma pergunta comum.
export function confirmar({ titulo, descricao, acao = "Confirmar", destrutivo = false }) {
  return new Promise((resolve) => {
    const caixa = $("#palette");
    const anterior = document.activeElement;
    const input = caixa.querySelector(".palette__input");

    const fechar = (r) => {
      caixa.hidden = true;
      input.hidden = false;
      mount($("#palette-results"));
      $("#palette-results").style.maxHeight = "";
      if (anterior && document.contains(anterior)) anterior.focus();
      resolve(r);
    };

    const botao = h("button", {
      class: "btn btn--primary",
      text: acao,
      style: destrutivo ? { background: "var(--alert)", color: "#fff" } : {},
      onClick: () => fechar(true),
    });

    mount(
      $("#palette-results"),
      h(
        "div",
        { style: { padding: "20px 24px 24px" } },
        h("h2", { style: { fontSize: "1.0625rem", marginBottom: "6px" }, text: titulo }),
        descricao ? h("p", { class: "tiny muted", text: descricao }) : null,
        h(
          "div",
          { style: { display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "20px" } },
          h("button", { class: "btn btn--ghost", text: "Cancelar", onClick: () => fechar(false) }),
          botao
        )
      )
    );

    input.hidden = true;
    $("#palette-results").style.maxHeight = "none";
    caixa.hidden = false;
    botao.focus();

    caixa.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        caixa.removeEventListener("keydown", esc);
        fechar(false);
      }
    });
  });
}
