# Identidade visual

A estética vem da marca da Logus Soluções em Automação. Nenhuma cor foi
escolhida por gosto: todas foram extraídas dos arquivos de marca em
[`assets/brand/`](../assets/brand) e estão declaradas em
[`web/css/tokens.css`](../web/css/tokens.css).

## O que a marca já dizia

Os três arquivos fornecidos são variações da mesma assinatura:

| Arquivo | Uso |
|---|---|
| `logo-navy.png` | Assinatura em azul institucional sobre fundo claro |
| `logo-dark-bg.png` | Versão clara sobre gradiente azul profundo |
| `logo-ice.png` | Versão em ciano gelo sobre fundo transparente |

Três características saltam e foram levadas para a interface:

1. **Tipografia geométrica** em caixa alta, com traço fino e círculos quase
   perfeitos no O, G e U.
2. **Espacejamento largo** entre letras, tanto no nome quanto na assinatura.
3. **Contraste alto entre azul profundo e ciano claro**, com a marca vivendo
   naturalmente sobre fundo escuro.

Por isso o tema escuro é o padrão: é onde a marca já morava.

## Cores

Valores extraídos por leitura direta dos pixels dos arquivos.

| Papel | Valor | Origem |
|---|---|---|
| Azul institucional | `#081468` | Assinatura sobre branco |
| Ciano gelo | `#a2e4f0` | O "L" e o símbolo |
| Cinza gelo | `#b4d2d8` | O lettering sobre fundo escuro |
| Azul profundo | `#033552` | Topo do gradiente de fundo |
| Quase preto | `#020515` | Base do gradiente de fundo |

O ciano gelo é a **cor de ação** da interface, e vale para **três** papéis:
a ação primária (o botão que a tela quer que se clique), o foco de teclado e a
resposta imediata à interação — o que está sob o cursor agora, e o que acabou
de ser salvo.

O que separa os três de tudo o mais é que **nenhum deles fica ligado sozinho na
tela**. O acento chega quando o cursor chega e sai quando ele sai; aparece
quando o servidor confirma e some meio segundo depois. É por isso que ele
continua dizendo "é aqui" mesmo aparecendo com frequência: nunca há dois
acentos acesos disputando a mesma atenção.

Estado **persistente** continua sem acento — item selecionado, filtro ligado,
título de coluna, coluna alvo de arraste. Se o que está ligado e o que está sob
o cursor brilhassem igual, o brilho pararia de informar qual dos dois é qual.

Duas versões atrás este parágrafo dava a ela quatro papéis — ação, foco,
seleção e o estado "Fazendo" — e o código foi ainda mais longe: os cinco
títulos de coluna, o item de navegação ativo, o filtro ligado, a coluna alvo
de arraste, os rótulos em versalete, as setas decorativas e o herói da tela
inicial diziam "é aqui" ao mesmo tempo. Quando tudo diz "é aqui", nenhum diz.
Espalhá-la por elemento decorativo tira dela justamente a função que ela tem.

A correção foi longe demais na direção oposta: sobrou tão pouco acento que a
interface parou de responder a quem a usa. Passar o mouse não devolvia nada, e
mover um cartão de coluna não confirmava que o servidor tinha recebido. Daí o
terceiro papel — que não desfaz a regra, e sim a completa: **o acento é
momentâneo**. Ele responde e sai. O que ele nunca faz é ficar.

O que sobrou de fora do acento é resolvido por três mecanismos que já
existiam e eram subusados: **superfície** (`--surface-3` para hover,
`--surface-4` mais um traço interno para selecionado), **contorno**
(`--border-strong`, tracejado onde é área de soltura, `currentColor` onde o
elemento já tem cor própria) e **peso ou sublinhado**. Link nunca se
distingue só pela cor: leva sublinhado junto, que é o mínimo da WCAG 1.4.1.

A única exceção é a marca. No glifo `.mark`, no favicon e na tela de entrada
o ciano aparece cheio, porque ali "decorativo" e "identidade" são a mesma
coisa.

