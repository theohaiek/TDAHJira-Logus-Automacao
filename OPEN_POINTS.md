# Pontos em aberto

O que ficou de fora da V1, o que ficou por decidir e o que foi decidido de um
jeito que talvez valha rever. Nada aqui impede o uso do produto hoje.

Cada item tem o motivo de estar em aberto, para que a decisão possa ser tomada
depois sem precisar reconstruir o raciocínio.

---

## 1. Dúvidas do pedido original que resolvi por conta própria

Foram resolvidas para não travar a entrega. Todas podem ser revertidas.

### 1.1 Hospedagem

Decidido: **Vercel**, por ser ferramenta interna da Logus e não haver
infraestrutura própria da empresa para usar.

Dois modos existem, e ambos funcionam sobre o mesmo contrato:

- **Autônomo** — roda sem nada além do Node. Serve para desenvolvimento e para
  uso interno na rede local.
- **Vercel** — publicado e em uso, com banco no Turso e anexos no Vercel Blob
  privado. É o modo de trabalho do time.

**Descartado de propósito:** hospedar na VPS ou no MySQL da clínica. É
infraestrutura de outra empresa, e misturar os dados criaria uma dependência
que ninguém quer administrar depois.

### 1.2 Node, e apenas Node

O pedido original citava compatibilidade com plugin de WordPress. Isso foi
implementado e depois removido a pedido: o produto é ferramenta interna da
Logus e não há motivo para carregar um segundo backend em PHP, com o dobro de
superfície para manter e testar.

O histórico do repositório preserva a implementação, caso um dia faça sentido.

### 1.3 Nomes reais fora do repositório

Os dados de exemplo usam nomes fictícios (Ana, Bruno, Carla). O repositório é
público, e não faz sentido publicar quem é do time nem nome de cliente. As
contas de verdade são criadas na instalação — veja [docs/INSTALL.md](docs/INSTALL.md).

### 1.4 Nome do repositório

Ficou `TDAHJira-Logus-Automacao`, como pedido. Se for renomeado, o único lugar
que precisa acompanhar são os endereços de clone no README e no INSTALL.

---

## 2. Riscos conhecidos

### 2.1 O modo autônomo escuta em todas as interfaces

É o que permite que as outras pessoas entrem pela rede local. Se a máquina tiver
endereço público, isso expõe o serviço na internet.

**Mitigação hoje:** firewall, ou `--host 127.0.0.1` para restringir à própria
máquina. Não há HTTPS embutido; o cookie de sessão só recebe o atributo `Secure`
quando a conexão já chega cifrada por um proxy à frente.

### 2.2 O plano Hobby restringe uso comercial

O deploy foi executado e validado de ponta a ponta: banco hospedado, criação
de tarefa, comentário, anexo enviado e devolvido byte a byte idêntico, e
recusa de acesso sem sessão.

O que fica em aberto é contratual, não técnico: o plano Hobby da Vercel
restringe uso comercial, e uma ferramenta interna de empresa se enquadra. A
decisão de assumir esse risco foi consciente; migrar para Pro é um clique e
não exige novo deploy.


---

## 3. Decisões que contrariam a pesquisa

Registradas porque a pesquisa está no repositório e a divergência precisa ser
explícita.

### 3.1 "Esperando" é uma coluna, não uma marca sobreposta

A pesquisa recomenda tratar bloqueio como uma marca sobre o estado atual, com
data de início, e não como coluna — porque uma coluna de espera polui a medição
de tempo da etapa real, e ao desbloquear a tarefa não sabe para onde voltar.

**A recomendação foi recusada de propósito.** Para este público, ver uma coluna
"Esperando" responde "onde está isso" em meio segundo, e a métrica que a mudança
protegeria (tempo de ciclo por etapa) não é calculada na V1.

**Reveja se:** o time começar a olhar tempo de ciclo, ou se aparecer confusão
sobre para onde uma tarefa volta ao ser desbloqueada.

### 3.2 Prioridade continua sendo um campo

A pesquisa recomenda eliminar o campo e usar a posição na fila como prioridade
(modelo do Pivotal Tracker), para eliminar uma decisão por tarefa.

**Mantido como campo**, com três níveis de nome humano (Agora, Normal, Quando
der). Ordem manual pura exige arrastar tudo para expressar urgência, o que é
mais trabalhoso do que escolher entre três opções.

### 3.3 O cronômetro entrou na V1

A pesquisa colocava timer e controle de tempo fora da V1. Entrou assim mesmo:
o modo foco sem relógio perde a função de conter a cegueira temporal, que é
justamente o motivo de ele existir.

---

