# herdr-mesh 0.2.0 — herdr 0.9.5 compatibility spec

## Why
herdr-mesh 0.1.0 was written against an older herdr CLI. Against herdr 0.9.5, these calls were verified live to fail:

| Old call (0.1.0) | herdr 0.9.5 result | 0.9.5 replacement |
|---|---|---|
| `agent start <name> --cwd/--workspace/--tab/--split ... -- <argv>` | `unknown option: --cwd` | `agent start <NAME> --kind <KIND> --pane <ID> [--timeout MS] [-- AGENT_ARG...]` (the pane must be an existing shell pane at its prompt) |
| `agent send <target> <text>` | command removed | `agent prompt <TARGET> <TEXT> [--wait] [--until S]... [--timeout MS]` (text and Enter); `pane send-text <PANE> <TEXT>` (no Enter) |
| `agent wait <t> --status <s>` | `unknown option: --status` | `agent wait <TARGET> [--until S]... [--timeout MS]` (default: idle, done or blocked) |
| `wait output <pane> --match X [--regex]` | `unknown command: wait` | `pane wait-output <PANE> (--match TEXT \| --regex PATTERN) [--source visible\|recent\|recent-unwrapped] [--lines N] [--timeout MS] [--raw]` |
| `pane send-keys <p> ctrl-c` | `invalid_key: unsupported key ctrl-c` | `ctrl+c` (also `C-c`); `esc` is the canonical Escape key |
| agent target = terminal id (`term_…`) | `agent_not_found` | Live agent name `[a-z][a-z0-9_-]{0,31}` or the pane id hosting the agent |

