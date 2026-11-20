import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { AppRelease, Message, PartyKind, PermissionRequest, Task, TaskStatus } from './protocol.ts';
import { TASK_STATUSES } from './protocol.ts';

// bigint ids come back as strings by default; message ids stay far below 2^53.
pg.types.setTypeParser(20, (v) => Number(v));

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

export interface NewMessage {
  kind?: Message['kind'];
  from_kind: PartyKind;
  from_name: string;
  to_kind: 'user' | 'session';
  to_name: string;
  body: string;
  speak?: boolean;
  meta?: Record<string, unknown>;
}

export interface SessionRow {
  name: string;
  cwd: string | null;
  role: 'orchestrator' | 'worker';
  description: string;
  tmux_target: string | null;
  created_at: string;
  last_seen_at: string | null;
  archived: boolean;
}

export interface TaskFilter {
  project?: string;
  status?: TaskStatus | 'open';
  assignee?: string;
  limit?: number;
}

export interface TaskPatch {
  title?: string;
  notes?: string;
  project?: string;
  status?: TaskStatus;
  priority?: number;
  assignee?: string | null;
}

export class Store {
  readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  }

  async migrate(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  // ---- sessions ---------------------------------------------------------

  async upsertSession(s: { name: string; cwd?: string | null; role?: string; description?: string; tmux_target?: string | null }): Promise<SessionRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO sessions (name, cwd, role, description, tmux_target, archived)
       VALUES ($1, $2, COALESCE($3, 'worker'), COALESCE($4, ''), $5, false)
       ON CONFLICT (name) DO UPDATE SET
         cwd         = COALESCE(EXCLUDED.cwd, sessions.cwd),
         role        = COALESCE($3, sessions.role),
         description = COALESCE($4, sessions.description),
         tmux_target = COALESCE(EXCLUDED.tmux_target, sessions.tmux_target),
         archived    = false
       RETURNING *`,
      [s.name, s.cwd ?? null, s.role ?? null, s.description ?? null, s.tmux_target ?? null],
    );
    return rows[0];
  }

  /** Record activity. `revive` un-archives (a session by that name connected again). */
  async touchSession(name: string, revive = false): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions (name, last_seen_at) VALUES ($1, now())
       ON CONFLICT (name) DO UPDATE SET last_seen_at = now(),
         archived = CASE WHEN $2 THEN false ELSE sessions.archived END`,
      [name, revive],
    );
  }

  async listSessions(includeArchived = false): Promise<SessionRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM sessions ${includeArchived ? '' : 'WHERE NOT archived'}
       ORDER BY (role = 'orchestrator') DESC, last_seen_at DESC NULLS LAST, name`,
    );
    return rows;
  }

  async getSession(name: string): Promise<SessionRow | null> {
    const { rows } = await this.pool.query(`SELECT * FROM sessions WHERE name = $1`, [name]);
    return rows[0] ?? null;
  }

  async archiveSession(name: string): Promise<void> {
    await this.pool.query(`UPDATE sessions SET archived = true WHERE name = $1`, [name]);
  }

  async orchestratorName(): Promise<string | null> {
    const { rows } = await this.pool.query(
      `SELECT name FROM sessions WHERE role = 'orchestrator' AND NOT archived
       ORDER BY last_seen_at DESC NULLS LAST LIMIT 1`,
    );
    return rows[0]?.name ?? null;
  }

  // ---- messages ---------------------------------------------------------

  async insertMessage(m: NewMessage): Promise<Message> {
    const { rows } = await this.pool.query(
      `INSERT INTO messages (kind, from_kind, from_name, to_kind, to_name, body, speak, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, created_at, kind, from_kind, from_name, to_kind, to_name, body, speak, delivered, meta`,
      [m.kind ?? 'chat', m.from_kind, m.from_name, m.to_kind, m.to_name, m.body, m.speak ?? false, m.meta ?? {}],
    );
    return rows[0];
  }

  async markDelivered(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.pool.query(`UPDATE messages SET delivered = true WHERE id = ANY($1::bigint[])`, [ids]);
  }

  /** Messages queued for a session while its bridge was offline. */
  async pendingFor(session: string): Promise<Message[]> {
    const { rows } = await this.pool.query(
      `SELECT id, created_at, kind, from_kind, from_name, to_kind, to_name, body, speak, delivered, meta
       FROM messages WHERE to_kind = 'session' AND to_name = $1 AND NOT delivered ORDER BY id`,
      [session],
    );
    return rows;
  }

  /**
   * A conversation thread. With `session`, everything to or from that session;
   * without, the whole switchboard. Newest last.
   */
  async history(opts: { session?: string; before?: number; limit?: number }): Promise<Message[]> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const params: unknown[] = [limit];
    const where: string[] = [];
    if (opts.session) {
      params.push(opts.session);
      where.push(`(from_name = $${params.length} OR to_name = $${params.length})`);
    }
    if (opts.before) {
      params.push(opts.before);
      where.push(`id < $${params.length}`);
    }
    const { rows } = await this.pool.query(
      `SELECT * FROM (
         SELECT id, created_at, kind, from_kind, from_name, to_kind, to_name, body, speak, delivered, meta
         FROM messages ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY id DESC LIMIT $1
       ) t ORDER BY id`,
      params,
    );
    return rows;
  }

  /**
   * Full-text search over every message ever sent, ranked. Falls back to a
   * substring match so identifiers and paths (which the English stemmer mangles)
   * are still findable.
   */
  async search(query: string, opts: { session?: string; limit?: number } = {}): Promise<(Message & { rank: number })[]> {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200);
    const params: unknown[] = [query, limit, '%' + query.replace(/[\\%_]/g, (c) => '\\' + c) + '%'];
    let scope = '';
    if (opts.session) {
      params.push(opts.session);
      scope = `AND (from_name = $4 OR to_name = $4)`;
    }
    const { rows } = await this.pool.query(
      `SELECT id, created_at, kind, from_kind, from_name, to_kind, to_name, body, speak, delivered, meta,
              ts_rank(tsv, websearch_to_tsquery('english', $1)) + CASE WHEN body ILIKE $3 THEN 0.5 ELSE 0 END AS rank
       FROM messages
       WHERE (tsv @@ websearch_to_tsquery('english', $1) OR body ILIKE $3) ${scope}
       ORDER BY rank DESC, id DESC LIMIT $2`,
      params,
    );
    return rows;
  }

  // ---- tasks ------------------------------------------------------------

  async addTask(t: { title: string; notes?: string; project?: string; status?: TaskStatus; priority?: number; assignee?: string | null; created_by?: string }): Promise<Task> {
    const { rows } = await this.pool.query(
      `INSERT INTO tasks (title, notes, project, status, priority, assignee, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [t.title, t.notes ?? '', normProject(t.project), t.status ?? 'backlog', t.priority ?? 2, t.assignee ?? null, t.created_by ?? 'user'],
    );
    return rows[0];
  }

  async updateTask(id: number, patch: TaskPatch): Promise<Task | null> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    const set = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (patch.title !== undefined) set('title', patch.title);
    if (patch.notes !== undefined) set('notes', patch.notes);
    if (patch.project !== undefined) set('project', normProject(patch.project));
    if (patch.priority !== undefined) set('priority', patch.priority);
    if (patch.assignee !== undefined) set('assignee', patch.assignee);
    if (patch.status !== undefined) {
      if (!TASK_STATUSES.includes(patch.status)) throw new Error(`bad status ${patch.status}`);
      set('status', patch.status);
      sets.push(patch.status === 'done' ? `done_at = COALESCE(done_at, now())` : `done_at = NULL`);
    }
    if (sets.length === 0) return this.getTask(id);
    sets.push('updated_at = now()');
    const { rows } = await this.pool.query(`UPDATE tasks SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
    return rows[0] ?? null;
  }

  async getTask(id: number): Promise<Task | null> {
    const { rows } = await this.pool.query(`SELECT * FROM tasks WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  async deleteTask(id: number): Promise<Task | null> {
    const { rows } = await this.pool.query(`DELETE FROM tasks WHERE id = $1 RETURNING *`, [id]);
    return rows[0] ?? null;
  }

  async listTasks(f: TaskFilter = {}): Promise<Task[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.project) {
      params.push(normProject(f.project));
      where.push(`project = $${params.length}`);
    }
    if (f.status === 'open') where.push(`status <> 'done'`);
    else if (f.status) {
      params.push(f.status);
      where.push(`status = $${params.length}`);
    }
    if (f.assignee) {
      params.push(f.assignee);
      where.push(`assignee = $${params.length}`);
    }
    params.push(Math.min(Math.max(f.limit ?? 500, 1), 2000));
    const { rows } = await this.pool.query(
      `SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY (status = 'done'), priority, project,
                array_position(ARRAY['doing','blocked','todo','backlog','done'], status), updated_at DESC
       LIMIT $${params.length}`,
      params,
    );
    return rows;
  }

  // ---- permission relay -------------------------------------------------

  async addPermission(p: { request_id: string; session: string; tool_name: string; description: string; input_preview: string }): Promise<PermissionRequest> {
    const { rows } = await this.pool.query(
      `INSERT INTO permission_requests (request_id, session, tool_name, description, input_preview)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session, request_id) DO UPDATE SET tool_name = EXCLUDED.tool_name
       RETURNING *`,
      [p.request_id, p.session, p.tool_name, p.description, p.input_preview],
    );
    return rows[0];
  }

  async decidePermission(session: string, request_id: string, behavior: 'allow' | 'deny', by: string): Promise<PermissionRequest | null> {
    const { rows } = await this.pool.query(
      `UPDATE permission_requests SET status = $3, decided_by = $4, decided_at = now()
       WHERE session = $1 AND request_id = $2 AND status = 'pending' RETURNING *`,
      [session, request_id, behavior, by],
    );
    return rows[0] ?? null;
  }

  async pendingPermissions(): Promise<PermissionRequest[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM permission_requests WHERE status = 'pending' AND created_at > now() - interval '1 hour' ORDER BY created_at`,
    );
    return rows;
  }

  /** A session's bridge went away: its open prompts can no longer be answered remotely. */
  async expirePermissions(session: string): Promise<PermissionRequest[]> {
    const { rows } = await this.pool.query(
      `UPDATE permission_requests SET status = 'expired', decided_at = now()
       WHERE session = $1 AND status = 'pending' RETURNING *`,
      [session],
    );
    return rows;
  }

  // ---- app releases -----------------------------------------------------

  async addRelease(r: Omit<AppRelease, 'created_at'>): Promise<AppRelease> {
    const { rows } = await this.pool.query(
      `INSERT INTO app_releases (version_code, version_name, filename, sha256, size_bytes, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [r.version_code, r.version_name, r.filename, r.sha256, r.size_bytes, r.notes],
    );
    return rows[0];
  }

  async latestRelease(): Promise<AppRelease | null> {
    const { rows } = await this.pool.query(`SELECT * FROM app_releases ORDER BY version_code DESC LIMIT 1`);
    return rows[0] ?? null;
  }
}

function normProject(p: string | undefined): string {
  const v = (p ?? '').trim().toLowerCase();
  return v || 'inbox';
}
