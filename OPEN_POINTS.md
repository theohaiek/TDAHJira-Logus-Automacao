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

---

## 11. Falta um guia para agentes de código

> **Resolvido em 8 de setembro de 2026:** o arquivo é [AGENTS.md](AGENTS.md), na
> raiz. O texto abaixo fica como registro do que foi pedido e por quê.

`CONTRIBUTING.md` foi escrito para uma pessoa: ela lê uma vez, entende o
projeto e volta ao texto só quando esquece de algo. Um agente de código não
funciona assim. Ele chega sem memória a cada sessão, lê o que couber na
janela de contexto, e erra exatamente nos pontos onde este projeto é
contra-intuitivo.

Nas sessões em que agentes trabalharam neste repositório, os mesmos erros se
repetiram, e todos são evitáveis por escrito:

- Rodar `npm install`, ou propor uma dependência, num projeto que não tem
  nenhuma de propósito.
- Alterar `core/schema.sql` e não acrescentar o `ALTER TABLE` na lista
  `MIGRACOES`, o que faz a coluna nunca existir no banco que já está em uso.
- Escrever código de servidor que só funciona em um dos dois modos.
- Usar `innerHTML` onde o projeto inteiro usa o helper `h()`.
- Criar listagem de tarefas sem decidir se ela respeita o campo `kind`.
- Mexer no ciclo de desenho e derrubar o represamento que protege o texto
  em digitação.
- Escrever comentário em inglês, ou sem acentuação, num código em português.
- Propor abstração, camada ou configuração nova, quando a regra da casa é a
  menor mudança que resolve.

O que o arquivo precisa ter, e que o `CONTRIBUTING.md` não tem:

1. **Os comandos exatos**, prontos para copiar, incluindo o de testes.
2. **A lista do que nunca fazer**, em imperativo, sem rodeio.
3. **Um mapa de "se você for mexer em X, leia Y antes"** — porque um agente
   não sabe o que não sabe, e o custo de ler o arquivo errado é alto.
4. **As invariantes**: o que precisa continuar verdadeiro depois de qualquer
   mudança (a suíte passa; nenhuma dependência nova; nada de credencial nem
   nome real; o esquema e as migrações andam juntos).
5. **Como verificar o próprio trabalho** antes de dizer que terminou.

Nome sugerido: `AGENTS.md` na raiz, que é a convenção que as ferramentas do
ramo vêm adotando. Curto — se não couber em uma leitura, não será lido.

---

## 12. Sessão de 8 de setembro de 2026

O trabalho começou pelo `AGENTS.md` da seção 11. Levantar as invariantes para
escrevê-lo exigiu ler o repositório inteiro em grupos disjuntos de arquivos, e
foi a costura entre esses grupos — não a leitura de nenhum deles — que achou os
dois defeitos abaixo. Nenhum leitor os enxergava sozinho.

### 12.1 A trilha mostrava o nome cru do evento

Arrastar um cartão gravava um evento sem nome próprio, e as duas telas que
mostram história não tinham tradução para ele: chegava ao usuário como
"Fulano update TAREFA", na tela inicial e no ticket. O mesmo buraco existia
para `parent`, `project`, `step_remove`, `label_add`, `label_remove` e os dois
eventos novos de comentário.

A causa é estrutural: o nome do evento nasce no servidor e precisa de tradução
em dois dicionários do cliente, e nada no código ligava os quatro arquivos.
Agora a lista fechada mora em `EVENT_KINDS` (`server/events.js`), `logEvent`
recusa nome que não esteja nela, e `tests/trilha.test.js` cobra os quatro de
uma vez, nos dois sentidos.

Reordenar continua gravando evento — o cursor de sincronização é o maior
`events.id`, e sem ele a ordem nova não chegaria às outras abas — mas não é
mais exibido: reordenar não é história de tarefa.

Pela mesma razão, editar comentário, apagar comentário e apagar anexo passaram
a gravar evento. Antes chamavam só `touch()`, que não move o cursor: quem
estivesse com a aba aberta via o texto antigo e a contagem errada até
recarregar a página inteira.

### 12.2 Um ciclo de tarefas travava o servidor inteiro

Duas tarefas apontando uma para a outra como pai satisfazem as duas chaves
estrangeiras — o banco aceita. A partir daí, apagar qualquer uma das duas
entra em recursão sem fim; como a recursão nunca cede o laço de eventos, o
processo não estoura a pilha nem registra erro: para de responder, para todos,
até alguém reiniciar. No modo autônomo, dois `PATCH` e um `DELETE` derrubam a
instância do time inteiro, e nada no log explica.

Reproduzido: o timeout de cinco segundos do próprio teste não chegou a
disparar.

A guarda que existia cobria só a tarefa que apontava para si mesma.
`updateTask` agora sobe a cadeia de pais e recusa o ciclo na escrita, que é
onde ele nasce, e `deleteTask` carrega a lista do que já visitou, para
sobreviver ao ciclo que alguma instância já tenha gravado.

### 12.3 Um teste escrito com `import` estático apaga o banco real

Todos os testes definem `TDAH_DATA_DIR` para um diretório temporário e só
depois usam `await import`. O motivo nunca esteve escrito: `paths.js` resolve
`DATA_DIR` na avaliação do módulo, e declaração de `import` é içada. Trocar o
import dinâmico por um comum — que parece mais limpo — faz `DATA_DIR` apontar
para o `./data` do repositório, e o `rmSync` do `after()`, que todo teste
copia, apaga o banco e os anexos de quem usa a máquina. Sem erro: o teste
passa.

Reproduzido. Os sete arquivos de teste passaram a só apagar o que estiver
dentro do diretório temporário do sistema, e o `AGENTS.md` explica a ordem.

### 12.4 Levantado e refutado na reprodução

Três suspeitas da mesma leitura não sobreviveram ao caso rodado:

1. `createTask` aceitaria responsável ou pai inexistente — **recusa**, como o
   `PATCH`.
2. A captura rápida aceitaria `31/02` e `20/13` — **rejeita as duas**.
3. Anexos seriam sempre gravados em disco nos dois modos — falso, `storage.js`
   desvia para a nuvem quando há token.

### 12.5 Divergências entre documento e realidade, corrigidas

- Quatro lugares diziam "31 testes" quando eram 78 (`HANDOFF.md` em dois
  pontos, `docs/ARCHITECTURE.md`, `docs/RESEARCH.md`).
- `.env.example` mandava copiar o arquivo para `.env`, mas nada no projeto lê
  um `.env`: não há `dotenv` nem `--env-file`. O cabeçalho também citava um
  plugin de WordPress que não existe mais.
- O comentário de `core/schema.sql` mantinha uma lista de eventos própria, já
  desatualizada (prometia um `restored` que nunca foi gravado). Agora aponta
  para `EVENT_KINDS`.

### 12.6 O que continua aberto

Os seis itens da seção 10.2 seguem recusados pelos mesmos motivos. Das seis
suspeitas da 10.3, uma foi confirmada por leitura e não reproduzida — o
`X-Forwarded-For` lido pela esquerda no freio de login — e quatro continuam
sem verificação: `emVoo` do `store.js`, o teto de upload decidido por
`TURSO_DATABASE_URL`, o toque que prende o aviso no celular, e `salvarTexto()`
chamando `render()` de dentro do `blur`.

A sexta, `espalhar()` renumerar a coluna sem evento, continua valendo com uma
nuance: a tarefa movida agora gera evento de posição e chega às outras abas,
mas as vizinhas renumeradas no mesmo `espalhar()` não entram no cursor, e a
ordem delas só se acerta no carregamento seguinte.

**Não verificado nesta sessão:** a correção da trilha não foi vista na tela.
A extensão do navegador não estava conectada, e o frontend não tem suíte. O
que foi verificado é o servidor, de ponta a ponta pelo protocolo, e a
existência das traduções nos dois dicionários, por análise do arquivo.

---

## 13. A versão de 8 de setembro de 2026

Quatro mudanças pedidas de uma vez, todas verificadas no navegador com dados
de exemplo antes de publicar.

### 13.1 O que mudou

