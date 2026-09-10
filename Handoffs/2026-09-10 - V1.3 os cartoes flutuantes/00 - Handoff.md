# Handoff — v1.3, os cartões flutuantes

De 8 a 10 de setembro de 2026. Vinte e um commits, do `54798dd` ao `e88e399`.
Produção em `v1.3.21`, verificada a cada publicação.

Este documento é para quem pegar o projeto sem ter acompanhado esta série. O que
mudou, por que mudou, e o que ficou aberto. Os detalhes de cada defeito estão em
`OPEN_POINTS.md`, seções 16, 17 e 18 — aqui está o mapa.

---

## 1. O que a série mudou

A tela principal deixou de ser um quadro. Virou uma **pilha de painéis
flutuantes**: as empresas à esquerda, as pessoas à direita, "todos os negócios"
sempre no centro. Toda cena é o mesmo quadro montado igual — só a escala e a
posição mudam. Arrastar o fundo desliza a pilha.

Três outras coisas entraram junto:

- **Mais de um responsável por tarefa.** Tabela `task_assignees`, com posição.
- **Rótulo de versão no rodapé** que também limpa o cache e recarrega.
- **Ciano vivo** nas três peças que respondem "onde eu estou".

---

## 2. O que você precisa saber antes de mexer no trilho

`web/js/views/quadro.js` é o arquivo mais delicado do projeto. Cinco coisas nele
não são óbvias e cada uma custou uma rodada de depuração:

### 2.1 Toda cena é o mesmo quadro

A versão anterior montava o quadro só no centro e cartões pequenos nos lados.
Parecia mais barato e era pior: o painel trocava de estrutura e de largura no
meio do gesto, o que aparecia como um estalo de formato a cada troca de cena.
Montando todas iguais, mover é só transformar — e transformar é a única coisa
que a placa de vídeo faz sozinha.

### 2.2 O gesto vive fora do DOM e fora do `state`

`mount()` destrói `#view` inteiro a cada `emit()` e a cada tique de seis
segundos. Nada que viva como propriedade de um nó antigo sobrevive. Por isso
`posicao`, `gesto`, `cenasEl` e companhia são variáveis de módulo.

E por isso existe `carrosselOcupado()`: enquanto o gesto está em curso o
redesenho fica represado. A trava é de **inatividade**, renovada a cada
movimento — um `pointerup` perdido (janela sem foco, ponteiro fora da tela)
nunca congela a tela.

### 2.3 `posicionarTrilho()` é síncrono, e tem de ser

Ele é chamado por `app.js` logo depois do `mount()`. Era um
`requestAnimationFrame` e o quadro de atraso era visível: entre o mount e o
quadro seguinte, as cenas ficavam no documento **sem transform nenhum**, todas
empilhadas na âncora de `left: 50%`. Como o mount acontece a cada movimento de
cartão, isso aparecia como um tremor na tela inteira.

### 2.4 O lado de uma cena vem de `aplicarLayout()`, não do render

`d.lado` diz o lado na **fileira** (empresas antes do centro, pessoas depois).
Isso deixa de ser o lado na **tela** assim que alguém navega para uma cena que
não é a geral. O atributo `data-lado` sai do mesmo `Math.sign` que decide para
que lado a cena se desloca, e é ele que o CSS usa.

### 2.5 A duração do movimento escala com a distância

`--dur-trilho` no CSS diz quanto vale UMA cena. `deslizarAte()` escreve no nó
quanto vale ESTA viagem, pela raiz da distância. Duração fixa fazia dez pixels
levarem meio segundo — parado o suficiente para ninguém ver que andou.

---

## 3. O modelo de dados que mudou

### `task_assignees`

```sql
CREATE TABLE IF NOT EXISTS task_assignees (
  task_id  INTEGER NOT NULL REFERENCES tasks(id)  ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  position REAL    NOT NULL DEFAULT 0,
  PRIMARY KEY (task_id, user_id)
);
```

**`tasks.assignee_id` continua existindo** e guarda o primeiro da lista. Não é
uma segunda verdade porque **quem escreve é uma função só**,
`gravarResponsaveis()`, que mexe na tabela e na coluna no mesmo lugar. Foi por
isso que `assigneeId` saiu de `FIELDS` em `server/tasks.js`: o laço genérico de
campos também escreveria a coluna.

O teste `conferirAcordo()` em `tests/responsaveis.test.js` vigia essa junta.

### O contrato de entrada tem três formas

- `assigneeIds` ausente → o patch não fala de responsável, não mexe em ninguém
- `assigneeIds: []` → tire todos
- `assigneeId: 5` → substitui a lista inteira por `[5]`

A diferença entre as duas primeiras é o que impede uma mudança de prazo de
esvaziar a tarefa.

### Tabela nova cabe no esquema; coluna nova, não

O esquema roda inteiro **antes** de `MIGRACOES`, e `CREATE TABLE IF NOT EXISTS`
não depende de nada que nasça depois. A regra que derrubou a produção em 8 de
setembro é sobre índice em **coluna** migrada, e continua valendo.

O que a tabela nova precisou foi a cópia inicial: todo banco em uso tem
responsável em `assignee_id` e a tabela nasce vazia. `povoarResponsaveis()` em
`server/db.js` roda em toda subida — `INSERT OR IGNORE` faz a segunda passagem
não escrever nada.

