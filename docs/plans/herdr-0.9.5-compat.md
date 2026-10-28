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


## Review disposition (Agy review, binding — overrides earlier sections where they conflict)
Source: `docs/plans/herdr-0.9.5-compat.review.md`.

1. **Accepted: agent_start race and cleanup.** After creating a pane, retry `agent start` while it fails with a "pane not at shell prompt / not available" style error: up to 5 attempts, 500 ms apart. Don't retry other errors. If the handler created the workspace, tab or pane and `agent start` ultimately fails, close it (`workspace close` / `tab close` / `pane close`) and rethrow. Never close a caller-supplied `pane_id`. Note: `agent_not_ready` (agent blocked during startup) is **not** a failure to clean up: return it as a result that says the agent is blocked and the name is usable with `agent read` and `agent send-keys`.
2. **Accepted: timeouts for `run` handlers.** Change `ToolDef.run` to `(args, ctx: { timeoutMs?: number }) => Promise<ToolResult>`. `execTool` computes `timeoutMs = max(tool.timeoutMs ?? 30000, timeout_ms + 10000)` when `args.timeout_ms` is a number, and passes it to both `runHerdr` (for the `buildArgs` path) and `tool.run`. Inside `run` handlers, every long call (`agent start`, `agent prompt --wait`, `agent wait`) passes `{ timeoutMs: ctx.timeoutMs }`.
3. **Accepted, with a different mapping.** List all breaking changes of `herdr_agent_start` in the README and CHANGELOG: `argv` → `kind` + `args`; `tab` removed. Keep `split` (right|down) backward compatible: when `split` is given without `pane_id` or `split_from`, run `pane split --current --direction <split> [--cwd] --no-focus` (the old "split from the current pane" meaning). If `--current` can't resolve (the MCP server isn't inside a herdr pane), fail with a clear error. `tab` isn't accepted; the zod schema simply doesn't have it.
4. **Partly accepted.** Add `raw` (bool → `--raw`) to `herdr_wait_output`. Rejected: moving the pane id to the end of the argv. herdr parses the positional in either position (verified live with `pane wait-output w2W:p1 --match ...`), and the current order matches the rest of the codebase.
5. **Rejected.** No duplicate `herdr_pane_wait_output` alias; it would add a tool for no capability gain. Keep `herdr_wait_output` and move its definition to `pane.ts` (still exported under the same name).
6. **Accepted.** Add `read_source` (`visible|recent|recent-unwrapped|detection`, default `recent`) to `herdr_handoff`.
7. **Accepted.** `herdr_agent_wait` accepts both `until` and the legacy `status` (each a single status or an array). `until` wins when both are given.
8. **Accepted.** Replace the recursive `findPaneId` with explicit lookups: `json.result?.agent?.pane_id ?? json.result?.pane?.pane_id ?? json.result?.root_pane?.pane_id`. `resolvePaneId(target)` tries `agent get` and then `pane get`, using that lookup.
9. **Accepted.** `scripts/smoke.mjs` wraps its work in `try/finally` so the scratch workspace is always closed. Add read-only agent checks (`herdr_agent_list`; `herdr_agent_get` on the first listed agent, if any) and a key-normalization check: `herdr_pane_send_keys ["ctrl-c"]` must succeed on the scratch pane. Optional and off by default: with `SMOKE_AGENT=<kind>`, also run `herdr_agent_start` (new workspace) → `herdr_agent_prompt` → `herdr_agent_wait` → close.
10. **Accepted, modified.** `normalizeKey`: trim; `escape` → `esc`; if the key matches `/^((ctrl|alt|shift|meta|super)-)+[^-]+$/i`, lowercase the modifiers and join every part with `+` (`Ctrl-Shift-C` → `ctrl+shift+C`; keep the final key's case). Leave everything else (including `C-c` and `enter`) unchanged. Cover these cases in unit tests.
11. **Accepted.** `args: z.array(z.string()).optional()`; push `"--", ...args` only when the array is non-empty.
12. **Accepted.** No new `resolve.ts`. Shared helpers (`extractPaneId`, `resolvePaneId`, `normalizeKey`, `statusEnum`) live in `src/tools/types.ts`.

Also add a short `CHANGELOG.md` entry for 0.2.0.
