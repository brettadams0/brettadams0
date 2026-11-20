// Wire types shared by the server, the channel bridge, the web UI and the phone app.
// The Android app mirrors these in Protocol.kt — change both together.

export type PartyKind = 'user' | 'session' | 'system';
export type MessageKind = 'chat' | 'permission' | 'verdict' | 'system';

export interface Message {
  id: number;
  created_at: string;
  kind: MessageKind;
  from_kind: PartyKind;
  from_name: string;
  to_kind: 'user' | 'session';
  to_name: string;
  body: string;
  speak: boolean;
  delivered: boolean;
  meta: Record<string, unknown>;
}

export interface Session {
  name: string;
  cwd: string | null;
  role: 'orchestrator' | 'worker';
  description: string;
  tmux_target: string | null;
  created_at: string;
  last_seen_at: string | null;
  archived: boolean;
  online: boolean;      // a channel bridge is connected right now
  tmux_alive: boolean;  // its tmux session exists right now
}

export const TASK_STATUSES = ['backlog', 'todo', 'doing', 'blocked', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Task {
  id: number;
  title: string;
  notes: string;
  project: string;
  status: TaskStatus;
  priority: number;
  assignee: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  done_at: string | null;
}

export interface PermissionRequest {
  request_id: string;
  session: string;
  tool_name: string;
  description: string;
  input_preview: string;
  status: 'pending' | 'allow' | 'deny' | 'expired';
  decided_by: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface AppRelease {
  version_code: number;
  version_name: string;
  filename: string;
  sha256: string;
  size_bytes: number;
  notes: string;
  created_at: string;
}

/** Server → any client (web, phone). */
export type ClientEvent =
  | { type: 'hello'; sessions: Session[]; pending_permissions: PermissionRequest[]; latest_release: AppRelease | null }
  | { type: 'message'; message: Message }
  | { type: 'sessions'; sessions: Session[] }
  | { type: 'task'; task: Task; deleted?: boolean }
  | { type: 'permission'; request: PermissionRequest }
  | { type: 'app_release'; release: AppRelease };

/** Server → channel bridge (one per Claude Code session). */
export type BridgeInbound =
  | { type: 'deliver'; message: Message }
  | { type: 'verdict'; request_id: string; behavior: 'allow' | 'deny' };

/** Channel bridge → server. */
export type BridgeOutbound =
  | { type: 'ack'; ids: number[] }
  | {
      type: 'permission_request';
      request_id: string;
      tool_name: string;
      description: string;
      input_preview: string;
    };
