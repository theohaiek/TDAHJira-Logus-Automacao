# Guia para agentes de código

Só o que quebra em silêncio: o que funciona aqui e falha em produção, ou
funciona hoje e corrompe o histórico depois. Como o projeto funciona está em
[CONTRIBUTING.md](CONTRIBUTING.md); o contrato das rotas, em
[docs/API.md](docs/API.md), que é normativo.

## Comandos

```bash
node server/index.js                                        # http://localhost:4173
TDAH_DATA_DIR=data-demo node server/index.js --demo --serve # sobe com exemplo e mostra as senhas
node --test "tests/*.test.js"                               # a suíte inteira
```

Node 22.5+, por causa do `node:sqlite` embutido. **Não existe `npm install`.**
A variável na frente do comando é sintaxe de shell POSIX; no PowerShell é
`$env:TDAH_DATA_DIR = "data-demo"` numa linha antes.

Duas coisas que custam meia hora cada: **ninguém lê o `.env`** — não há `dotenv`
nem `--env-file`, e a variável vai na frente do comando, como acima. E `--demo`
só mostra senha quando cria as contas: rodado de novo sobre a mesma base, ele
volta com zero tarefas e nenhuma senha. Use um `TDAH_DATA_DIR` novo.

## Os dois modos, que é onde o bug mora

O mesmo código roda de dois jeitos, e a diferença não aparece em teste local:

| | Autônomo | Hospedado |
|---|---|---|
| Entrada | `server/index.js` | `api/index.js` |
| Escolhido por | ausência de `TURSO_DATABASE_URL` | presença dela |
| Transação | de verdade | **`tx()` não faz nada** |
| Estado entre chamadas | vive no processo | **não sobrevive** |
| Disco | leitura e escrita | **somente leitura** |

**Antes de escrever qualquer coisa no servidor, pergunte se funciona nos dois.**
Um `Map` de módulo guarda estado num e perde no outro. Uma sequência de escritas
é atômica num e não é no outro. E a sequência que recebe a requisição — conferir
a origem, ler o cookie, preparar a instância a frio — está escrita **nas duas
entradas**: mexer só numa passa nos testes e não vale em produção. O mesmo com
os três cabeçalhos de segurança, que estão em `SEGURANCA` (`server/http.js`) e
de novo em `vercel.json`.

`vercel.json` completa o contrato do modo hospedado: só o que casa com
`includeFiles` entra no pacote da função, e só `web/` é servido como estático.
Arquivo novo lido em tempo de execução fora daí some sem aviso em produção.

## Nunca

1. **Nunca instale nem proponha dependência**, nem camada, abstração ou
   configuração nova. A regra da casa é a menor mudança que resolve. A única
   dependência é `@vercel/blob`, importada dinamicamente e só quando há token.
2. **Nunca use `innerHTML` para conteúdo de quem usa.** O projeto monta DOM pelo
   helper `h()` e limpa nós com `clear()`, ambos em `web/js/dom.js`.
3. **Nunca altere `core/schema.sql` sem a entrada correspondente em `MIGRACOES`**
   (`server/db.js`). `CREATE TABLE IF NOT EXISTS` não altera tabela que já
   existe: sem a migração, a coluna nunca chega ao banco em uso, e o erro só
   aparece na primeira escrita.
4. **Nunca escreva DDL não-idempotente no esquema.** O arquivo roda inteiro a
   cada subida do servidor, não só na criação. Um `ALTER TABLE` solto ali derruba
   o boot a partir da segunda vez.
5. **Nunca deixe de gravar evento numa escrita que outra aba precisa enxergar.**
   O cursor de sincronização é o maior `events.id`: quem chama só `touch()` fica
   invisível para quem está com a aba aberta até um recarregamento completo.
6. **Nunca adicione campo ao formulário de tarefa.** Cada campo é uma decisão a
   mais por tarefa, e o produto foi construído para reduzir esse número — o
   público é quem tem TDAH e executa bem quando o trabalho está claramente
   colocado. Se algo precisa ficar registrado, prefira um evento na trilha.
7. **Nunca escreva código ou comentário em inglês, nem sem acentuação.**
8. **Nunca versione credencial, token ou nome real de pessoa.** O repositório é
   público; os dados de exemplo usam Ana, Bruno e Carla Exemplo. Os arquivos
   `*.local.md` da raiz têm nome real e senha: eles não entram no repositório, e
   o conteúdo deles também não — nem citado em commit, comentário ou documento.
