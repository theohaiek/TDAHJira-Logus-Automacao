// Construção de DOM sem biblioteca.
//
// Tudo que vem de quem usa entra por textContent ou por atributo — nunca por
// innerHTML. É o que mantém o produto imune a conteúdo malicioso colado num
// título ou num comentário, sem precisar de uma camada de sanitização.

export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);

  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;

      if (k === "class") el.className = v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k in el && k !== "list" && typeof v !== "object") {
        el[k] = v;
      } else {
        el.setAttribute(k, v === true ? "" : String(v));
      }
    }
  }

  add(el, children);
  return el;
}

function add(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false || c === true) continue;
    if (Array.isArray(c)) add(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  add(f, children);
  return f;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function mount(el, ...children) {
  clear(el);
  add(el, children);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function on(el, event, selector, handler) {
  el.addEventListener(event, (e) => {
    const alvo = e.target.closest(selector);
    if (alvo && el.contains(alvo)) handler(e, alvo);
  });
}

// Iniciais para o avatar: no máximo duas letras.
export function initials(name = "") {
  const partes = String(name).trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes.at(-1)[0]).toUpperCase();
}

export function avatar(user, size = "") {
  if (!user) {
    return h("span", { class: `avatar avatar--empty ${size}`, title: "Sem responsável" }, "–");
  }
  return h(
    "span",
    {
      class: `avatar ${size}`,
      style: { background: user.color || "#8fa9b5" },
      title: user.name,
    },
    initials(user.name)
  );
}

// A marca visual de uma empresa, no tamanho que o lugar pede.
//
// Empresa sem foto não ganha placeholder cinza: ganha o mesmo ponto colorido
// que o cabeçalho de filtros já usa, em escala. Um retângulo cinza dizendo
// "falta imagem" transforma cadastro incompleto em cobrança, e a foto aqui é
// enfeite útil, não campo obrigatório.
export function fotoEmpresa(company, px = 20) {
  if (!company) return null;
  const medida = { width: `${px}px`, height: `${px}px` };

  if (company.avatar) {
    return h("img", {
      class: "empfoto",
      src: company.avatar,
      alt: "",
      style: medida,
      loading: "lazy",
    });
  }

  // O ponto fica dentro de uma caixa do mesmo tamanho da foto: sem ela, uma
  // lista com empresas fotografadas e não fotografadas ficaria com os nomes
  // em colunas diferentes. Ele cresce junto, mas nunca vira um disco cheio —
  // continua sendo o ponto, não um lugar vazio pedindo para ser preenchido.
  const ponto = Math.max(7, Math.round(px * 0.4));
  return h(
    "span",
    { class: "empfoto empfoto--ponto", style: medida, "aria-hidden": "true" },
    h("span", {
      class: "dot",
      style: {
        width: `${ponto}px`,
        height: `${ponto}px`,
        color: company.color || "#8fa9b5",
      },
    })
  );
}

// Faz um textarea crescer com o conteúdo, sem barra de rolagem interna.
export function autoGrow(el) {
  const ajusta = () => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  el.addEventListener("input", ajusta);
  requestAnimationFrame(ajusta);
  return el;
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
