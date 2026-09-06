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

---

## 8. Pendências registradas em 3 de setembro de 2026

Deixadas ao encerrar a sessão que entregou os quadros laterais da tela inicial.

1. **Validar a migração em produção.** O primeiro pedido depois do deploy roda
   `ALTER TABLE tasks ADD COLUMN kind` no Turso. Conferir que `/api/boot`
   devolve `vocabulary.kinds` e que criar um item com `^meta` o coloca no
   quadro certo.
2. **Testar o "+ adicionar…" dos quadros com a aba visível.** Foi validado só
   pelo estado e pela API: a aba usada na automação estava em segundo plano, e
   o redesenho depende de `requestAnimationFrame`, que o navegador suspende
   nesse caso (HANDOFF 4.10).
3. **O filtro de tipo da planilha persiste.** "Ver na planilha" a partir de um
   quadro deixa a planilha filtrada naquele tipo até alguém limpar. Decidir se
   a planilha deve voltar a "Tarefa" ao trocar de tela.
4. **Tela estreita não foi vista.** Abaixo de 900px os quadros descem para
   baixo do fluxo do dia; falta olhar num celular.
5. ~~**Acesso da equipe.**~~ **Resolvido em 5 de setembro de 2026.** O aplicativo
   passou a morar em `https://tarefas.logusautomacao.com` (CNAME `tarefas` para a
   hospedagem, criado na Hostinger, onde fica o DNS do domínio). O bloqueio por
   antivírus era consequência de servir formulário de senha em endereço
   compartilhado gratuito, e desapareceu com o domínio próprio — verificado no
   mesmo navegador, com o mesmo antivírus ligado. O endereço `.vercel.app`
   continua respondendo como reserva.

---

## 9. Auditoria de 5 de setembro de 2026

Varredura do código inteiro em sete frentes (autenticação, contrato dos dois
modos, regras de tarefa, estado do frontend, os quadros novos, higiene do
repositório e acesso da equipe). O que segue foi **reproduzido**, não deduzido.

### 9.1 Confirmado e já corrigido

| O que acontecia | Onde |
|---|---|
| Meta concluída aparecia em "Concluídas hoje", junto do trabalho do dia | `web/js/store.js` — `feitasHoje()` não passava por `visiveis()` |
| A busca (Ctrl+K) nunca encontrava item de quadro lateral | `web/js/palette.js` — usava `visiveis()` em vez de `visiveis("*")` |
| Com filtro de projeto ativo, o item criado no quadro sumia no mesmo instante | `web/js/views/hoje.js` — nascia sem projeto |
| A sincronização de 6s apagava o que estava sendo digitado na tela | `web/js/app.js` — o `#view` remontava sem respeitar campo em foco |
| Tarefa apontando para si mesma como pai travava o servidor ao ser apagada | `server/tasks.js` — recursão sem fim em `deleteTask` |

As quatro primeiras entraram junto com os quadros laterais. A quinta é antiga.

### 9.2 Confirmado e ainda aberto

1. **Mover tarefa entre projetos quebra o projeto de destino.** A tarefa leva o
   número antigo; quando a numeração do destino alcança esse número, o `INSERT`
   morre em `UNIQUE constraint failed: tasks.project_id, tasks.number` e ninguém
   mais cria tarefa ali. Reproduzido: mover `AAA-2` para BBB e criar duas em BBB.
2. **Apagar tarefa não avisa ninguém, e faz o relógio da sincronização andar para
   trás.** `deleteTask` não grava evento e apaga os da tarefa em cascata, então o
   maior `events.id` diminui. As outras abas seguem mostrando o cartão e podem
   reprocessar eventos já vistos. Reproduzido: maior id caiu de 5 para 4.
3. **Prazo impossível é aceito.** `2026-99-99`, `2026-02-30` e `0000-00-00` são
   gravados como estão — `cleanDate` confere o formato, não a data.
4. **O cookie de sessão sai sem `Secure` em produção.** `httpsAtivo()` só liga o
   atributo quando `TRUST_PROXY_PROTO` existe, e essa variável não está definida
   na hospedagem. O HSTS cobre o caso comum, mas o atributo deveria estar lá.
   Conserto: definir `TRUST_PROXY_PROTO=https` no painel.
5. **Não há `Content-Security-Policy`.** HSTS, `X-Frame-Options` e `nosniff` estão.
6. **Criar aceita em silêncio o que editar recusa.** `createTask` normaliza valor
   inválido para o padrão; `updateTask` devolve erro. O contrato deveria ser um só.
7. **Quem perde a senha fica sem acesso.** Não existe redefinição nem desativação
   pela interface — só um administrador criando outra conta.

### 9.3 Levantado e refutado na reprodução

Ficam registrados para não serem levantados de novo:

- **Travessia de caminho na rota de arquivos.** Nenhuma das seis entradas hostis
  passou: `normalize` + a limpeza do prefixo + `startsWith` seguram.
- **Senha de administrador publicada em `docs/INSTALL.md`.** É exemplo de saída de
  terminal; testada contra produção, devolve 401.
- **Freio de tentativas ausente na hospedagem.** Medido em produção: a nona
  tentativa devolve 429. Vale a ressalva de que o contador vive na memória da
  instância, então o teto é por instância, não global.

### 9.4 O que ficou sem verificação

> **Atualização:** os 66 apontamentos que restavam foram trabalhados um a um
> logo em seguida. O resultado está na seção 10; o que sobrou de verdade é
> curto e está em 10.2.

A varredura levantou 78 apontamentos; os acima foram reproduzidos um a um. O
restante — sobretudo corrida de numeração e transação pela metade no modo
hospedado, e limpeza de anexo órfão — continua como suspeita de peso, sem prova.

