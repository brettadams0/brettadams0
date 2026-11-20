-- Switchboard schema. Idempotent: applied on every server start.
--
-- Everything that crosses the switchboard is a row in `messages`: you to a
-- session, a session to you, a session to another session, permission prompts
-- and their verdicts. Nothing is ever deleted, which is the point: when a
-- session forgets something, it can search this table.

CREATE TABLE IF NOT EXISTS sessions (
  name          text PRIMARY KEY,
  cwd           text,
  role          text NOT NULL DEFAULT 'worker',      -- 'orchestrator' | 'worker'
  description   text NOT NULL DEFAULT '',
  tmux_target   text,                                -- tmux session name when we launched it
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz,
  archived      boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS messages (
  id          bigserial PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  kind        text NOT NULL DEFAULT 'chat',          -- 'chat' | 'permission' | 'verdict' | 'system'
  from_kind   text NOT NULL,                         -- 'user' | 'session' | 'system'
  from_name   text NOT NULL,
  to_kind     text NOT NULL,                         -- 'user' | 'session'
  to_name     text NOT NULL,
  body        text NOT NULL,
  speak       boolean NOT NULL DEFAULT false,        -- phone should read it aloud
  delivered   boolean NOT NULL DEFAULT false,        -- pushed into the target session
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  tsv         tsvector GENERATED ALWAYS AS (to_tsvector('english', body)) STORED
);
CREATE INDEX IF NOT EXISTS messages_tsv_idx      ON messages USING gin (tsv);
CREATE INDEX IF NOT EXISTS messages_from_idx     ON messages (from_name, id DESC);
CREATE INDEX IF NOT EXISTS messages_to_idx       ON messages (to_name, id DESC);
CREATE INDEX IF NOT EXISTS messages_pending_idx  ON messages (to_name, id) WHERE NOT delivered AND to_kind = 'session';

CREATE TABLE IF NOT EXISTS tasks (
  id          serial PRIMARY KEY,
  title       text NOT NULL,
  notes       text NOT NULL DEFAULT '',
  project     text NOT NULL DEFAULT 'inbox',
  status      text NOT NULL DEFAULT 'backlog',       -- backlog | todo | doing | blocked | done
  priority    smallint NOT NULL DEFAULT 2,           -- 0 = urgent … 3 = someday
  assignee    text,                                  -- session name, if any
  created_by  text NOT NULL DEFAULT 'user',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  done_at     timestamptz,
  CONSTRAINT tasks_status_ck   CHECK (status IN ('backlog','todo','doing','blocked','done')),
  CONSTRAINT tasks_priority_ck CHECK (priority BETWEEN 0 AND 3)
);
CREATE INDEX IF NOT EXISTS tasks_board_idx ON tasks (project, status, priority);

CREATE TABLE IF NOT EXISTS permission_requests (
  request_id    text NOT NULL,
  session       text NOT NULL,
  tool_name     text NOT NULL,
  description   text NOT NULL,
  input_preview text NOT NULL,
  status        text NOT NULL DEFAULT 'pending',     -- pending | allow | deny | expired
  decided_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz,
  PRIMARY KEY (session, request_id)
);

CREATE TABLE IF NOT EXISTS app_releases (
  version_code  integer PRIMARY KEY,
  version_name  text NOT NULL,
  filename      text NOT NULL,
  sha256        text NOT NULL,
  size_bytes    bigint NOT NULL,
  notes         text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);
