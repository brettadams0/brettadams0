import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * ~/.switchboard/config.json holds the URL and token every piece shares: the
 * server reads it, every Claude session's channel bridge reads it, and `sb`
 * reads it. Environment variables override it (SB_URL, SB_TOKEN, …).
 */
export interface Config {
  url: string;          // how bridges and the CLI reach the server
  token: string;        // shared secret for web, phone, bridges and CLI
  host: string;         // server bind address
  port: number;
  databaseUrl: string;
  dataDir: string;      // APK releases live here
  defaultCwd: string;   // where new sessions start unless told otherwise
  userName: string;     // how you appear in the log
}

export const CONFIG_DIR = process.env.SB_HOME || join(homedir(), '.switchboard');
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export function loadConfig(): Config {
  let file: Partial<Config> = {};
  if (existsSync(CONFIG_FILE)) file = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  const port = Number(process.env.SB_PORT || file.port || 7777);
  const host = process.env.SB_HOST || file.host || '127.0.0.1';
  return {
    port,
    host,
    url: process.env.SB_URL || file.url || `http://127.0.0.1:${port}`,
    token: process.env.SB_TOKEN || file.token || '',
    databaseUrl: process.env.DATABASE_URL || file.databaseUrl || 'postgres://localhost/switchboard',
    dataDir: process.env.SB_DATA_DIR || file.dataDir || join(CONFIG_DIR, 'data'),
    defaultCwd: process.env.SB_DEFAULT_CWD || file.defaultCwd || homedir(),
    userName: process.env.SB_USER_NAME || file.userName || 'you',
  };
}

/** Create the config file with a fresh token if there isn't one. Returns the merged config. */
export function initConfig(overrides: Partial<Config> = {}): Config {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  let file: Partial<Config> = {};
  if (existsSync(CONFIG_FILE)) file = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  const merged = { ...file, ...stripUndefined(overrides) };
  if (!merged.token) merged.token = randomBytes(24).toString('base64url');
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2) + '\n', { mode: 0o600 });
  return loadConfig();
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as Partial<T>;
}
