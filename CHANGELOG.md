# Changelog

## 0.3.0

Targets **herdr 0.9.5** (unchanged). Adds task tools that move waiting and screen
watching into the MCP server, plus compact reads. No breaking changes.

### Added

- `herdr_task_run` — start an agent in a new workspace, a new git worktree, or an
  existing pane; hand it a task; optionally wait; and return only a compact result.
  Builders write a JSON result file (`status`, `summary`, `files_changed`, `commits`,
  `tests`, `questions`, `followups`) and go idle.
- `herdr_task_wait` — wait for one or more tasks (`mode: any | all`) with one
  `agent list` poll per tick. Returns an array with an object for every requested
  name, including still-running tasks.
- `herdr_task_status` — plain-text status lines for registered tasks.
- `herdr_task_close` — stop tracking a task and close what `task_run` created.
  `pane_id` placement closes nothing; `remove_worktree` refuses dirty worktrees or
  commits on no remote unless `force: true`.
- Task registry persisted to `$XDG_STATE_HOME/herdr-mesh/tasks.json` (atomic write,
  7-day retention) and a `ledger.jsonl` with time/status only (rotated at 1 MB).
- Progress notifications every 30 s while waiting, and abort-signal handling.
- `compact`, `since_last` and `max_chars` inputs on `herdr_agent_read`,
  `herdr_pane_read` and `herdr_handoff`.

### Changed

- `herdr_agent_read` and `herdr_pane_read` are now `run` handlers so they can apply
  compact-read options; their CLI argv is unchanged.
- Result files and task files are validated at read time: regular file, ≤ 64 KB, and
  inside the agent cwd via `realpath`.

## 0.2.0

Targets **herdr 0.9.5** and its CLI syntax.

### Breaking changes

- `herdr_agent_start`: `argv` was replaced by `kind` (one of herdr 0.9.5's supported
  agent kinds) plus optional `args` (extra agent arguments after `--`).
- `herdr_agent_start`: `tab` was removed. New agents are placed in an existing
  `pane_id`, a split from `split_from`/`split`, or a new tab in `workspace`.
  `split` (right/down) still splits the current pane for backward compatibility.
- Older herdr releases are no longer supported (`agent prompt`, `pane wait-output`,
  and `agent start --kind` are required).

### Added

- `herdr_agent_prompt` — submit text with Enter, with optional `wait`, `until` and
  `timeout_ms` (surfaces `agent_blocked`, `agent_prompt_stalled` and `timeout`).
- `herdr_agent_send_keys` — send key presses to an agent target.
- `herdr_handoff` accepts `read_source` (`visible`, `recent`, `recent-unwrapped`,
  `detection`; default `visible`, which reliably captures replies from TUI agents).
- `herdr_wait_output` supports `lines` and `raw`; it now runs `pane wait-output`.

### Changed

- `herdr_agent_wait` accepts `until` (single status or array) and keeps `status` as
  a legacy alias. Omitting both waits for idle, done or blocked.
- `herdr_agent_send` now resolves the target's pane and uses `pane send-text`.
- `herdr_relay` submits with `agent prompt`; `submit: false` uses `pane send-text`.
- `herdr_agent_read` / `herdr_pane_read` accept the `detection` source.
- Key names are normalized (`ctrl-c` → `ctrl+c`, `escape` → `esc`, `Ctrl-Shift-C`
  → `ctrl+shift+C`).
- Agent targets must be a live agent name or the pane id hosting it; terminal ids
  and agent-kind labels are rejected.
- Subprocess timeouts now scale with `timeout_ms` for both `buildArgs` and
  composite `run` handlers, so long waits are not killed early.
- `herdr_agent_start` retries briefly while a new pane's shell starts, and cleans
  up any workspace/tab/pane it created if startup fails. `agent_not_ready` is
  returned as a normal result (the agent name remains usable).
