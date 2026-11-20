# Working on the switchboard

You may be one of the sessions this code runs. Changing it changes how you talk to the user.

- The server runs TypeScript directly on Node 22.18+ (type stripping). Use erasable syntax only:
  no enums, no parameter properties, no namespaces. Import with `.ts` extensions. `npx tsc --noEmit` enforces this.
- `src/protocol.ts` and `android/app/src/main/kotlin/dev/switchboard/app/Protocol.kt` describe the same wire
  format. Change both together.
- Tests run against real Postgres and tmux: `DATABASE_URL=postgres://localhost/switchboard_test npm test`.
  Add a test with every behaviour change. The channel is tested by speaking MCP to the real `src/channel.ts`.
- Channel meta keys must be identifiers (`[A-Za-z0-9_]`). Claude Code silently drops others.
- Restarting the server is safe: bridges reconnect, and undelivered messages are redelivered from Postgres.
  Restarting your *own* channel means restarting your Claude session.

## Shipping a phone app update

1. Change the Kotlin under `android/`. Run `cd android && ./gradlew :app:testDebugUnitTest :app:assembleDebug`.
2. `android/tools/release.sh "one line on what changed"`. This builds a signed release and publishes it.
   Phones install it by themselves (or use the `release_app` tool with a built APK).
3. Tell the user in one spoken sentence what changed.

Never regenerate `android/switchboard-release.jks`. A new key can't update installed apps.
