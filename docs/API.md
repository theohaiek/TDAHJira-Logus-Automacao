# Contrato da API

Este é o documento normativo do contrato entre a interface e o servidor,
implementado em `server/api.js`. A resposta é idêntica no modo autônomo e no
hospedado — o que muda por baixo é apenas o driver de banco e o de arquivo.

## Endereço base

Todas as rotas ficam sob `/api/`. A interface monta o endereço de forma
relativa ao documento e nunca usa URL absoluta.

## Autenticação

Cookie de sessão `tdah_sess`, `HttpOnly` e `SameSite=Lax`, obtido em
`POST /session`. Os métodos de escrita conferem a origem da requisição.

O download de anexo usa o mesmo cookie: o navegador o envia sozinho, inclusive
em `<img src>`.

Sem sessão válida, qualquer rota responde `401` com `{ "error": "..." }`.

## Formato

Entrada e saída em JSON UTF-8. Datas com hora em ISO 8601 UTC
(`2026-08-13T07:33:04.494Z`); datas sem hora em `YYYY-MM-DD`.

Erro sempre no mesmo formato, em qualquer situação:

```json
{ "error": "A tarefa precisa de um título." }
```

---

## Rotas

### Sessão e inicialização

| Método | Rota | Retorno |
|---|---|---|
| `GET` | `/boot` | Identificação da instância e se há sessão. Única rota que responde sem autenticação |
| `POST` | `/session` | `{usuario, senha}` → cria sessão |
| `DELETE` | `/session` | Encerra a sessão |

### Estado

| Método | Rota | Retorno |
|---|---|---|
| `GET` | `/state` | Tudo o que a interface precisa numa chamada só |
| `GET` | `/sync?cursor=N` | O que mudou desde o evento `N` |
| `GET` | `/activity?limit=N` | Atividade recente da instância |

`GET /state` responde:

```json
{
  "cursor": 419,
  "today": "2026-08-13",
  "me": { "id": 1, "username": "ana", "name": "Ana Exemplo", "color": "#a2e4f0", "role": "admin", "active": true },
  "prefs": { "tema": "dark", "wip": 3 },
  "users": [ ... ],
  "projects": [ { "id": 1, "key": "AUT", "name": "Automações", "color": "#a2e4f0" } ],
  "companies": [ { "id": 1, "name": "ACME Metalurgia", "color": "#c9b6f0", "avatar": null, "description": "", "position": 0 } ],
  "labels": [ { "id": 1, "name": "cliente", "color": "#a2e4f0" } ],
  "tasks": [ ... ],
  "activity": [ ... ]
}
```

`GET /sync` responde `{ cursor, tasks, removed, events }`. Quando o cursor
recebido já é o atual, devolve listas vazias — é o caso comum e precisa ser
barato.

### Tarefas

| Método | Rota | Observação |
|---|---|---|
| `GET` | `/tasks` | `?archived=1` inclui as arquivadas |
| `POST` | `/tasks` | Só `title` é obrigatório → `201` |
| `GET` | `/tasks/{id}` | Devolve `{task, comments, attachments, timeline}` |
| `PATCH` | `/tasks/{id}` | Campos parciais; devolve `{task}` |
| `DELETE` | `/tasks/{id}` | Apenas administrador |
| `POST` | `/tasks/{id}/move` | `{status, beforeId, afterId}` → reposiciona |
| `GET` | `/tasks/{id}/timeline` | A trilha da tarefa |

### O objeto tarefa

```json
{
  "id": 1,
  "key": "AUT-1",
  "number": 1,
  "projectId": 1,
  "projectKey": "AUT",
  "projectColor": "#a2e4f0",
  "projectName": "Automações",
  "companyId": 2,
  "companyName": "ACME Metalurgia",
  "companyColor": "#c9b6f0",
  "title": "Revisar o fluxo de aprovação",
  "description": "",
  "status": "doing",
  "kind": "task",
  "priority": "agora",
  "energy": "media",
  "size": 3,
  "assigneeId": 1,
  "reporterId": 1,
  "parentId": null,
  "dueOn": null,
  "focusOn": "2026-08-13",
  "waitingFor": null,
  "position": 1024,
  "archived": false,
  "createdAt": "2026-08-13T07:33:04.494Z",
  "updatedAt": "2026-08-13T07:33:04.531Z",
  "startedAt": "2026-08-13T07:33:04.494Z",
  "doneAt": null,
  "statusSince": "2026-08-13T07:33:04.494Z",
  "touchedAt": "2026-08-13T07:33:04.531Z",
  "steps": [ { "id": 1, "text": "Reproduzir", "done": true, "position": 1000 } ],
  "labels": [1, 2],
  "commentCount": 2,
  "attachmentCount": 1
}
```

