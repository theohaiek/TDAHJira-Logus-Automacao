# O servidor MCP

O MCP (Model Context Protocol) é a porta por onde um agente de código, o
Claude Code por exemplo, lê e registra nos tickets. É a série **1.5** do
produto: o agente que trabalha num ticket deixa ali a sessão, o handoff, o PR,
o print do teste e a mudança de estado, na hora, sem ninguém copiar nada.

Duas regras governam tudo aqui:

1. **Registrar tudo, curto.** O servidor instrui o agente a registrar cada
   passo e a escrever de forma operacional, e a ferramenta de registro recusa
   texto acima de 1500 caracteres com o motivo.
2. **Custar pouco.** O catálogo inteiro e as instruções cabem em cerca de 2 mil
   tokens, e `tests/mcp.test.js` segura o teto. As respostas são texto enxuto,
   não JSON.

---

## Conectar

1. No aplicativo: menu da conta (canto inferior esquerdo) → **Conectar um
   agente (MCP)** → dê um nome à máquina → **Gerar token**.
2. Copie um dos dois comandos que aparecem e rode no terminal. O token aparece
   uma vez só.
3. Abra o Claude Code e confira com `/mcp` (ou `claude mcp get tdah`): o
   servidor precisa aparecer como conectado.

### Direto ou pela ponte

| | Direto (HTTP) | Ponte local |
|---|---|---|
| Instala | nada | o clone deste repositório e Node 22+ |
| Comando | `claude mcp add -s user -t http tdah https://tarefas.logusautomacao.com/api/mcp -H "Authorization: Bearer tdah_…"` | `claude mcp add tdah -s user -e TDAH_URL=https://tarefas.logusautomacao.com -e TDAH_TOKEN=tdah_… -- node "<clone>/scripts/mcp/ponte.mjs"` |
| Anexar | texto (log, CSV, JSON) ou base64 | **caminho de arquivo**, sem passar pelo modelo |
| Baixar anexo | imagem volta para o modelo ver; texto volta como texto | salva em disco e devolve o caminho |
| Atualizar | automático | automático: a ponte só repassa, as ferramentas vêm do servidor |

Recomendado: **a ponte**, sempre que a máquina tiver o clone. Anexar um print
pelo modo direto obriga o modelo a escrever o arquivo em base64 dentro da
chamada, que custa mais token do que a sessão inteira.

`node scripts/mcp/ponte.mjs verificar` (com `TDAH_URL` e `TDAH_TOKEN` no
ambiente) confere conexão, versão e quem é você, sem abrir o Claude.

---

## As ferramentas

| Ferramenta | O que faz |
|---|---|
| `contexto` | Quem é o agente, pessoas, projetos, empresas, etiquetas e valores válidos |
| `buscar` | Lista tickets, uma linha cada, abertos primeiro. Texto procura também na conversa e nos links |
| `ler` | O ticket inteiro: campos, passos, links, anexos, último handoff, conversa, trilha; `json=true` devolve os objetos crus |
| `criar` | Ticket novo. Só `titulo` é obrigatório |
| `editar` | Muda campos, inclusive `status` (mover). Responde só o que mudou, de → para |
| `registrar` | Comentário, `sessao` (o que foi feito) ou `handoff` (onde parou), até 1500 caracteres |
| `vincular` | PR, commit, branch ou documento. O tipo sai da URL; repetir a URL atualiza |
| `passos` | Acrescenta, conclui, reabre e remove passos numa chamada |
| `anexar` | Arquivo local (ponte), texto, ou base64 (direto) |
| `baixar` | Anexo para o disco (ponte) ou para o modelo ver (direto) |
| `apagar` | Comentário, anexo ou link, pelas mesmas regras da tela |

Ticket se escreve pela chave (`AUT-14`) ou pelo id (`#12`). Pessoa por
username, nome ou `eu`. Projeto por chave ou nome, empresa e etiqueta por nome.
Nome errado volta com a lista de opções, para a chamada seguinte acertar.

Tudo passa pelas mesmas funções da tela (`server/tasks.js`,
`server/comments.js`, `server/links.js`): as regras de transição de estado, as
permissões e os eventos da trilha valem igual para gente e agente.

### O que a tela mostra

- **Sessão e handoff** aparecem na conversa do ticket com um selo.
- **Links** ganham uma seção no ticket, visível só quando existe algum.
- **A trilha** mostra "via <nome do token>" em toda escrita de agente. O nome
  fica em `events.note`, gravado a partir de `handleApi` pelo contexto
  `origem` (`server/events.js`), sem passar por parâmetro de função nenhuma.

---

## Automação de teste

A ponte também é linha de comando, sem MCP e sem modelo. É por onde o script
que tira print ou roda a suíte registra o resultado:

```bash
export TDAH_URL=https://tarefas.logusautomacao.com TDAH_TOKEN=tdah_…
node scripts/mcp/ponte.mjs anexar AUT-14 ./prints/login.png
node scripts/mcp/ponte.mjs chamar registrar ticket=AUT-14 tipo=sessao "texto=Feito: e2e. Resultado: 1 falha. Próximo: etapa 3."
node scripts/mcp/ponte.mjs chamar editar ticket=AUT-14 status=waiting "esperando=revisão do PR"
node scripts/mcp/ponte.mjs baixar 7 ./baixados/
```

