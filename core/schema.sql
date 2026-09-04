-- ===========================================================================
-- Esquema do banco — dialeto SQLite (modo autônomo).
-- O plugin de WordPress traduz este mesmo desenho para MySQL em
-- wordpress/tdah-logus/includes/class-schema.php. Se algo mudar aqui,
-- muda lá também.
--
-- Princípio que governa este esquema: poucos campos na tarefa, muita
-- história no log. A tarefa guarda o estado atual e nada mais; quem
-- responde "onde está cada coisa e desde quando" é a tabela de eventos.
-- É assim que se tem rastreabilidade sem encher o formulário de campos.
-- ===========================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- --- Pessoas ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  display_name  TEXT    NOT NULL,
  email         TEXT,
  password_hash TEXT,                       -- nulo enquanto o convite não é aceito
  color         TEXT    NOT NULL DEFAULT '#a2e4f0',
  role          TEXT    NOT NULL DEFAULT 'member',   -- admin | member
  is_active     INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  prefs         TEXT    NOT NULL DEFAULT '{}',       -- JSON: tema, modo calmo, wip
  created_at    TEXT    NOT NULL,
  last_seen_at  TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- --- Projetos --------------------------------------------------------------
-- Um projeto é só um agrupamento com uma sigla. Sem esquemas de permissão,
-- sem configuração de fluxo por projeto: essa é justamente a cerimônia que
-- torna o Jira intransitável para um time pequeno.
CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT    NOT NULL UNIQUE,      -- ex.: LOG. Vira LOG-14 no cartão.
  name        TEXT    NOT NULL,
  color       TEXT    NOT NULL DEFAULT '#a2e4f0',
  description TEXT    NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  seq         INTEGER NOT NULL DEFAULT 0,   -- contador do número legível
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

-- --- Tarefas ---------------------------------------------------------------
-- Campos obrigatórios ao criar: apenas o título. Todo o resto é opcional e
-- pode ser preenchido depois, ou nunca. Capturar tem que custar um segundo.
CREATE TABLE IF NOT EXISTS tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  number        INTEGER,                    -- o 14 de LOG-14
  title         TEXT    NOT NULL,
  description   TEXT    NOT NULL DEFAULT '',

  status        TEXT    NOT NULL DEFAULT 'inbox',
                -- inbox | todo | doing | waiting | done
  kind          TEXT    NOT NULL DEFAULT 'task',
                -- task | longa | oportunidade | meta
                -- "task" é o fluxo principal. Os outros três moram em quadros
                -- laterais da tela inicial e ficam fora da fila do dia.
  priority      TEXT    NOT NULL DEFAULT 'normal',
                -- agora | normal | quando_der  (três níveis, com nome humano)
  energy        TEXT,   -- leve | media | pesada — custo, não duração
  size          INTEGER,-- blocos de ~25 min. Estimar em blocos, nunca em horas.

  assignee_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reporter_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  parent_id     INTEGER REFERENCES tasks(id) ON DELETE CASCADE,

  due_on        TEXT,   -- data (YYYY-MM-DD), sem hora: hora falsa gera culpa falsa
  focus_on      TEXT,   -- o dia em que eu decidi puxar isso para mim
  waiting_for   TEXT,   -- de quem/do que está esperando. Só quando status=waiting.

  position      REAL    NOT NULL DEFAULT 0, -- ordem manual dentro da coluna
  is_archived   INTEGER NOT NULL DEFAULT 0,

  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  started_at    TEXT,   -- primeira vez que entrou em "fazendo"
  done_at       TEXT,   -- última vez que entrou em "feito"
  status_since  TEXT    NOT NULL,  -- desde quando está no estado atual (aging)
  touched_at    TEXT    NOT NULL   -- última interação humana de qualquer tipo
);

CREATE INDEX IF NOT EXISTS idx_tasks_status    ON tasks(status, is_archived);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee  ON tasks(assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_project   ON tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_parent    ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_focus     ON tasks(focus_on);
CREATE INDEX IF NOT EXISTS idx_tasks_due       ON tasks(due_on);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_key ON tasks(project_id, number);

-- --- Passos (a quebra da tarefa grande) ------------------------------------
-- Existe para dissolver paralisia: uma tarefa que assusta vira uma lista de
-- passos pequenos, e o primeiro passo é sempre visível no cartão.
CREATE TABLE IF NOT EXISTS steps (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text       TEXT    NOT NULL,
  is_done    INTEGER NOT NULL DEFAULT 0,
  position   REAL    NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL,
  done_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_steps_task ON steps(task_id, position);

-- --- Etiquetas -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS labels (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#8fa9b5'
);

CREATE TABLE IF NOT EXISTS task_labels (
  task_id  INTEGER NOT NULL REFERENCES tasks(id)  ON DELETE CASCADE,
  label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);

-- --- Conversa no ticket ----------------------------------------------------
-- Comentário é texto simples com formatação leve e menção por @usuario.
-- Sem editor rico, sem macros, sem painéis: o que se quer aqui é registrar
-- decisão e contexto, não diagramar.
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  updated_at TEXT,
  edited     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id, created_at);

-- --- Anexos ----------------------------------------------------------------
-- Pensado para o caso real: colar um print direto no ticket (Ctrl+V).
-- O arquivo vai para o disco com nome sorteado; o nome original é só rótulo.
CREATE TABLE IF NOT EXISTS attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  comment_id    INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  uploader_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  original_name TEXT    NOT NULL,
  stored_name   TEXT    NOT NULL UNIQUE,
  mime          TEXT    NOT NULL,
  size_bytes    INTEGER NOT NULL,
  width         INTEGER,
  height        INTEGER,
  created_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments(task_id);
CREATE INDEX IF NOT EXISTS idx_attachments_comment ON attachments(comment_id);

-- --- A trilha: onde está cada coisa, e desde quando -------------------------
-- Log append-only. Nunca se edita nem se apaga uma linha daqui.
-- É o que dá ao produto a rastreabilidade do Jira sem pedir nada a mais de
-- quem usa: a história se escreve sozinha a cada mudança.
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind       TEXT    NOT NULL,
             -- created | status | assignee | priority | energy | size | title
             -- | description | due | focus | waiting | project | parent
             -- | label_add | label_remove | step_add | step_done | step_undone
             -- | step_remove | comment | attachment | archived | restored
  field      TEXT,
  from_value TEXT,
  to_value   TEXT,
  note       TEXT,
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id, id);
CREATE INDEX IF NOT EXISTS idx_events_time ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind, created_at);

-- --- Sessões de foco -------------------------------------------------------
-- Mede tempo de verdade gasto, sem pedir apontamento manual de horas.
-- Serve para calibrar a estimativa em blocos com o tempo real, que é onde a
-- cegueira temporal mais atrapalha.
CREATE TABLE IF NOT EXISTS focus_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at  TEXT    NOT NULL,
  ended_at    TEXT,
  seconds     INTEGER NOT NULL DEFAULT 0,
  planned_min INTEGER NOT NULL DEFAULT 25,
  completed   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_focus_user ON focus_sessions(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_focus_task ON focus_sessions(task_id);

-- --- Configuração da instância ---------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