O fundo reproduz o gradiente diagonal da própria logo.

## Cores de estado

Dessaturadas de propósito.

| Estado | Cor |
|---|---|
| Entrada | `#8fa9b5` névoa |
| A fazer | `#6b9fc9` azul-aço |
| Fazendo | `#6aa7b9` ciano assentado |
| Esperando | `#e3b877` âmbar suave |
| Feito | `#7fc8a9` verde-menta |
| Atenção | `#e88b7d` coral |

"Fazendo" era o ciano da marca, bit a bit igual à cor de ação — e como
título de coluna ele competia com o botão principal e com o item de navegação
ativo. O valor de hoje é 65% do gelo da marca com 35% do azul profundo dela:
mesma família de matiz (194 contra 189), saturação de 72% para 36%,
luminosidade de 79% para 57%. Deixa de ser fonte de luz e entra na família
dessaturada que esta seção promete.

No tema claro, "Esperando" era `#a1701f` e dava 4,04:1 sobre o fundo quase
branco — reprovando AA como título de coluna. Passou a `#8a5e14`, que dá
5,31:1 com o matiz praticamente intacto (37,4° contra 37,6°).

Um painel que grita em vermelho e verde vira ruído e destrói a hierarquia. O
coral de atenção aparece pouco: se tudo é urgente, nada é. E vermelho puro nunca
aparece em prazo vencido — atraso não é fracasso.

## Tipografia

**Títulos e marca** usam a pilha geométrica que acompanha a logo:

```
"Century Gothic", "Questrial", "Jost", "Futura", "Trebuchet MS", system-ui
```

**Corpo de texto** usa a fonte do sistema:

```
"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, ...
```

A separação é intencional. Geométrica pura em texto corrido cansa a leitura, e
legibilidade vence estética no conteúdo. A marca aparece nos títulos, nos
rótulos de seção e no modo foco; o resto é lido, não admirado.

O corpo é 15px, um pouco maior que o padrão comum de 14px — leitura confortável
é requisito de acessibilidade aqui, não preferência.

Nenhuma fonte é baixada de servidor externo. O produto funciona numa rede sem
internet.

## O símbolo

[`web/img/mark.svg`](../web/img/mark.svg) reduz a assinatura ao seu gesto: a
barra superior estendida e a haste em L. É desenhado com `currentColor`, então
acompanha o tema, e é aplicado como máscara CSS.

## Temas

**Escuro** é o padrão, por ser a cara da marca.

**Claro** existe porque sensibilidade a contraste varia muito entre pessoas — e
num produto voltado a conforto cognitivo, obrigar alguém a um tema é
contraditório. No tema claro a cor de ação passa a `#0d5f7d`, para garantir
contraste suficiente sobre fundo branco.

**Modo calmo** é o terceiro estado: remove o gradiente, achata as sombras,
reduz a saturação em 55% e zera as animações. Para os dias em que qualquer
estímulo a mais atrapalha.

## Movimento

Transições entre 90ms e 260ms. Rápido de propósito: atraso percebido quebra o
fio.

A única animação com alguma presença é o pulso de conclusão, com 620ms. Toda
animação é desligada quando o sistema pede movimento reduzido, e também no modo
calmo.

**Profundidade do trilho.** O quadro é um trilho horizontal de cenas, e a cena
ao lado da que está aberta não fica desligada: fica ao fundo. Isso é dito por
opacidade (`--cena-perto`, `--cena-longe`), não por `filter` — filter cria
bloco de contenção, e o modo calmo já aplica `saturate(0.45)` no `body`; dois
filtros compostos ficam imprevisíveis. Opacidade também é a única propriedade
barata de mexer a cada quadro durante um arrasto.

No modo calmo a lâmina vizinha **afunda mais**, e não menos: o propósito do
modo é ter menos coisa competindo pela atenção. E o deslizamento entre cenas
lê a duração de `--dur-slow` a cada movimento, nunca de um número cravado no
JavaScript — é assim que `prefers-reduced-motion` e o modo calmo valem de
graça para um movimento que não é CSS.