---

## 10. Fechamento da V1

Depois da auditoria da seção 9, os 66 apontamentos restantes foram divididos por
arquivo e trabalhados em paralelo. 49 viraram correção, 20 foram descartados com
motivo, e a costura entre eles rendeu mais sete consertos que nenhum grupo via
sozinho. A suíte saiu de 36 para 78 testes.

### 10.1 O que foi corrigido

| Área | O que mudou |
|---|---|
| **Chave da tarefa** | Mover entre projetos renumera no destino; o número sai numa instrução só (`UPDATE … RETURNING`), sem a corrida de antes |
| **Exclusão** | Gera evento próprio, o cursor de sincronização nunca recua, o cartão some da tela de quem está com a aba aberta, e os arquivos dos anexos saem do disco e da nuvem |
| **Validação** | Criar e editar recusam os mesmos valores; data impossível (`2026-02-30`) deixa de passar; título é aparado e limitado; referência inexistente vira 400, não 500 |
| **Ordenação** | A posição fracionária deixa de colapsar: a coluna se renumera sozinha quando o espaço acaba |
| **Sessão e senha** | Cookie com `Secure` no modo hospedado, `logout` invalida a sessão certa, administrador redefine senha e desativa acesso, freio de login separa quem é quem atrás de proxy |
| **Transações** | O modo local serializa as escritas que passam por `tx()`, em vez de derrubar a segunda com erro 500 |
| **Migrações** | Sobrevivem a duas partidas simultâneas |
| **Anexos** | Teto por modo (12 MB local, 4 MB hospedado), anunciado em `/boot` e `/state`, e a interface recusa antes de subir |
| **Interface** | Cronômetro não vaza mais, anexos do compositor sobrevivem ao redesenho, filtro da planilha tem como ser limpo, texto da senha deixa de prometer regra que não existe |

### 10.2 O que continua aberto, e por quê

Nenhum deles impede o uso. Todos foram examinados e recusados por serem grandes
demais para o retorno, não por falta de tempo:

1. **O freio de login é por instância no modo hospedado.** O contador vive na
   memória do processo, e a plataforma cria instâncias novas. Consertar de
   verdade é guardar tentativas no banco — uma escrita a mais em toda tentativa
   de login, inclusive nas legítimas. Para três pessoas atrás de um domínio
   próprio, não compensa.
2. **`UPDATE` e evento não são atômicos no Turso.** O driver HTTP não tem
   transação de verdade. Na prática significa que uma queda de rede no
   milissegundo errado grava a mudança sem a linha da trilha. Fechar isso é
   refazer o driver para juntar as instruções num pipeline só.
3. **`today()` é local e `nowIso()` é UTC.** Perto da meia-noite os dois
   discordam sobre que dia é hoje. Uniformizar exige decidir o fuso da
   instância e migrar o que já está gravado.
4. **Escrita fora de `tx()` ainda pode ser desfeita por um `ROLLBACK` alheio**
   no modo local (passos e comentários não passam por transação).
5. **`PATCH /users/{id}` não tem botão.** A rota existe e é testada; falta a
   tela para o administrador usar sem `curl`.
6. **Adicionar um passo não aparece na hora** quando o cursor está dentro de um
   campo do painel: o redesenho fica represado até o foco sair. É o preço de
   não apagar o que está sendo digitado.

### 10.3 Revisão do próprio lote

O diff inteiro passou por uma segunda leitura, em seis frentes, antes de virar
commit. Nada bloqueou a entrega. Quatro coisas apareceram e foram corrigidas na
hora:

1. A exclusão não chegava ao "O que andou": `recentActivity()` filtrava
   `task_id IS NOT NULL`, que é exatamente a forma do único evento que nasce sem
   tarefa. Agora ela aparece, sem link, porque não há mais o que abrir.
2. `DELETE` de tarefa inexistente respondia 200 e ainda gravava o evento, o que
   mandava os outros clientes removerem um cartão que nunca existiu. Agora é 404.
3. `docs/API.md` prometia que `PATCH /users/{id}` mudava papel, nome e cor. A
   rota não lê nenhum dos três: ela redefine senha e ativa ou desativa. Quem
   fosse construir a tela por esse contrato faria um formulário que não grava.
4. `tx()` ganhou guarda contra transação aninhada. Não há aninhamento hoje; o
   problema é que, se alguém introduzir um, o processo trava sem erro e sem fim.

A revisão também levantou uma leva de suspeitas que **não chegaram a ser
verificadas** — a sessão esbarrou no limite antes. Ficam anotadas para quem
retomar, sem peso de fato:

- `emVoo` do `store.js` pode ficar preso se uma sondagem nunca terminar, e a
  sincronização morreria em silêncio pelo resto da sessão.
- `MAX_UPLOAD` decide o teto por `TURSO_DATABASE_URL`, mas o limite de 4 MB é da
  função sem servidor, não do banco. Quem rodar o modo autônomo apontando para o
  Turso perde 8 MB sem motivo técnico.
- `X-Forwarded-For` é lido pela esquerda no freio de login; se a plataforma não
  sanear o cabeçalho, dá para escolher a própria chave.
- `espalhar()` renumera a coluna com um `UPDATE` por linha e sem evento: no modo
  hospedado é uma ida à rede por tarefa, e as outras abas só veem a ordem nova no
  carregamento seguinte.
- No celular, o toque que segura o aviso pode prendê-lo na tela.
- `salvarTexto()` chama `render()` de dentro do `blur`.

O caminho para fechá-las é o mesmo de sempre: reproduzir antes de acreditar.