9. **Nunca credite um agente como autor** de commit, PR ou documento.

## Ao escrever teste

Copie o cabeçalho de um teste existente **sem mexer na ordem**:

```js
process.env.TDAH_DATA_DIR = mkdtempSync(join(tmpdir(), "tdah-test-"));
const { DB_FILE, DATA_DIR } = await import("../server/paths.js");   // dinâmico, não estático
```

`paths.js` resolve `DATA_DIR` na avaliação do módulo, e declaração de `import` é
içada. Trocar o `await import` por um `import` comum — que parece mais limpo —
faz `DATA_DIR` apontar para o `./data` real, e o `rmSync` do `after()` apaga o
banco e os anexos de quem usa a máquina. Sem erro: o teste passa.

Correção de regra de negócio no servidor pede teste junto. O frontend não tem
suíte: vale leitura atenta e coerência com o arquivo ao redor.

## Se for mexer em X, leia Y antes

| Você vai mexer em | Leia antes |
|---|---|
| Qualquer rota | `docs/API.md`, e a outra entrada (`server/index.js` ou `api/index.js`) |
| `core/schema.sql` | `MIGRACOES` e o `exec()` do driver Turso, em `server/db.js`: `PRAGMA` é descartado no modo hospedado, e a divisão das instruções só ignora linha que **começa** com `--` |
| Evento, trilha, atividade | `EVENT_KINDS` em `server/events.js`, `EVENT_FOR` em `server/tasks.js`, e os dois dicionários que traduzem o evento para o usuário, `FRASE` (`web/js/views/fluxo.js`) e `NARRA` (`web/js/ticket.js`). `tests/trilha.test.js` cobra os quatro de uma vez |
| Exclusão de tarefa | `deleteTask` em `server/tasks.js`: o evento nasce sem `task_id` de propósito, e a lista de visitadas é o que impede um ciclo de travar o processo |
| Ordem dos cartões | `moveTask` e `espalhar()` em `server/tasks.js` |
| Ciclo de desenho | `app.js` e `ticket.js`: cada um tem sua instância do represamento que protege o campo em foco, e mexer numa só faz metade da tela apagar o que a pessoa digita |
| Qualquer listagem | `visiveis()` em `web/js/store.js` — sem argumento, traz só `kind: "task"` |
| Anexo ou limite de upload | `MAX_UPLOAD` em `server/comments.js`, `/boot` e `/state` em `server/api.js`, e a recusa do cliente em `ticket.js`: o número aparece nos três |
| Login, sessão, senha | `server/auth.js` e `httpsAtivo()` em `server/api.js` — o `Secure` do cookie nunca é escrito à mão |
| Transação, escrita em lote | os comentários de `tx()` em `server/db.js` |
| Qualquer coisa do produto | `docs/PRODUCT.md`: decisões que parecem arbitrárias e não são |

## Antes de dizer que terminou

1. **Rode a suíte.** É o único comando de teste que existe.
2. **Reproduza antes de acreditar.** Nenhum apontamento vira correção sem você
   rodar o caso — a maioria dos que parecem graves não sobrevive à reprodução.
3. **Leia `OPEN_POINTS.md` seções 10.2 e 10.3 antes de apresentar achado.** A
   10.2 são recusas conscientes por custo-benefício, não esquecimentos; a 10.3
   são suspeitas já levantadas e ainda não verificadas.
4. **Teste pelo protocolo, não pela tela**, quando der: `fetch` por Node valida
   login, escrita e cabeçalho sem depender do navegador. `curl` no shell do
   Windows corrompe acentuação em JSON.
5. **Depois de trabalho em paralelo, revise as junções.** O defeito mais caro
   deste projeto sempre apareceu entre dois arquivos que ninguém olhava junto.

## Commits

Assunto em português, terceira pessoa do presente, **sem acentuação** e sem
prefixo do tipo `fix:`. O corpo explica a causa, o que foi reproduzido e o que
foi refutado — não a lista de arquivos, que o diff já mostra.

```
Impede o ciclo de tarefas que travava o servidor inteiro
```
