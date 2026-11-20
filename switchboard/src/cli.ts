// sb — the switchboard from a terminal. Run `sb help`.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_FILE, initConfig, loadConfig } from './config.ts';
import type { Message, Session, Task } from './protocol.ts';

const HELP = `sb — drive Claude Code sessions through the switchboard

Setup
  sb setup [--url URL] [--port N] [--host ADDR] [--db URL] [--cwd DIR] [--name YOU]
                         write ~/.switchboard/config.json (makes a token) and
                         register the channel with Claude Code (user scope)
  sb server              run the server in the foreground
  sb info                show URL + token to type into the phone app / web UI

Sessions
  sb ls                                   list sessions
  sb start NAME [--cwd DIR] [--orchestrator] [--desc TEXT] [--prompt TEXT] [-- CLAUDE FLAGS]
  sb stop NAME [--archive]
  sb send NAME TEXT…                      message a session (NAME "-" = orchestrator)
  sb peek NAME [LINES]                    print its screen
  sb keys NAME KEY…                       send tmux keys (e.g. Enter, Escape, Down)
  sb attach NAME                          tmux attach to it
  sb claude [NAME] [-- CLAUDE FLAGS]      run Claude Code right here, wired to the switchboard
                                          (NAME defaults to this directory's name)

History
  sb log [NAME] [-n N]                    recent messages
  sb search QUERY… [--session NAME]

Tasks
  sb tasks [--project P] [--status S|open|all]
  sb task add TITLE… [-p PROJECT] [-P 0-3] [-s STATUS] [--notes TEXT]
  sb task NAME_OR_ID STATUS               e.g. sb task 12 done
  sb task rm ID

Phone app
  sb release APK --code N --name X [--notes TEXT]
`;

const cfg = loadConfig();
const [cmd = 'help', ...rest] = process.argv.slice(2);

async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  if (!cfg.token) die('not set up: run `sb setup`');
  let res: Response;
  try {
    res = await fetch(cfg.url + path, {
      method,
      headers: { authorization: `Bearer ${cfg.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    die(`cannot reach the switchboard at ${cfg.url} — is \`sb server\` running?`);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) die(data?.error ?? `${res.status} ${res.statusText}`);
  return data;
}

function flags(args: string[]) {
  const pos: string[] = [];
  const f: Record<string, string | true> = {};
  let passthrough: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      passthrough = args.slice(i + 1);
      break;
    }
    if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      const key = a.replace(/^-+/, '');
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        f[key] = next;
        i++;
      } else f[key] = true;
    } else pos.push(a);
  }
  return { pos, f, passthrough };
}

function die(msg: string): never {
  console.error(`sb: ${msg}`);
  process.exit(1);
}

const fmtTask = (t: Task) =>
  `#${String(t.id).padEnd(4)} p${t.priority} ${t.status.padEnd(7)} ${t.project.padEnd(14)} ${t.title}${t.assignee ? `  @${t.assignee}` : ''}`;
const fmtMsg = (m: Message) =>
  `${m.created_at.slice(5, 16).replace('T', ' ')}  ${m.from_name} → ${m.to_name}${m.kind !== 'chat' ? ` [${m.kind}]` : ''}: ${m.body}`;

const { pos, f, passthrough } = flags(rest);
const s = (k: string) => (typeof f[k] === 'string' ? (f[k] as string) : undefined);

