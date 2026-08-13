# Instalação

Há dois caminhos. Os dois servem a mesma interface e falam o mesmo contrato de
API — o que muda é quem responde e onde os dados ficam.

| | Autônomo | Vercel |
|---|---|---|
| Exige | Node.js 22.5+ | conta Vercel + Turso |
| Banco | SQLite em `data/` | Turso (SQLite hospedado) |
| Anexos | `data/uploads/` | Vercel Blob |
| Acesso | rede local | de qualquer lugar |
| Melhor para | uso interno sem exposição, ou desenvolvimento | o time trabalhando de onde estiver |

---

## Vercel

O modo hospedado. Não há servidor para manter nem máquina para deixar ligada.

### 1. Criar o banco no Turso

Turso é SQLite hospedado — o mesmo dialeto que o aplicativo já usa, o que
mantém o modo autônomo e o hospedado rodando exatamente o mesmo código.

1. Crie uma conta em turso.tech e um banco novo.
2. Guarde a URL do banco e gere um token de acesso.

O plano gratuito cobre folgadamente um time pequeno.

### 2. Criar o armazenamento dos anexos

No painel da Vercel, em **Storage**, crie um **Blob**. A variável
`BLOB_READ_WRITE_TOKEN` é adicionada ao projeto automaticamente.

Sem isso, o aplicativo funciona, mas qualquer anexo enviado desaparece — em
ambiente sem servidor não existe disco que sobreviva à requisição.

### 3. Publicar

Importe o repositório na Vercel. Não há nada a configurar em build: o projeto
não tem etapa de compilação nem dependências.

Em **Settings → Environment Variables**, adicione:

| Variável | Conteúdo |
|---|---|
| `TURSO_DATABASE_URL` | a URL do banco |
| `TURSO_AUTH_TOKEN` | o token gerado no passo 1 |
| `ADMIN_USERNAME` | opcional; o padrão é `admin` |
| `ADMIN_INITIAL_PASSWORD` | opcional; se não definir, é sorteada e aparece no log |

> As chaves vivem **apenas** no painel da Vercel. Nunca em arquivo, nunca no
> repositório, nunca em mensagem.

### 4. Primeiro acesso

A primeira requisição cria as tabelas e a conta de administração. Se você não
definiu `ADMIN_INITIAL_PASSWORD`, a senha sorteada aparece uma única vez no log
da função, em **Deployments → Functions**.

Entre, troque a senha em **Ajustes** e crie as contas do time.

### Observações

- **O plano Hobby da Vercel proíbe uso comercial.** Uma ferramenta interna de
  empresa se enquadra; para uso legítimo, o plano Pro é o indicado.
- **Não há transação no modo hospedado.** Cada consulta é uma requisição
  independente, e manter uma transação aberta entre elas não sobrevive a uma
  função que pode ser encerrada a qualquer momento. A consequência prática é
  estreita: uma criação de tarefa interrompida no meio pode consumir um número
  de projeto sem criar a tarefa. É um buraco na sequência, não perda de dado.

---

## Modo autônomo

### 1. Instalar

```bash
git clone https://github.com/<usuario>/TDAHJira-Logus-Automacao.git
cd TDAHJira-Logus-Automacao
```

Não há dependências para instalar. Confira a versão do Node:

```bash
node -v      # precisa ser 22.5 ou maior
```

### 2. Criar a instância

```bash
node server/index.js --setup
```

Aparece algo assim:

```
  Instância criada.
  ─────────────────────────────────────────────
  usuário: admin
  senha:   7fK2mQx9vLpR4a
  ─────────────────────────────────────────────
  Anote a senha: ela não é mostrada de novo.
```

A senha é sorteada e guardada apenas como hash. **Anote antes de fechar o
terminal.** Se perder, apague `data/tdah-logus.db` e comece de novo.

Para escolher usuário e senha em vez de deixar sortear:

```bash
node server/index.js --setup --user ana --name "Ana" --password "sua senha aqui"
```

### 3. Subir

```bash
node server/index.js
```

```
  TDAH Jira — Logus Soluções em Automação
  ─────────────────────────────────────────────
  http://localhost:4173
  http://192.168.0.9:4173
  ─────────────────────────────────────────────
```

O segundo endereço é o da rede local: é por ele que as outras pessoas entram, do
computador delas, sem nada exposto na internet.

Para trocar a porta: `node server/index.js --port 8080`

### 4. Criar os outros acessos

Entre como administrador e use a API para criar as contas:

```bash
curl -X POST http://localhost:4173/api/users \
  -H "Content-Type: application/json" \
  -b "tdah_sess=SEU_TOKEN" \
  -d '{"username":"bruno","name":"Bruno"}'
```

A resposta traz a senha inicial uma única vez. Repasse por um canal seguro e
peça que seja trocada no primeiro acesso, em **Ajustes**.

### Conteúdo de exemplo

Para ver o produto povoado em vez de uma tela vazia:

```bash
node server/index.js --demo
```

Cria três projetos, três pessoas e catorze tarefas em estados variados,
mostrando as senhas no terminal. Serve para entender o produto em dez segundos.
Para começar limpo depois, apague `data/` e rode `--setup`.

### Deixar rodando sozinho

**Windows** — crie um atalho apontando para:

```
node "C:\caminho\TDAHJira-Logus-Automacao\server\index.js"
```

Para iniciar junto com o Windows, coloque o atalho em
`shell:startup` (Win+R → `shell:startup`).

**Linux** — um serviço do systemd:

```ini
[Unit]
Description=TDAH Jira Logus
After=network.target

[Service]
WorkingDirectory=/opt/tdah-logus
ExecStart=/usr/bin/node server/index.js
Restart=always
User=tdah

[Install]
WantedBy=multi-user.target
```

### Cópia de segurança

Tudo o que importa está em `data/`. Copie a pasta inteira com o servidor
parado — o banco e os anexos vão juntos.

---


## Segurança em qualquer um dos modos

- Nenhuma credencial vive no repositório. As senhas são sorteadas na instalação
  e guardadas apenas como hash (`scrypt`).
- O modo autônomo escuta em todas as interfaces para funcionar na rede local.
  Se a máquina tiver endereço público, **use um firewall** — o produto foi
  desenhado para rede interna e não para a internet aberta.
- Os anexos nunca são servidos por caminho direto: saem sempre por rota que
  confere a sessão.
