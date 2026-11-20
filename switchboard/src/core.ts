// The switchboard itself: who is connected, where a message goes, and what
// every client should hear about it. Transport-agnostic so tests can drive it.

import type { NewMessage, SessionRow, Store } from './db.ts';
import type {
  AppRelease, BridgeInbound, BridgeOutbound, ClientEvent, Message, PermissionRequest, Session, Task,
} from './protocol.ts';
import { SESSION_NAME_RE, type Tmux } from './tmux.ts';

/** Anything we can push JSON at: a WebSocket in production, an array in tests. */
export interface Peer {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface LaunchRequest {
  name: string;
  cwd?: string;
  role?: 'orchestrator' | 'worker';
  description?: string;
  /** First instruction, delivered through the channel once the session is up. */
  prompt?: string;
  /** Who asked for it: 'user' or a session name. */
  requested_by?: string;
  args?: string;
}

export interface CoreOptions {
  store: Store;
  tmux: Tmux;
  /** Env every launched session gets so its channel bridge can find us. */
  bridgeEnv: Record<string, string>;
  defaultCwd: string;
  /** Display name for you in the message log. */
  userName?: string;
  log?: (msg: string) => void;
}

const VOICE_VERDICT = /^\s*(yes|y|yep|yeah|allow|approve|approved|ok|okay|go ahead|no|n|nope|deny|denied|reject)\s*[.!]?\s*$/i;
const ID_VERDICT = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i;

export class Core {
  readonly bridges = new Map<string, Peer>();
  readonly clients = new Set<Peer>();
  private lastSessionsJson = '';
  readonly userName: string;

  private readonly o: CoreOptions;

  constructor(o: CoreOptions) {
    this.o = o;
    this.userName = o.userName ?? 'you';
  }

  private log(m: string) {
    this.o.log?.(m);
  }

  // ---- clients (web UI, phone) -------------------------------------------

  async addClient(peer: Peer): Promise<void> {
    this.clients.add(peer);
    const hello: ClientEvent = {
      type: 'hello',
      sessions: await this.sessions(),
      pending_permissions: await this.o.store.pendingPermissions(),
      latest_release: await this.o.store.latestRelease(),
    };
    peer.send(JSON.stringify(hello));
  }

  removeClient(peer: Peer): void {
    this.clients.delete(peer);
  }

  broadcast(ev: ClientEvent): void {
    const data = JSON.stringify(ev);
    for (const c of this.clients) {
      try {
        c.send(data);
      } catch {
        this.clients.delete(c);
      }
    }
  }

  // ---- bridges (one per Claude Code session) -----------------------------

  async addBridge(name: string, peer: Peer, info: { cwd?: string } = {}): Promise<void> {
    if (!SESSION_NAME_RE.test(name)) throw new Error(`invalid session name "${name}"`);
    const prev = this.bridges.get(name);
    if (prev && prev !== peer) prev.close(4000, 'replaced by a newer connection');
    this.bridges.set(name, peer);
    await this.o.store.upsertSession({ name, cwd: info.cwd ?? null });
    await this.o.store.touchSession(name, true);
    this.log(`bridge up: ${name}`);
    // Anything sent while it was offline goes now, in order.
    for (const m of await this.o.store.pendingFor(name)) this.toBridge(name, { type: 'deliver', message: m });
    await this.publishSessions(true);
  }

  async removeBridge(name: string, peer: Peer): Promise<void> {
    if (this.bridges.get(name) !== peer) return; // already replaced
    this.bridges.delete(name);
    await this.o.store.touchSession(name);
    for (const p of await this.o.store.expirePermissions(name)) this.broadcast({ type: 'permission', request: p });
    this.log(`bridge down: ${name}`);
    await this.publishSessions(true);
  }

