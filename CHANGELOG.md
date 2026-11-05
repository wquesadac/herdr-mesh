# Changelog

## 0.3.2

Targets **herdr 0.9.5** (unchanged). A task prompt that never starts is sent
again, a clear is confirmed before the task, and finished tasks can be journaled.

### Added

- `ack_ms` on `herdr_task_run` (default 20000, minimum 5000). The prompt is
  acknowledged when the agent is seen working or `completion_seq` moves past the
  dispatch baseline. Past the window, an idle or done agent is prompted once
  more; a second miss fails the task. A dialog is reported as `blocked` and is
  not treated as a missed prompt. Inside the window, idle is not `missing_result`.
  `herdr_task_status` shows `running (awaiting ack)` until acknowledgement.
  `prompt_attempts` is included in the output when the prompt was sent more than once.
- `clear` waits until `state_change_seq` advances (poll every 500 ms, up to 10 s),
  then until the agent is idle or done. If the sequence never moves, the task
  continues after a 3 s settle and the output includes `clear_unconfirmed: true`.
- `journal` on `herdr_task_run`: an absolute directory. Finish and close append
  one markdown entry to `<journal>/<YYYY-MM-DD>.md`. A write failure never fails
  the task. A git-ignored directory such as `<repo>/.agent/journal` is the
  intended place; the orchestrator curates it into project memory.
- A git worktree created for an agent task is removed if the hand-off fails
  before the prompt is delivered. The branch is deleted only when its tip is
  still the base commit from creation.

## 0.3.1

Targets **herdr 0.9.5** (unchanged). A task can be handed to an agent that is
already running.

### Added

- `herdr_task_run` placement `agent` — do not start an agent. `name` must be the
  live agent name (`agent` may be that name or a pane id). The agent must be
  `idle` or `done`; any other status fails and the agent is not interrupted.
  `kind` and `args` are ignored; the kind is taken from `agent get`.
- Optional `worktree` with `agent` runs `git worktree add -b` (no new pane).
  The task is told to work only in that directory when it differs from the
  agent's cwd. The branch is not created when it already exists.
- Optional `clear` (for example `/clear` or `/new`) is sent first. There is no
  default. The server waits until the agent is idle or done (30s) before the
  task prompt. The baseline `completion_seq` is read after that wait.
- `herdr_task_close` on `agent` placement never closes a pane, tab, or
  workspace. `remove_worktree: true` removes a git worktree created for the
  task (`git worktree remove`) and keeps the branch. Dirty trees and commits on
  no remote are refused unless `force: true`. A result file under `.agent/`
  does not by itself block that remove.

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

### Fixed
- `herdr_task_run`: when the agent is blocked at startup (e.g. a trust dialog), the task
  prompt is kept in memory and `herdr_task_wait` delivers it once the dialog is answered
  and the agent is idle. A server restart in between fails the task cleanly.

- `blocked`, `missing_result` and a wait `timeout` are per-call observations, not
  final statuses. They are returned in `state` and satisfy that call's mode, but the
  task stays registered as running so a later `herdr_task_wait` re-polls and picks up
  a result written after the orchestrator approves a dialog. Only result files and
  `herdr_task_close` finalize a task and write a ledger line.
- `herdr_task_close` ignores `.agent/` in the worktree dirty check, so the default
  result file no longer blocks `remove_worktree`. Add `.agent/` to the repo's
  `.gitignore` so builders do not commit result files.

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
