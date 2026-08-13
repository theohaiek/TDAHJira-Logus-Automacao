# Instalação

Há três caminhos. Todos servem a mesma interface e falam o mesmo contrato de
API — o que muda é quem responde e onde os dados ficam.

| | Autônomo | Vercel | Plugin de WordPress |
|---|---|---|---|
| Exige | Node.js 22.5+ | conta Vercel + Turso | WordPress 6.0+, PHP 7.4+ |
| Banco | SQLite em `data/` | Turso (SQLite hospedado) | O MySQL do próprio site |
| Anexos | `data/uploads/` | Vercel Blob | `wp-content/uploads/tdah-logus/` |
| Login | contas do próprio aplicativo | idem | as contas que já existem no WordPress |
| Acesso | rede local | de qualquer lugar | de qualquer lugar |
| Melhor para | uso interno sem exposição | time distribuído, sem servidor para manter | quem já tem um site WordPress |

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

## Plugin de WordPress

### 1. Instalar

Clone o repositório dentro da pasta de plugins:

```bash
cd wp-content/plugins
git clone https://github.com/<usuario>/TDAHJira-Logus-Automacao.git tdah-logus
```

O repositório inteiro **é** o plugin: o arquivo com o cabeçalho está na raiz.
Não há passo de empacotamento.

Como alternativa, baixe o ZIP do GitHub e envie por **Plugins → Adicionar novo →
Enviar plugin**.

### 2. Ativar

Em **Plugins**, ative *TDAH Jira — Logus*. A ativação cria as tabelas (prefixo
`wp_tdah_`) e a pasta de anexos protegida.

### 3. Usar

Aparece **TDAH Jira** no menu lateral do painel.

Quem pode entrar: qualquer pessoa com conta no WordPress e permissão de leitura.
Quem tem `manage_options` é tratado como administrador — pode apagar tarefas e
comentários de outras pessoas.

Não é preciso criar senha nova: o login é o do próprio WordPress.

### Cópia de segurança

As tabelas entram no backup normal do banco do site. Os anexos ficam em
`wp-content/uploads/tdah-logus/`.

### Se algo não funcionar

**A tela abre em branco.** Verifique no console do navegador se os arquivos de
`web/js/` carregaram. O plugin serve módulos ES nativos; algum plugin de
otimização que concatena ou adia scripts pode quebrá-los. Exclua `tdah-logus` da
otimização.

**As imagens dos anexos não aparecem.** Elas passam pela REST autenticada por
nonce. Se o site tem cache agressivo de página no painel, desative-o para
`/wp-admin/admin.php?page=tdah-logus`.

**As tabelas não foram criadas.** Desative e reative o plugin. A criação também
é verificada a cada carregamento, comparando a versão gravada.

---

## Segurança em qualquer um dos modos

- Nenhuma credencial vive no repositório. As senhas são sorteadas na instalação
  e guardadas apenas como hash (`scrypt`).
- O modo autônomo escuta em todas as interfaces para funcionar na rede local.
  Se a máquina tiver endereço público, **use um firewall** — o produto foi
  desenhado para rede interna e não para a internet aberta.
- Os anexos nunca são servidos por caminho direto: saem sempre por rota que
  confere a sessão.
