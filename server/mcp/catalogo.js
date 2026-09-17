// A lista de ferramentas do MCP, na ordem em que o agente as vê.
//
// Import estático, um por linha, e não leitura da pasta: a plataforma só leva
// para a função o que um import alcança (ver "vercel.json completa o contrato"
// no AGENTS.md). Uma pasta varrida em tempo de execução passaria em todo teste
// local e chegaria vazia em produção.
//
// Cada ferramenta é um objeto:
//
//   nome        o que o agente chama, curto e em português
//   titulo      rótulo para a interface do cliente
//   descricao   uma ou duas frases; texto ou função (ctx) => texto
//   leitura     true quando só lê
//   destrutiva  true quando apaga
//   entrada     JSON Schema dos argumentos; propriedade com so: "ponte" ou
//               so: "remoto" só aparece naquele modo (server/mcp/index.js)
//   executar    async (args, ctx) => texto, ou { content, isError }
//               ctx = { user, ponte }; erro com status < 500 vira isError
//
// tests/mcp.test.js confere que todo arquivo de ferramentas/ está aqui.

import contexto from "./ferramentas/contexto.js";
import buscar from "./ferramentas/buscar.js";
import ler from "./ferramentas/ler.js";
import criar from "./ferramentas/criar.js";
import editar from "./ferramentas/editar.js";
import registrar from "./ferramentas/registrar.js";
import vincular from "./ferramentas/vincular.js";
import passos from "./ferramentas/passos.js";
import anexar from "./ferramentas/anexar.js";
import baixar from "./ferramentas/baixar.js";
import apagar from "./ferramentas/apagar.js";

export const FERRAMENTAS = [contexto, buscar, ler, criar, editar, registrar, vincular, passos, anexar, baixar, apagar];

// O que cada rota da API significa para o MCP: as ferramentas que a cobrem, ou
// o motivo de ficar de fora.
//
// É a trava de "toda funcionalidade nova entra no MCP". tests/mcp.test.js lê
// server/api.js e recusa rota nova que não esteja aqui: quem acrescenta uma
// tela ou um recurso decide, no mesmo commit, se o agente ganha ferramenta ou
// por que não ganha. Fora não é para sempre: o que é "próxima versão" está em
// OPEN_POINTS.md seção 22.
export const COBERTURA = {
  tasks: ["buscar", "ler", "criar", "editar", "passos", "registrar", "vincular", "anexar"],
  comments: ["registrar", "apagar"],
  attachments: ["anexar", "baixar", "apagar"],
  projects: ["contexto"],
  companies: ["contexto"],
  labels: ["contexto"],
  users: ["contexto"],
  state: ["contexto", "buscar"],
  mcp: ["o próprio MCP"],
  session: { fora: "login de navegador; o agente entra por token" },
  boot: { fora: "diagnóstico da instância, sem dado de ticket" },
  sync: { fora: "relógio da tela aberta; o agente lê sob demanda" },
  activity: { fora: "próxima versão: atividade geral do time" },
  versao: { fora: "próxima versão: o agente ler a versão no ar" },
  feedback: { fora: "próxima versão: relatos e Sugestões pelo MCP" },
  agente: { fora: "outro agente, o dos relatos, com credencial própria" },
  focus: { fora: "cronômetro pessoal de quem está na tela" },
  me: { fora: "conta e tokens; token não mexe em credencial" },
};