`chave=valor` vira argumento; valor que é JSON (`3`, `true`, `["ana"]`) vira o
tipo dele. Um único argumento começando com `{` é lido como JSON inteiro. Erro
de ferramenta sai com código 1.

---

## Segurança

- **O token vale em `/api/mcp` e em mais nada.** `rotear()` (`server/api.js`)
  responde 403 a qualquer outra rota: com ele não se lê `/state`, não se cria
  acesso, não se troca senha e não se gera outro token.
- **Só o hash fica no banco** (tabela `api_tokens`, SHA-256). O segredo tem 256
  bits sorteados e o prefixo `tdah_`, que o separa do token do agente de
  relatos. A guarda dos relatos (`scripts/relatos/guarda.mjs`) recusa commit
  com um token desses.
- **Revogar é imediato**, pela mesma caixa da tela. Desativar a conta corta
  todos os tokens dela.
- **Trocar a senha não revoga token.** É decisão: token é configuração de
  máquina, e derrubar todos a cada troca quebraria o agente sem aviso. Quem sai
  do time perde o acesso quando a conta é desativada.
- O agente fala em nome da pessoa: vê o que ela vê e pode o que ela pode, menos
  apagar tarefa, que não existe como ferramenta.

---

## Acrescentar ou mudar uma ferramenta

O MCP acompanha toda funcionalidade nova (regra do `AGENTS.md`). O caminho:

1. **Parâmetro novo numa ferramenta que já existe** (campo novo de tarefa, por
   exemplo): uma linha em `CAMPOS` e outra em `PROPRIEDADES_DO_TICKET`, as duas
   em `server/mcp/comum.js`. Valor novo de enum (`STATUSES`, `COMMENT_KINDS`,
   `LINK_KINDS`) chega sozinho.
2. **Ferramenta nova**: um arquivo em `server/mcp/ferramentas/`, no formato
   descrito no topo de `server/mcp/catalogo.js`, e uma linha de import em
   `FERRAMENTAS`. Validação de campo desconhecido, de obrigatório e de enum,
   erro legível e marca "via agente" na trilha já acontecem em
   `server/mcp/index.js`.
3. **Rota nova na API**: registre em `COBERTURA` (`catalogo.js`) quais
   ferramentas a cobrem, ou `{ fora: "motivo" }`.
4. **Teste** em `tests/mcp.test.js`, pelo arreio `ferramenta()` que já está lá.

O que a suíte recusa sozinha: campo de `FIELDS` sem nome no MCP, rota de
`server/api.js` fora de `COBERTURA`, arquivo de `ferramentas/` fora do
catálogo, e catálogo ou instruções acima do teto de tamanho.

Escrevendo a descrição: uma ou duas frases, sem repetir o nome da ferramenta,
sem exemplo. Cada caractere ali é pago em toda sessão de toda máquina.

Propriedade que só funciona com disco leva `so: "ponte"`; a que só faz sentido
sem ela, `so: "remoto"`. A marca some antes de chegar ao cliente, e cada modo
vê só o que funciona nele. Ferramenta que precisa de disco também precisa de
tratamento em `scripts/mcp/ponte.mjs` (hoje: `anexar` com caminho e `baixar`).

---

## Protocolo

- **Streamable HTTP, sem sessão e sem SSE.** `POST /api/mcp` com JSON-RPC 2.0;
  resposta `application/json`. Notificação responde `202` sem corpo. `GET` e
  `DELETE` respondem `405`, que é o que o protocolo pede a quem não abre fluxo
  de eventos. Lote (lista de mensagens) é aceito, para cliente antigo.
- **Métodos:** `initialize`, `ping`, `tools/list`, `tools/call`. O resto é
  `-32601`. Ferramenta desconhecida é `-32602`; erro de uso da ferramenta
  volta como resultado com `isError`, que é o que o modelo lê.
- **Versões:** `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`. O servidor
  devolve a pedida quando a conhece, senão a mais nova.
- **Sem token:** `401` com `WWW-Authenticate: Bearer`.
- **Rotas binárias da ponte**, com o mesmo token: `POST /api/mcp/anexos?ticket=&nome=&comentario=`
  (corpo cru, `Content-Type` do arquivo) e `GET /api/mcp/anexos/{id}`.
- **Sem dependência.** Quatro métodos de JSON-RPC não justificam biblioteca,
  pela mesma razão que o driver do Turso fala HTTP à mão.
- **Funciona igual nos dois modos** (autônomo e hospedado): não guarda estado
  entre chamadas, não escreve em disco no servidor, e os anexos passam pelo
  mesmo `server/storage.js`.

Validado com o Claude Code de verdade em 17 de setembro de 2026: os dois modos
conectaram, e uma sessão em Sonnet leu, moveu, anexou por caminho, vinculou um
PR e registrou o handoff no formato pedido.

---

## Custo em tokens

| O quê | Tamanho em 17/9/2026 | Teto no teste |
|---|---|---|
| `tools/list` (direto e ponte) | ~6.000 caracteres, cerca de 1.900 tokens | 7.500 caracteres |
| Instruções do `initialize` | ~630 caracteres | 1.000 caracteres |
| Uma linha de `buscar` | ~80 caracteres | |

Estourou o teto: enxugue descrição antes de subir o número.

---

## Próximas versões

O que ficou de fora da primeira, com o motivo, está em `OPEN_POINTS.md`
seção 22.