| Pedido | Como ficou |
|---|---|
| O "Hoje" vira popup ao entrar, e continua acessível | `<dialog>` nativo, aberto uma vez por dia; segue como tela em `#/hoje` |
| A tela principal passa a ser o Quadro | A rota sem endereço vai para `quadro` |
| Associar uma empresa ao ticket | Tabela `companies` e `company_id` na tarefa, com evento próprio na trilha |
| Filtrar por pessoa e por empresa no cabeçalho | Avatares e selos que ligam e desligam, no quadro |

### 13.2 Decisões que valem ser lembradas

**Empresa não é projeto.** O projeto diz de que área a tarefa é; a empresa,
para quem ela é. Juntar as duas obrigaria a criar um projeto por cliente. A
tabela nasceu sem `key` e sem `seq` de propósito: a chave visível continua
saindo do contador do projeto, e trocar a empresa não pode renumerar a tarefa
— se renumerasse, duas tarefas do mesmo projeto colidiriam e o índice único
recusaria toda criação futura naquele projeto.

**Nome de empresa repetido devolve a que existe.** Duas fichas para o mesmo
cliente dividem as tarefas entre elas e quebram o filtro sem nenhum aviso na
tela. É o mesmo comportamento que o `POST` de etiqueta já tinha.

**Empresa inexistente é recusada com 400.** O projeto não valida isso, e o
resultado lá é 500 sem explicação no modo local e responsável fantasma no
hospedado. A rota nova não copiou o defeito.

**O filtro do quadro não entra em `visiveis()`.** Se entrasse, valeria também
para `agora()`, `hojeLista()` e o popup do dia: alguém filtraria o quadro por
uma empresa e o "o que eu faço agora" mudaria junto, sem nada na tela
explicando por quê. E não é o `sheet` da planilha pela razão inversa — filtro
compartilhado faz mexer num lugar alterar o outro em silêncio.

**O popup abre uma vez por dia, não a cada carga.** Aviso que aparece toda
hora vira clique reflexo, e clique reflexo não é leitura. A marca fica no
`localStorage`, ou seja, por dispositivo: quem abre no computador de manhã e
no celular à tarde quer ver nos dois.

**O `<dialog>` nativo, e não o `dialog.js`.** O módulo existente só sabe
formulário e pergunta de sim ou não, reaproveita o elemento da paleta de
comandos que o Ctrl+K também usa, não empilha e vaza ouvinte de Escape. O
elemento nativo entrega modal, fundo, Escape e prisão de foco sem uma linha
de JavaScript.

**O selo de empresa é fixo no cartão.** Entre os candidatos, o teto de quatro
selos o cortaria às vezes, e um selo que some deixaria o filtro do cabeçalho
parecendo quebrado. O teto passou a descontá-lo, então o cartão continua com
a mesma quantidade de informação de antes.

### 13.3 O que ficou de fora

- **Não há tela de administração de empresas.** Cria-se pelo próprio seletor
  do ticket, e arquiva-se por `PATCH`. Renomear e recolorir pela interface
  ainda não têm botão — mesma situação em que `PATCH /users/{id}` está desde
  a V1 (seção 10.2, item 5). *Resolvido na 1.1: empresas viraram uma seção da
  barra lateral, com criar, renomear, recolorir e pôr foto. Ver 14.6.*
- **A planilha continua com o filtro antigo**, o dela, que não conhece
  empresa. Só o quadro ganhou o cabeçalho de ícones.
- **O `&` da captura rápida exige tecla morta em teclado ABNT.** Os símbolos
  fáceis já estavam tomados por `#`, `@`, `^`, `!`, `*`, `~` e `+`.

### 13.4 O que a sessão deixou como rede

Dois testes novos que não existiam e cobrem o que o frontend não tinha como
cobrir:

- `tests/modulos-web.test.js` lê todos os módulos de `web/js` como texto e
  confere as junções: todo caminho de `import` existe, e todo nome importado é
  mesmo exportado por quem deveria. É o erro que deixa a tela branca sem
  registrar nada no servidor.
- `tests/trilha.test.js` cobra os quatro arquivos do contrato de evento. Ele
  pegou, nesta mesma sessão, o esquecimento do dicionário de frases quando o
  evento `company` nasceu.

### 13.5 A publicação derrubou a produção, e o que ficou disso

Entre a publicação e o conserto, o aplicativo respondeu 500 em tudo — inclusive
no `/boot`, ou seja, nem a tela de entrada carregava.

**A causa.** `CREATE INDEX ... ON tasks(company_id, status)` foi escrito em
`core/schema.sql`. O esquema roda inteiro a cada subida e **antes** da lista
`MIGRACOES`. Num banco criado por uma versão anterior, a coluna `company_id`
ainda não existe quando o índice tenta lê-la. Quem falha aí é `openDb()`, não
uma rota: a aplicação inteira cai junto.

**Por que passou em tudo que foi rodado.** Banco novo já nasce com a coluna,
porque o `CREATE TABLE` a traz. E o driver local manda o arquivo de uma vez só,
enquanto o hospedado executa instrução por instrução — é lá que o erro aparece.
É exatamente o padrão da armadilha 4.1 do `HANDOFF.md`, documentada desde a V1
e repetida mesmo assim, no mesmo dia em que o `AGENTS.md` foi escrito para
evitá-la.

**O conserto.** O índice foi para dentro da entrada de `MIGRACOES`, ao lado do
`ALTER TABLE` que cria a coluna; uma migração passou a aceitar mais de uma
instrução.

**A rede.** `tests/migracao.test.js` roda o esquema como o driver hospedado
roda, uma instrução por vez, sobre um banco montado sem as colunas migradas, e
recusa qualquer índice do esquema que dependa de coluna que nasce na migração.
Com o defeito reintroduzido de propósito, dois dos quatro testes falham.

**A lição, para o próximo deploy:** nada aqui é verificado de verdade enquanto
não roda contra um banco que já existe. Banco novo é o caso fácil, e é o único
que a suíte cobria.

---

## 14. A versão 1.1, de 8 de setembro de 2026

Quatro frentes numa sessão: cor, empresas, o Hoje em pop-up e o trilho de
cenas do quadro. O que cada uma deixou em aberto está registrado abaixo, na
ordem em que foi entregue.

### 14.1 Cor: o acento passou de quatro papéis para dois

`docs/BRAND.md` dizia que o ciano gelo era "foco, seleção, botão principal,
estado Fazendo" — quatro papéis. O código ia além: cinco títulos de coluna, o
item de navegação ativo, o filtro ligado, a coluna alvo de arraste, os rótulos
em versalete, as setas decorativas, os links e o herói da tela inicial. Com
tudo dizendo "é aqui", nenhum dizia.

A doutrina nova tem dois papéis: **ação primária** e **foco de teclado**. O
resto passou a ser dito por superfície, contorno e peso — três mecanismos que
já existiam no arquivo e eram subusados. A contagem de `var(--accent)` em
`web/css/` caiu de 43 para 17, e desses 17 dois são a própria definição de
`--accent-dim` nos dois temas.

`--accent-strong` e `--accent-line` foram apagados: o primeiro não tinha
consumidor nenhum no repositório, e o segundo só a borda do herói do Hoje, que
deixou de existir.

### 14.2 `--st-waiting` reprovava AA no tema claro, e foi corrigido

Como título de coluna sobre o fundo quase branco, `#a1701f` dava **4,04:1** —
abaixo do mínimo de 4,5:1 da WCAG AA. Passou para `#8a5e14`, que dá 5,31:1
mantendo o matiz (37,4° contra 37,6°). `--st-waiting-bg` e `--energy-media`
acompanharam. Não é redesenho: é dívida antiga paga.

### 14.3 A cor ciano das entidades que já existem vem do banco

O padrão de `users.color` e `projects.color` era `#a2e4f0`, exatamente a cor de
ação, em `core/schema.sql`, `server/auth.js`, `server/api.js`, `server/demo.js`
e no *fallback* de `web/js/dom.js`. Era essa a causa concreta da queixa de
"muito ciano" — e ela não estava no CSS. O padrão passou a `#8fa9b5`, a névoa
de `--st-inbox`, que é neutra e já pertence à paleta.

