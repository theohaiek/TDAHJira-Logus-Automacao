# Arquitetura

## O formato

Três camadas, e apenas uma delas muda conforme onde o aplicativo roda:

```
              web/  — interface, ES modules nativos, sem build
               │
               │  fala um contrato só (docs/API.md)
               │
            server/ — regras de negócio, agnósticas de onde rodam
               │
        ┌──────┴──────┐
        │             │
   SQLite local    Turso (SQLite hospedado)
   disco local     Vercel Blob
```

A interface é o mesmo arquivo nos dois modos. Ela não sabe quem está do outro
lado: recebe a base da API e segue trabalhando.

As regras de negócio também são as mesmas. O que troca é o **driver** — quem
fala com o banco e quem guarda os arquivos —, escolhido em tempo de execução
pela configuração do ambiente.

## Os dois modos

| | Autônomo | Hospedado |
|---|---|---|
| Ativado por | ausência de configuração | `TURSO_DATABASE_URL` presente |
| Banco | `node:sqlite`, arquivo em `data/` | Turso, por HTTP |
| Anexos | `data/uploads/` | Vercel Blob |
| Entrada | `server/index.js` (servidor HTTP) | `api/index.js` (função) |
| Transação | real | ver a ressalva adiante |

O modo autônomo não é um brinquedo de desenvolvimento: é um caminho de
produção completo, e é o que permite que os testes exercitem o núcleo de
verdade em vez de simular um banco.

## Por que Turso e não Postgres

Turso **é** SQLite. O dialeto do [`core/schema.sql`](../core/schema.sql)
continua valendo sem tradução, as mesmas consultas rodam nos dois modos, e não
existe um segundo esquema para manter em sincronia.

Um Postgres exigiria um dialeto paralelo — `SERIAL` em vez de `AUTOINCREMENT`,
outro tratamento de data — e cada divergência entre os dois seria uma classe de
defeito que só aparece em produção.

## Por que não há etapa de compilação

Nenhum `npm install`, nenhum empacotador, nenhum passo de build. O que está no
repositório é exatamente o que o navegador executa e o que o servidor roda.

Isso torna o deploy trivial (não há o que configurar), elimina a categoria
inteira de problema de dependência quebrada, e mantém o código legível por
quem for mexer nele daqui a um ano.

O custo é abrir mão de TypeScript e de bibliotecas de componentes. Para uma
aplicação deste tamanho, compensa.

## O banco

### O princípio que governa o esquema

> Poucos campos na tarefa, muita história no log.

A tabela `tasks` guarda o estado atual e nada mais. Quem responde "onde está
cada coisa e desde quando" é a tabela `events`, que só recebe inserção — nunca
edição, nunca remoção.

É daí que vem a rastreabilidade sem cerimônia: a história se escreve sozinha a
cada mudança. Não existe campo de apontamento, nem formulário de justificativa,
nem transição que exija preenchimento.

Três campos de tempo sustentam quase toda a interface:

| Campo | Serve para |
|---|---|
| `status_since` | "parada há N dias" — o número que revela tarefa esquecida |
| `started_at` | quando entrou em andamento pela primeira vez |
| `done_at` | quando foi concluída |

Todos gravados automaticamente na transição de estado.

### A ressalva das transações

No modo autônomo, `tx()` é a transação real do SQLite.

No modo hospedado, cada consulta é uma requisição HTTP independente. Manter uma
transação aberta entre elas exigiria segurar uma sessão, o que não sobrevive a
uma função que pode ser encerrada a qualquer momento. Ali, `tx()` apenas
executa.

A consequência é estreita e foi aceita conscientemente: uma criação de tarefa
interrompida no meio pode consumir um número de projeto sem criar a tarefa —
um buraco na sequência (`LOG-7` existe, `LOG-8` não, `LOG-9` existe), não uma
perda de dado. O log de eventos continua íntegro.

## Sincronização entre as pessoas

O log de eventos também funciona como cursor. O cliente guarda o maior `id` que
já viu e pergunta periodicamente o que mudou desde então:

```
GET /api/sync?cursor=412
→ { cursor: 419, tasks: [...], removed: [...], events: [...] }
```

Para três pessoas, uma verificação a cada seis segundos é indistinguível de
tempo real e não exige conexão persistente nem um servidor com estado. Quando a
aba vai para segundo plano a sondagem para, e é retomada ao voltar.

## Estado no cliente

A base cabe inteira na memória do navegador. Uma chamada a `GET /api/state`
traz tudo: tarefas, projetos, pessoas, etiquetas e atividade recente.

Filtrar, ordenar, buscar e trocar de visão não geram nenhuma ida ao servidor —
a interface responde no mesmo quadro em que se clica. Essa resposta imediata é
requisito de produto, não detalhe técnico: atraso percebido é onde a atenção se
perde.

As escritas são aplicadas na tela antes da confirmação do servidor e revertidas
se a chamada falhar (`store.js`, função `patch`).

## Segurança

| Risco | Tratamento |
|---|---|
| Injeção de SQL | Toda consulta usa parâmetro vinculado, nos dois drivers |
| XSS | A interface nunca usa `innerHTML` com dado de quem usa. Todo texto entra por `textContent` ou atributo (`web/js/dom.js`) |
| CSRF | Cookie `SameSite=Lax` mais verificação de origem nos métodos de escrita |
| Upload perigoso | Lista fechada de tipos, sem SVG (que carrega script); nome sorteado; `nosniff` na entrega |
| Anexo exposto | A referência do arquivo nunca sai na resposta da API; a leitura passa sempre pela rota autenticada |
| Senha | `scrypt` com sal por usuário e comparação em tempo constante |
| Força bruta | Oito tentativas por origem e usuário numa janela de quinze minutos |
| Enumeração de contas | A verificação roda contra um hash descartável quando o usuário não existe, para o tempo de resposta não denunciar |
| Segredo no repositório | Nenhum. As chaves vivem só no ambiente, e `.env.example` traz apenas os nomes |

## Estrutura de diretórios

```
package.json            sem dependências; só declara os comandos
vercel.json             configuração do modo hospedado
Dockerfile              imagem para um servidor próprio
compose.yaml

core/
  schema.sql            o esquema, em dialeto SQLite

api/
  index.js              entrada do modo hospedado (função)

server/
  index.js              entrada do modo autônomo (servidor HTTP)
  api.js                as rotas — o contrato em código
  db.js                 driver de banco: local ou hospedado
  storage.js            driver de arquivo: disco ou nuvem
  auth.js               senha, sessão e freio de tentativas
  tasks.js              regras de tarefa
  comments.js           conversa e anexos
  events.js             a trilha
  http.js               utilidades de HTTP
  demo.js               dados de exemplo
  paths.js              caminhos

web/                    interface
  index.html
  css/                  tokens.css (identidade), base.css, app.css
  js/
    app.js              montagem, navegação, atalhos
    store.js            estado e sincronização
    api.js              cliente
    dom.js              construção de DOM sem biblioteca
    dialog.js           diálogos próprios, no lugar dos do navegador
    capture.js          o interpretador da captura rápida
    taskcard.js         o cartão de tarefa
    ticket.js           o ticket, com conversa e trilha
    focus.js            modo foco
    palette.js          paleta de comandos
    views/              hoje, quadro, planilha, fluxo

tests/                  31 testes, sem dependência externa
data/                   banco e anexos no modo autônomo (fora do versionamento)
```