### Vocabulário

| Campo | Valores |
|---|---|
| `status` | `inbox` · `todo` · `doing` · `waiting` · `done` |
| `kind` | `task` · `longa` · `oportunidade` · `meta` |
| `priority` | `agora` · `normal` · `quando_der` |
| `energy` | `leve` · `media` · `pesada` · `null` |
| `size` | 1 a 40 blocos de 25 minutos, ou `null` |

`kind` separa o fluxo do dia dos três quadros laterais da tela inicial.
`task` é o padrão e o único tipo que entra em "o que faço agora", no quadro
e na planilha sem filtro. `longa` (validade longa), `oportunidade` e `meta`
ficam nos quadros laterais e só entram no fluxo quando alguém troca o tipo
por `PATCH`. A troca gera um evento de tipo `kind` na trilha, com `from` e
`to`. Valor fora da lista é recusado com `400`.

### Regras da transição de estado

Estas regras são parte do contrato — as duas implementações precisam aplicar
todas, ou a história fica diferente conforme o backend:

1. `status_since` é reescrito a cada mudança de estado.
2. Ao entrar em `doing` pela primeira vez, grava `started_at`. Não é sobrescrito
   depois.
3. Ao entrar em `done`, grava `done_at`. Ao sair de `done`, limpa.
4. Ao sair de `waiting` sem informar `waitingFor`, limpa `waiting_for` e
   registra o evento correspondente.
5. Ao entrar em `doing` sem `focus_on` definido, define `focus_on` como hoje.
6. Toda alteração de campo gera um evento com valor anterior e novo.

### Passos, conversa e anexos

| Método | Rota | Observação |
|---|---|---|
| `POST` | `/tasks/{id}/steps` | `{text}` → `201`, devolve `{task}` |
| `PATCH` | `/tasks/{id}/steps/{stepId}` | `{done}` |
| `DELETE` | `/tasks/{id}/steps/{stepId}` | |
| `GET` | `/tasks/{id}/comments` | |
| `POST` | `/tasks/{id}/comments` | `{body}` → `201` |
| `PATCH` | `/comments/{id}` | Só quem escreveu |
| `DELETE` | `/comments/{id}` | Quem escreveu ou administrador |
| `POST` | `/tasks/{id}/attachments` | Corpo binário puro |
| `GET` | `/attachments/{id}` | O arquivo |
| `DELETE` | `/attachments/{id}` | Quem enviou ou administrador |

**Envio de anexo.** O arquivo vai como corpo binário puro, sem `multipart` —
menos código dos dois lados e uma superfície de erro a menos:

```
POST /api/tasks/12/attachments
Content-Type: image/png
X-File-Name: print%20do%20erro.png
X-Comment-Id: 34          (opcional: prende o anexo a um comentário)

<bytes>
```

Tipos aceitos: `png`, `jpeg`, `gif`, `webp`, `avif`, `pdf`, `txt`, `csv`, `zip`,
`json`. O teto depende do modo: 12 MB no autônomo, 4 MB no hospedado — a
função sem servidor tem limite próprio de corpo. O valor em vigor vem em
`limits.maxUpload` de `/boot` e de `/state`, e a interface recusa antes de subir.

SVG é recusado de propósito: carrega script.

### Projetos, empresas, etiquetas e pessoas

O projeto diz de que área a tarefa é; a empresa, para quem ela é. São duas
dimensões independentes: `projectId` decide a chave visível (`AUT-14`) e
renumera a tarefa quando muda; `companyId` não mexe em número nenhum.