---

## 4. O rótulo de versão

`v1.3.21` no rodapé da barra lateral. Clicar abre a linha do tempo do
repositório e, no mesmo gesto:

1. pergunta ao servidor o commit atual, sem passar pelo cache
2. apaga o Cache Storage e desregistra service workers
3. rebusca cada arquivo que a página carregou com `cache: "reload"`
4. recarrega

**Recarrega sempre**, e não só quando o commit mudou. Houve uma versão que só
recarregava na diferença, e ela errava no caso mais comum: commit novo,
JavaScript novo e CSS velho, porque a borda da hospedagem serviu o arquivo
antigo por mais alguns segundos depois do deploy.

### De onde vem o número

`SERIES` em `server/versao.js` diz onde cada série começa, em **número de
commit**:

| série | commit | o que mudou |
| --- | --- | --- |
| 1.3 | 39 | os cartões flutuantes |
| 1.2 | 24 | empresa como dimensão própria |
| 1.0 | 1 | o começo |

A chave é o número, e não o identificador, porque é o número que os dois modos
sabem calcular sem consulta extra: no autônomo sai de `git rev-list --count`, no
hospedado sai da paginação do GitHub (uma página de UM commit; o número da
última página é o total).

Ao subir de série, mexa em **dois lugares**: `SERIES` e o `version` do
`package.json`. O segundo virou rede e conferência — se discordarem, alguém
esqueceu de um.

---

## 5. O que fazer se algo quebrar

### O trilho não aparece / as cenas ficam empilhadas no centro

`posicionarTrilho()` não rodou. Confira que `app.js` a chama **sincronamente**
depois do `mount()`, e que `.trilho` existe no documento.

### A tela treme a cada movimento de cartão

Mesma causa. Era um `requestAnimationFrame` e voltou a ser.

### O gesto do trilho morre

`medidas()` mudou de forma e `aoMover()` continuou desestruturando o formato
antigo. Aconteceu uma vez e não deu erro nenhum no console.

### O painel de versão abre vazio no modo hospedado

A API do GitHub sem credencial dá sessenta chamadas por hora **por endereço**, e
o endereço é o da plataforma, compartilhado. O cache de cinco minutos existe
para isso. Se persistir, `GIT_REPO` pode ser definido à mão nas variáveis.

### Depois de um deploy, a tela está velha

Clique no rótulo de versão. É exatamente para isso que ele existe.

---

## 6. A armadilha do ambiente de medição

Vale para quem for depurar isto com um agente ou com o DevTools fechado:

**Aba em segundo plano não avança animação.** `requestAnimationFrame` fica
suspenso e o compositor não interpola. Duas vezes nesta série concluí que uma
transição não existia quando ela existia — o que faltava era um quadro pintado.

Como medir de verdade: `getAnimations()` devolve a transição criada e sua
duração sem depender de o compositor ter avançado. `document.getAnimations()` e
`el.getAnimations()` foram a única forma confiável.

`setTimeout` em aba de fundo é limitado a um segundo. Qualquer medição de tempo
feita assim está distorcida.

---

## 7. O que ficou aberto

- **A rolagem horizontal ainda aparece em tela estreita.** É correto — mas o
  mínimo de coluna (200 px) foi escolhido para caber cinco etapas em pouco mais
  de mil pixels. Se um dia houver mais etapas, revisar.
- **O blur do painel de trás é fixo em 3,5 px.** Escalar com a distância seria
  mais bonito e caro: `filter` não é composto pela placa de vídeo, e animá-lo a
  cada quadro do arrasto pesaria.
- **A numeração de versão depende da posição do commit.** Rebase ou squash
  mudam os números. Aceitável neste projeto; documentado aqui para não ser
  surpresa.
- **`--espia` é fixo em 214 px** (116 na media query estreita). Em tela muito
  larga sobra faixa; em tela muito estreita a espiada some. Nunca incomodou.

---

## 8. Onde está cada coisa

| O quê | Onde |
| --- | --- |
| O trilho, o gesto, o layout da pilha | `web/js/views/quadro.js` |
| A fileira de cenas e o escopo de cada uma | `web/js/store.js`, `escoposDoCarrossel()` |
| Quem faz, no servidor | `server/tasks.js`, `gravarResponsaveis()` |
| A tabela de responsáveis | `core/schema.sql` |
| A cópia inicial dos responsáveis | `server/db.js`, `povoarResponsaveis()` |
| Versão, linha do tempo e séries | `server/versao.js` |
| O rótulo, o painel e o limpa-cache | `web/js/versao.js` |
| Tokens de cor, sombra e duração | `web/css/tokens.css` |
| O trilho, o véu e os cartões, em CSS | `web/css/app.css` |
| Cada defeito desta série, contado | `OPEN_POINTS.md`, seções 16 a 18 |

---

## 9. Estado ao fechar

- Produção em `v1.3.21`, respondendo 200.
- 125 testes automatizados passando, 12 deles novos (responsáveis múltiplos).
- Nenhuma credencial, nome real ou assinatura no repositório.
- Toda publicação desta série foi verificada em produção antes de seguir.
