# Handoff

Este documento existe para que outra pessoa — ou você mesmo daqui a seis meses —
retome o projeto sem precisar reconstruir o raciocínio nem repetir os erros que
já foram pagos.

Ele registra o que **não** está óbvio no código: por que as coisas são como são,
o que já foi tentado e descartado, e onde estão as armadilhas reais.

---

## 1. O que é

Um gerenciador de tarefas com a simplicidade de uma planilha e a rastreabilidade
de um issue tracker, para um time de três pessoas na Logus Soluções em Automação.

O público-alvo é específico: **pessoas com TDAH que executam muito bem quando o
trabalho está claramente colocado.** Isso não é enfeite — é o critério que decide
cada disputa de interface. Quando estiver em dúvida sobre uma mudança, pergunte:
isso reduz ou aumenta o número de decisões que alguém precisa tomar para começar
a trabalhar?

| | |
|---|---|
| Produção | https://tdah-jira-logus-automacao.vercel.app |
| Repositório | https://github.com/theohaiek/TDAHJira-Logus-Automacao |
| Painel | Vercel, conta **Logus** (plano Hobby), projeto `tdah-jira-logus-automacao` |
| Banco | Turso `tdah-logus-db`, plano Starter ($0), região `iad1` |
| Arquivos | Vercel Blob `tdah-jira-logus-automacao-blob`, **privado**, `iad1` |

**As senhas não estão aqui e nunca devem estar** — o repositório é público. Elas
foram passadas por outro canal. Se perdeu, veja a seção 7.

---

## 2. Como rodar

### Local (desenvolvimento)

```bash
git clone https://github.com/theohaiek/TDAHJira-Logus-Automacao.git
cd TDAHJira-Logus-Automacao
node server/index.js --demo    # cria dados de exemplo e mostra as senhas
node server/index.js           # sobe em http://localhost:4173
```

Não há `npm install` no modo local. Node 22.5+ basta — o SQLite vem embutido.

### Testes

```bash
node --test "tests/*.test.js"     # 31 testes, sem dependência externa
```

Rode antes de qualquer commit. Eles cobrem as transições de estado e o
interpretador da captura rápida, que são as duas partes onde um erro não
aparece na tela — aparece semanas depois, num histórico errado.

### Produção

Deploy automático a cada push na `main`. Não há build: o que está no
repositório é o que roda.

---

## 3. Arquitetura em uma página

```
web/          interface — ES modules nativos, sem build, sem framework
   │
   │  fala um contrato só (docs/API.md)
   │
server/       regras de negócio, agnósticas de onde rodam
   │
   ├── db.js       SQLite local  │  Turso por HTTP    (escolhe por env)
   └── storage.js  disco local   │  Vercel Blob       (escolhe por env)
```

**A regra central:** nada em `server/api.js` ou `server/tasks.js` sabe onde está
rodando. Quem resolve isso são os dois drivers, escolhidos em tempo de execução:

- `TURSO_DATABASE_URL` presente → banco hospedado; ausente → arquivo local
- `BLOB_READ_WRITE_TOKEN` presente → arquivos na nuvem; ausente → disco

Isso é o que permite testar de verdade: os 31 testes exercitam o núcleo real
contra um SQLite real, não contra simulação.

### O princípio que governa o banco

> Poucos campos na tarefa, muita história no log.

`tasks` guarda só o estado atual. Quem responde "onde está cada coisa e desde
quando" é `events`, que só recebe inserção — nunca edição, nunca remoção.

É daí que vem a rastreabilidade sem cerimônia: a história se escreve sozinha.
**Se você adicionar um campo, adicione o evento correspondente**, ou a trilha
passa a mentir por omissão.

---

## 4. As armadilhas que já custaram caro

Cada uma destas quebrou de verdade. Todas estão corrigidas — a lista existe para
você não reintroduzi-las.

### 4.1 O esquema não era criado no banco hospedado

O driver do Turso divide `core/schema.sql` por `;` e manda uma instrução por vez.
A primeira versão descartava o pedaço que começava com `--`, **levando junto o
`CREATE TABLE` logo abaixo do comentário**. Como o esquema é comentado linha a
linha, quase nenhuma tabela nascia, e a primeira consulta derrubava a função.

**Regra:** comentários saem *antes* da divisão, nunca depois.

### 4.2 Escrita em repositório de arquivos privado exige a biblioteca oficial

A API HTTP de upload privado do Vercel Blob **não é pública**. Tentar por
`fetch` com cabeçalho inventado devolve `bad_request` com a mensagem
*"Cannot use public access on a private store"*. Só `@vercel/blob` sabe fazer.

É a única dependência do projeto, e ela só é carregada quando existe
configuração de nuvem — o modo local segue sem dependência alguma.

### 4.3 `hidden` perde para `display` no CSS

`.focus { display: grid }` reativa um elemento marcado como `hidden`, que então
cobre a tela inteira. A tela ficava preta e ninguém entendia por quê.

Existe uma regra em `base.css` que resolve isso globalmente:
`[hidden] { display: none !important }`. **Não remova.**