| Método | Rota |
|---|---|
| `GET` `POST` | `/projects` |
| `PATCH` | `/projects/{id}` |
| `GET` `POST` | `/companies` — `POST` com nome repetido devolve a empresa que já existe, com 200 |
| `PATCH` | `/companies/{id}` — nome, cor e foto são de qualquer pessoa; `archived` é só do administrador. Não há `DELETE`: apagar deixaria as tarefas sem para quem |

As três rotas devolvem a empresa no mesmo formato do `/state`:

```json
{ "id": 1, "name": "ACME Metalurgia", "color": "#c9b6f0", "description": "", "avatar": null, "position": 0 }
```

**A foto da empresa.** O campo `avatar` é um *data URI* guardado na própria
linha da empresa, e não um anexo com rota de arquivo. O motivo é o modo
hospedado: sem o token do repositório de arquivos, o driver de arquivo grava em
disco, e ali o disco é somente leitura — a foto funcionaria em todo teste local
e nasceria quebrada em produção. Data URI se comporta igual nos dois modos.

O `PATCH` aceita:

| Valor de `avatar` | Efeito |
|---|---|
| ausente | mantém a foto que está lá |
| `null` | limpa a foto |
| `data:image/webp;base64,…` · `data:image/jpeg;base64,…` · `data:image/png;base64,…` | grava, se couber em 32 KB |

Qualquer outra coisa é recusada com `400` e frase legível — inclusive SVG, pela
mesma razão dos anexos: ele carrega script. O teto de 32 KB vale para a string
inteira. A interface reduz a imagem para 96×96 antes de enviar e cai de
qualidade até caber em 24 KB, então a folga existe para o navegador que
codifica mais gordo, e não para virar porta de entrada de arquivo grande.
| `GET` `POST` | `/labels` |
| `DELETE` | `/labels/{id}` |
| `GET` | `/users` |
| `POST` | `/users` — só administrador; devolve `senhaInicial` uma vez |
| `PATCH` | `/users/{id}` — só administrador: `senha` redefine (devolve `senhaInicial` uma vez e obriga a troca) e `active` ativa ou desativa, derrubando as sessões |
| `PATCH` | `/me/prefs` |
| `POST` | `/me/password` |

### Foco

| Método | Rota |
|---|---|
| `POST` | `/focus/start` — `{taskId, minutes}` |
| `POST` | `/focus/stop` — `{completed}` |
| `GET` | `/focus` — total concluído hoje |

### Versão

| Método | Rota | Retorno |
|---|---|---|
| `GET` | `/versao` | `{fonte, repo, atual, commits, total, atras, app}` |

Cada item de `commits` traz `{sha, data, titulo, corpo, versao}`. O commit feito
pelo ciclo de relatos traz também `relatos: [{id, kind, status, autor,
resolution}]`, montado a partir das linhas `Relato: N` da mensagem (sem
cerquilha: `#12` no GitHub viraria link para a issue 12 do repositório público).
O nome de quem relatou vem do banco, nunca do commit.

### Relatos e sugestões

| Método | Rota | Quem | Retorno |
|---|---|---|---|
| `POST` | `/feedback` — `{kind, body, page?, version?}` | qualquer sessão | `201 {id, encaminhado, agenda}` |
| `GET` | `/feedback` | qualquer sessão | `{feedback, passada, agenda, encaminhamento, repo}` |
| `POST` | `/feedback/{id}/acao` — `{acao, nota?}` | só administrador | `{relato}` |
| `POST` | `/feedback/{id}/complemento` — `{texto}` | só quem relatou | `{relato}` |

`kind` é `bug` ou `ideia`. O envio tem freio de 12 por pessoa por hora (`429`),
contado no banco. `GET` devolve a lista inteira, mais novo primeiro: é o quadro
de sugestões do time, e mostrar quem relatou é de propósito.

O relato:

```json
{
  "id": 12, "kind": "bug", "body": "…", "page": "/quadro", "version": "v1.3.30",
  "createdAt": "…", "updatedAt": "…",
  "autor": "Nome de exibição", "autorId": 3,
  "status": "corrigido",
  "resolution": "O que mudou, o porquê, o plano ou a pergunta, conforme a situação.",
  "commit": { "sha": "40 hex", "curto": "7 hex", "url": "https://github.com/dono/nome/commit/…" },
  "versaoResolvida": "1.3.41",
  "duplicadoDe": null,
  "issueUrl": null,
  "eventos": [ { "status": "novo", "nota": null, "commit": null, "ator": "autor", "atorNome": "…", "em": "…" } ]
}
```