## 4. O que a pesquisa recomendou e ainda não foi feito

Em ordem aproximada de valor por esforço.

| Ideia | Origem | Por que vale |
|---|---|---|
| Miniatura do primeiro anexo no cartão | Planka, Gitea | Um print visível no quadro entrega contexto em meio segundo |
| Navegação anterior/próximo dentro do ticket | Trello, Plane, Baserow | Revisar uma fila em sequência sem fechar e reabrir |
| Pinos numerados sobre a imagem anexada | NocoDB | "Esse botão aqui" é mais barato que descrever em texto |
| Reações de emoji no comentário | GitLab, Linear, Gitea | Reconhecer sem gerar mais um item de "responder depois" |
| Resolver um comentário sem fechar a tarefa | GitLab, Linear | Separa "dúvida respondida" de "tarefa acabou" |
| Lixeira com desfazer para tarefa e comentário | Baserow | Reduz o medo de quebrar algo, que trava antes da ação |
| Capacidade calculada da semana | Pivotal Tracker, Amazing Marvin | Tira a ansiedade de estimar quanto cabe |
| Comparação "o que mudou desde ontem" | OpenProject (Baseline) | O log de eventos já tem tudo o que isso precisa |
| Vínculo "bloqueado por" entre tarefas | Redmine, Jira | Dependência é dado estrutural, hoje só existe como texto |
| Edição em massa na planilha | Baserow, NocoDB | Seleção múltipla e mudança de estado de uma vez |
| Intenção de implementação | Leantime | Tarefa + gatilho de tempo + primeiro passo, na tela inicial |

---

## 5. Funcionalidades adiadas por escopo

- **Notificações.** Nenhuma, de nenhum tipo. A crítica da pesquisa apontou que
  este é o maior vazio: a tela inicial responde "o que faço agora" só para quem
  abre o aplicativo. Um resumo diário passivo (nunca um alerta interruptivo)
  resolveria sem virar cobrança.
- **Tempo real.** Hoje é sondagem a cada seis segundos, o que é suficiente para
  três pessoas.
- **Tarefas recorrentes.**
- **Subtarefas na interface.** O campo `parent_id` existe no banco e o
  back-end trata cascata, mas nenhuma tela cria ou mostra hierarquia.
- **Etiquetas na interface.** Existem no banco e na API, e a captura rápida já
  entende `+etiqueta`, mas não há tela para criar nem para filtrar por elas.
- **Anexo direto na tarefa pela interface.** A API aceita; o front só anexa
  através do compositor de comentário.
- **Aplicativo para celular.** A interface é responsiva, mas não foi testada em
  telas pequenas.
- **Importar de uma planilha existente.** A exportação em CSV já existe; falta o
  caminho de volta.

---

## 6. Dívidas técnicas

- **`node:sqlite` é experimental.** Funciona bem, mas a interface pode mudar
  entre versões do Node. O aviso é suprimido em `server/index.js`. Vale só para
  o modo autônomo; o hospedado fala com o Turso por HTTP e não usa o módulo.
- **Sem migrações de banco.** O esquema é criado com `CREATE TABLE IF NOT
  EXISTS`. Acrescentar tabela ou coluna nova funciona sozinho; alterar uma
  coluna existente vai exigir escrever a migração à mão.
- **Uma dependência entrou no projeto.** O repositório de arquivos privado só
  aceita escrita pela biblioteca oficial, então `@vercel/blob` é instalada no
  modo hospedado. O modo local segue sem dependência alguma: o import só
  acontece quando existe configuração de nuvem.
- **O driver do Turso é caseiro.** São duas chamadas HTTP escritas à mão em
  `server/db.js`, em vez da biblioteca oficial. A troca foi deliberada — manter
  zero dependências —, mas se a API do serviço mudar, é ali que quebra.
- **Uma pessoa só edita por vez, sem aviso.** Se duas pessoas abrirem a mesma
  tarefa, a última gravação vence — em silêncio. Para três pessoas isso é raro,
  mas a trilha registra as duas mudanças e permite descobrir o que houve.
- **Testes só do núcleo.** 23 testes cobrem regras de tarefa, trilha e captura.
  Não há teste de API nem de interface.

---

## 7. Perguntas para o time

1. Migrar para o plano Pro da Vercel, ou seguir no Hobby? (item 2.2)
2. Trocar a senha inicial do admin e criar as contas de vocês três.
3. Cinco estados estão bons, ou "Entrada" e "A fazer" viraram a mesma coisa na
   prática?
4. O limite de três tarefas simultâneas é realista para o ritmo de vocês?
5. Alguma notificação é desejada, ou o silêncio é justamente o ponto? (item 5)
