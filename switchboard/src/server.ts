// HTTP + WebSocket front door. One process, one port:
//   /            the web UI (static files from ../web)
//   /api/*       JSON API used by the web UI, the phone app, the CLI and bridges
//   /ws          live events: ?role=client for UIs, ?role=bridge&name=… for sessions
//
// Every request needs the token: `Authorization: Bearer <token>` or `?token=`.

import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { loadConfig, type Config } from './config.ts';
import { Core, HttpError, type Peer } from './core.ts';
import { Store } from './db.ts';
import type { BridgeOutbound, TaskStatus } from './protocol.ts';
import { TASK_STATUSES } from './protocol.ts';
import { Tmux } from './tmux.ts';

const WEB_DIR = fileURLToPath(new URL('../web/', import.meta.url));
const MAX_APK_BYTES = 200 * 1024 * 1024;

export interface RunningServer {
  server: Server;
  core: Core;
  store: Store;
  url: string;
  close(): Promise<void>;
}

export async function startServer(cfg: Config, tmux = defaultTmux()): Promise<RunningServer> {
  if (!cfg.token) throw new Error('No token configured. Run `sb setup` first (or set SB_TOKEN).');
  const store = new Store(cfg.databaseUrl);
  await store.migrate();
  mkdirSync(join(cfg.dataDir, 'releases'), { recursive: true });

  const core = new Core({
    store, tmux, defaultCwd: cfg.defaultCwd, userName: cfg.userName,
    bridgeEnv: { SB_URL: cfg.url, SB_TOKEN: cfg.token },
    log: (m) => console.log(new Date().toISOString(), m),
  });

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) json(res, status, { error: err.message ?? String(err) });
      else res.end();
    });
  });

  const authed = (req: IncomingMessage, url: URL): boolean => {
    const h = req.headers.authorization;
    const given = h?.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token') ?? '';
    const a = Buffer.from(given);
    const b = Buffer.from(cfg.token);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (path === '/healthz') return json(res, 200, { ok: true });
    if (!path.startsWith('/api/')) return serveStatic(res, path);
    if (!authed(req, url)) throw new HttpError(401, 'bad or missing token');

    // A Claude session's bridge identifies itself; everyone else is you.
    const asSession = header(req, 'x-sb-session');
    const q = url.searchParams;
    const seg = path.split('/').slice(2).map(decodeURIComponent); // after /api/

    // ---- sessions
    if (seg[0] === 'sessions') {
      if (seg.length === 1 && method === 'GET') return json(res, 200, await core.sessions());
      if (seg.length === 1 && method === 'POST') {
        const b = await body(req);
        const s = await core.launch({
          name: str(b.name, 'name'), cwd: opt(b.cwd), role: b.role === 'orchestrator' ? 'orchestrator' : 'worker',
          description: opt(b.description), prompt: opt(b.prompt), args: opt(b.args), requested_by: asSession ?? undefined,
        });
        return json(res, 201, s);
      }
      const name = seg[1];
      if (seg.length === 2 && method === 'DELETE') {
        await core.stop(name, { archive: q.get('archive') === '1', by: asSession ?? undefined });
        return json(res, 200, { ok: true });
      }
      if (seg.length === 2 && method === 'PATCH') {
        const b = await body(req);
        await store.upsertSession({ name, description: opt(b.description), role: opt(b.role) });
        await core.publishSessions(true);
        return json(res, 200, (await core.sessions()).find((s) => s.name === name) ?? null);
      }
      if (seg[2] === 'screen' && method === 'GET') {
        const text = await tmux.capture(name, Number(q.get('lines') || 60)).catch(() => {
          throw new HttpError(404, `${name} has no tmux session`);
        });
        return json(res, 200, { name, screen: text });
      }
      if (seg[2] === 'keys' && method === 'POST') {
        const b = await body(req);
        if (Array.isArray(b.keys)) await tmux.keys(name, ...b.keys.map(String));
        else await tmux.type(name, String(b.text ?? ''), b.enter !== false);
        return json(res, 200, { ok: true });
      }
    }

    // ---- messages
    if (seg[0] === 'messages' && seg.length === 1) {
      if (method === 'GET') {
        return json(res, 200, await store.history({
          session: q.get('session') || undefined, before: num(q.get('before')), limit: num(q.get('limit')),
        }));
      }
      if (method === 'POST') {
        const b = await body(req);
        const meta = typeof b.meta === 'object' && b.meta ? (b.meta as Record<string, unknown>) : {};
        const m = asSession
          ? await core.fromSession(asSession, String(b.to ?? 'user'), str(b.body, 'body'), { speak: b.speak as boolean | undefined, meta })
          : await core.fromUser(opt(b.to), str(b.body, 'body'), meta);
        return json(res, 201, m);
      }
    }
    if (seg[0] === 'search' && method === 'GET') {
      return json(res, 200, await store.search(str(q.get('q'), 'q'), { session: q.get('session') || undefined, limit: num(q.get('limit')) }));
    }

    // ---- tasks
    if (seg[0] === 'tasks') {
      if (seg.length === 1 && method === 'GET') {
        const status = q.get('status') as TaskStatus | 'open' | null;
        return json(res, 200, await store.listTasks({
          project: q.get('project') || undefined, status: status || undefined,
          assignee: q.get('assignee') || undefined, limit: num(q.get('limit')),
        }));
      }
      if (seg.length === 1 && method === 'POST') {
        const b = await body(req);
        const t = await store.addTask({
          title: str(b.title, 'title'), notes: opt(b.notes), project: opt(b.project),
          status: status(b.status), priority: prio(b.priority), assignee: opt(b.assignee) ?? null,
          created_by: asSession ?? cfg.userName,
        });
        core.taskChanged(t);
        return json(res, 201, t);
      }
      const id = Number(seg[1]);
      if (seg.length === 2 && method === 'PATCH') {
        const b = await body(req);
        const t = await store.updateTask(id, {
          title: opt(b.title), notes: b.notes === undefined ? undefined : String(b.notes), project: opt(b.project),
          status: status(b.status), priority: prio(b.priority),
          assignee: b.assignee === undefined ? undefined : (b.assignee ? String(b.assignee) : null),
        });
        if (!t) throw new HttpError(404, `no task ${id}`);
        core.taskChanged(t);
        return json(res, 200, t);
      }
      if (seg.length === 2 && method === 'DELETE') {
        const t = await store.deleteTask(id);
        if (!t) throw new HttpError(404, `no task ${id}`);
        core.taskChanged(t, true);
        return json(res, 200, t);
      }
    }

    // ---- permission relay
    if (seg[0] === 'permissions') {
      if (seg.length === 1 && method === 'GET') return json(res, 200, await store.pendingPermissions());
      if (seg.length === 3 && method === 'POST') {
        const b = await body(req);
        const behavior = b.behavior === 'allow' ? 'allow' : b.behavior === 'deny' ? 'deny' : null;
        if (!behavior) throw new HttpError(400, 'behavior must be allow or deny');
        return json(res, 200, await core.decide(seg[1], seg[2], behavior, cfg.userName));
      }
    }

    // ---- phone app self-update
    if (seg[0] === 'app') {
      if (seg[1] === 'latest' && method === 'GET') {
        const r = await store.latestRelease();
        return json(res, 200, r ? { ...r, url: `/api/app/download/${r.version_code}` } : null);
      }
      if (seg[1] === 'download' && method === 'GET') {
        const file = join(cfg.dataDir, 'releases', `switchboard-${Number(seg[2])}.apk`);
        if (!existsSync(file)) throw new HttpError(404, 'no such release');
        res.writeHead(200, {
          'content-type': 'application/vnd.android.package-archive',
          'content-length': statSync(file).size,
          'content-disposition': `attachment; filename="switchboard-${Number(seg[2])}.apk"`,
        });
        createReadStream(file).pipe(res);
        return;
      }
      if (seg[1] === 'releases' && method === 'POST') {
        const code = Number(header(req, 'x-version-code'));
        const name = header(req, 'x-version-name') ?? String(code);
        const notes = decodeURIComponent(header(req, 'x-notes') ?? '');
        if (!Number.isInteger(code) || code <= 0) throw new HttpError(400, 'X-Version-Code header must be a positive integer');
        const latest = await store.latestRelease();
        if (latest && code <= latest.version_code) {
          throw new HttpError(409, `version code ${code} must be greater than the current ${latest.version_code}`);
        }
        const dir = join(cfg.dataDir, 'releases');
        const tmp = join(dir, `.upload-${process.pid}-${Date.now()}`);
        const hash = createHash('sha256');
        let size = 0;
        try {
          await pipeline(req, async function* (src) {
            for await (const chunk of src) {
              size += chunk.length;
              if (size > MAX_APK_BYTES) throw new HttpError(413, 'APK too large');
              hash.update(chunk);
              yield chunk;
            }
          }, createWriteStream(tmp));
          if (size < 4) throw new HttpError(400, 'empty upload');
          const filename = `switchboard-${code}.apk`;
          await rename(tmp, join(dir, filename));
          const rel = await store.addRelease({ version_code: code, version_name: name, filename, sha256: hash.digest('hex'), size_bytes: size, notes });
          core.released(rel);
          await core.post({
            kind: 'system', from_kind: 'system', from_name: 'switchboard', to_kind: 'user', to_name: cfg.userName,
            body: `Phone app ${name} (build ${code}) is out${notes ? ': ' + notes : ''}. It will update itself.`,
            meta: { version_code: code },
          });
          return json(res, 201, rel);
        } finally {
          await rm(tmp, { force: true });
        }
      }
    }

    throw new HttpError(404, `no route for ${method} ${path}`);
  }

  // ---- websockets
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/ws' || !authed(req, url)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onSocket(ws, url));
  });

  function onSocket(ws: WebSocket, url: URL) {
    const peer: Peer = { send: (d) => ws.send(d), close: (c, r) => ws.close(c, r) };
    let alive = true;
    ws.on('pong', () => (alive = true));
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 25_000);
    ws.on('error', () => {});

    if (url.searchParams.get('role') === 'bridge') {
      const name = url.searchParams.get('name') ?? '';
      const ready = core.addBridge(name, peer, { cwd: url.searchParams.get('cwd') ?? undefined }).catch((e) => {
        ws.close(4001, String(e.message).slice(0, 120));
      });
      ws.on('message', async (raw) => {
        await ready;
        try {
          await core.fromBridge(name, JSON.parse(String(raw)) as BridgeOutbound);
        } catch (e) {
          console.error('bridge message', name, e);
        }
      });
      ws.on('close', () => {
        clearInterval(ping);
        void ready.then(() => core.removeBridge(name, peer));
      });
      return;
    }

    void core.addClient(peer);
    ws.on('message', async (raw) => {
      // Clients may also send chat over the socket: {type:'say', to, body}
      try {
        const m = JSON.parse(String(raw));
        if (m?.type === 'say') await core.fromUser(m.to || undefined, String(m.body ?? ''), m.meta ?? {});
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', error: (e as Error).message }));
      }
    });
    ws.on('close', () => {
      clearInterval(ping);
      core.removeClient(peer);
    });
  }

  // tmux sessions can die without telling anyone (claude exits, machine sleeps).
  const poll = setInterval(() => void core.publishSessions().catch(() => {}), 5_000);

  await new Promise<void>((resolve) => server.listen(cfg.port, cfg.host, resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : cfg.port;
  return {
    server, core, store, url: `http://${cfg.host}:${port}`,
    async close() {
      clearInterval(poll);
      for (const c of wss.clients) c.terminate();
      await new Promise((r) => server.close(r));
      await store.close();
    },
  };
}

// ---- helpers --------------------------------------------------------------

function defaultTmux(): Tmux {
  return new Tmux({
    socket: process.env.SB_TMUX_SOCKET || undefined,
    claudeCmd: process.env.SB_CLAUDE_CMD || undefined,
    claudeArgs: process.env.SB_CLAUDE_ARGS || undefined,
    channelName: process.env.SB_CHANNEL_NAME || undefined,
  });
}

function json(res: ServerResponse, status: number, data: unknown) {
  const s = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(s);
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += c.length;
    if (size > 2 * 1024 * 1024) throw new HttpError(413, 'body too large');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    throw new HttpError(400, 'body must be JSON');
  }
}

function header(req: IncomingMessage, name: string): string | null {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v) || null;
}
function str(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${field} is required`);
  return v;
}
function opt(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}
function num(v: string | null): number | undefined {
  const n = Number(v);
  return v && Number.isFinite(n) ? n : undefined;
}
function status(v: unknown): TaskStatus | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (!TASK_STATUSES.includes(v as TaskStatus)) throw new HttpError(400, `status must be one of ${TASK_STATUSES.join(', ')}`);
  return v as TaskStatus;
}
function prio(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'string' ? Number(v.replace(/^p/i, '')) : Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 3) throw new HttpError(400, 'priority must be 0 (urgent) to 3 (someday)');
  return n;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
};

function serveStatic(res: ServerResponse, path: string) {
  const rel = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '');
  const file = join(WEB_DIR, rel);
  if (!file.startsWith(WEB_DIR) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  createReadStream(file).pipe(res);
}

// `node src/server.ts` runs it.
if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const cfg = loadConfig();
  const s = await startServer(cfg);
  console.log(`switchboard listening on ${s.url}`);
  const stop = () => void s.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
