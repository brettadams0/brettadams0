// End-to-end: real Postgres, real HTTP/WebSocket server, real channel process
// spoken to over MCP stdio exactly as Claude Code would, real tmux.
//
//   DATABASE_URL=postgres://sb:sb@127.0.0.1/switchboard_test npm test

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import pg from 'pg';
import WebSocket from 'ws';
import type { Config } from '../src/config.ts';
import type { ClientEvent, Message, Task } from '../src/protocol.ts';
import { startServer, type RunningServer } from '../src/server.ts';
import { Tmux, menuKeys, STARTUP_DIALOGS } from '../src/tmux.ts';

const DB = process.env.DATABASE_URL || 'postgres://sb:sb@127.0.0.1/switchboard_test';
const TOKEN = 'test-token-123';
const CHANNEL = fileURLToPath(new URL('../src/channel.ts', import.meta.url));
const FAKE_CLAUDE = fileURLToPath(new URL('./fake-claude.sh', import.meta.url));
const SOCKET = `sbtest-${process.pid}`;

let srv: RunningServer;
let base: string;
const dataDir = mkdtempSync(join(tmpdir(), 'sb-test-'));
const tmux = new Tmux({ socket: SOCKET, claudeCmd: FAKE_CLAUDE });

before(async () => {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  await c.query('DROP TABLE IF EXISTS messages, sessions, tasks, permission_requests, app_releases CASCADE');
  await c.end();
  const cfg: Config = {
    url: '', token: TOKEN, host: '127.0.0.1', port: 0, databaseUrl: DB, dataDir,
    defaultCwd: tmpdir(), userName: 'you',
  };
  srv = await startServer(cfg, tmux);
  base = srv.url;
  // Bridges launched by the server must find it; patch now that the port is known.
  (srv.core as any).o.bridgeEnv = { SB_URL: base, SB_TOKEN: TOKEN };
});

after(async () => {
  for (const b of bridges) await b.close().catch(() => {});
  await tmux.kill('worker-t').catch(() => {});
  await srv.close();
});

// ---- helpers ------------------------------------------------------------------

async function api<T = any>(method: string, path: string, body?: unknown, session?: string): Promise<{ status: number; data: T }> {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(session ? { 'x-sb-session': session } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as T };
}

