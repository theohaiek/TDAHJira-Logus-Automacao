// Avisos rápidos e a comemoração de conclusão.

import { h, $ } from "./dom.js";

const caixa = () => $("#toasts");

export function toast(mensagem, { acao, aoClicar, ms = 4200 } = {}) {
  const el = h(
    "div",
    { class: "toast" },
    h("span", { text: mensagem }),
    acao &&
      h("button", {
        text: acao,
        onClick: () => {
          el.remove();
          aoClicar?.();
        },
      })
  );
  caixa().appendChild(el);
  const t = setTimeout(() => {
    el.style.transition = "opacity .3s, transform .3s";
    el.style.opacity = "0";
    el.style.transform = "translateY(8px)";
    setTimeout(() => el.remove(), 320);
  }, ms);
  el.addEventListener("mouseenter", () => clearTimeout(t));
  return el;
}

export function erro(mensagem) {
  const el = toast(mensagem, { ms: 6000 });
  el.style.borderColor = "var(--alert)";
  el.style.color = "var(--alert)";
  return el;
}

// Um pulso de luz ao concluir.
//
// Existe porque fechar uma tarefa precisa devolver alguma coisa — e não
// devolve nada quando o item apenas some da lista. Mas fica em meio segundo
// e não emite som: recompensa que interrompe deixa de ser recompensa.
export function comemorar() {
  const el = $("#celebrate");
  if (!el) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  el.classList.remove("is-on");
  void el.offsetWidth;
  el.classList.add("is-on");
  setTimeout(() => el.classList.remove("is-on"), 700);
}