**Não houve `UPDATE` retroativo.** As três pessoas e o projeto que já existem
em produção continuam com a cor antiga até alguém trocar pela interface: mudar
a cor de gente por migração é decisão de quem administra a instância, não de
quem escreve a migração.

O `#a2e4f0` continua em `web/css/tokens.css` (é `--logus-ice`, extraído da
logo) e em `web/img/favicon.svg`. Nos dois casos é a marca, e a marca continua
sendo a única exceção.

### 14.4 A foto da empresa não usa o repositório de arquivos

Ela é um data URI numa coluna `avatar` de `companies`, e não um anexo por
`server/storage.js`. Sem `BLOB_READ_WRITE_TOKEN`, aquele driver cai no ramo de
disco — `mkdirSync` mais `writeFileSync` — e o disco do modo hospedado é
somente leitura. Pelo caminho de arquivo, a foto passaria em toda a suíte local
e nasceria quebrada em produção, que é exatamente o padrão de defeito que este
projeto mais repete.

O custo aceito: a foto viaja dentro do `/state` de todo mundo. Com 96×96 e teto
de 24 KB no cliente, uma carteira de trinta clientes com foto acrescenta menos
de 1 MB à carga inicial. Se um dia isso incomodar, a saída é uma rota própria
para a foto — não o `storage.js`.

### 14.5 Mexer em empresa não gera evento na trilha

Criar, renomear, recolorir ou trocar a foto de uma empresa continua sem
`EVENT_KIND` próprio. A consequência é conhecida: quem está com outra aba
aberta só vê a mudança no recarregamento seguinte, porque o cursor de
sincronização é o maior `events.id`.

Foi decisão de custo. Um tipo de evento novo obriga a mexer em quatro
dicionários — `EVENT_KINDS`, `EVENT_FOR`, `FRASE` e `NARRA` — mais o
`tests/trilha.test.js`, e empresa não é campo de tarefa: é cadastro, como
projeto, que segue o mesmo padrão desde a V1. A aba que editou atualiza
`state.companies` localmente e emite; as outras veem depois.

### 14.6 Empresas é seção da barra lateral, e não uma quinta tela

O pedido falava em "aba". A entrega é um bloco `.rail__companies` espelhando o
de projetos, e não uma entrada nova em `VIEWS`. Duas razões: o projeto e a
empresa são perguntas irmãs sobre a mesma tarefa — de que área ela é, e para
quem — e uma virar tela enquanto a outra continua sendo lista deixaria a barra
lateral respondendo a mesma coisa de dois jeitos; e uma quinta tela obrigaria
a mais um atalho numérico, mais um ícone e mais uma decisão de "onde eu estou"
para quem já usa quatro.

Isso resolve o item de 13.3: renomear, recolorir e pôr foto agora têm botão. O
`⋯` de cada linha abre o diálogo, e o `+` do cabeçalho cadastra.

**`docs/PRODUCT.md` recusa telas de configuração por escrito, e continua
recusando.** O que se recusa ali é a tela que decide como o produto se comporta
— quais estados existem, que campo é obrigatório, quem pode o quê. Cadastro de
entidade não é isso, e a lista de projetos sempre existiu. O documento passou a
dizer essa diferença em vez de deixar o código contradizê-lo em silêncio.

### 14.7 Foto de pessoa ficou de fora, e é só escopo

A mecânica inteira serve: `users` teria a mesma coluna `avatar`, o mesmo teto
de 32 KB, a mesma redução para 96×96 no cliente e o mesmo `fotoEmpresa()` com
outro nome. Não entrou porque a queixa que originou esta versão era sobre
empresas, e porque `dom.js:avatar()` já resolve pessoa com iniciais coloridas —
que é justamente o lugar onde a cor da entidade continua fazendo sentido.

### 14.8 Um `<label>` engolia o clique do botão de tirar a foto

Achado ao usar, não ao ler. `pedir()` envolve cada campo num `<label>`, e um
`<label>` repassa qualquer clique de dentro dele ao primeiro controle que
envolve. Com o campo de foto ali dentro, clicar em "Tirar a foto" — ou na
própria prévia — abria a janela de escolher arquivo do sistema, sem erro nenhum
no console e sem nada na tela explicando.

Campo de arquivo passou a usar `<div class="field">` com o rótulo num `<label
for>` que cobre só o texto. Fica como aviso para qualquer campo composto que
alguém acrescente ao `pedir()` amanhã.

### 14.9 Abrir o Hoje ainda empilha uma entrada de histórico

Medido: três aberturas pelo atalho `1` criam três entradas. Todas são
`#/quadro`, porque `rota()` normaliza o hash com `replaceState` logo depois de
abrir o pop-up — então voltar não muda nada na tela, mas o botão Voltar do
navegador fica sem efeito visível por tantas vezes quantas o Hoje foi aberto.

Por que ficou assim. Três dos seis caminhos são `<a href="#/hoje">` — o
logotipo, o item de navegação e o link Entrada — e um link de hash empilha
antes de qualquer JavaScript rodar. Tirar isso exigiria interceptar o clique
nos links, mais um caso especial em `irPara()`, mais o tratamento que já existe
em `rota()`: três mecanismos para o mesmo comportamento, que é exatamente o que
o ponto de entrada único foi feito para evitar. O defeito que se quis evitar
primeiro — esquecer um dos seis caminhos — é bem mais caro que este.

**Reveja se:** o Voltar começar a incomodar de verdade no uso diário. A saída
menos ruim seria um único ouvinte delegado para `a[href="#/hoje"]`, que cobre
os três links de uma vez.

### 14.10 O trilho de cenas: dois defeitos que só apareceram no navegador

**Um laço de realimentação entre o scroll e o redesenho.** Escrever
`scrollLeft` dispara o evento `scroll`; o evento `scroll` conclui a navegação;
concluir a navegação chama `emit()`; `emit()` remonta a view; remontar
reposiciona o trilho escrevendo `scrollLeft`. A tela remontava a cada 120 ms
para sempre, e o sintoma era a cena certa no rótulo com a cena errada na tela.
O conserto é um contador de escritas nossas: scroll causado por nós não é
navegação de ninguém.

**O `semSnap` reentrante travava o snap desligado.** Ele guardava o valor
anterior de `scroll-snap-type` para restaurar depois. Com duas chamadas
sobrepostas — o reposicionamento pós-monte e o `ResizeObserver`, por exemplo —
a segunda gravava `"none"` como valor original, e o snap ficava desligado pelo
resto da sessão sem erro nenhum. Agora o inline volta sempre para vazio: ele
existe só durante a escrita direta de `scrollLeft`, e o valor de verdade mora
na folha de estilo.

Os dois são invisíveis para a suíte: o frontend não tem teste de comportamento,
e nenhum dos dois quebra um `import`, que é o que `tests/modulos-web.test.js`
pega. Foram achados ao usar.

### 14.11 O que não deu para verificar no navegador desta máquina

- **A faixa abaixo de 900px.** A janela do Chrome está maximizada e não
  encolheu abaixo disso. A verificação foi pelo CSSOM: as três regras da media
  query existem e dizem `--espia: 0px`, `padding-inline: 0` e
  `.cena--resumo { display: none }` — sem lâmina, sem espia e sem um segundo
  eixo horizontal aninhado.
- **A animação do deslizamento.** A máquina tem `prefers-reduced-motion:
  reduce` ligado no sistema, então `--dur-slow` vale `0ms` e o trilho assenta
  sem quadro intermediário. Isso é a prova de que a leitura da duração a cada
  movimento funciona — o movimento reduzido passou a valer de graça para um
  movimento que é JavaScript —, mas quer dizer que a curva de saída
  (`1 - (1-p)³`) nunca foi vista rodando aqui.

### 14.12 Foto de pessoa continua fora, agora com um lugar a mais pedindo por ela