### 4.4 Redesenhar o painel apaga o que está sendo digitado

A sincronização roda a cada 6s e dispara com mudança de *qualquer* pessoa. Se o
painel do ticket for redesenhado enquanto alguém digita, o texto não salvo é
perdido — porque ele só existe no nó do DOM.

`ticket.js` adia o redesenho quando há um campo em foco dentro do painel
(`editandoNoPainel`). **Se mexer no ciclo de render, preserve isso.**

### 4.5 `await fn().prop` não faz o que parece

`await updateTask(...).startedAt` avalia `.startedAt` na Promise (undefined) e
não aguarda a chamada. No modo local isso deixava uma transação SQLite aberta, e
a chamada seguinte falhava com *"cannot start a transaction within a
transaction"*. Sempre `(await fn()).prop`.

### 4.6 `\b` não reconhece fronteira depois de letra acentuada

`/amanhã\b/` nunca casa, porque `\b` se apoia no `\w` ASCII e `ã` não é
caractere de palavra. O interpretador da captura usa `(?!\p{L})` no lugar. Vale
para qualquer regex nova que termine em palavra acentuada.

### 4.7 `curl` no shell do Windows corrompe acentuação

Testes de API por `curl` mandaram `Automações` como `Automa��es`. **Não é bug do
aplicativo** — a interface e o Node tratam UTF-8 corretamente. Para testar
acentuação, use `fetch` pelo Node ou a própria interface.

### 4.8 Antivírus pode substituir os arquivos do aplicativo

Numa das máquinas, o Kaspersky interceptou o domínio e **devolveu a própria
página de bloqueio no lugar de cada CSS e JS**: o servidor entregava 3 KB de
JavaScript e o navegador recebia 190 KB de HTML, com status 499. Resultado: tela
branca, sem erro no console.

**Como reconhecer:** o `curl` baixa tudo com 200, mas no navegador as folhas de
estilo aparecem com zero regras e o módulo falha com *"Failed to fetch
dynamically imported module"*.

**Solução:** liberar o domínio no antivírus, ou usar domínio próprio — endereço
recém-criado sem reputação é o gatilho.

### 4.9 Coluna nova não chega ao banco que já existe

O esquema usa `CREATE TABLE IF NOT EXISTS`, então adicionar uma coluna em
`core/schema.sql` só vale para banco novo. Em produção a tabela já existe, a
coluna nunca aparece, e o primeiro `INSERT` que a cita falha.

A saída está em `server/db.js`: a lista `MIGRACOES` guarda um `ALTER TABLE`
por coluna, e cada um só roda se `pragma_table_info` disser que a coluna
falta. É idempotente e funciona igual no SQLite local e no Turso. Toda coluna
nova entra nos dois lugares: no esquema, para banco novo, e na lista, para os
que já existem.

### 4.10 Aba em segundo plano não redesenha

`desenhar()` agrupa mudanças com `requestAnimationFrame`, e o navegador
suspende esse relógio em aba oculta. Numa automação de navegador com a aba em
segundo plano, o `state` muda, a API confirma, e a tela fica parada; parece
bug de redesenho e não é. Para validar nessa condição, meça pelo `state` ou
pela API, ou traga a aba para a frente antes de olhar o DOM.

---

## 5. Decisões tomadas e o motivo

Estas foram discutidas e decididas. Reabrir é legítimo, mas comece sabendo o que
já foi pesado.

| Decisão | Por quê | Reveja se |
|---|---|---|
| **Vercel + Turso**, não VPS própria | A VPS disponível é de outra empresa; misturar dados criaria dependência que ninguém quer administrar | O time ganhar infraestrutura própria |
| **Node, e só Node** | O plugin de WordPress foi construído inteiro e removido: dobrava a superfície para manter e testar, com a metade não exercitada | Nunca, provavelmente |
| **Turso, não Postgres** | Turso é SQLite: o mesmo esquema serve aos dois modos, sem dialeto paralelo para manter em sincronia | O volume passar do que SQLite aguenta (muito longe disso) |
| **Blob privado, não público** | Anexo de trabalho não pode abrir para quem descobrir a URL | Nunca |
| **"Esperando" é coluna, não marca** | A pesquisa recomenda marca sobreposta, por causa de métrica de tempo. Recusado: ver a coluna responde "onde está isso" em meio segundo, e a métrica não é calculada na V1 | O time começar a olhar tempo de ciclo |
| **Prioridade é campo, não posição na fila** | Ordem manual pura exige arrastar tudo para expressar urgência | O quadro ficar grande demais |
| **Sem exigência de senha forte** | Instância interna de time pequeno; regra complicada só produz senha em papel. O que protege é o freio de 8 tentativas por 15 min | A instância passar a ter acesso externo |
| **Cronômetro entrou na V1** | Modo foco sem relógio perde a função de conter cegueira temporal | Nunca |
| **Quadros laterais são um campo, não uma tabela** | Validade longa, oportunidades e metas são a mesma tarefa com `kind` diferente: uma fonte, várias lentes, e mover entre eles é trocar um campo que fica na trilha. Foi a exceção consciente à regra de não adicionar campo: este tira coisas da fila do dia em vez de pedir mais uma decisão por tarefa | Os quadros precisarem de campos que a tarefa não tem |