Read sources for `agent read` and `pane read`: `visible | recent | recent-unwrapped | detection` (herdr's default is `recent`). New commands worth exposing: `agent send-keys <TARGET> <KEY>...` and `agent prompt`.

Verified JSON output shapes (stdout, one JSON object):
- `workspace create` → `{"result":{"root_pane":{"pane_id":"w2X:p1",...},"tab":{...},"workspace":{"workspace_id":"w2X",...},"type":"workspace_created"}}`
- `tab create` → `{"result":{"root_pane":{"pane_id":"w2X:p2",...},"tab":{"tab_id":"w2X:t2",...},...}}`
- `pane split` → `{"result":{"pane":{"pane_id":"w2X:p3",...},"type":"pane_info"}}`
- `agent start` → `{"result":{"agent":{"name":...,"pane_id":...,"agent_status":"idle","interactive_ready":true,...},"type":"agent_started"}}`
- Errors → non-zero exit with `{"error":{"code":"...","message":"..."}}`; `runHerdr` already surfaces these.

Read `result.root_pane.pane_id` or `result.pane.pane_id` explicitly. Don't rely on a recursive "first pane_id" search for new panes.

## Constraints
- Keep the existing code style: `ToolDef`, `buildArgs`/`run`, `flag`/`boolFlag`, and zod schemas in `src/tools/*`.
- Don't change unaffected tools (session, tab, workspace and integration tools, plus agent list/get/read/rename/focus, apart from the shared schema text).
- Only `herdr_agent_start` changes its interface in a breaking way. Every other tool name and input stays backward compatible.

## Changes

Target: herdr **0.9.5**. Version bump to **0.2.0** in `package.json` and `src/server.ts`. `dist/` is committed in this repo, so rebuild and commit it.

### src/tools/types.ts
- `targetSchema` description: "Live agent name (unique, `[a-z][a-z0-9_-]{0,31}`) or the pane id hosting the agent. Terminal ids and agent-kind labels are not accepted."
- Add `statusEnum = z.enum(["idle","working","blocked","done","unknown"])` and reuse it everywhere that currently repeats the enum (agent.ts, composite.ts).
- Add `normalizeKey(k)`: rewrite a `ctrl-`/`alt-`/`shift-`/`meta-` prefix to the `+` form (`ctrl-c` → `ctrl+c`); pass everything else through.
- Move `findPaneId` and `resolvePaneId` from `composite.ts` into a shared helper (e.g. `src/tools/resolve.ts`) and reuse them.
- `execTool`: when `args.timeout_ms` is a number, set the subprocess timeout to `max(tool.timeoutMs ?? 30000, timeout_ms + 10000)`. Today the fixed 120000 cap kills longer waits early.

### src/tools/agent.ts
- `herdr_agent_wait`: `status` becomes optional and accepts one status or an array; emit `--until` once per value. When omitted, pass nothing, so herdr waits for idle, done or blocked.
- `herdr_wait_output` → `["pane","wait-output",pane,...]`: if `regex: true`, emit `--regex <match>`, otherwise `--match <match>`. Add optional `lines` (`--lines`). Keep `source` and `timeout_ms`.
- `herdr_agent_send` (text without Enter): convert it to a `run` handler that calls `resolvePaneId` and then `pane send-text`. Same name and inputs.
- **New** `herdr_agent_send_keys`: `agent send-keys <target> <keys...>`, keys passed through `normalizeKey`.
- **New** `herdr_agent_prompt`: `agent prompt <target> <text>`, optional `wait` (bool), `until` (status or array), `timeout_ms`. Describe `agent_blocked`, `agent_prompt_stalled` and `timeout` in the description.
- `herdr_agent_start` rewritten as a `run` handler. Inputs: `name` (regex above), `kind` (enum of herdr 0.9.5 kinds: pi, claude, codex, gemini, cursor, devin, agy, cline, omp, mastracode, opencode, copilot, kimi, kiro, droid, amp, grok, hermes, kilo, qodercli, qwen, letta, maki, muse), and optional `args` (extra agent args after `--`), `pane_id`, `workspace`, `split_from` + `direction`, `cwd`, `focus`, `timeout_ms`. Pane resolution order:
  1. `pane_id` given → use it.
  2. `split_from` given → `pane split <split_from> --direction <d|right> [--cwd] --no-focus`.
  3. `workspace` given → `tab create --workspace <w> [--cwd] --label <name> --no-focus`.
  4. Otherwise → `workspace create [--cwd] --label <name> --no-focus`.
  Read the new pane id from the result (`result.root_pane.pane_id` for workspace and tab create, `result.pane.pane_id` for split; see the verified shapes above), then run `agent start <name> --kind <kind> --pane <id> [--timeout] [-- args]`. Focus the agent afterwards if `focus` is true. Remove the old `argv` input (breaking, which is why the version becomes 0.2.0).
- `agent_list/get/read/rename/focus` stay as they are.

### src/tools/composite.ts
- `herdr_relay`: with `submit` (default) → `agent prompt <target> <text>`. With `submit=false` → `resolvePaneId` then `pane send-text`.
- `herdr_handoff`: `agent prompt <target> <message> --wait [--until ...] --timeout <t>`, then `agent read <target> --source <read_source|recent> --lines <n> --format text`. `wait_status` becomes optional; when omitted, use herdr's default (idle, done or blocked). On failure (`agent_blocked`, `agent_prompt_stalled`, timeout), still read the output and return it with the error note, as it does today. This also fixes the existing race where the wait could match "idle" before the agent had started working.

### src/tools/pane.ts
- `herdr_pane_send_keys`: run the keys through `normalizeKey`; description lists the valid names (`enter`, `esc`, `tab`, `ctrl+c`, `up`…).
- `herdr_pane_read`/`herdr_agent_read`: add `detection` to the read sources, as a separate enum so `wait-output` doesn't accept it.

### Tests and smoke
- Add `test/args.test.ts` (node:test run via tsx) covering every `buildArgs` and `normalizeKey`: assert the exact argv against herdr 0.9.5 syntax. Add `"test": "tsx --test test/*.test.ts"`.
- Add `scripts/smoke.mjs`: an MCP SDK stdio client that starts `dist/index.js` and checks the live tools: list tools, `workspace_list`, `agent_list`, then `workspace_create` → `pane_run "echo smoke-ok"` → `wait_output "smoke-ok"` → `pane_send_keys ["ctrl-c"]` → `workspace_close`. It never touches existing workspaces.

### Docs
- README.md and README.ko.md: update the tool reference (new tools, `agent_start` inputs, key names, target rules) and add a "Requires herdr ≥ 0.9.5" note.