A lâmina do trilho mostra a foto da empresa e as iniciais coloridas da pessoa.
Fica visivelmente assimétrico, e é de propósito: ver [14.7](#147-foto-de-pessoa-ficou-de-fora-e-e-so-escopo).
A mecânica serve inteira, e o custo de estendê-la é uma coluna e quatro
chamadas.

---

## 15. O retorno da primeira leitura, ainda em 8 de setembro de 2026

Quatro apontamentos ao ver a 1.1 em produção. Os três primeiros eram defeitos
de execução; o quarto foi correção de rota.

### 15.1 Os painéis do trilho não pareciam painéis

A cena vizinha era uma faixa de cem pixels colada na borda. A causa não era de
cor, era geométrica: com a largura da cena inteira, as bordas do painel vizinho
caem fora da janela ou atrás do painel central, e nunca sobra uma borda para
ver. Faixa sem borda e sem forma não parece painel nenhum, e a tela continuava
com a mesma cara de antes.

O painel de trás passou a ter largura própria — um cartão de 220px, com borda,
raio e sombra em três camadas. E o empilhamento saiu da rolagem para posição
absoluta com `transform`: caixa que rola não sobrepõe, e o pedido era
justamente que o vizinho imediato ficasse **acima** dos mais distantes daquele
lado.

Isso apagou de uma vez três defeitos anteriores: o laço de realimentação entre
`scroll` e redesenho (14.10), o `semSnap` reentrante e a briga com o motor de
snap. Nenhum deles existe mais, porque não há mais rolagem.

### 15.2 O Hoje ainda figurava como seção

Ele abria como pop-up desde a 1.1, mas continuava listado entre Quadro,
Planilha e Fluxo — com a mesma cara de "tela para onde se navega", que é
exatamente o que ele deixou de ser. Saiu de `VIEWS` e virou uma ação própria,
acima da navegação e em acento: é a pergunta que este produto existe para
responder, e o único item da barra que carrega o ciano.

`rota()` continua sendo o ponto de entrada único — só que agora trata o `hoje`
pelo endereço, antes de consultar `VIEWS`, e não por estar nela.

### 15.3 O acento tinha ido longe demais

A doutrina de dois papéis (14.1) resolveu o excesso e criou o oposto: a
interface parou de responder. Passar o mouse não devolvia nada, e mover um
cartão de coluna não confirmava que o servidor recebeu.

Entrou o terceiro papel — **resposta imediata à interação** —, com a regra que
o separa dos outros: o acento é momentâneo. Chega com o cursor e sai com ele;
aparece quando o servidor confirma e some meio segundo depois. Estado
persistente continua sem acento, porque se o que está ligado e o que está sob o
cursor brilhassem igual, o brilho pararia de dizer qual é qual.

A confirmação de salvamento mora em `store.js`, e não no nó do cartão: `mount()`
recria o cartão a cada redesenho, e é justamente o redesenho do salvamento que
precisa mostrar a confirmação. Ela vale para criação e para mudança de estado —
não para cada tecla digitada num campo, que faria o cartão piscar sem parar. E
piscar sem parar não confirma nada; vira ruído, que é o oposto do que este
produto quer.

### 15.4 O que continua em aberto

- **A empresa mock é local.** O ambiente de teste ganhou duas empresas com foto
  para o painel da esquerda existir; a produção continua com zero empresas
  cadastradas, e o trilho lá mostra só o centro e as pessoas. Cadastrar é pelo
  `+` da barra lateral.
- **A janela de confirmação é de 2,5 s.** Se o redesenho for represado por mais
  que isso — um gesto muito longo, um campo em foco esquecido —, o pulso se
  perde. Perder a confirmação é bem menos grave do que travar o redesenho para
  garanti-la.

### 15.5 A pilha de painéis, na segunda tentativa

A primeira versão dos painéis flutuantes tinha o quadro no centro e cartões
estreitos nos lados. Parecia mais barata e era pior de todas as formas: o
painel trocava de estrutura **e de largura** ao virar central, o que se via
como um estalo de formato a cada passagem; o gesto exigia arrastar mais de mil
pixels para trocar de cena; e a "prévia" do lado não mostrava o quadro que
estava prestes a ser aberto, que é justamente o que se quer espiar.

Agora **todas as cenas são o mesmo quadro, do mesmo tamanho**. O que as separa
é só a escala e a posição, e escala interpola sozinha — não há mais o que
trocar no meio do caminho. Medido durante um arrasto: nenhuma cena muda de
largura de layout em nenhum quadro do gesto.

Três consequências que valem registrar:

- **A altura do trilho é fixa** e o quadro rola por dentro de cada cena. Sem
  isso, a altura mudaria a cada troca — uma cena tem três cartões, outra tem
  doze — e a página inteira saltaria junto.
- **A faixa lateral é repartida entre as camadas**, 62% para o vizinho
  imediato e o resto para os de trás. Sem repartir, cada camada some inteira
  atrás da anterior, que foi o defeito da primeira tentativa.
- **O corpo dos painéis de trás é `inert`.** Sem isso o Tab entraria nos
  cartões de uma prévia que ninguém está usando.

**O custo aceito:** todas as cenas montam o quadro a cada redesenho, e não só
a do centro. Com o teto de quinze cenas e uma base pequena, é irrelevante — mas
é o primeiro lugar a olhar se o quadro começar a engasgar em base grande. A
saída seria montar o quadro só nas cenas com distância até um, e moldura vazia
nas demais; o estalo voltaria, mas longe do centro, onde não se vê.

### 15.6 O trilho ganhou peso, e a preferência de movimento do sistema

O deslize entre cenas estava seco de duas formas.

**A primeira era a curva.** `1-(1-p)³` só desacelera, e movimento que só
desacelera parece parar contra uma parede. A curva passou a ir um triz além do
destino e voltar — chega a 1,054 do caminho por volta de 70% do tempo e assenta
em 1,000 exato no último quadro. Sem o retorno, um movimento matematicamente
correto ainda assim parece um estalo.

**A segunda era a duração**, e essa é a decisão que vale registrar.
`prefers-reduced-motion: reduce` está ligado na máquina em que isto foi testado
— e provavelmente em muitas outras, porque o Windows liga junto com "reduzir
animações" por desempenho, sem que ninguém saiba. Com a media query zerando
`--dur-slow`, o trilho trocava de cena sem quadro intermediário nenhum: a tela
saltava de uma visualização para outra sem dizer que tinha andado.

`--dur-trilho` ficou **fora** da media query, e é o único movimento do produto
que fica. O critério: todo o resto que se move aqui é enfeite — o pulso de
conclusão, o painel do ticket deslizando, o realce que aparece e some. O
deslize entre cenas não é. Ele é a resposta a um gesto que a pessoa está
fazendo com a mão naquele instante, e quem chega numa cena sem ver o caminho
perde a noção de onde estava.

Quem quiser zerar tem onde: o **modo calmo**, no botão da barra de cima, zera o
deslize junto com todo o resto. É o controle de movimento deste produto, é
explícito, e está a um clique.

**Foi tentado e desfeito:** ligar o modo calmo sozinho quando o sistema pede
movimento reduzido. Funciona, mas o modo calmo dessatura a interface inteira em
55% — quem só queria menos animação abriria o aplicativo com todas as cores
lavadas, sem ter pedido isso. O remédio era maior que a doença.

### 15.7 O arremesso atirava a pilha para longe

Um movimento curto e rápido — o mais comum de todos — dava velocidade
instantânea altíssima, porque o intervalo entre dois eventos de ponteiro é de
poucos milissegundos. A pilha voava para o fim da fileira como se alguém
tivesse dado um empurrão que ninguém deu.

Duas correções: a velocidade passou a ser média móvel (três quartos do valor
anterior, um quarto do novo), o que absorve o pico sem atrasar o
reconhecimento de um movimento de verdade; e o arremesso avança **no máximo uma
cena** além de onde a mão parou.

### 15.8 O recorte da foto de empresa mudou de regra

Era corte central quadrado, herdado de foto de rosto. Logotipo de empresa
costuma ser bem mais largo do que alto, com o símbolo à esquerda e o nome
escrito à direita — e o corte central pegava o meio do lettering, que a 40
pixels não diz nada.

Agora: razão maior que 1,8 corta o quadrado do **começo**; abaixo disso segue
central. E entra fundo branco, porque logotipo costuma vir com transparência, e
transparência sobre o tema escuro apaga o desenho.

### 15.9 O assentamento era seco porque JavaScript e CSS animavam ao mesmo tempo

A curva com balanço já estava certa e o movimento continuava chegando seco. A
causa não era a curva: era o tween escrever o transform a cada quadro **com a
transição do CSS ligada**. Cada escrita virava uma transição nova, o navegador
reinterpolava do meio do caminho, e o resultado saía atrasado e sem o balanço,
por mais correta que fosse a matemática.

Agora o assentamento é da transição do CSS: a posição final é escrita uma vez e
o navegador interpola sozinho, na placa de vídeo, com `--ease-trilho`
(`cubic-bezier(0.32, 1.42, 0.52, 1)`). Medido no navegador, o valor computado
passa do destino e volta — o balanço aparece de fato.

O JavaScript continua escrevendo quadro a quadro **durante o arrasto**, e ali a
transição fica desligada: no arrasto o painel tem de acompanhar a mão sem
atraso nenhum.

Dois detalhes que fazem isso funcionar:

- **Um reflow entre os dois estados.** Remover a classe de arrasto e escrever a
  posição no mesmo quadro conta como um estado só para o navegador, e não há
  transição para animar. `void trilhoEl.offsetHeight` separa os dois.
- **A classe `is-mudo`.** Reposicionamento por remonte e por mudança de tamanho
  da janela não são movimento que alguém pediu: vão instantâneos, com a
  transição desligada por um quadro.

### 15.10 A cena central tem acento aceso o tempo todo

É a única exceção à regra de que o acento é momentâneo (15.3), e ela se
sustenta pelo mesmo motivo que a regra: **existe exatamente uma cena central na
tela**. O reflexo não disputa com nada — ele diz onde é o aqui, que é o que o
acento sempre disse.

São três camadas: a borda com 70% de acento, um fio de um pixel por fora com
55%, e dois halos vazando para fora, com 26% e 14%. Sem o fio, a borda só fica
mais clara; sem os halos, não há reflexo, só contorno.

### 15.11 A Clínica Leger não pôde ser criada daqui

Ela é dado de produção, e criar dado de produção exige a sessão de quem
administra — que eu não tenho, e não devo ter. As credenciais do Turso ficam no
painel do banco, e o `ACESSOS.local.md` só diz onde elas estão.

Pelo código também não: o `AGENTS.md` proíbe versionar nome real de cliente, e
este repositório é público.

A saída foi `CRIAR-LEGER.local.md`, fora do versionamento, com um bloco pronto
para colar no console do navegador já autenticado. Ele faz o mesmo que o botão
de foto faria — inclusive o recorte, que passou a pegar o símbolo à esquerda
quando a imagem é bem mais larga que alta (15.8).

### 15.12 O arrasto acompanhava a mão bem demais

O assentamento parecia não existir, e a transição estava certa o tempo todo:
medida no navegador, `transitionend` disparava com `elapsedTime` de 420 ms
exatos, com a curva de mola aplicada.

A causa era o arrasto ser **um para um** com o cursor. A mão levava a pilha até
o destino, e ao soltar sobravam poucos pixels para a transição percorrer — ela
rodava inteira, sobre um trecho tão curto que não dava para ver. O que se via
era um encaixe.

Agora a pilha acompanha a mão a 58%. Medido: a mão anda 300 px, a pilha anda
174, e o assentamento percorre os 88 restantes — **um terço do movimento total
acontece na transição**, com a curva que passa do destino e volta. É o peso de
uma porta pesada: ela acompanha o empurrão e termina de fechar sozinha.

O limiar do arremesso foi recalibrado junto, para 0,0038 cena por milissegundo
— atravessar uma cena em pouco mais de 260 ms. Rápido para uma mão, lento para
um tremor.

**Nota de método:** nada disso era mensurável com a aba do navegador em segundo
plano. O compositor não avança transição em aba oculta: `playState` fica em
`running`, `currentTime` em zero, e `getComputedStyle` já devolve o valor final.
Toda medida de animação neste projeto precisa da aba em primeiro plano — foi o
que fez a primeira leitura concluir, errado, que a transição não estava sendo
criada.

### 15.13 O diálogo de empresa ficava por baixo do quadro

As cenas se empilham entre si com `z-index` até 100, escrito inline. Sem
isolamento, esses números disputam com os do resto do aplicativo — e o diálogo
vale `--z-palette`, que é 70. O quadro ganhava.

`isolation: isolate` no `.trilho` prende a briga lá dentro: as cenas continuam
se ordenando entre si, e lá fora o trilho inteiro conta como uma camada só, na
ordem natural do documento. O `<dialog>` do Hoje nunca teve o problema porque
vive na camada de topo do navegador, acima de qualquer `z-index`.

### 15.14 O tremor ao mover um ticket

Arrastar um cartão de coluna fazia a tela inteira tremer. A causa: o
posicionamento do trilho era feito num `requestAnimationFrame` **depois** do
`mount()`, e nesse quadro de atraso as cenas estavam no documento **sem
transform nenhum** — todas empilhadas na âncora de `left: 50%`, fora de lugar.

Como o `mount()` acontece a cada movimento de cartão, a cada criação e a cada
tique de seis segundos, o quadro fora de lugar aparecia o tempo todo.

Agora `posicionarTrilho()` é chamada por `app.js` logo depois do `mount()`, de
forma síncrona, no mesmo turno. O navegador nunca chega a pintar o estado
intermediário. Medido: duas montagens do trilho, **zero** com cena sem
transform.

É a única view que precisa disso, e é por ser a única cujo layout mora em
JavaScript em vez de CSS.

### 15.15 O pulso de confirmação existia e não era visto

Verificado no navegador: a animação era criada, com a curva e a duração certas.
Três coisas o tornavam invisível na prática.

- **O tremor de 15.14.** Uma tela que salta a cada movimento consome a atenção
  que o pulso queria ter.
- **O pulso já entrava apagando.** Com o pico em 0% e a queda começando ali, ele
  estava fraco quando o olho chegava. Agora acende no primeiro quadro e fica
  aceso por 55% do tempo antes de apagar — quem move um cartão está olhando
  para onde ele chegou, não para a borda dele.
- **O brilho era discreto.** Passou a ter contorno de dois pixels em acento
  sólido, mais halos de 18 e 48 pixels, e a borda do cartão em acento junto.

A janela do store caiu de 2500 ms para 1500 ms, um pouco acima da duração do
pulso. Com a janela muito maior que a animação, um redesenho tardio remontava o
cartão ainda marcado e a animação recomeçava — o realce piscava duas vezes, o
que diz "mudou de novo" quando nada mudou.

### 15.16 O realce durava um milissegundo

A queixa foi literal: "dura 1ms, mal dá pra perceber". Medido no navegador, era
verdade — `getAnimations()` devolvia `{declarada: "1.2s", duraçãoMedida: 0}`. A
animação era criada e terminava no mesmo instante. Duas causas somadas:

- **`steps(2, jump-none)`** no bloco de movimento reduzido. Era uma tentativa de
  dar a quem pede menos movimento um realce que aparece e some sem pulsar. Com
  dois degraus e a preferência ligada nesta máquina, o segundo degrau caía em
  cima do primeiro.
- **`box-shadow: none` no quadro final.** `none` não interpola com uma lista de
  sombras: o navegador troca de um valor para o outro de uma vez. O que deveria
  ser um apagar suave era um corte, e um corte no primeiro quadro é invisível.

A correção não foi consertar os keyframes, foi trocar de mecanismo. O realce
agora é transição, não animação: `.is-confirmada` acende, `.is-apagando` entra
depois do pico e leva a sombra até `--brilho-zero` — o mesmo desenho, todo
transparente, que interpola porque tem a mesma forma. Transição é o que o resto
do trilho já usa, e é a mesma mecânica que eu conseguia medir funcionando
enquanto os keyframes não davam medida nenhuma.

Ficou em 640 ms aceso e 1600 ms apagando, com a janela do store em 2400 ms —
sempre acima do ciclo inteiro, senão um redesenho tardio remonta o cartão ainda
marcado e o realce recomeça.

Verificado ao fim: `transitionDuration: "1.6s, 1.6s"` em `box-shadow,
border-color`, e a sombra chegando a `rgba(0,0,0,0)` no fim do percurso.

### 15.17 Empresa cadastrada que não aparecia no trilho

Reproduzido criando uma empresa sem nenhuma tarefa: ela aparecia na barra
lateral e não tinha painel nenhum na fileira. A causa era `escoposDoCarrossel`
montar a lista de empresas a partir da contagem de tarefas abertas — quem não
tinha tarefa não existia para o trilho.

Empresa passou a entrar por cadastro, e não por contagem. Alguém cadastra uma
empresa porque vai trabalhar para ela; uma empresa recém-cadastrada que não
aparece em lugar nenhum parece um cadastro que não funcionou. A contagem
continua decidindo *quem entra* quando há mais empresas do que cabe no trilho.

Pessoa continua entrando só com trabalho em aberto, e é de propósito: o time
inteiro na fileira seria uma parede de gente para atravessar.

### 15.18 Filtro dentro das cenas laterais

Antes, o cabeçalho de ícones só existia na cena geral, com o argumento de que
as laterais já são um filtro aplicado pela posição na fileira. O argumento vale
para metade da pergunta e não para a outra: quem abre a cena de um cliente quase
sempre quer saber "o que está aberto aqui **e com quem**", e recusar a segunda
metade obrigava a voltar ao centro só para refinar.

Agora toda cena com quadro tem cabeçalho, e ele oferece só a dimensão que ainda
está em aberto — na cena de uma empresa escolhem-se as pessoas, na de uma pessoa
escolhem-se as empresas, na geral as duas. Oferecer o filtro de empresa dentro
da cena de uma empresa seria dar dois controles para a mesma pergunta na mesma
tela, que é o que se evita.

Os ícones de uma cena lateral listam só quem tem trabalho *dentro dela*: numa
cena de cliente, mostrar o time inteiro seria oferecer filtros que não escondem
nada.

O estado do filtro é um só, compartilhado entre as cenas. Ligar uma pessoa na
cena do cliente e voltar ao centro mantém aquela pessoa ligada — é o mesmo
recorte visto de outro ângulo, não dois recortes independentes.

## 16. O acento na navegação e o rótulo de versão, em 9 de setembro de 2026

### 16.1 A seção em que se está voltou a ser ciano

Duas peças foram apontadas para receber acento: o item selecionado da barra
lateral e o nome da tela, no alto da página.

Havia um comentário no CSS dizendo que o acento ali tinha sido um erro. Estava
certo sobre o caso dele e não sobre este. Naquela versão, selecionado era
"texto ciano" e mais nada — indistinguível de passar o mouse por cima. Agora
são quatro sinais no mesmo item: superfície de acento, texto de acento, peso e
o traço da borda de dentro. O hover continua sendo cinza um degrau acima, e os
dois não se confundem.

O item de projeto ficou em superfície neutra, de propósito: um diz em que tela
você está, o outro diz que recorte está aplicado nela, e a hierarquia entre as
duas perguntas é essa.

O nome da tela ganhou acento e um halo de `text-shadow`. É a âncora da página —
quem volta para a aba depois de meia hora lê aquela palavra antes de qualquer
outra. Halo em `text-shadow`, e não em filtro: acende sem custar camada de
composição e sem mexer na linha de base do parágrafo ao lado.

### 16.2 Um rótulo de versão que também conserta o cache

O aplicativo não põe número de build no nome dos arquivos. O navegador guarda
`app.js` e `app.css` pelo caminho, e um deploy novo chega sem que a aba aberta
perceba — a pessoa vê um defeito já corrigido e reclama de algo que não existe
mais. O rótulo no rodapé da barra lateral responde "que versão é esta?", e o
clique responde "e se não for a última?".

O que o clique faz, nesta ordem:

1. pergunta ao servidor em que commit ele está, sem passar pelo cache;
2. apaga o Cache Storage e desregistra service workers — nenhum dos dois existe
   hoje, e a limpeza é escrita defensiva para o dia em que existirem;
3. rebusca no servidor cada arquivo que a página carregou, com `cache: "reload"`,
   que é a única maneira de mexer no cache de HTTP a partir do JavaScript;
4. compara com o commit de quando a aba abriu. Diferente, recarrega. Igual, diz
   que está em dia — e a limpeza aconteceu de todo jeito, porque quem clica ali
   está desconfiando do próprio cache, e responder "está tudo em dia" sem ter
   mexido em nada seria responder com a mesma dúvida.

A ordem importa: o `reload` do passo 4 sem o passo 3 reencontraria no cache
exatamente os arquivos velhos que motivaram o clique.

### 16.3 De onde vem o histórico

`server/versao.js` esconde uma diferença grande entre os dois modos. No modo
autônomo o repositório está no disco e `git log` responde tudo. No hospedado
não existe repositório nenhum — a plataforma copia os arquivos e joga o
histórico fora —, então a fonte é a API pública do GitHub, com o dono e o nome
vindos das variáveis que a própria plataforma injeta.

Três detalhes que não são óbvios:

- **O separador do `git log` é caractere de controle** (`%x1f`, `%x1e`), e não
  vírgula ou barra. É o que faz uma mensagem de commit com qualquer pontuação
  atravessar inteira.
- **A resposta do GitHub fica cinco minutos em memória.** Sem credencial são
  sessenta chamadas por hora por endereço, e no modo hospedado o endereço é o
  da plataforma, compartilhado — uma sala com cinco pessoas clicando esgotaria
  a cota em minutos.
- **O commit publicado pode não ser a ponta do ramo.** Um deploy que ainda está
  subindo deixa o servidor atrás do GitHub, e a distância entre os dois é a
  única resposta honesta para "estou atualizado?".

A rota fica atrás da sessão, e não ao lado de `/api/boot`. O repositório é
público, mas dizer a estranhos qual commit exato uma instalação está rodando é
entregar de graça a lista de correções que ela ainda não tem.

### 16.4 O corpo do commit fica fechado

Este repositório escreve corpo de commit com parágrafos. Vinte deles abertos
davam nove mil pixels de rolagem para achar a data de um — que é justamente o
que a pessoa foi ver. O corpo entrou num `<details>` fechado, que entrega o
abrir, o fechar, o estado e o teclado sem uma linha de JavaScript.

### 16.5 O acento gelo não era ciano

O acento do produto tem 68% de saturação: é gelo, e de perto lê como
quase-branco. Isso serve para o que ele faz na maior parte da tela — num quadro
de sessenta cartões, sessenta gritos não marcam nada. Nas três peças que
respondem "onde eu estou", porém, ele simplesmente não aparecia como cor.

Entrou um segundo acento, `--accent-vivo`, com quase toda a saturação
disponível: `#3ae7fb` no escuro. No claro ele não sobe de brilho — ciano claro
sobre branco some —, sobe de saturação e desce de luminosidade, que é o que dá
a mesma sensação de cor viva com contraste de leitura.

Não é o acento do produto com outro brilho: é outra cor, com três lugares de
uso. Espalhá-la desfaz exatamente o contraste que ela existe para criar.

O rótulo de versão perdeu a opacidade de 78% junto. Opacidade em cima de cor
viva devolve o mesmo lavado que se estava tentando tirar; o recuo agora vem de
tamanho e peso, não de transparência.

## 17. Mais de um responsável por tarefa, em 9 de setembro de 2026

### 17.1 O modelo, e a coluna que ficou

O trabalho compartilhado existia e o produto não sabia representá-lo: uma
tarefa de duas pessoas mostrava um rosto só, e a segunda parecia não envolvida.
Entrou a tabela `task_assignees`, com posição — a ordem faz parte do valor,
porque o primeiro é quem aparece quando não cabe mostrar todos.

`tasks.assignee_id` continua existindo, e isso é deliberado. Ela guarda o
primeiro da lista e serve ao índice `idx_tasks_assignee` e às perguntas do
produto que só precisam de um nome. Não é uma segunda verdade porque **quem
escreve é uma função só**, `gravarResponsaveis()`, que mexe na tabela e na
coluna no mesmo lugar. Ler de dois lugares é barato; escrever de dois é que
seria o erro — e foi por isso que `assigneeId` saiu de `FIELDS`, onde o laço
genérico de campos também a escreveria.

O teste `conferirAcordo()` existe para vigiar exatamente essa junta: o dia em
que a coluna e a tabela discordarem é o dia em que o cartão mostra um rosto e o
ticket mostra outro.

### 17.2 A tabela nova pôde ir para o esquema

Diferente de coluna, tabela nova cabe em `core/schema.sql`: o esquema roda
inteiro antes de `MIGRACOES`, e `CREATE TABLE IF NOT EXISTS` não depende de
nada que nasça depois. O índice sobre ela também vai junto, porque a tabela
nasce no mesmo arquivo — a regra que derrubou a produção em 8 de setembro é
sobre índice em **coluna** migrada, e ela continua valendo.

O que a tabela nova precisou e a migração de coluna não dá é a cópia inicial:
todo banco em uso tem responsável em `assignee_id` e a tabela nasce vazia. O
`INSERT OR IGNORE ... SELECT` roda em toda subida, e é de propósito. A chave
primária faz a segunda passagem não escrever nada, e no modo hospedado duas
instâncias frias sobem juntas depois de um deploy. Uma marca em `settings` para
rodar uma vez só economizaria uma consulta e traria de volta a pergunta "e se a
marca ficou gravada e a cópia não terminou?".

### 17.3 O contrato de entrada tem três formas

`assigneeIds` ausente significa "o patch não fala de responsável"; `[]`
significa "tire todos". A diferença entre as duas é o que impede uma mudança de
prazo de esvaziar a tarefa.

`assigneeId` sozinho continua aceito e **substitui a lista inteira**. É o que a
célula da planilha manda, e deixar a lista intacta faria a tela mostrar um
responsável enquanto o banco guarda três.

### 17.4 Onde a interface mudou, e onde não mudou

- **Cartão**: os avatares empilham como baralho aberto, com anel da cor da
  superfície entre eles — sem o anel, duas cores próximas viram uma mancha só.
  Teto de três e um contador, o mesmo acordo dos selos.
- **Ticket**: cada pessoa virou um botão que liga e desliga. Um `<select
  multiple>` resolveria em três linhas e é intragável: exige Ctrl para somar,
  não mostra rosto e desmarca tudo com um clique errado.
- **Planilha**: a célula continua sendo um seletor de um nome só, e troca **o
  primeiro** responsável sem mexer nos outros; os demais aparecem ao lado, sem
  seletor. A planilha é para varrer muita linha depressa — somar gente é gesto
  de decisão, e decisão acontece no ticket.
- **Filtro por pessoa**: basta uma das pessoas filtradas estar na tarefa.
  Filtrar por Ana e ver sumir o que ela divide com Bruno esconderia justamente
  o trabalho compartilhado.
- **Contagem das cenas**: a tarefa conta para cada responsável, e a soma das
  cenas passa do total. É o certo: a cena de cada pessoa mostra tudo que passa
  pela mão dela.
- **Limite de trabalho em curso**: uma tarefa de três pessoas está em andamento
  para as três.
- **Captura rápida**: `@ana @bruno` na mesma linha soma, e a ordem de leitura é
  a ordem de entrada.

### 17.5 A trilha não precisou de evento novo

O evento continua sendo `assignee`, e o valor virou a lista separada por
vírgula. Um evento gravado antes desta mudança tem um id só ali — que é uma
lista de um. A trilha inteira, inclusive a que já estava no banco, lê pelo mesmo
caminho, e nenhum registro histórico precisou ser reescrito.

### 17.6 O botão de versão passou a recarregar sempre

Ele só recarregava quando o commit mudava, e errava no caso mais comum: o
commit do servidor é o novo, o JavaScript da aba é o novo, e o CSS ainda é o
velho — porque a borda da hospedagem serviu o arquivo antigo por mais alguns
segundos depois do deploy. O commit comparava igual, a limpeza acontecia, e a
folha velha continuava pintando a tela.

Agora recarrega dos dois jeitos, e a diferença é só o que se diz antes. Quem
clica ali está pedindo a página que o servidor tem agora, e limpar o cache sem
recarregar não entrega isso. O estado da tela não se perde: o que existe mora
no servidor.

## 18. O trilho deixou de teletransportar, em 9 de setembro de 2026

### 18.1 Navegar era aparecer, não andar

`irParaCena()` trocava `state.carrossel.atual` e emitia. O emit remonta `#view`
inteiro, e `posicionarTrilho()` coloca o trilho novo sem transição — de
propósito, porque remonte não é movimento que alguém pediu. O resultado era
teletransporte, e por todos os caminhos de uma vez: duplo clique no painel,
ponto da barra, setas do teclado, botão "entrar em visualização" e o clique na
empresa da barra lateral passam todos por aquela função.

Agora o deslize vem primeiro e a troca de estado vem no fim — a mesma ordem que
o arrasto já usava. O caminho antigo continua existindo para quando não há
trilho na tela (outra view aberta, ou a cena fora da fileira), porque ali não
há o que animar.

### 18.2 O "snap" ao soltar era a duração fixa

Medido no navegador: a transição de assentamento **existia**, partia do ponto
certo e rodava os 480 ms. O problema era a distância. Quem solta a mão perto de
uma cena deixa dez pixels para o assentamento percorrer, e dez pixels em 480 ms
não são um movimento — são um painel parado que demora meio segundo para
admitir que chegou.

A duração passou a escalar com a distância. Não linearmente: velocidade
constante faria três cenas levarem três vezes o tempo de uma, e três vezes 480
ms é uma espera. A raiz da distância aproxima a velocidade constante nas
distâncias curtas — que é onde a diferença entre andar e estalar se decide — e
comprime as longas.

    0,04 cena (10 px) → 168 ms      1 cena  → 480 ms
    0,25 cena         → 240 ms      2 cenas → 679 ms
    0,50 cena         → 339 ms      3 cenas → 831 ms

Piso e teto são frações da base, e não milissegundos cravados: o modo calmo
continua zerando tudo, e mexer no token do CSS move o conjunto inteiro junto.

A duração é escrita no nó do trilho, não lida do documento — o CSS declara
quanto vale UMA cena, e o JavaScript diz quanto vale ESTA viagem. As cenas
herdam a variável.

### 18.3 A aparência saltava mesmo quando a posição andava

Havia um segundo salto, e ele era o mais visível dos dois: o painel deslizava
até o centro ainda apagado, e o `mount()` chegava depois e acendia tudo de uma
vez — reflexo de acento, véu, borda. Dois movimentos onde a pessoa fez um gesto
só.

`destacarMaisProxima()` já trocava o rótulo e os pontos no nó vivo. Passou a
trocar também a classe `is-atual` e o `inert` do corpo. Agora a cena acende
enquanto anda, e o remonte no fim não tem mais nada a corrigir.

### 18.4 O que foi verificado, e como

Instrumentado no navegador, com `getAnimations()` e um `MutationObserver` sobre
o `style` das cenas:

- duplo clique a duas cenas: quatro transições de `transform`, 679 ms, `is-atual`
  já trocada no mesmo instante;
- soltar a mão em três distâncias: 168 ms, 303 ms e 168 ms, cada uma partindo do
  transform onde a mão parou;
- ponto da barra a três cenas: 831 ms; seta do teclado: 480 ms;
- `irParaCena` fora do quadro: cai no caminho antigo sem estourar.

### 18.5 O convite da cena de trás aparecia dentro do quadro em uso

Reportado com print: o painel central era uma empresa, e o cartão de outra cena
— nome, contagem e o botão "Entrar em visualização" — aparecia desenhado por
dentro dele, sobre o trabalho de quem estava trabalhando. Não era transparência
mal calibrada: era o cartão no lugar errado.

`cena--esq` e `cena--dir` eram escritas no render, a partir do lado na
**fileira**: empresas antes do centro, pessoas depois. É a informação certa
sobre a fileira e a errada sobre a tela, porque o lado em que uma cena aparece
depende de qual cena está no centro — e isso muda a cada navegação.

Dois defeitos saíam daí:

- A cena "geral" tem `lado: "centro"` e nenhuma regra de alinhamento. Ao navegar
  para uma empresa, ela virava uma cena de trás com o cartão centralizado — ou
  seja, no meio do painel da frente, que é exatamente onde ele não pode estar.
- Uma empresa que ficasse à direita de outra continuava marcada como
  "esquerda", e o cartão ia para a borda coberta.

O lado passou a sair de `aplicarLayout()`, em `data-lado`, do mesmo `Math.sign`
que já decide para que lado a cena se desloca. Ele acompanha o arrasto: medido,
uma cena troca de `esq` para `dir` no quadro em que cruza o centro.

O cartão também encolheu de 66% para 52% da faixa. Ele era dimensionado por uma
fração maior que a fatia de 62% que o primeiro vizinho de fato mostra, e com o
preenchimento do véu dos dois lados encostava no painel da frente.

`d.lado` continua existindo no descritor da fileira, e continua sendo a resposta
certa para "de que tipo é esta cena". Só deixou de ser a resposta para "onde ela
está agora".

### 18.6 O véu aparecia de uma vez

Ao entrar numa visualização, o painel que ficava para trás ganhava véu, nome e
contagem instantaneamente — no meio de um movimento que era suave em todo o
resto. A causa era `display: none` na cena do centro: display não interpola, e
o navegador não tem como esmaecer o que acabou de existir.

Duas mudanças, e as duas são a mesma ideia:

- **Todo painel tem véu, inclusive o do centro**, onde ele fica transparente.
  Montar véu só nas cenas de trás parecia economia e impedia exatamente o que
  importa: o painel que sai do centro não tinha véu para acender, e o que chega
  tinha um véu que precisava sumir de uma vez. Com o véu sempre presente,
  entrar e sair de uma visualização é uma opacidade indo de zero a um e
  voltando.
- **`display: none` virou `opacity: 0` com `pointer-events: none`.** O segundo
  não é detalhe: sem ele o véu invisível continuaria por cima do quadro em uso e
  engoliria todo clique em cartão. Verificado com `elementFromPoint` e com um
  clique de verdade abrindo o ticket.

A duração é a do trilho, com teto de 320 ms. Não é `--dur-slow` porque o
movimento reduzido do sistema zera esse token, e entrar numa visualização não é
enfeite — é a resposta ao gesto que a pessoa acabou de fazer. O teto existe
porque a viagem chega a quase um segundo quando se atravessa a fileira inteira,
e um véu que leva isso tudo para acender descola do painel que já chegou.

Pelo mesmo argumento, o convite de entrar deixou de usar `--dur`: nesta máquina,
com movimento reduzido ligado, ele piscava em vez de subir.

O véu nunca dura mais que o deslize — `min(dur, 320)` é sempre menor ou igual —,
então o remonte do fim nunca corta o esmaecimento pela metade.

### 18.7 O halo do painel em uso era cortado em cima e embaixo

O reflexo de acento aparecia nas laterais e sumia na vertical, rente à borda.
`.trilho` tem `overflow: hidden` — e precisa ter, senão as cenas distantes
esticam a página e criam rolagem horizontal —, e a cena ocupava `height: 100%`
dele. Não sobrava um pixel para a sombra vazar.

Na horizontal a folga já existia por acaso: `--espia` reserva 214 px de cada
lado para as cenas de trás, e o halo cabia ali. Na vertical não havia reserva
nenhuma.

Entrou `--folga-halo: 40px`. A folga é somada à altura do trilho e devolvida em
`margin-block` negativa: o recorte cresce para o halo caber, e o fluxo da página
não percebe que ele cresceu. A cena passou a ser `top: var(--folga-halo)` com
`height: calc(100% - 2 * var(--folga-halo))`, então a altura útil do painel é
exatamente a de antes.

Quarenta e não sessenta e quatro: o halo tem duas camadas, uma de 26 px a 26% e
outra de 64 px a 14%. Quarenta pega a primeira inteira e a parte da segunda que
de fato se vê, sem empurrar o trilho para fora da janela.

Medido depois: 40 px de folga em cima e embaixo, 214 de cada lado, e nenhuma
rolagem horizontal na página.

### 18.8 O painel de trás era legível demais

Só a transparência não bastava: o texto atravessava o véu e ficava legível, e um
quadro legível atrás do quadro em uso disputa a leitura com ele — que é
exatamente o que a pilha existe para evitar.

Entrou `filter: blur(3.5px)` nas cenas que não estão no centro. O filtro fica no
`.cena__corpo`, e não na `.cena`: borrar a cena inteira levaria junto a borda, o
halo e o cartão com o nome — e o nome é justamente o que precisa continuar
nítido, porque é ele que diz de quem é aquela prévia.

A transição usa a mesma duração do véu. Entrar numa visualização é um movimento
só; o foco voltando depois do véu seria um segundo.

### 18.9 A rolagem horizontal aparecia sem precisar

Com cinco etapas, `minmax(252px, 1fr)` pedia 1308 px de quadro, e a barra
aparecia em painel que tinha espaço de sobra para as colunas — só não para
aquele mínimo. O mínimo caiu para 200 px: as cinco cabem em 1048, e o cartão
continua com largura de leitura.

A rolagem não sumiu — ela continua para quem de fato não tem largura, que é a
tela estreita. O que sumiu foi a rolagem que não precisava existir.

### 18.10 Dois cliques no fundo alargam o painel

Duplo clique numa área vazia do quadro em uso faz ele ocupar a faixa inteira, e
de novo o devolve. Zerar `--espia` é tudo o que precisa acontecer: `--cena-w`
sai dela, e a cena cresce sozinha até a borda do trilho.

Três detalhes que não são óbvios:

- **O gesto lê a classe, não a variável do render.** `destacarMaisProxima()`
  troca `is-atual` no nó vivo, então o painel que era prévia pode já ser o
  quadro em uso antes de qualquer remonte. Um `onDblclick` decidido no render
  responderia pelo estado de antes.
- **Só a partir de área vazia.** Dois cliques num cartão são para abrir o
  ticket dele, e um gesto não pode significar duas coisas no mesmo lugar.
- **A opacidade das cenas de trás sai do JavaScript, não de uma regra.**
  `aplicarLayout()` escreve opacidade no atributo, e atributo ganha de classe —
  uma regra `.is-largo .cena:not(.is-atual) { opacity: 0 }` seria escrita e
  ignorada.

`width` entrou na transição da cena. É a única propriedade ali que recalcula
layout, e entra porque muda uma vez, quando alguém alarga o painel — não a cada
quadro de um gesto.

Navegar desfaz o alargamento: largo é "quero ver este quadro inteiro", e trocar
de quadro é dizer que a pergunta mudou. Escape também desfaz, e antes de voltar
ao centro — Escape desfaz de dentro para fora.

### 18.11 Arrastar dentro do painel alargado

Com o painel ocupando a faixa inteira, arrastar o fundo dava em nada útil: os
vizinhos estão em opacidade zero, então a mão andava, a pilha andava junto e a
tela ficava parada até soltar. E pior que parada — com `--espia` zerado o passo
do gesto encolhe para um sétimo do normal, e o mesmo movimento de mão que
atravessa uma cena passava a atravessar várias.

Começar a arrastar agora desfaz o alargamento. Sem transição, de propósito: a
classe de arrasto já desligou as transições da cena, a largura volta no mesmo
quadro, e é justamente a geometria dessa largura que o passo do gesto mede — um
gesto que começasse esperando meio segundo por ela não acompanharia a mão.

Desfaz no primeiro movimento que conta como arrasto, e não no `pointerdown`:
movimento vertical devolve a rolagem da página sem nunca virar arrasto, e um
clique simples no fundo continua não fazendo nada.

Medido: painel a 2328 px, primeiro movimento de 15 px, painel a 1891 px e as
cinco cenas de trás de volta à vista no mesmo instante.
