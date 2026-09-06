# Como mexer neste projeto

Guia prático para quem vai desenvolver. O que está aqui é o que se precisa
saber para não quebrar nada; o porquê de cada decisão está em
[docs/PRODUCT.md](docs/PRODUCT.md) e em [HANDOFF.md](HANDOFF.md).

## Rodar local

Precisa de Node 22.5 ou mais novo — o projeto usa o `node:sqlite` embutido.
**Não existe `npm install`:** nenhuma dependência.

```bash
node server/index.js                # http://localhost:4173
node server/index.js --port 8080    # outra porta
node server/index.js --setup        # cria a primeira conta

node --test "tests/*.test.js"       # a suíte inteira
```

O banco e os anexos ficam em `./data`, que o git ignora. Para um ambiente
descartável, aponte outro diretório:

```bash
TDAH_DATA_DIR=data-teste node server/index.js
```

O acesso é criado por quem administra a instância — não há cadastro aberto.

## Os dois modos, que é onde o bug mora

O mesmo código roda de duas formas, e essa é a maior fonte de defeito do
projeto:

| | Autônomo | Hospedado |
|---|---|---|
| Entrada | `server/index.js` | `api/index.js` (função sem servidor) |
| Banco | `node:sqlite` em disco | Turso, por HTTP |
| Anexos | disco local | repositório de arquivos na nuvem |
| Transação | de verdade | **não** |
| Estado entre chamadas | vive no processo | **não sobrevive** |
| Disco | leitura e escrita | somente leitura |

Quem decide é o ambiente: havendo `TURSO_DATABASE_URL`, é o modo hospedado.
Os drivers plugáveis moram em `server/db.js` e `server/storage.js`.

**Antes de escrever qualquer coisa no servidor, pergunte se funciona nos
dois.** Um `Map` de módulo guarda estado no autônomo e perde tudo no
hospedado. Uma sequência de escritas é atômica no autônomo e não é no outro.

## Onde está cada coisa

```
server/api.js       as rotas — o contrato em código
server/tasks.js     regras de tarefa e transições de estado
server/db.js        driver de banco, transações e a lista MIGRACOES
server/auth.js      senha, sessão, freio de tentativas
server/events.js    a trilha
server/storage.js   driver de arquivo
core/schema.sql     o esquema, dialeto SQLite

web/js/store.js     estado e sincronização — o coração
web/js/app.js       montagem, navegação, atalhos, ciclo de desenho
web/js/dom.js       o helper h(). Nunca use innerHTML.
web/js/ticket.js    ticket, conversa, anexos, trilha
web/js/capture.js   interpretador da captura rápida
web/js/views/       hoje, quadro, planilha, fluxo
```

Documentação: [docs/API.md](docs/API.md) é normativo — leia antes de mexer em
rota. [OPEN_POINTS.md](OPEN_POINTS.md) diz o que está aberto e por quê.

## Quatro conceitos que explicam o resto

**O campo `kind`.** Toda tarefa é `task`, `longa`, `oportunidade` ou `meta`.
`task` é o fluxo do dia; os outros três moram nos quadros pequenos da lateral
da tela inicial e ficam fora da fila, do quadro e da planilha sem filtro. A
regra está em `visiveis(kind = "task")`, em `store.js`; passar `"*"` traz
todos. **Ao criar uma listagem nova, escolha conscientemente entre as duas.**

**A trilha.** Poucos campos na tarefa, muita história no log. Toda mudança
vira uma linha em `events`, com valor anterior e novo. Se algo precisa ficar
registrado, prefira um evento a um campo novo no formulário.

**A sincronização.** O cliente faz polling de 6s em `/api/sync?cursor=N`,
onde `N` é o maior `events.id` que ele já viu. A exclusão é o caso especial:
o evento nasce com `task_id` nulo — a linha da tarefa já não existe, e a
chave estrangeira levaria o evento junto no `CASCADE` — e o identificador vai
em `to_value`. Quem lê isso é `deletedSince()`.

**O ciclo de desenho.** `app.js` e `ticket.js` represam o redesenho enquanto
houver campo em foco, senão a sincronização apaga o que a pessoa está
digitando. Se mexer no ciclo de render, preserve isso.

## Armadilhas que já custaram caro

1. **Coluna nova não chega ao banco que já existe.** O `CREATE TABLE` tem
   `IF NOT EXISTS`, então alterar `core/schema.sql` só vale para banco novo.
   Toda coluna nova entra em **dois** lugares: no esquema e na lista
   `MIGRACOES` de `server/db.js`.
2. **Antivírus com anti-phishing bloqueia formulário de senha em domínio
   compartilhado.** Foi por isso que o aplicativo saiu de um endereço
   genérico para domínio próprio. Se o sintoma voltar (tela branca, arquivos
   que não carregam), é o domínio, não o código.
3. **`curl` no shell do Windows corrompe acentuação** em corpo JSON. Para
   testar com acento, use `fetch` por Node.
4. **Aba em segundo plano suspende `requestAnimationFrame`** e o aplicativo
   não redesenha. Ao automatizar navegador, meça pelo estado, não pelo DOM.
5. **SQL novo precisa valer nos dois bancos.** `RETURNING` funciona nos dois,
   mas confira o caminho do driver antes de adotar qualquer coisa nova.

O relato completo de cada uma está em [HANDOFF.md](HANDOFF.md), seção 4.

## Regras do repositório

Ele é público. Isso não é detalhe:

- **Nenhuma credencial, token, chave ou senha** em arquivo versionado.
- **Nenhum nome real** de pessoa do time ou de cliente. Os dados de exemplo
  usam Ana, Bruno e Carla Exemplo, e é assim que continua.
- **Nenhuma dependência nova.** A única é `@vercel/blob`, importada
  dinamicamente e só quando existe o token do repositório de arquivos.
- **Comentário explica por que, não o que.** O código já diz o que faz.
- **Não adicione campo ao formulário de tarefa.** Cada campo é uma decisão a
  mais por tarefa, e o produto inteiro foi construído para reduzir esse
  número. Se algo precisa ser registrado, prefira um evento na trilha.

## Deploy

Push na `main` publica sozinho. Não há passo manual. As variáveis de ambiente
ficam no painel da hospedagem, nunca no repositório. Erro em produção aparece
no log do projeto — filtre por `[erro]`, `[turso]` ou `[blob]`.

## Antes de abrir um PR

```bash
node --test "tests/*.test.js"
```

Correção de regra de negócio no servidor pede teste. O frontend não tem
suíte: não há DOM nem dependência de teste, então vale leitura atenta e
coerência com o arquivo ao redor.
