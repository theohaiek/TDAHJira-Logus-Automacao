# Decisões de produto

Este documento explica **por que** o produto é como é. A pesquisa que embasa
cada escolha está em [RESEARCH.md](RESEARCH.md).

## O problema

Uma planilha de tarefas é fácil de usar e não responde a pergunta mais
importante depois de duas semanas: onde isso está, e desde quando. Um issue
tracker responde, mas cobra por isso um preço em campos obrigatórios, esquemas
de fluxo e telas de configuração — e esse preço é pago a cada tarefa criada, por
todo mundo, para sempre.

O objetivo é a interseção: quase nada para preencher, história completa mesmo
assim.

## Para quem

Pessoas com TDAH que **executam muito bem quando o trabalho está claramente
colocado**. A parte difícil não é fazer; é decidir o que fazer, lembrar do que
existe e retomar depois de uma interrupção.

Isso muda o que a ferramenta precisa ser. Ela não é um painel de controle para
quem supervisiona: é um apoio de memória e de decisão para quem executa.

## Os dez princípios

### 1. A tela inicial responde "o que eu faço agora"

A abertura não é um quadro com tudo o que existe — ver tudo o que existe é
exatamente o que trava. É **uma** tarefa em destaque, com o próximo passo dela e
uma frase explicando por que ela está no topo.

A explicação importa: sem ela, a ordenação vira caixa-preta, e caixa-preta gera
desconfiança e reordenação manual.

### 2. Criar custa uma linha

Só o título é obrigatório. Nunca haverá um segundo campo obrigatório.

O custo de registrar precisa ser menor do que o custo de segurar na cabeça — se
não for, nada é registrado e a ferramenta fica pela metade. Por isso a captura
aceita tudo numa frase só:

```
Ligar para o fornecedor #COM @bruno !agora ~2 amanhã
```

### 3. O próximo passo é a unidade de trabalho

Toda tarefa pode ser quebrada em passos, e o primeiro passo pendente aparece no
cartão, na tela inicial e no modo foco.

Encarar "o próximo passo" é muito mais fácil do que encarar "a tarefa". A
iniciação é o gargalo, não a intenção.

### 4. Estimativa em blocos, nunca em horas

Perguntar "quantas horas isso leva" pede uma precisão que ninguém tem — e a
estimativa numérica erra por fator alto e sistemático em quem tem dificuldade
com noção de tempo. Perguntar "cabe em quantos blocos de 25 minutos" pede uma
comparação, que é bem mais fácil de acertar.

O campo de **energia** (leve, média, pesada) existe pelo mesmo motivo: às vezes
não falta tempo, falta energia, e escolher pela capacidade do momento é mais
realista do que escolher pela urgência.

### 5. Atraso não é fracasso

Nenhum vermelho agressivo, nenhuma palavra "atrasado", nenhuma sequência que
zera. Prazo vencido aparece como `era ontem` ou `3 dias atrás`, em tom neutro.

O item atrasado em vermelho é o gatilho clássico de vergonha que faz abandonar a
ferramenta — e uma ferramenta abandonada não rastreia nada. Tirar do foco de hoje
custa um clique e não pede justificativa.

### 6. Prioridade tem nome humano

`Agora`, `Normal`, `Quando der`. Não existe P1 a P5, não existe story point.

Uma escala numérica sem referência externa faz tudo virar prioridade máxima em
duas semanas.

### 7. O limite de trabalho simultâneo avisa, não bloqueia

O indicador de tarefas em andamento muda de cor ao passar do limite, e a frase
que aparece é "terminar uma rende mais do que começar outra".

Impedir alguém de começar algo é uma briga que a ferramenta perde. Mostrar que
já há três coisas abertas costuma bastar.

### 8. Concluir devolve alguma coisa

Marcar como feito dispara um pulso de luz de meio segundo. Sem som, sem confete
barulhento, sem pontuação, sem ranking.

Fechar uma tarefa precisa devolver algo — não devolve nada quando o item apenas
some da lista. Mas recompensa que interrompe deixa de ser recompensa.

### 9. A história se escreve sozinha

Nenhum campo de apontamento, nenhuma justificativa de transição. Toda mudança
vira uma linha num log que nunca é editado, e a visão **Fluxo** mostra onde está
cada coisa e há quanto tempo.

É a rastreabilidade do issue tracker sem o formulário dele.

### 10. Sempre há uma saída para a paralisia

Quando a paralisia é na escolha e não na execução, o botão **Escolhe por mim**
sorteia uma tarefa elegível, com peso maior para as leves.