---

## 6. Onde as coisas estão

```
api/index.js          entrada do modo hospedado (função sem servidor)
server/index.js       entrada do modo local (servidor HTTP)
server/api.js         as rotas — o contrato em código
server/db.js          driver de banco (local ou hospedado) + transações
server/storage.js     driver de arquivo (disco ou nuvem)
server/tasks.js       regras de tarefa e transições de estado
server/auth.js        senha, sessão, freio de tentativas
server/events.js      a trilha
core/schema.sql       o esquema, dialeto SQLite

web/js/app.js         montagem, navegação, atalhos, menu do usuário
web/js/store.js       estado, sincronização, e a função agora() — o coração
web/js/ticket.js      o ticket, conversa, anexos, trilha
web/js/capture.js     interpretador da captura rápida
web/js/views/         hoje, quadro, planilha, fluxo

docs/RESEARCH.md      as 51 ferramentas analisadas e o que foi aproveitado
docs/PRODUCT.md       os dez princípios e por que cada um existe
docs/ARCHITECTURE.md  como os dois modos coexistem
docs/API.md           o contrato, normativo
OPEN_POINTS.md        o que ficou em aberto
```

**Se for mexer no produto, leia `docs/PRODUCT.md` antes.** Ele explica por que
a tela inicial não é o quadro, por que o cronômetro conta para cima depois do
fim, e por que não existe vermelho em prazo vencido. São decisões que parecem
arbitrárias e não são.

---

## 7. Operação

### Perdi a senha do administrador

Não há recuperação por e-mail. Duas saídas:

1. Outra pessoa com papel `admin` cria um acesso novo pelo menu.
2. Apagar a linha do usuário direto no Turso (painel → `tdah-logus-db`) e
   reiniciar a função: sem nenhuma conta, a primeira requisição cria o
   administrador de novo e imprime a senha no log da Vercel.

### Onde vejo erro de produção

Vercel → projeto → **Logs**. Filtre por `[erro]`, `[turso]` ou `[blob]`. As
mensagens 5xx são genéricas para quem chama, mas o detalhe completo fica no log.

### Criar acesso para alguém

Dentro do aplicativo: avatar no canto inferior esquerdo → **Criar acesso para
alguém**. Só quem é `admin` enxerga. A senha pode ser escolhida ou sorteada, e
aparece uma única vez.

### Cópia de segurança

O banco fica no Turso, que tem ponto de restauração próprio. Os anexos ficam no
Blob. No modo local, tudo está em `data/` — copiar a pasta com o servidor parado
basta.

### Variáveis de ambiente

Cinco, todas no painel da Vercel, nenhuma no repositório:
`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `BLOB_READ_WRITE_TOKEN`,
`BLOB_STORE_ID`, `BLOB_WEBHOOK_PUBLIC_KEY`.

Os nomes em `.env.example` estão sempre vazios — mantenha assim.

---

## 8. O que fazer a seguir

Em ordem de valor por esforço. A lista longa, com origem de cada ideia, está em
`OPEN_POINTS.md` seção 4. As pendências deixadas ao fim da última sessão
estão na seção 8 do mesmo arquivo.

1. **Usar por duas semanas antes de mudar qualquer coisa.** As perguntas abertas
   (cinco estados são demais? limite de três é realista?) só se respondem com
   uso real.
2. **Domínio próprio** (`tarefas.logus.com.br`). Resolve o bloqueio por
   antivírus de vez e tira a cara de endereço genérico.
3. **Notificações** — o maior vazio apontado pela pesquisa. Hoje a tela inicial
   responde "o que faço agora" só para quem abre o aplicativo. Um resumo diário
   passivo resolveria; um alerta interruptivo estragaria.
4. **Miniatura do anexo no cartão** — um print visível no quadro entrega
   contexto em meio segundo.
5. **Etiquetas e subtarefas na interface.** Ambas já existem no banco e na API;
   falta só a tela.

**O que não fazer:** adicionar campos ao formulário de tarefa. Cada campo novo é
uma decisão a mais por tarefa, e o produto inteiro foi construído para reduzir
esse número. Se algo precisar ser registrado, prefira um evento na trilha a um
campo no formulário.

---

## 9. Estado ao fim desta sessão

- V1 completa, publicada e validada em produção de ponta a ponta: criar tarefa,
  comentar, anexar print, recuperá-lo byte a byte, e recusar acesso sem sessão.
- Tela inicial com os três quadros laterais (validade longa, oportunidades,
  metas longas) fora do fluxo do dia; campo `kind` com migração idempotente
  para bancos que já existiam.
- 35 testes automatizados passando.
- Três contas criadas: uma de administração e duas do time.
- Banco limpo, com um projeto e nenhuma tarefa — pronto para uso real.
- Nenhuma credencial, assinatura ou autoria no repositório.
