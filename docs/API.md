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

---

## Regras que valem em qualquer modo

O driver de banco e o de arquivo mudam conforme o ambiente, mas nada disso
vaza para o contrato: a mesma requisição produz a mesma resposta nos dois. A
única diferença observável está descrita em [ARCHITECTURE.md](ARCHITECTURE.md),
na seção sobre transações.
