// Dados de exemplo.
//
// Existe por um motivo de produto, não de conveniência: uma ferramenta que
// abre vazia obriga quem chega a imaginar como ela funcionaria cheia — e
// tela em branco é exatamente onde a paralisia começa. Com exemplos dentro,
// dá para entender o produto em dez segundos e apagar tudo depois.

import { one, insert, run, nowIso, today } from "./db.js";
import { createUser, generatePassword } from "./auth.js";
import { createTask, updateTask, addStep } from "./tasks.js";
import { addComment } from "./comments.js";

export async function seedDemo() {
  const credentials = [];

  // --- Pessoas -------------------------------------------------------------
  // Nomes fictícios de propósito: estes dados existem no repositório
  // público, e não faz sentido publicar quem é do time nem nome de cliente.
  // Quem for usar de verdade cria as próprias contas — veja docs/INSTALL.md.
  const pessoas = [
    { username: "ana", name: "Ana Exemplo", color: "#a2e4f0", role: "admin" },
    { username: "bruno", name: "Bruno Exemplo", color: "#7fc8a9", role: "member" },
    { username: "carla", name: "Carla Exemplo", color: "#e3b877", role: "member" },
  ];

  const ids = {};
  for (const p of pessoas) {
    const existente = await one("SELECT * FROM users WHERE username = ?", [p.username]);
    if (existente) {
      ids[p.username] = existente.id;
      continue;
    }
    const senha = generatePassword();
    const u = await createUser({
      username: p.username,
      displayName: p.name,
      password: senha,
      role: p.role,
      color: p.color,
    });
    ids[p.username] = u.id;
    credentials.push({ username: p.username, password: senha });
  }

  // --- Projetos ------------------------------------------------------------
  const projetos = [
    { key: "AUT", name: "Automações", color: "#a2e4f0" },
    { key: "COM", name: "Comercial", color: "#7fc8a9" },
    { key: "INT", name: "Interno", color: "#e3b877" },
  ];
  const proj = {};
  for (const [i, p] of projetos.entries()) {
    const existente = await one("SELECT * FROM projects WHERE key = ?", [p.key]);
    if (existente) {
      proj[p.key] = existente.id;
      continue;
    }
    const ts = nowIso();
    proj[p.key] = await insert(
      `INSERT INTO projects (key, name, color, description, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [p.key, p.name, p.color, "", i, ts, ts]
    );
  }

  // --- Etiquetas -----------------------------------------------------------
  for (const [nome, cor] of [
    ["cliente", "#a2e4f0"],
    ["urgente", "#e88b7d"],
    ["rápido", "#7fc8a9"],
    ["precisa de resposta", "#e3b877"],
  ]) {
    if (!await one("SELECT id FROM labels WHERE name = ?", [nome])) {
      await insert("INSERT INTO labels (name, color) VALUES (?, ?)", [nome, cor]);
    }
  }

  if ((await one("SELECT COUNT(*) AS n FROM tasks")).n > 0) {
    return { tasks: 0, projects: Object.keys(proj).length, credentials };
  }

  // --- Tarefas -------------------------------------------------------------
  const hoje = today();
  const emDias = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const modelo = [
    {
      p: "AUT", t: "Revisar o fluxo de aprovação do orçamento",
      d: "O disparo está saindo duas vezes quando o valor passa do limite. Reproduzir com um caso real antes de mexer.",
      s: "doing", pr: "agora", e: "media", sz: 3, a: "ana", focus: hoje,
      steps: [["Reproduzir com um orçamento acima do limite", true], ["Achar onde o gatilho duplica", false], ["Corrigir e testar de novo", false]],
    },
    {
      p: "AUT", t: "Integrar o formulário do site com a planilha de leads",
      d: "Cada envio precisa virar uma linha, com data e origem.",
      s: "todo", pr: "agora", e: "pesada", sz: 6, a: "bruno", due: emDias(3),
      steps: [["Mapear os campos do formulário", false], ["Escrever a automação", false], ["Testar com três envios", false]],
    },
    {
      p: "COM", t: "Responder a proposta da distribuidora",
      s: "waiting", pr: "normal", e: "leve", sz: 1, a: "ana",
      waiting: "a tabela de preços atualizada",
    },
    {
      p: "COM", t: "Montar apresentação comercial de automação industrial",
      d: "Reaproveitar os slides do ano passado e trocar os números.",
      s: "todo", pr: "normal", e: "media", sz: 4, a: "carla", due: emDias(7),
    },
    {
      p: "INT", t: "Organizar o backup dos projetos antigos",
      s: "quando_der_status", pr: "quando_der", e: "pesada", sz: 8,
    },
    {
      p: "AUT", t: "Cliente reclamou que o relatório chega sem o gráfico",
      d: "Chegou hoje de manhã. Print anexado na conversa.",
      s: "todo", pr: "agora", e: "leve", sz: 2, a: "bruno", focus: hoje,
    },
    {
      p: "INT", t: "Trocar a senha do painel do servidor",
      s: "todo", pr: "normal", e: "leve", sz: 1, a: "ana", due: emDias(1),
    },
    {
      p: "COM", t: "Ligar para os três orçamentos parados há mais de duas semanas",
      s: "todo", pr: "agora", e: "media", sz: 2, a: "carla", focus: hoje,
      steps: [["Cliente A", false], ["Cliente B", false], ["Cliente C", false]],
    },
    {
      p: "AUT", t: "Documentar o processo de instalação em cliente novo",
      s: "todo", pr: "quando_der", e: "media", sz: 5,
    },
    {
      p: "AUT", t: "Ajustar o alarme de temperatura da estufa 2",
      s: "done", pr: "normal", e: "leve", sz: 2, a: "bruno",
    },
    {
      p: "INT", t: "Fechar as notas do mês",
      s: "done", pr: "normal", e: "media", sz: 3, a: "ana",
    },
    {
      p: "COM", t: "Ideia: oferecer manutenção preventiva como plano mensal",
      d: "Surgiu numa conversa com cliente. Vale pensar depois.",
      s: "inbox", pr: "quando_der",
    },
    {
      p: null, t: "Ver aquele curso de CLP que mandaram no grupo",
      s: "inbox", pr: "quando_der",
    },
    {
      p: "AUT", t: "Padronizar os nomes dos arquivos de projeto",
      s: "inbox", pr: "quando_der",
    },

    // --- Quadros laterais: horizonte mais longo ---------------------------
    { k: "longa", p: "INT", t: "Renovar o domínio e o certificado do site", s: "todo", pr: "normal" },
    { k: "longa", p: "AUT", t: "Migrar os projetos antigos para a versão nova do CLP", s: "todo", pr: "quando_der" },
    { k: "oportunidade", p: "COM", t: "Plano mensal de manutenção preventiva", s: "todo", pr: "normal",
      d: "Três clientes já perguntaram. Vale desenhar uma proposta padrão." },
    { k: "oportunidade", p: "COM", t: "Parceria com o integrador de painéis da região", s: "todo", pr: "quando_der" },
    { k: "meta", p: null, t: "Dobrar a carteira de contratos recorrentes até o fim do ano", s: "todo", pr: "normal" },
    { k: "meta", p: null, t: "Documentação de instalação boa o bastante para um novato executar sozinho", s: "todo", pr: "normal" },
  ];

  let n = 0;
  for (const m of modelo) {
    const status = m.s === "quando_der_status" ? "todo" : m.s;
    const t = await createTask(
      {
        projectId: m.p ? proj[m.p] : null,
        title: m.t,
        description: m.d || "",
        status,
        kind: m.k || "task",
        priority: m.pr,
        energy: m.e || null,
        size: m.sz || null,
        assigneeId: m.a ? ids[m.a] : null,
        dueOn: m.due || null,
        focusOn: m.focus || null,
      },
      ids.ana
    );
    n++;

    if (m.waiting) {
      await updateTask(t.id, { status: "waiting", waitingFor: m.waiting }, ids.ana);
    }
    for (const [texto, feito] of m.steps || []) {
      const s = await addStep(t.id, texto, ids.ana);
      if (feito) {
        await run("UPDATE steps SET is_done = 1, done_at = ? WHERE id = ?", [nowIso(), s.id]);
      }
    }
  }

  // Uma conversa de exemplo, para que a aba de comentários não abra vazia.
  const alvo = await one("SELECT id FROM tasks WHERE title LIKE 'Revisar o fluxo%'");
  if (alvo) {
    await addComment(
      alvo.id,
      "Consegui reproduzir: acontece quando o valor passa de 10 mil e o aprovador está de férias. O gatilho de escalonamento dispara junto com o normal.",
      ids.ana
    );
    await addComment(
      alvo.id,
      "Faz sentido. Acho que é a condição do segundo gatilho que está sem o filtro de status. Olho isso amanhã de manhã.",
      ids.bruno
    );
  }

  const espera = await one("SELECT id FROM tasks WHERE status = 'waiting' LIMIT 1");
  if (espera) {
    await addComment(
      espera.id,
      "Quando a tabela nova estiver pronta, me manda aqui que eu respondo no mesmo dia.",
      ids.ana
    );
  }

  return { tasks: n, projects: Object.keys(proj).length, credentials };
}
