# TDAH Jira — Logus

Um gerenciador de tarefas com a simplicidade de uma planilha e a rastreabilidade
de um issue tracker.

A ideia nasceu de um incômodo concreto: a planilha do Sheets é fácil de usar mas
não sabe dizer onde cada coisa está nem como chegou lá; o Jira sabe, mas cobra
por isso um preço alto demais em campos, telas de configuração e cerimônia. Este
projeto fica no meio: quase nada para preencher, e mesmo assim história completa
de cada tarefa.

O público-alvo é específico — pessoas com TDAH que executam muito bem quando o
trabalho está claramente colocado. Isso não é um detalhe de marketing: é o que
determina cada decisão de interface descrita em [docs/PRODUCT.md](docs/PRODUCT.md).

---

## O que ele faz

**Quatro visões sobre os mesmos dados.** Nenhuma delas é uma cópia: são lentes
diferentes sobre a mesma tabela.

| Visão | Para quê |
|---|---|
| **Hoje** | Responde "o que eu faço agora" logo na abertura, com uma tarefa em destaque e a explicação de por que ela está no topo |
| **Quadro** | Cinco colunas, arrastar para mudar de estado, limite visível de trabalho simultâneo |
| **Planilha** | Tabela editável célula a célula, com filtros prontos e exportação em CSV |
| **Fluxo** | Onde está cada coisa e há quanto tempo está lá, com a atividade recente do time |

**Modo foco.** Uma tarefa por vez em tela cheia, com cronômetro. Quando o tempo
acaba o relógio continua contando para cima em vez de alarmar: quem está embalado
não deve ser interrompido.

**Conversa no ticket.** Comentários com menção por `@usuario` e anexos. Um print
pode ser colado direto com `Ctrl+V` — o caminho mais curto entre ver o problema e
registrar o problema. O rascunho fica salvo enquanto se digita.

**Trilha automática.** Toda mudança vira uma linha num log que nunca é editado.
Quem mudou, o que mudou, quando. Ninguém precisa preencher nada para isso
acontecer.

**Captura em uma linha.** Uma frase vira uma tarefa completa:

```
Ligar para o fornecedor #COM @bruno !agora ~2 amanhã
```

`#` projeto · `@` responsável · `!` prioridade · `*` energia · `~` blocos de 25 min
· `+` etiqueta · e datas soltas como `hoje`, `sexta`, `21/08`.

---

## Como rodar

Só é preciso ter o **Node.js 22.5 ou mais novo**. Não há dependências para
instalar, nem banco para subir, nem etapa de compilação.

```bash
git clone https://github.com/<usuario>/TDAHJira-Logus-Automacao.git
cd TDAHJira-Logus-Automacao
node server/index.js
```

Na primeira execução a instância é criada e a senha aparece uma única vez no
terminal. Anote: ela não é mostrada de novo.

Para experimentar com conteúdo dentro, em vez de uma tela vazia:

```bash
node server/index.js --demo
node server/index.js
```

O endereço aparece no terminal, incluindo o IP da rede local — é assim que as
outras pessoas do time entram, cada uma do seu computador, sem nada exposto na
internet.

Também funciona como **plugin de WordPress**: basta clonar o repositório dentro
de `wp-content/plugins/` e ativar. Os dois modos compartilham o mesmo front-end e
o mesmo contrato de API. Os detalhes de cada caminho estão em
[docs/INSTALL.md](docs/INSTALL.md).

---

## Atalhos

| Tecla | Ação |
|---|---|
| `n` | Nova tarefa |
| `f` | Focar na primeira da fila |
| `/` ou `Ctrl+K` | Buscar e comandos |
| `1` `2` `3` `4` | Hoje, Quadro, Planilha, Fluxo |
| `Esc` | Fecha o que estiver aberto |
| `?` | Lembrete dos atalhos |

---

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/RESEARCH.md](docs/RESEARCH.md) | O levantamento que originou o produto: 51 ferramentas analisadas, o que foi aproveitado de cada uma e o que foi recusado |
| [docs/PRODUCT.md](docs/PRODUCT.md) | As decisões de produto e por que cada uma foi tomada |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Como o mesmo código atende aos dois modos de execução |
| [docs/API.md](docs/API.md) | O contrato que os dois backends implementam |
| [docs/INSTALL.md](docs/INSTALL.md) | Instalação nos dois modos |
| [docs/BRAND.md](docs/BRAND.md) | A identidade visual e de onde vem cada cor |
| [OPEN_POINTS.md](OPEN_POINTS.md) | O que ficou em aberto depois da V1 |

---

## Estado atual

V1 completa e funcional no modo autônomo, testada de ponta a ponta. O modo
plugin de WordPress está implementado sobre o mesmo contrato, mas ainda não foi
executado num WordPress real — isso está registrado com todas as letras em
[OPEN_POINTS.md](OPEN_POINTS.md).

## Licença

MIT. Veja [LICENSE](LICENSE).