Qualquer tarefa começada rende mais do que a melhor tarefa não começada.

---

## Os cinco estados

| Estado | Pergunta que responde |
|---|---|
| **Entrada** | Capturei e ainda não decidi o que fazer com isso |
| **A fazer** | Decidi que vai ser feito |
| **Fazendo** | Estou trabalhando nisso agora |
| **Esperando** | Não depende de mim — e o campo diz de quem depende |
| **Feito** | Acabou |

Cinco e não mais. Cada estado adicional é uma decisão a mais a cada movimento de
cartão, e a soma dessas decisões é o que torna um quadro cansativo de manter.

Não existe tela de configuração de fluxo, nem transições permitidas, nem
esquemas por projeto. Essa configurabilidade é justamente a cerimônia que se
quis evitar.

**Sobre "Esperando":** a pesquisa recomenda tratar bloqueio como uma marca
sobreposta ao estado atual, e não como coluna, porque uma coluna de espera
polui a medição de tempo da etapa real. A recomendação é tecnicamente correta e
foi recusada de propósito: para este público, ver uma coluna "Esperando" no
quadro responde "onde está isso" em meio segundo, e a métrica que a mudança
protegeria não é calculada na V1. A alternativa está registrada em
[OPEN_POINTS.md](../OPEN_POINTS.md).

## Os três quadros laterais

A tela inicial tem uma coluna larga, que responde "o que eu faço agora", e
uma coluna estreita à direita com três quadros pequenos, nesta ordem:

| Quadro | O que guarda |
|---|---|
| **Validade longa** | O que não vence e não tem pressa, mas não pode se perder |
| **Oportunidades** | O que ainda não é tarefa: algo que pode valer a pena |
| **Metas longas** | Para onde tudo isso está indo |

Eles existem porque essas três coisas costumam acabar no mesmo lugar errado:
ou viram tarefa na fila do dia, onde envelhecem e pesam, ou ficam só na
cabeça, onde somem. Um quadro pequeno e sempre visível resolve os dois
problemas sem competir com o trabalho do dia.

Três regras mantêm os quadros no lugar deles:

1. **Ficam fora do fluxo.** Um item de quadro não entra em "o que faço agora",
   não aparece no quadro de colunas nem na planilha sem filtro. Ele só vira
   trabalho quando alguém troca o tipo dele para tarefa.
2. **São menores de propósito.** Cada quadro mostra no máximo cinco itens; o
   resto fica atrás de um "ver na planilha". Quadro lateral que cresce vira um
   segundo backlog, e é isso que se quer evitar.
3. **Uma fonte, várias lentes.** Item de quadro é a mesma tarefa, com o campo
   tipo diferente. Mover uma oportunidade para o fluxo do dia é trocar o tipo,
   e a troca fica na trilha como qualquer outra mudança.

Na captura rápida, `^longa`, `^oport` e `^meta` mandam o item direto para o
quadro certo. No ticket, o tipo é a primeira linha dos detalhes.

---

## O que foi deliberadamente deixado de fora

| Recusado | Por quê |
|---|---|
| Esquemas de fluxo, de campo, de tela e de permissão | É a maior fonte de complexidade do Jira e não entrega nada a um time de três pessoas |
| Campo de resolução separado do estado | Cria a classe inteira de bug "concluído mas não resolvido" |
| Story points e velocidade | Precisão fingida sobre estimativa que ninguém acerta |
| Sprints e cerimônias ágeis | O time não trabalha assim; a ferramenta não deveria obrigar |
| Editor de texto rico nos comentários | O que se quer ali é registrar decisão e contexto, não diagramar |
| Notificação por e-mail | Mais uma caixa de entrada para administrar. Registrado como ponto em aberto |
| Papéis granulares | Existem dois níveis: administrador e membro |
| Backlog infinito rolável | Lista longa e indiferenciada paralisa; a tela inicial mostra poucos itens de propósito |

---

## Duas decisões que valem ser explicadas

**Por que a tela inicial não é o quadro.** O quadro mostra tudo o que existe.
Para quem se paralisa diante de volume, abrir no quadro é começar o dia pelo
pior lugar possível. O quadro continua a um clique — ele é ótimo para entender o
todo, e ruim para começar.

**Por que o cronômetro conta para cima depois do fim.** Alarme que encerra
interrompe quem está rendendo — e hiperfoco é o ativo mais valioso deste público.
O relógio vira `+03:12` e a frase muda para "se ainda está rendendo, siga". A
ferramenta é um cronômetro, não um chefe.