`issueUrl` só vem preenchido para administrador (aponta para um repositório
privado). `versaoResolvida` pode vir `null` quando a linha do tempo não chega em
2,5 s. `passada` é a última passada do agente: `{inicio, fim, analisados,
decididos, publicados, erro}` ou `null`.

`agenda` é quando o agente passa de novo, para a tela prever a entrega:
`{horario, proxima, entrega, duracao, esperando}`. `proxima` e `entrega` são
instantes ISO, `duracao` está em minutos, e `esperando` vem `true` quando a
máquina que roda o agente faltou à hora marcada: aí a tela mostra "Esperando
conexão com servidor de desenvolvimento" no lugar da previsão. O horário e o
fuso vêm de `RELATOS_HORARIO` e `RELATOS_FUSO` (padrão `05:17` em
`America/Sao_Paulo`).

Situações: `novo`, `autorizado`, `detalhe`, `todo` ("Exige permissão do dev - Adicionado ao TODO"),
`corrigido` (só bug), `adicionado` (só ideia), `rejeitado`, `inviavel`,
`duplicado`, `ja_existe`.

As ações de administrador, e de onde cada uma parte (fora disso, `409`):

| `acao` | de | para |
|---|---|---|
| `autorizar` | `todo` | `autorizado`, e o plano em `resolution` fica |
| `recusar` | `novo`, `todo`, `autorizado`, `detalhe` | `rejeitado`, com `nota` (ou uma frase padrão) em `resolution` |
| `reabrir` | `todo` e as finais | `novo`, limpando `resolution`, `commit` e `duplicadoDe` |

O complemento só vale em `detalhe` (`409` fora dela) e só para o autor (`403`).
Ele entra no fim do `body` como "Complemento: …" e devolve o relato para `novo`.

### O agente diário

Rotas do executor `scripts/relatos/rodar.mjs`, que roda numa máquina de quem
administra. Não usam cookie: autenticam por `Authorization: Bearer <token>`,
comparado em tempo constante com `RELATOS_AGENTE_TOKEN`.

Sem a variável no servidor, ou com menos de 32 caracteres, **as três rotas
respondem `404`**, igual a um caminho que não existe. Com ela, credencial
ausente ou errada é `401`.

| Método | Rota | Retorno |
|---|---|---|
| `GET` | `/agente/relatos` | `{pendentes, contexto}` |
| `POST` | `/agente/relatos/{id}` — `{status, resolution, commit?, duplicadoDe?}` | `{relato}` |
| `POST` | `/agente/passada` — `{inicio, fim, analisados, decididos, publicados, erro?}` | `{ok: true}` |

`pendentes` são os relatos em `novo` e `autorizado`, inteiros, com
`autor: {id, username, nome, role, ativo}`. `contexto` são os 80 mais novos das
outras situações, com `resumo` (até 280 caracteres) e `autor: {username, role,
ativo}`, para o agente reconhecer um pedido repetido. O autor vai junto porque
a triagem dos relatos de autor confiável só recebe contexto de autor confiável.

A decisão aceita `detalhe`, `todo`, `corrigido`, `adicionado`, `rejeitado`,
`inviavel`, `duplicado` e `ja_existe` — nunca `novo` nem `autorizado`, que é
decisão de gente. `resolution` é obrigatória, até 1500 caracteres, sem
caractere de controle além da quebra de linha. `corrigido` e `adicionado`
exigem `commit` (7 a 40 hexadecimais). `duplicado` exige `duplicadoDe` de outro
relato que exista. O relato precisa estar em `novo` ou `autorizado` (`409`
fora disso), exceto a repetição idêntica da decisão que já está gravada, que
responde `200` sem registrar nada de novo: é o executor reenviando o que ficou
sem resposta na passada anterior.

---

## Regras que valem em qualquer modo

O driver de banco e o de arquivo mudam conforme o ambiente, mas nada disso
vaza para o contrato: a mesma requisição produz a mesma resposta nos dois. A
única diferença observável está descrita em [ARCHITECTURE.md](ARCHITECTURE.md),
na seção sobre transações.
