// Starting, watching and stopping Claude Code sessions, each in its own tmux
// session. You can always `tmux attach -t sb-<name>` to sit in front of one.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface TmuxOptions {
  /** `tmux -L <socket>`; unset uses your normal tmux server so `tmux attach` just works. */
  socket?: string;
  /** Command that starts Claude Code. Overridable for tests and for wrappers. */
  claudeCmd?: string;
  /** Extra flags appended to every launch, e.g. "--permission-mode acceptEdits". */
  claudeArgs?: string;
  /** Name of the channel MCP server as registered with `claude mcp add`. */
  channelName?: string;
}

export interface LaunchSpec {
  name: string;
  cwd: string;
  env: Record<string, string>;
  /** Extra flags for this one launch (model, permission mode, --resume …). */
  args?: string;
}

export const SESSION_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export class Tmux {
  private readonly opts: TmuxOptions;
  constructor(opts: TmuxOptions = {}) {
    this.opts = opts;
  }

  target(name: string): string {
    return `sb-${name}`;
  }

  private async tmux(...args: string[]): Promise<string> {
    const full = this.opts.socket ? ['-L', this.opts.socket, ...args] : args;
    const { stdout } = await run('tmux', full, { maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  }

  async alive(): Promise<Set<string>> {
    try {
      const out = await this.tmux('list-sessions', '-F', '#{session_name}');
      return new Set(out.split('\n').filter((s) => s.startsWith('sb-')).map((s) => s.slice(3)));
    } catch {
      return new Set(); // no tmux server running yet
    }
  }

  async isAlive(name: string): Promise<boolean> {
    return (await this.alive()).has(name);
  }

  /** The shell command line tmux runs for a session. Exported for tests. */
  commandLine(spec: LaunchSpec): string {
    const claude = this.opts.claudeCmd ?? 'claude';
    const channel = this.opts.channelName ?? 'switchboard';
    const parts = [claude, `--dangerously-load-development-channels`, `server:${channel}`];
    if (this.opts.claudeArgs) parts.push(this.opts.claudeArgs);
    if (spec.args) parts.push(spec.args);
    return parts.join(' ');
  }

  async launch(spec: LaunchSpec): Promise<string> {
    if (!SESSION_NAME_RE.test(spec.name)) throw new Error(`invalid session name "${spec.name}" (a-z, 0-9, -, max 40)`);
    if (await this.isAlive(spec.name)) throw new Error(`session ${spec.name} is already running`);
    const target = this.target(spec.name);
    const envArgs = Object.entries(spec.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    // Run via a login shell so PATH (nvm, ~/.local/bin, …) matches your terminal.
    // `exec` makes claude the pane's process: when it exits, the tmux session ends.
    await this.tmux(
      'new-session', '-d', '-s', target, '-x', '220', '-y', '50', '-c', spec.cwd,
      ...envArgs,
      `exec $SHELL -lc ${shq('exec ' + this.commandLine(spec))}`,
    );
    return target;
  }

  async kill(name: string): Promise<void> {
    await this.tmux('kill-session', '-t', this.target(name));
  }

  /** The last `lines` lines of the session's screen, wrapped lines joined. */
  async capture(name: string, lines = 60): Promise<string> {
    const out = await this.tmux('capture-pane', '-p', '-J', '-t', this.target(name), '-S', `-${Math.max(1, lines)}`);
    return out.replace(/\s+$/, '') + '\n';
  }

  /** Type literal text into the session, optionally pressing Enter. Escape hatch when the channel is down. */
  async type(name: string, text: string, enter = true): Promise<void> {
    if (text) await this.tmux('send-keys', '-t', this.target(name), '-l', text);
    if (enter) await this.tmux('send-keys', '-t', this.target(name), 'Enter');
  }

  async keys(name: string, ...keys: string[]): Promise<void> {
    await this.tmux('send-keys', '-t', this.target(name), ...keys);
  }

  /**
   * Claude Code asks a few one-time questions at startup that nobody is around
   * to answer in a detached tmux pane. Watch the screen for a while and answer
   * the ones that a launch through the switchboard has already decided.
   */
  async clearStartupDialogs(name: string, timeoutMs = 45_000, onScreen?: (screen: string) => void): Promise<string[]> {
    const answered: string[] = [];
    const deadline = Date.now() + timeoutMs;
    let quietSince = 0;
    while (Date.now() < deadline) {
      await sleep(700);
      let screen: string;
      try {
        screen = await this.capture(name, 50);
      } catch {
        break; // session ended
      }
      onScreen?.(screen);
      const dialog = STARTUP_DIALOGS.find((d) => d.match.test(screen));
      if (dialog) {
        const keys = dialog.choose ? menuKeys(screen, dialog.choose) : ['Enter'];
        if (!keys) break; // a menu we can't read safely: leave it for a human rather than guess
        await this.keys(name, ...keys);
        answered.push(dialog.id);
        quietSince = 0;
        await sleep(800);
        continue;
      }
      if (READY.test(screen)) {
        quietSince ||= Date.now();
        if (Date.now() - quietSince > 2000) break; // prompt visible and stable: done
      }
    }
    return answered;
  }
}

interface Dialog {
  id: string;
  match: RegExp;
  /** The option to pick. Omitted: just press Enter. */
  choose?: RegExp;
}

// Phrases from Claude Code's startup screens. If a release rewords one, the
// launch still works: you answer it once from the web UI's screen view (or
// `sb peek` + `sb keys`, or `tmux attach`).
//
// Order matters: the first match wins, and menus are answered by moving the
// cursor to the wanted option. Never by pressing Enter on whatever is
// highlighted, because the trust dialog highlights "No, exit".
export const STARTUP_DIALOGS: Dialog[] = [
  { id: 'theme', match: /Choose the text style/i },
  { id: 'security-notes', match: /Security notes:[\s\S]*Press Enter to continue/i },
  { id: 'trust-folder', match: /Is this a project you created or one you trust|Do you trust the files in this folder/i, choose: /Yes,? (I trust|proceed)/i },
  { id: 'dev-channels', match: /using this for local development/i, choose: /I am using this for local development/i },
  { id: 'mcp-server', match: /New MCP server found/i, choose: /Use this (and all future )?MCP servers?/i },
];

/**
 * Keys that move a Claude Code select menu's cursor (❯) onto the option
 * matching `choose` and confirm it. Null if the menu can't be read.
 */
export function menuKeys(screen: string, choose: RegExp): string[] | null {
  const lines = screen.split('\n').filter((l) => l.trim());
  const opt = (l: string) => l.replace(/^\s*[❯›>]?\s*(\d+\.\s+)?/, '').trim();
  const cursor = lines.findIndex((l) => /^\s*[❯›]/.test(l));
  const target = lines.findIndex((l, i) => (i >= cursor - 12 && i <= cursor + 12) && choose.test(opt(l)));
  if (cursor < 0 || target < 0) return null;
  const delta = target - cursor;
  return [...Array(Math.abs(delta)).fill(delta > 0 ? 'Down' : 'Up'), 'Enter'];
}

const READY = /(^|\n)\s*[>❯]\s|\? for shortcuts/;

export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
