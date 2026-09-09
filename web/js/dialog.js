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

    // Campo de arquivo não guarda o que interessa no próprio elemento: o que
    // o chamador quer é o resultado de converter o arquivo, e um input de
    // arquivo não tem onde segurar isso. Este mapa é esse lugar.
    const valores = {};

    // "current-password" é o sinal de "aqui vai a senha salva deste site", e o
    // gerenciador preenche sozinho. Num campo de senha nova — trocar a própria
    // senha, ou criar o acesso de outra pessoa — isso entrega a senha de quem
    // está na tela, mascarada, sem ninguém reparar. O padrão é "new-password";
    // quem tiver um campo de senha atual passa "current-password" na mão.
    const entradas = campos.map((c) =>
      c.tipo === "arquivo"
        ? campoArquivo(c, valores)
        : h("input", {
            type: c.tipo || "text",
            value: c.valor || "",
            placeholder: c.dica || "",
            autocomplete: c.autocomplete || (c.tipo === "password" ? "new-password" : "off"),
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
      campos.forEach((c, i) => {
        saida[c.chave] = c.tipo === "arquivo" ? valores[c.chave] : entradas[i].value;
      });
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
      // Campo de arquivo não pode ficar dentro de <label>: o rótulo repassa
      // qualquer clique de dentro dele ao primeiro controle que envolve, e o
      // primeiro controle ali é o seletor de arquivo. Clicar em "Tirar a foto"
      // ou na própria prévia abriria a janela do sistema, sem erro nenhum e
      // sem nada na tela explicando. Aqui o <label> cobre só o texto e aponta
      // para o input pelo `for`.
      campos.map((c, i) =>
        c.tipo === "arquivo"
          ? h(
              "div",
              { class: "field" },
              h("label", { class: "field__label", for: `dlg-${c.chave}`, text: c.rotulo }),
              entradas[i]
            )
          : h(
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
    // O primeiro campo pode ser um bloco de arquivo, que não tem focus().
    entradas[0]?.focus?.();

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

// Campo de imagem com prévia.
//
// Quem chama entrega um `aoEscolher(arquivo)` que devolve a string a gravar —
// no caso da foto de empresa, o data URI já reduzido. A conversão fica com
// quem sabe o que a imagem precisa virar; este arquivo só sabe de formulário.
//
// A prévia é montada com h("img"), nunca com innerHTML: o valor vem de um
// arquivo escolhido na máquina de quem usa, e é exatamente esse o caminho que
// a regra da casa fecha.
function campoArquivo(c, valores) {
  valores[c.chave] = c.valor ?? null;

  const previa = h("span", { class: "dlg-foto" });
  const aviso = h("p", { class: "tiny", style: { color: "var(--alert)" }, hidden: true });

  const limpar = h("button", {
    type: "button",
    class: "btn btn--ghost btn--sm",
    text: "Tirar a foto",
    onClick: () => {
      valores[c.chave] = null;
      aviso.hidden = true;
      desenhar();
    },
  });

  function desenhar() {
    mount(previa, valores[c.chave] ? h("img", { src: valores[c.chave], alt: "" }) : null);
    previa.classList.toggle("dlg-foto--vazia", !valores[c.chave]);
    limpar.hidden = !valores[c.chave];
  }

  const escolher = h("input", {
    type: "file",
    accept: c.accept || "image/*",
    id: `dlg-${c.chave}`,
    onChange: async (e) => {
      const arquivo = e.target.files?.[0];
      // Zerar o campo deixa escolher o mesmo arquivo de novo depois de um
      // erro; sem isso o segundo "change" nunca dispara.
      e.target.value = "";
      if (!arquivo) return;
      try {
        valores[c.chave] = await c.aoEscolher(arquivo);
        aviso.hidden = true;
      } catch (err) {
        aviso.textContent = err.message;
        aviso.hidden = false;
      }
      desenhar();
    },
  });

  desenhar();
  return h(
    "div",
    { class: "dlg-arquivo" },
    previa,
    h("div", { class: "dlg-arquivo__lado" }, escolher, limpar),
    aviso
  );
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
