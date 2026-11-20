# Switchboard

Talk to all your Claude Code sessions from one place: a browser, your phone, or
a button in your pocket on a walk.

- **One session runs the others.** Every session lives in its own tmux pane.
  The orchestrator starts, stops, watches and messages the rest with its own tools.
- **Messages are pushed, not polled.** Messages use Claude Code
  [channels](https://code.claude.com/docs/en/channels): what you type or say
  lands in the session's conversation as a `<channel>` event immediately. The
  session never calls a tool to check for mail.
- **Everything is kept.** Every message goes into Postgres with full-text
  search: you to a session, a session to you, session to session, and every
  permission prompt. When a session forgets something, it searches the history.
- **A real backlog.** Tasks are sorted by project, status
  (`backlog → todo → doing → blocked → done`) and priority (P0 urgent … P3 someday),
  and you and the sessions share them.
- **A phone app that talks.** It reads replies aloud and gives you
  push-to-talk. You can answer permission prompts by saying "yes" or "no". A
  Flic button gives true hold-to-talk. The app **updates itself**: a session
  rebuilds it, publishes it, and every phone installs it.

```
 you (web / phone / Flic) ──HTTP+WS──▶ switchboard server ──▶ Postgres
                                          │  ▲      (every message, tasks,
                                   WS     │  │       prompts, app releases)
                                          ▼  │
        tmux: sb-main          tmux: sb-api-work        tmux: sb-docs
        claude ─ channel       claude ─ channel         claude ─ channel
        (orchestrator)         (worker)                 (worker)
          ▲ pushes <channel> events in · tools out: reply, send_to_session,
            start_session, peek_session, search_history, task_*, release_app
```

Built from your earlier repos: tmux defaults from `termux-ai-setup`, the
Android build, signing key and SDK scripts from `cue`, and the typed
shared-protocol, test-first layout from `tap-in`.

## What's verified, and what isn't

| Piece | Status |
|---|---|
| Server, Postgres store, search, tasks, permission relay, releases | 21 integration tests: real Postgres, real HTTP/WS, the real channel process driven over MCP stdio exactly as Claude Code drives it, real tmux |
| Live Claude Code (v2.1.329) through the channel | Run for real: a queued prompt was delivered, the reply came back, a permission prompt was relayed and approved by saying "yes". The orchestrator started a worker, the worker answered it, and the orchestrator reported back and filed a task |
| Web UI | Exercised in Chromium at desktop and phone sizes, with no page errors |
| Android app | Compiles; 9 JVM unit tests (speech cleanup, speak modes, verdicts); signed 2.6 MB release APK verified with `apksigner`/`aapt2`. **Not yet run on a phone**: there was no emulator where this was built. Expect a round of fixes on first install |
| Flic hold-to-talk | Written against the Flic 2 SDK's real API (`onButtonUpOrDown`), but untested with a button |
| iPhone | No native app. The web UI installs as a PWA (Share → Add to Home Screen) with read-aloud and hold-to-talk in Safari. iOS stops speaking when the app is backgrounded, so on a walk Android is the one that works |

## Requirements

- Node 22.18+ (runs the TypeScript directly; no build step)
- PostgreSQL 14+
- tmux 3.0+
- Claude Code with channels available: claude.ai login or Console API key. On a
  Team/Enterprise org an admin must enable **Channels**. Custom channels are a
  research preview and load with `--dangerously-load-development-channels`
  (`sb` passes the flag for you).

## Setup (once)

```sh
cd switchboard
npm install
createdb switchboard                      # or point --db at any Postgres
ln -s "$PWD/bin/sb" ~/.local/bin/sb       # optional, puts `sb` on PATH

sb setup --db postgres://localhost/switchboard --cwd ~/code --name brett
```

`sb setup` does three things. It writes `~/.switchboard/config.json` with a
fresh token. It registers the channel with Claude Code
(`claude mcp add -s user switchboard -- node …/src/channel.ts`). And it allows
the switchboard's own tools in `~/.claude/settings.json`, so `reply` doesn't ask
for permission every time.

```sh
sb server                                 # keep running (systemd unit below)
sb start main --orchestrator --cwd ~/code # your orchestrator, in tmux
sb info                                   # URL + token for the phone / browser
```

Open the printed `…/#token=…` link. From now on you can talk to `main` there.
Ask it to start more sessions. `sb attach main` puts you in front of its
terminal whenever you want.

### Reaching it from your phone

The server listens on `127.0.0.1:7777` by default. To reach it from anywhere,
**use [Tailscale](https://tailscale.com)**: run
`sb setup --host 0.0.0.0` (or your Tailscale IP) and open
`http://<machine>.<tailnet>.ts.net:7777` on the phone. `tailscale serve` adds
HTTPS if you want it. Don't port-forward this to the open internet. The
token is the only lock, and whoever holds it can type into your sessions and
approve their tool calls.

### Keep the server running (systemd user unit)

```ini
# ~/.config/systemd/user/switchboard.service
[Unit]
Description=Switchboard
After=network-online.target postgresql.service

[Service]
ExecStart=/usr/bin/env node %h/code/switchboard/src/server.ts
Restart=always

[Install]
WantedBy=default.target
```

`systemctl --user enable --now switchboard && loginctl enable-linger $USER`

## Day to day

| You want to… | Do this |
|---|---|
| Talk to the orchestrator | Type or hold the mic in the web UI or phone app; `sb send - "…"` |
| Talk to one session | Pick it in the list; `sb send api-work "…"` |
| Start a session | Ask the orchestrator, **+ New** in the web UI, or `sb start NAME --cwd DIR --prompt "…"` |
| Use the switchboard from the terminal you're in | `sb claude` (session named after the directory) |
| See its screen | **Screen** in the web UI / terminal icon in the app; `sb peek NAME` |
| Unstick a dialog | Screen view's key buttons (Enter, Esc, ↑, ↓, 1, 2); `sb keys NAME Down Enter` |
| Approve a tool call | Allow/Deny card, the notification's buttons, or just say "yes" |
| Find something old | Search tab; `sb search "deploy key"`. Sessions use `search_history` |
| Backlog | Tasks tab (`Fix login #api !1`); `sb tasks`, `sb task add …`, `sb task 12 done` |

Sessions talk to each other with `send_to_session`. Those messages show up in
your feed too, tinted, so you can watch the orchestrator work.

**Startup dialogs.** Claude Code asks a few one-time questions in a fresh pane:
folder trust, the development-channels warning, and project MCP servers. The
server answers them by moving the menu cursor to the right option, never by
pressing Enter on the default, because trust defaults to "No, exit". If a
future Claude Code rewords one, the session waits for you to answer it once
from the screen view.

## Phone app (Android)

```sh
cd switchboard/android
./tools/android-sdk.sh          # ~500 MB, no Android Studio
./tools/keystore.sh             # signing key. BACK IT UP: updates need the same key
./tools/release.sh "first build"
```

Download the APK from the web UI sidebar (**Download APK**) and install it.
Enter the URL and token, and allow the microphone and notifications. On that
first install, also allow **Install unknown apps** (Settings → Updates) and
**battery optimisation exemption** (Settings → Staying connected), or Android
will cut the connection when the screen is off.

What it does:

- Reads aloud whatever sessions send you. Code blocks, URLs and long paths are
  turned into something listenable, and the sender is announced. You can choose
  every message, only messages marked `speak`, or off.
- **Hold to talk**: the big mic button, the notification's Talk action, or a
  Flic button. Release to send. Recognition keeps going through pauses while
  you hold. A spoken "yes"/"no" answers an open permission prompt.
- Permission prompts arrive as notifications with Allow/Deny.
- Chat, session screens with key buttons, and the task board.

### Self-update

A session that changes the app runs `android/tools/release.sh "what changed"`.
That script builds, signs, and uploads to the switchboard. The server
announces the release, and every phone downloads it, checks the sha256 and
installs it. On Android 12+ that is silent from the second self-update on. The
first one replaces the copy you sideloaded, so it asks for one tap. Version
codes are minutes-since-epoch, so they only go up.

### Flic button

In the app: **Settings → Flic button → Pair a Flic**, then hold the button for 7
seconds. The SDK reports raw press and release, so:

- **hold**: talk, release to send
- **tap**: stop the voice, or if it's quiet, repeat the last message

A button paired to Switchboard isn't paired to the Flic app. To keep it in the
Flic app instead, give it an *Intent* action that broadcasts
`dev.switchboard.PTT_TOGGLE` (tap to start, tap to send). Tasker and Bluetooth
remotes can fire the same intent.

## Layout

```
src/server.ts     HTTP + WebSocket server, REST API, static web UI
src/core.ts       routing: delivery, queueing, permission relay, voice verdicts
src/channel.ts    the Claude Code channel (MCP stdio server): pushes events in, exposes tools
src/tmux.ts       launch/kill/capture/type, startup-dialog handling
src/db.ts         Postgres store; src/schema.sql is applied on every start
src/cli.ts        `sb`
web/              dependency-free web UI / PWA
android/          Kotlin + Compose app (service, TTS, push-to-talk, Flic, updater)
test/             integration tests (needs Postgres + tmux)
```

## Tests

```sh
createdb switchboard_test
DATABASE_URL=postgres://localhost/switchboard_test npm test
npx tsc --noEmit
cd android && ./gradlew :app:testDebugUnitTest
```

## Security notes

- One shared token guards everything: the web UI, the app, the bridges and the
  CLI. It lives in `~/.switchboard/config.json` (mode 600) and in the app's
  private storage.
- Permission relay means a phone holding the token can approve tool calls.
  That's the point, so keep the server on localhost or your tailnet.
- Messages from other sessions are labelled `from_kind="session"`, and the
  channel tells Claude not to treat them as your own words.
- Only sessions started through the switchboard (`SB_SESSION` set) register to
  receive messages. Other Claude Code sessions that load the server get the
  tools only.
