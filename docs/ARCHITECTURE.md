# Arquitetura

## A restrição que definiu tudo

O pedido trazia dois requisitos de distribuição que puxavam para lados opostos:

1. rodar como **plugin de WordPress** — o que obriga PHP;
2. ou, se isso não desse certo, ser **conectável por três pessoas, cada uma no
   seu computador**, sem exposição na internet.

Fazer os dois com um backend só não é possível: um plugin de WordPress precisa
ser PHP, e exigir uma instalação de PHP na máquina de cada pessoa para o modo
autônomo seria trocar um problema por outro.

A saída foi separar o produto em três camadas e deixar apenas a mais fina
duplicada:

```
                    web/  — interface, ES modules nativos, sem build
                     │
                     │  fala um contrato só (docs/API.md)
        ┌────────────┴────────────┐
        │                         │
   server/  (Node)          tdah-logus.php (PHP)
   SQLite embutido          wordpress/includes/
   zero dependências        $wpdb, MySQL
```

A interface é **o mesmo arquivo** nos dois modos. Ela não sabe quem está do
outro lado: recebe a base da API e um eventual nonce em `window.TDAH_BOOT` e
segue trabalhando.

O que é duplicado é somente a implementação do contrato — cerca de mil linhas de
cada lado, com a mesma forma de entrada e de saída. É duplicação real e tem
custo de manutenção; foi o preço aceito para atender aos dois requisitos sem
inventar uma camada de abstração que ninguém entenderia depois.

## Por que não há etapa de compilação

Nenhum `npm install`, nenhum empacotador, nenhum passo de build. O que está no
repositório é exatamente o que o navegador executa.

Isso não é purismo. É o que permite que o repositório inteiro funcione como
plugin de WordPress ao ser clonado dentro de `wp-content/plugins/`, sem processo
de empacotamento. E é o que faz o modo autônomo ser `node server/index.js` e mais
nada.

A interface usa módulos ES nativos, suportados por qualquer navegador atual. O
custo é abrir mão de TypeScript e de bibliotecas de componentes; para uma
aplicação deste tamanho, o custo compensa.

## O banco

`node:sqlite` vem embutido no Node desde a versão 22.5 — SQLite sem instalar
nada. É o que torna o modo autônomo verdadeiramente sem dependências.

O esquema está em [`core/schema.sql`](../core/schema.sql), no dialeto do SQLite,
e é traduzido para MySQL em
[`wordpress/includes/class-schema.php`](../wordpress/includes/class-schema.php).
Os dois descrevem o mesmo desenho; ao mudar um, mude o outro.

### O princípio que governa o esquema

> Poucos campos na tarefa, muita história no log.

A tabela `tasks` guarda o estado atual e nada mais. Quem responde "onde está
cada coisa e desde quando" é a tabela `events`, que só recebe inserção — nunca
edição, nunca remoção.

É daí que vem a rastreabilidade sem cerimônia: a história se escreve sozinha a
cada mudança, sem pedir nada a mais de quem usa. Não existe campo de
apontamento, nem formulário de justificativa, nem transição que exija
preenchimento.

Três campos de tempo sustentam quase toda a interface:

| Campo | Serve para |
|---|---|
| `status_since` | "parada há N dias" — o número que revela tarefa esquecida |
| `started_at` | quando entrou em andamento pela primeira vez |
| `done_at` | quando foi concluída |

Todos gravados automaticamente na transição de estado.

## Sincronização entre as pessoas

O log de eventos também funciona como cursor de sincronização. O cliente guarda
o maior `id` de evento que já viu e pergunta periodicamente o que mudou desde
então:

```
GET /api/sync?cursor=412
→ { cursor: 419, tasks: [...], removed: [...], events: [...] }
```

Para três pessoas numa rede local, uma verificação a cada seis segundos é
indistinguível de tempo real e não exige conexão persistente nem um servidor que
saiba manter estado. Quando a aba está em segundo plano a sondagem para, e ela
é retomada assim que a aba volta ao primeiro plano.

## Estado no cliente

A base é pequena o suficiente para caber inteira na memória do navegador. Uma
chamada a `GET /api/state` traz tudo: tarefas, projetos, pessoas, etiquetas e
atividade recente.

Isso significa que filtrar, ordenar, buscar e trocar de visão não geram nenhuma
ida ao servidor — a interface responde no mesmo quadro em que se clica. Essa
resposta imediata é requisito de produto, não detalhe técnico: atraso percebido
é onde a atenção se perde.

As escritas são aplicadas na tela antes da confirmação do servidor e revertidas
se a chamada falhar (`store.js`, função `patch`).

## Segurança

| Risco | Tratamento |
|---|---|
| Injeção de SQL | Toda consulta usa parâmetro vinculado; no WordPress, `$wpdb->prepare` e os métodos `insert`/`update`/`delete` |
| XSS | A interface nunca usa `innerHTML` com dado de quem usa. Todo texto entra por `textContent` ou atributo (`web/js/dom.js`) |
| CSRF | Cookie `SameSite=Lax` mais verificação de origem nos métodos de escrita; no WordPress, nonce da REST |
| Upload perigoso | Lista fechada de tipos aceitos, sem SVG (que carrega script); nome no disco é sorteado; `X-Content-Type-Options: nosniff` na entrega |
| Travessia de caminho | O nome enviado é apenas rótulo e nunca toca o sistema de arquivos; a entrega usa `basename` |
| Senha | `scrypt` com sal por usuário e comparação em tempo constante (`server/auth.js`) |
| Anexo exposto | A pasta de uploads fica fora do controle de versão e, no WordPress, protegida por `.htaccess`; os arquivos saem apenas por rota autenticada |

## Estrutura de diretórios

```
tdah-logus.php          ponto de entrada do plugin de WordPress
package.json            sem dependências; só declara os comandos

core/
  schema.sql            o esquema, no dialeto do SQLite

server/                 servidor autônomo em Node
  index.js              inicialização, preparação da instância, servidor HTTP
  api.js                as rotas
  db.js                 conexão e utilidades
  auth.js               senha e sessão
  tasks.js              regras de tarefa
  comments.js           conversa e anexos
  events.js             a trilha
  http.js               utilidades de HTTP
  demo.js               dados de exemplo
  paths.js              caminhos

web/                    interface, idêntica nos dois modos
  index.html
  css/                  tokens.css (identidade), base.css, app.css
  js/
    app.js              montagem, navegação, atalhos
    store.js            estado e sincronização
    api.js              cliente
    dom.js              construção de DOM sem biblioteca
    capture.js          o interpretador da captura rápida
    taskcard.js         o cartão de tarefa
    ticket.js           o ticket, com conversa e trilha
    focus.js            modo foco
    palette.js          paleta de comandos
    views/              hoje, quadro, planilha, fluxo

wordpress/
  includes/             a implementação PHP do mesmo contrato
  assets/admin.css      ajustes para conviver com o painel

data/                   banco e anexos (fora do controle de versão)
```