  async fromBridge(name: string, msg: BridgeOutbound): Promise<void> {
    if (msg.type === 'ack') {
      await this.o.store.markDelivered(msg.ids);
      return;
    }
    if (msg.type === 'permission_request') {
      const req = await this.o.store.addPermission({ ...msg, session: name });
      this.broadcast({ type: 'permission', request: req });
      await this.post({
        kind: 'permission',
        from_kind: 'session',
        from_name: name,
        to_kind: 'user',
        to_name: this.userName,
        body: `${name} wants to use ${msg.tool_name}: ${msg.description}`,
        speak: true,
        meta: { request_id: msg.request_id, tool_name: msg.tool_name, input_preview: msg.input_preview },
      });
    }
  }

  private toBridge(name: string, msg: BridgeInbound): boolean {
    const b = this.bridges.get(name);
    if (!b) return false;
    try {
      b.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  // ---- messages ---------------------------------------------------------

  /** Store, deliver if the target is a session, and show it to every client. */
  async post(m: NewMessage): Promise<Message> {
    const msg = await this.o.store.insertMessage(m);
    if (msg.to_kind === 'session') this.toBridge(msg.to_name, { type: 'deliver', message: msg });
    this.broadcast({ type: 'message', message: msg });
    return msg;
  }

  /**
   * You said something to a session (typed, or spoken on the phone). A bare
   * "yes"/"no" while that session has exactly one open permission prompt
   * answers the prompt instead of becoming a chat message — that is what makes
   * approvals work hands-free.
   */
  async fromUser(to: string | undefined, body: string, meta: Record<string, unknown> = {}): Promise<Message> {
    const target = to || (await this.o.store.orchestratorName());
    if (!target) throw new HttpError(409, 'no orchestrator session yet; say which session this is for');
    const text = body.trim();
    if (!text) throw new HttpError(400, 'empty message');

    const pending = (await this.o.store.pendingPermissions()).filter((p) => p.session === target);
    const byId = text.match(ID_VERDICT);
    const bare = text.match(VOICE_VERDICT);
    let verdict: { req: PermissionRequest; allow: boolean } | null = null;
    if (byId) {
      const req = pending.find((p) => p.request_id === byId[2].toLowerCase());
      if (req) verdict = { req, allow: byId[1].toLowerCase().startsWith('y') };
    } else if (bare && pending.length === 1) {
      verdict = { req: pending[0], allow: !/^(n|no|nope|deny|denied|reject)/i.test(bare[1]) };
    }
    if (verdict) {
      await this.decide(verdict.req.session, verdict.req.request_id, verdict.allow ? 'allow' : 'deny', this.userName);
      return this.o.store.insertMessage({
        kind: 'verdict', from_kind: 'user', from_name: this.userName, to_kind: 'session', to_name: target,
        body: text, meta: { ...meta, request_id: verdict.req.request_id },
      }).then(async (m) => {
        await this.o.store.markDelivered([m.id]);
        const done = { ...m, delivered: true };
        this.broadcast({ type: 'message', message: done });
        return done;
      });
    }
    return this.post({ from_kind: 'user', from_name: this.userName, to_kind: 'session', to_name: target, body: text, meta });
  }

  /** A session said something, to you or to another session. */
  async fromSession(from: string, to: string, body: string, opts: { speak?: boolean; meta?: Record<string, unknown> } = {}): Promise<Message> {
    if (!body.trim()) throw new HttpError(400, 'empty message');
    const toUser = to === 'user' || to === this.userName || to === '';
    if (!toUser) {
      if (to === from) throw new HttpError(400, 'a session cannot message itself');
      const known = await this.o.store.getSession(to);
      if (!known) throw new HttpError(404, `no session named ${to}; list_sessions shows who exists`);
    }
    return this.post({
      from_kind: 'session', from_name: from,
      to_kind: toUser ? 'user' : 'session', to_name: toUser ? this.userName : to,
      body, speak: toUser ? (opts.speak ?? true) : false, meta: opts.meta,
    });
  }

  // ---- permission relay -------------------------------------------------

  async decide(session: string, request_id: string, behavior: 'allow' | 'deny', by: string): Promise<PermissionRequest> {
    const req = await this.o.store.decidePermission(session, request_id, behavior, by);
    if (!req) throw new HttpError(409, 'that request is already answered or expired');
    if (!this.toBridge(session, { type: 'verdict', request_id, behavior })) {
      throw new HttpError(503, `${session} is not connected, so the answer cannot reach it`);
    }
    this.broadcast({ type: 'permission', request: req });
    return req;
  }

  // ---- sessions ---------------------------------------------------------

  async sessions(): Promise<Session[]> {
    const [rows, alive] = await Promise.all([this.o.store.listSessions(), this.o.tmux.alive()]);
    const out: Session[] = rows.map((r: SessionRow) => ({ ...r, online: this.bridges.has(r.name), tmux_alive: alive.has(r.name) }));
    return out;
  }

  /** Broadcast the session list if it changed (or always, when forced). */
  async publishSessions(force = false): Promise<void> {
    const sessions = await this.sessions();
    const json = JSON.stringify(sessions.map((s) => [s.name, s.online, s.tmux_alive, s.role, s.description, s.archived]));
    if (!force && json === this.lastSessionsJson) return;
    this.lastSessionsJson = json;
    this.broadcast({ type: 'sessions', sessions });
  }

  async launch(req: LaunchRequest): Promise<Session> {
    const name = req.name.trim().toLowerCase();
    if (!SESSION_NAME_RE.test(name)) throw new HttpError(400, `invalid session name "${req.name}" (a-z, 0-9, -, max 40)`);
    if (await this.o.tmux.isAlive(name)) throw new HttpError(409, `${name} is already running`);
    const cwd = req.cwd || this.o.defaultCwd;
    const target = await this.o.tmux.launch({
      name, cwd, args: req.args,
      env: { ...this.o.bridgeEnv, SB_SESSION: name },
    });
    await this.o.store.upsertSession({ name, cwd, role: req.role, description: req.description, tmux_target: target });
    const by = req.requested_by || this.userName;
    await this.post({
      kind: 'system', from_kind: 'system', from_name: 'switchboard', to_kind: 'user', to_name: this.userName,
      body: `${by === this.userName ? 'You' : by} started ${name} in ${cwd}`, meta: { session: name },
    });
    if (req.prompt?.trim()) {
      // Queued now, delivered the moment its channel connects.
      const fromUser = by === this.userName;
      await this.post({
        from_kind: fromUser ? 'user' : 'session', from_name: by, to_kind: 'session', to_name: name, body: req.prompt.trim(),
      });
    }
    void this.o.tmux.clearStartupDialogs(name).then(
      (answered) => answered.length && this.log(`${name}: answered startup dialogs ${answered.join(', ')}`),
      () => {},
    );
    await this.publishSessions(true);
    return (await this.sessions()).find((s) => s.name === name)!;
  }

  async stop(name: string, opts: { archive?: boolean; by?: string } = {}): Promise<void> {
    if (await this.o.tmux.isAlive(name)) await this.o.tmux.kill(name);
    if (opts.archive) await this.o.store.archiveSession(name);
    await this.post({
      kind: 'system', from_kind: 'system', from_name: 'switchboard', to_kind: 'user', to_name: this.userName,
      body: `${opts.by && opts.by !== this.userName ? opts.by : 'You'} stopped ${name}${opts.archive ? ' and archived it' : ''}`,
      meta: { session: name },
    });
    await this.publishSessions(true);
  }

  // ---- tasks & releases: storage plus a broadcast ------------------------

  taskChanged(task: Task, deleted = false): void {
    this.broadcast({ type: 'task', task, deleted });
  }

  released(release: AppRelease): void {
    this.broadcast({ type: 'app_release', release });
  }
}

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