/** A web/phone client: collects every event it receives. */
async function uiClient() {
  const events: ClientEvent[] = [];
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?role=client&token=${TOKEN}`);
  ws.on('message', (d) => events.push(JSON.parse(String(d))));
  await new Promise((r) => ws.once('open', r));
  await until(() => events.some((e) => e.type === 'hello'));
  return { ws, events };
}

/** Launch the real channel.ts as Claude Code would, and record what it pushes. */
const bridges: Client[] = [];
async function bridge(name: string) {
  const pushed: { method: string; params: any }[] = [];
  const client = new Client({ name: 'fake-claude-code', version: '0.0.0' }, { capabilities: {} });
  client.fallbackNotificationHandler = async (n) => {
    pushed.push(n as any);
  };
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [CHANNEL],
    env: { ...process.env, SB_URL: base, SB_TOKEN: TOKEN, SB_SESSION: name, SB_HOME: dataDir } as Record<string, string>,
    stderr: 'ignore',
  }));
  bridges.push(client);
  clientsBy.set(name, client);
  pushedBy.set(name, pushed);
  await until(async () => (await api<any[]>('GET', '/api/sessions')).data.some((s) => s.name === name && s.online));
  const call = async (tool: string, args: Record<string, unknown> = {}) => {
    const r: any = await client.callTool({ name: tool, arguments: args });
    return { text: r.content[0].text as string, isError: !!r.isError };
  };
  return { client, pushed, call };
}

async function until(fn: () => boolean | Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('condition not met in time');
}

// ---- tests --------------------------------------------------------------------

describe('auth', () => {
  test('rejects requests without the token', async () => {
    const res = await fetch(base + '/api/sessions');
    assert.equal(res.status, 401);
    const bad = await fetch(base + '/api/sessions', { headers: { authorization: 'Bearer nope' } });
    assert.equal(bad.status, 401);
  });
  test('serves the web UI without a token (it asks for one)', async () => {
    const res = await fetch(base + '/');
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<title>Switchboard<\/title>/);
  });
});

describe('channel bridge', () => {
  test('declares itself a channel with permission relay, and lists its tools', async () => {
    const b = await bridge('main');
    const caps = b.client.getServerCapabilities() as any;
    assert.deepEqual(caps.experimental['claude/channel'], {});
    assert.deepEqual(caps.experimental['claude/channel/permission'], {});
    assert.match(b.client.getInstructions() ?? '', /session named "main"/);
    const tools = (await b.client.listTools()).tools.map((t) => t.name);
    for (const t of ['reply', 'send_to_session', 'start_session', 'search_history', 'task_add', 'release_app']) assert.ok(tools.includes(t), t);
    await api('PATCH', '/api/sessions/main', { role: 'orchestrator' });
  });

  test('a message you send is pushed into the session as a channel event', async () => {
    const ui = await uiClient();
    const sent = await api<Message>('POST', '/api/messages', { to: 'main', body: 'what is on the backlog?' });
    assert.equal(sent.status, 201);
    await until(() => pushedTo('main').some((n) => n.params.content === 'what is on the backlog?'));
    const ev = pushedTo('main').find((n) => n.params.content === 'what is on the backlog?')!;
    assert.equal(ev.method, 'notifications/claude/channel');
    assert.equal(ev.params.meta.from_kind, 'user');
    assert.equal(ev.params.meta.from, 'you');
    assert.equal(ev.params.meta.message_id, String(sent.data.id));
    for (const k of Object.keys(ev.params.meta)) assert.match(k, /^[A-Za-z0-9_]+$/, 'meta keys must be identifiers');
    await until(async () => (await api<Message[]>('GET', '/api/messages?session=main')).data.find((m) => m.id === sent.data.id)!.delivered);
    assert.ok(ui.events.some((e) => e.type === 'message' && e.message.id === sent.data.id), 'UI saw it');
    ui.ws.close();
  });

  test('no target means the orchestrator', async () => {
    const r = await api<Message>('POST', '/api/messages', { body: 'hello boss' });
    assert.equal(r.data.to_name, 'main');
  });

  test('reply reaches every UI, flagged to be spoken', async () => {
    const ui = await uiClient();
    const r = await call('main', 'reply', { text: 'Three things on it.' });
    assert.equal(r.isError, false, r.text);
    await until(() => ui.events.some((e) => e.type === 'message' && e.message.body === 'Three things on it.'));
    const m = (ui.events.find((e) => e.type === 'message' && e.message.body === 'Three things on it.') as any).message as Message;
    assert.equal(m.from_name, 'main');
    assert.equal(m.to_kind, 'user');
    assert.equal(m.speak, true);
    ui.ws.close();
  });

  test('sessions message each other; messages to an offline session queue until it connects', async () => {
    const r = await call('main', 'send_to_session', { session: 'nobody', text: 'hi' });
    assert.equal(r.isError, true);
    // A session that exists but is offline: create it, then message it.
    await api('PATCH', '/api/sessions/worker-a', { description: 'tests' });
    const q = await call('main', 'send_to_session', { session: 'worker-a', text: 'run the tests please' });
    assert.match(q.text, /queued/);
    await bridge('worker-a');
    await until(() => pushedTo('worker-a').some((n) => n.params.content === 'run the tests please'));
    const ev = pushedTo('worker-a').find((n) => n.params.content === 'run the tests please')!;
    assert.equal(ev.params.meta.from_kind, 'session');
    assert.equal(ev.params.meta.from, 'main');
  });

  test('list_sessions shows who is connected', async () => {
    const r = await call('main', 'list_sessions');
    assert.match(r.text, /main \(you\) \[orchestrator\] connected/);
    assert.match(r.text, /worker-a \[worker\] connected/);
  });
});

describe('permission relay', () => {
  test('a prompt goes to the phone, and the tapped answer goes back to the session', async () => {
    const ui = await uiClient();
    const c = clientFor('worker-a');
    await c.notification({
      method: 'notifications/claude/channel/permission_request',
      params: { request_id: 'abcde', tool_name: 'Bash', description: 'Run the test suite', input_preview: '{"command":"npm test"}' },
    } as any);
    await until(() => ui.events.some((e) => e.type === 'permission' && e.request.request_id === 'abcde'));
    const spoken = ui.events.find((e) => e.type === 'message' && e.message.kind === 'permission') as any;
    assert.equal(spoken.message.speak, true);
    assert.match(spoken.message.body, /worker-a wants to use Bash: Run the test suite/);

    const r = await api('POST', '/api/permissions/worker-a/abcde', { behavior: 'allow' });
    assert.equal(r.status, 200);
    await until(() => pushedTo('worker-a').some((n) => n.method === 'notifications/claude/channel/permission'));
    const v = pushedTo('worker-a').find((n) => n.method === 'notifications/claude/channel/permission')!;
    assert.deepEqual(v.params, { request_id: 'abcde', behavior: 'allow' });

    const again = await api('POST', '/api/permissions/worker-a/abcde', { behavior: 'deny' });
    assert.equal(again.status, 409, 'answered once only');
    ui.ws.close();
  });

  test('saying just "no" answers the one open prompt, hands-free', async () => {
    const c = clientFor('worker-a');
    await c.notification({
      method: 'notifications/claude/channel/permission_request',
      params: { request_id: 'fghij', tool_name: 'Write', description: 'Write config', input_preview: '{}' },
    } as any);
    await until(async () => (await api<any[]>('GET', '/api/permissions')).data.some((p) => p.request_id === 'fghij'));
    const before = pushedTo('worker-a').length;
    const r = await api<Message>('POST', '/api/messages', { to: 'worker-a', body: 'No.' });
    assert.equal(r.data.kind, 'verdict');
    await until(() => pushedTo('worker-a').slice(before).some((n) => n.method === 'notifications/claude/channel/permission'));
    const v = pushedTo('worker-a').slice(before).find((n) => n.method === 'notifications/claude/channel/permission')!;
    assert.equal(v.params.behavior, 'deny');
    assert.ok(!pushedTo('worker-a').slice(before).some((n) => n.params?.content === 'No.'), 'not delivered as chat');
  });

  test('"yes" with nothing pending is just a chat message', async () => {
    const r = await api<Message>('POST', '/api/messages', { to: 'worker-a', body: 'yes' });
    assert.equal(r.data.kind, 'chat');
  });
});

describe('history', () => {
  test('full-text search finds old messages, stemmed and by substring', async () => {
    await api('POST', '/api/messages', { to: 'main', body: 'The deploy key lives in vault at secret/deploy-keys/prod_v2' });
    const stem = await api<Message[]>('GET', '/api/search?q=deploying');
    assert.ok(stem.data.some((m) => m.body.includes('vault')));
    const sub = await api<Message[]>('GET', '/api/search?q=prod_v2');
    assert.ok(sub.data.some((m) => m.body.includes('vault')));
    const viaTool = await call('worker-a', 'search_history', { query: 'vault' });
    assert.match(viaTool.text, /secret\/deploy-keys/);
  });
});

describe('tasks', () => {
  test('add, list by priority, move through statuses, delete — from UI and from a session', async () => {
    const ui = await uiClient();
    const a = await api<Task>('POST', '/api/tasks', { title: 'Ship web UI', project: 'Switchboard', priority: 'p1', status: 'todo' });
    assert.equal(a.status, 201);
    assert.equal(a.data.project, 'switchboard');
    const viaTool = await call('main', 'task_add', { title: 'Fix flaky test', project: 'switchboard', priority: 0 });
    assert.match(viaTool.text, /\[p0 backlog\] switchboard: Fix flaky test/);
    const list = await api<Task[]>('GET', '/api/tasks?project=switchboard&status=open');
    assert.deepEqual(list.data.map((t) => t.priority), [0, 1]);
    const done = await api<Task>('PATCH', `/api/tasks/${a.data.id}`, { status: 'done' });
    assert.ok(done.data.done_at);
    const reopened = await api<Task>('PATCH', `/api/tasks/${a.data.id}`, { status: 'doing' });
    assert.equal(reopened.data.done_at, null);
    assert.equal((await api('PATCH', `/api/tasks/${a.data.id}`, { status: 'nope' })).status, 400);
    assert.equal((await api('PATCH', `/api/tasks/${a.data.id}`, { priority: 9 })).status, 400);
    const open = await call('main', 'task_list', {});
    assert.match(open.text, /Fix flaky test/);
    await until(() => ui.events.filter((e) => e.type === 'task').length >= 3);
    assert.equal((await api('DELETE', `/api/tasks/${a.data.id}`)).status, 200);
    ui.ws.close();
  });
});

describe('tmux sessions', () => {
  test('start_session launches claude in tmux, answers the startup dialog, and queues the prompt', async () => {
    const log = join(dataDir, 'fake-claude.log');
    (srv.core as any).o.bridgeEnv = { SB_URL: base, SB_TOKEN: TOKEN, FAKE_CLAUDE_LOG: log };
    const r = await call('main', 'start_session', { name: 'worker-t', cwd: dataDir, prompt: 'refactor the parser', description: 'parser work' });
    assert.equal(r.isError, false, r.text);
    await until(() => existsSync(log), 10_000);
    const rec = readFileSync(log, 'utf8');
    assert.match(rec, /^key: args:/, 'confirmed "I am using this for local development" (cursor already on it)');
    assert.match(rec, /--dangerously-load-development-channels server:switchboard/);
    const ss = (await api<any[]>('GET', '/api/sessions')).data;
    const w = ss.find((s) => s.name === 'worker-t');
    assert.equal(w.tmux_alive, true);
    assert.equal(w.description, 'parser work');
    const pending = (await api<Message[]>('GET', '/api/messages?session=worker-t')).data.find((m) => m.body === 'refactor the parser')!;
    assert.equal(pending.from_name, 'main');
    assert.equal(pending.delivered, false, 'waits for its channel');

    const peek = await call('main', 'peek_session', { name: 'worker-t' });
    assert.match(peek.text, /\? for shortcuts/);
    const dup = await call('main', 'start_session', { name: 'worker-t' });
    assert.equal(dup.isError, true);

    const stop = await call('main', 'stop_session', { name: 'worker-t' });
    assert.equal(stop.isError, false);
    assert.equal(await tmux.isAlive('worker-t'), false);
  });

  test('rejects unsafe session names', async () => {
    const r = await api('POST', '/api/sessions', { name: 'x; rm -rf /' });
    assert.equal(r.status, 400);
  });

  test('moves the menu cursor to the wanted option instead of accepting the default', () => {
    const trust = STARTUP_DIALOGS.find((d) => d.id === 'trust-folder')!;
    const screen = ' Quick safety check: Is this a project you created or one you trust?\n\n ❯ No, exit\n   Yes, I trust this folder\n\n Enter to confirm · Esc to cancel\n';
    assert.ok(trust.match.test(screen));
    assert.deepEqual(menuKeys(screen, trust.choose!), ['Down', 'Enter']);
    const dev = STARTUP_DIALOGS.find((d) => d.id === 'dev-channels')!;
    assert.deepEqual(menuKeys(' ❯ 1. I am using this for local development\n   2. Exit\n', dev.choose!), ['Enter']);
    assert.deepEqual(menuKeys('   1. Exit\n ❯ 2. Something\n   3. Yes, I trust this folder', trust.choose!), ['Down', 'Enter']);
    assert.deepEqual(menuKeys('   1. Yes, I trust this folder\n ❯ 2. No', trust.choose!), ['Up', 'Enter']);
    assert.equal(menuKeys('no cursor here\nYes, I trust this folder', trust.choose!), null, 'never guess');
  });

});

describe('phone app releases', () => {
  test('upload a build, phones see it, download it back byte-for-byte; codes must increase', async () => {
    const ui = await uiClient();
    const apk = join(dataDir, 'fake.apk');
    writeFileSync(apk, Buffer.from('PK\u0003\u0004 not really an apk'));
    const r = await call('main', 'release_app', { apk_path: apk, version_code: 5, version_name: '0.1.5', notes: 'louder voice' });
    assert.equal(r.isError, false, r.text);
    await until(() => ui.events.some((e) => e.type === 'app_release' && e.release.version_code === 5));
    const latest = await api<any>('GET', '/api/app/latest');
    assert.equal(latest.data.version_code, 5);
    const dl = await fetch(base + latest.data.url, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(dl.status, 200);
    assert.deepEqual(Buffer.from(await dl.arrayBuffer()), readFileSync(apk));
    const old = await call('main', 'release_app', { apk_path: apk, version_code: 5, version_name: 'again' });
    assert.equal(old.isError, true);
    assert.match(old.text, /must be greater/);
    ui.ws.close();
  });
});

describe('resilience', () => {
  test('a newer bridge with the same name replaces the old one', async () => {
    const b = await bridge('dup');
    const b2 = await bridge('dup');
    await api('POST', '/api/messages', { to: 'dup', body: 'which one?' });
    await until(() => b2.pushed.some((n) => n.params?.content === 'which one?'));
    assert.ok(!b.pushed.some((n) => n.params?.content === 'which one?'));
  });

  test('an archived session stays archived when its channel disconnects afterwards', async () => {
    const b = await bridge('gone');
    await api('DELETE', '/api/sessions/gone?archive=1');
    await b.client.close();
    await new Promise((r) => setTimeout(r, 300));
    const ss = (await api<any[]>('GET', '/api/sessions')).data;
    assert.ok(!ss.some((s) => s.name === 'gone'));
  });

  test('when a session disconnects, its open prompts expire', async () => {
    const b = await bridge('short');
    await b.client.notification({
      method: 'notifications/claude/channel/permission_request',
      params: { request_id: 'kmnop', tool_name: 'Bash', description: 'x', input_preview: '{}' },
    } as any);
    await until(async () => (await api<any[]>('GET', '/api/permissions')).data.some((p) => p.request_id === 'kmnop'));
    await b.client.close();
    await until(async () => !(await api<any[]>('GET', '/api/permissions')).data.some((p) => p.request_id === 'kmnop'));
  });
});

describe('sessions not started through the switchboard', () => {
  test('get the tools but never register to receive (their pushes would be dropped)', async () => {
    const client = new Client({ name: 'plain-claude', version: '0.0.0' }, { capabilities: {} });
    const cwd = mkdtempSync(join(tmpdir(), 'plainproj-'));
    const env = { ...process.env, SB_URL: base, SB_TOKEN: TOKEN, SB_HOME: dataDir } as Record<string, string>;
    delete env.SB_SESSION;
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [CHANNEL], env, cwd, stderr: 'ignore' }));
    bridges.push(client);
    assert.match(client.getInstructions() ?? '', /not started through the switchboard/);
    const r: any = await client.callTool({ name: 'reply', arguments: { text: 'hello from a plain session' } });
    assert.ok(!r.isError, r.content?.[0]?.text);
    await new Promise((res) => setTimeout(res, 400));
    const ss = (await api<any[]>('GET', '/api/sessions')).data;
    const name = cwd.split('/').pop()!.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    assert.ok(!ss.some((s) => s.name === name && s.online), 'not registered as connected');
    const log = (await api<Message[]>('GET', '/api/messages?limit=5')).data;
    assert.ok(log.some((m) => m.body === 'hello from a plain session' && m.from_name === name));
  });
});

// ---- per-bridge accessors (the latest bridge for a name wins) ------------------

const pushedBy = new Map<string, { method: string; params: any }[]>();
const clientsBy = new Map<string, Client>();
function pushedTo(name: string) {
  return pushedBy.get(name) ?? [];
}
function clientFor(name: string) {
  return clientsBy.get(name)!;
}
async function call(name: string, tool: string, args: Record<string, unknown> = {}) {
  if (!clientsBy.has(name)) await bridge(name);
  const r: any = await clientsBy.get(name)!.callTool({ name: tool, arguments: args });
  return { text: r.content[0].text as string, isError: !!r.isError };
}
