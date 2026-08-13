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

O ciano gelo é a **cor de ação** da interface: foco, seleção, botão principal,
estado "Fazendo". Ela é reservada para isso. Espalhá-la por elementos decorativos
tiraria dela justamente a função de dizer "é aqui".

O fundo reproduz o gradiente diagonal da própria logo.

## Cores de estado

Dessaturadas de propósito.

| Estado | Cor |
|---|---|
| Entrada | `#8fa9b5` névoa |
| A fazer | `#6b9fc9` azul-aço |
| Fazendo | `#a2e4f0` ciano da marca |
| Esperando | `#e3b877` âmbar suave |
| Feito | `#7fc8a9` verde-menta |
| Atenção | `#e88b7d` coral |

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