switch (cmd) {
  case 'setup': {
    const c = initConfig({
      url: s('url'), port: s('port') ? Number(s('port')) : undefined, host: s('host'),
      databaseUrl: s('db'), defaultCwd: s('cwd'), userName: s('name'),
    });
    const channel = fileURLToPath(new URL('./channel.ts', import.meta.url));
    console.log(`Wrote ${CONFIG_FILE}`);
    const has = spawnSync('claude', ['mcp', 'get', 'switchboard'], { encoding: 'utf8' });
    if (has.status === 0) spawnSync('claude', ['mcp', 'remove', '-s', 'user', 'switchboard'], { stdio: 'ignore' });
    const add = spawnSync('claude', ['mcp', 'add', '-s', 'user', 'switchboard', '--', process.execPath, channel], { encoding: 'utf8' });
    if (add.status === 0) console.log(`Registered the channel with Claude Code: switchboard → node ${channel}`);
    else console.log(`Could not run \`claude mcp add\` (${(add.stderr || add.error?.message || '').trim()}).\nAdd it yourself:\n  claude mcp add -s user switchboard -- ${process.execPath} ${channel}`);
    // Let sessions use the switchboard's own tools (reply, send_to_session, …)
    // without a permission prompt each time.
    const settingsFile = join(homedir(), '.claude', 'settings.json');
    try {
      const settings = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, 'utf8')) : {};
      settings.permissions ??= {};
      settings.permissions.allow ??= [];
      if (!settings.permissions.allow.includes('mcp__switchboard')) {
        settings.permissions.allow.push('mcp__switchboard');
        mkdirSync(dirname(settingsFile), { recursive: true });
        writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
        console.log(`Allowed the switchboard's tools in ${settingsFile} (permissions.allow: "mcp__switchboard")`);
      }
    } catch (e) {
      console.log(`Could not update ${settingsFile}: ${(e as Error).message}. Add "mcp__switchboard" to permissions.allow yourself.`);
    }
    console.log(`\nServer will listen on ${c.host}:${c.port}; bridges reach it at ${c.url}`);
    console.log(`Token: ${c.token}`);
    console.log(`\nNext: sb server   (then)   sb start main --orchestrator`);
    break;
  }
  case 'server': {
    await import('./server.ts').then(async (m) => {
      const srv = await m.startServer(cfg);
      console.log(`switchboard listening on ${srv.url}  (web UI: ${cfg.url}/#token=${cfg.token})`);
      const stop = () => void srv.close().then(() => process.exit(0));
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    });
    break;
  }
  case 'info':
    console.log(`URL:   ${cfg.url}\nToken: ${cfg.token}\nWeb:   ${cfg.url}/#token=${cfg.token}`);
    break;
  case 'ls': {
    const ss = await api<Session[]>('GET', '/api/sessions');
    if (!ss.length) console.log('no sessions — try: sb start main --orchestrator');
    for (const x of ss) {
      const state = x.online ? 'connected' : x.tmux_alive ? 'starting' : 'stopped';
      console.log(`${x.name.padEnd(20)} ${x.role.padEnd(12)} ${state.padEnd(10)} ${x.cwd ?? ''}${x.description ? '  — ' + x.description : ''}`);
    }
    break;
  }
  case 'start': {
    const name = pos[0] ?? die('usage: sb start NAME [--cwd DIR] [--orchestrator] [--prompt TEXT]');
    const x = await api<Session>('POST', '/api/sessions', {
      name, cwd: s('cwd') ?? process.cwd(), role: f.orchestrator ? 'orchestrator' : 'worker',
      description: s('desc'), prompt: s('prompt'), args: passthrough.join(' ') || undefined,
    });
    console.log(`started ${x.name} in ${x.cwd} — watch it with: sb attach ${x.name}`);
    break;
  }
  case 'stop':
    await api('DELETE', `/api/sessions/${encodeURIComponent(pos[0] ?? die('usage: sb stop NAME'))}${f.archive ? '?archive=1' : ''}`);
    console.log('stopped');
    break;
  case 'send': {
    const [to, ...words] = pos;
    if (!to || !words.length) die('usage: sb send NAME TEXT…');
    const m = await api<Message>('POST', '/api/messages', { to: to === '-' ? undefined : to, body: words.join(' ') });
    console.log(`#${m.id} → ${m.to_name}`);
    break;
  }
  case 'peek': {
    const r = await api<{ screen: string }>('GET', `/api/sessions/${encodeURIComponent(pos[0] ?? die('usage: sb peek NAME'))}/screen?lines=${pos[1] ?? 60}`);
    process.stdout.write(r.screen);
    break;
  }
  case 'keys':
    await api('POST', `/api/sessions/${encodeURIComponent(pos[0] ?? die('usage: sb keys NAME KEY…'))}/keys`, { keys: pos.slice(1) });
    break;
  case 'attach': {
    const sock = process.env.SB_TMUX_SOCKET;
    const target = `sb-${pos[0] ?? die('usage: sb attach NAME')}`;
    spawnSync('tmux', [...(sock ? ['-L', sock] : []), 'attach', '-t', target], { stdio: 'inherit' });
    break;
  }
  case 'claude': {
    const name = (pos[0] ?? process.cwd().split('/').pop() ?? 'session').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    const r = spawnSync('claude', ['--dangerously-load-development-channels', 'server:switchboard', ...passthrough], {
      stdio: 'inherit', env: { ...process.env, SB_SESSION: name },
    });
    process.exit(r.status ?? 0);
  }
  case 'log': {
    const p = new URLSearchParams({ limit: s('n') ?? '30' });
    if (pos[0]) p.set('session', pos[0]);
    for (const m of await api<Message[]>('GET', `/api/messages?${p}`)) console.log(fmtMsg(m));
    break;
  }
  case 'search': {
    const p = new URLSearchParams({ q: pos.join(' ') || die('usage: sb search QUERY') });
    if (s('session')) p.set('session', s('session')!);
    for (const m of await api<Message[]>('GET', `/api/search?${p}`)) console.log(`#${m.id} ${fmtMsg(m)}`);
    break;
  }
  case 'tasks': {
    const p = new URLSearchParams();
    if (s('project')) p.set('project', s('project')!);
    const st = s('status') ?? 'open';
    if (st !== 'all') p.set('status', st);
    const ts = await api<Task[]>('GET', `/api/tasks?${p}`);
    console.log(ts.length ? ts.map(fmtTask).join('\n') : 'nothing here');
    break;
  }
  case 'task': {
    const [sub, ...more] = pos;
    if (sub === 'add') {
      const t = await api<Task>('POST', '/api/tasks', {
        title: more.join(' ') || die('usage: sb task add TITLE…'), project: s('p') ?? s('project'),
        priority: s('P') ?? s('priority'), status: s('s') ?? s('status'), notes: s('notes'),
      });
      console.log(fmtTask(t));
    } else if (sub === 'rm') {
      await api('DELETE', `/api/tasks/${Number(more[0])}`);
      console.log('deleted');
    } else if (sub && more[0]) {
      console.log(fmtTask(await api<Task>('PATCH', `/api/tasks/${Number(sub)}`, { status: more[0] })));
    } else die('usage: sb task add TITLE… | sb task ID STATUS | sb task rm ID');
    break;
  }
  case 'release': {
    const apk = pos[0] ?? die('usage: sb release APK --code N --name X [--notes TEXT]');
    const code = s('code') ?? versionCodeOf(apk) ?? die('--code is required (could not read it from the APK)');
    const res = await fetch(`${cfg.url}/api/app/releases`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.token}`, 'content-type': 'application/vnd.android.package-archive',
        'x-version-code': String(code), 'x-version-name': s('name') ?? String(code), 'x-notes': encodeURIComponent(s('notes') ?? ''),
      },
      body: readFileSync(apk),
    }).catch(() => die(`cannot reach the switchboard at ${cfg.url} — is \`sb server\` running?`));
    const out = await res.json();
    if (!res.ok) die(out.error);
    console.log(`released build ${out.version_code} (${out.version_name}), sha256 ${out.sha256.slice(0, 12)}…`);
    break;
  }
  default:
    process.stdout.write(HELP);
}

/** Read versionCode out of an APK with aapt2, when the SDK is around. */
function versionCodeOf(apk: string): string | null {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) return null;
  try {
    const tools = execFileSync('sh', ['-c', `ls -d "${sdk}"/build-tools/* | sort -V | tail -1`], { encoding: 'utf8' }).trim();
    const out = execFileSync(`${tools}/aapt2`, ['dump', 'badging', apk], { encoding: 'utf8' });
    return out.match(/versionCode='(\d+)'/)?.[1] ?? null;
  } catch {
    return null;
  }
}
