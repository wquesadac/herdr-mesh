# herdr-mesh

An MCP server for orchestrating multi-agent workflows inside [herdr](https://herdr.dev),
enabling real-time communication, pane management, and contextual handoffs.

> **Fork notice:** this fork carries the **herdr 0.9.5** compatibility fix (v0.2.0), which is
> pending upstream in [rmngl/herdr-mesh#4](https://github.com/rmngl/herdr-mesh/pull/4).
> Upstream 0.1.0 does not work with herdr 0.9.x. Install this fork:
> `npm i -g https://github.com/wquesadac/herdr-mesh/archive/refs/heads/main.tar.gz`

> 한국어: [README.ko.md](./README.ko.md)

## Why this exists

herdr already has everything needed to orchestrate multiple agents — real panes,
persistent sessions, semantic agent state (idle/working/blocked/done), and a CLI +
socket API to drive it all. What it lacked was a **standard interface for agents
themselves to use it.**

So when you run several agents inside herdr (Claude, Codex, …), there was no clean
way for them to read each other's context, share a session, or pass messages
without a human shuffling between terminals.

herdr-mesh closes that gap: it exposes herdr's CLI as **MCP tools**, so any
MCP-capable agent — regardless of type — can read other agents' panes, hand off
context, coordinate, and spawn new agents **on its own, from plain-language
instructions.** The goal is to make herdr's multi-agent workflow programmable by
the agents themselves, through one standard, agent-agnostic interface.

## Use cases

Concrete situations where herdr-mesh turns tedious terminal-shuffling into a
single natural-language instruction.

### 1. Code → review → fix loop

You have Claude writing code and Codex reviewing it. Codex finds a bug — normally
you'd copy it over to Claude by hand. Instead:

> "Have Codex review the changes Claude just made. If it finds problems, send them
> to Claude to fix, then ask Codex to re-review. Repeat until it's clean."

The orchestrating agent uses `herdr_agent_read` (pull Codex's review) →
`herdr_agent_send` (hand the findings to Claude) → `herdr_agent_wait` (let Claude
finish) → and loops the review. No copy-paste between panes.

### 2. Parallel fan-out

> "Split this refactor: have Claude do the API layer and Codex do the tests, then
> collect both results and summarize."

Spawns/targets two agents with `herdr_agent_start` / `herdr_agent_send`, waits on
each with `herdr_agent_wait`, and merges their output with `herdr_agent_read`.

### 3. Long-running handback

> "Tell the build agent to run the full test suite, wait until it prints PASS or
> FAIL, and bring me the failing cases."

Uses `herdr_pane_run` to kick off the run and `herdr_wait_output` to block on the
result — so you're notified the moment it's done instead of babysitting the pane.

### 4. Unblock a stuck agent

An agent is sitting at a prompt waiting for confirmation (`blocked`) while you're
heads-down in another pane.

> "Is any agent blocked waiting on input? If Codex is stuck on a y/n prompt,
> approve it so it can continue."

`herdr_agent_list` surfaces the `blocked` state; `herdr_agent_send` +
`herdr_pane_send_keys` answer the prompt — no context-switch on your part.

### 5. Spec → implement → verify pipeline

> "Take the plan in the *architect* agent's pane, give it to Claude to implement,
> then have the *tester* agent run the suite against the result."

Reads the spec with `herdr_agent_read`, hands it off with `herdr_agent_send`,
waits with `herdr_agent_wait`, then triggers verification in a third agent — a
three-stage relay driven by one instruction.

### 6. Route a question to the agent that has the context

> "The agent working in the payments service already has that code loaded — ask it
> why the webhook retries, and bring me its answer."

Instead of re-loading context yourself, `herdr_agent_send` poses the question to
the agent already sitting in that codebase and `herdr_agent_read` returns its
reply.

The point: the agent-to-agent handoffs that used to need a human in the middle
become one sentence.

herdr already exposes its workspace/agent runtime over a CLI + socket API. `herdr-mesh`
wraps that CLI as [Model Context Protocol](https://modelcontextprotocol.io) tools, so any
MCP client can read other agents' panes, send messages, share sessions, and spawn new
agents through a standard interface.

It is **agent-agnostic**: tools operate on whatever agents herdr recognizes — `pi`, `omp`,
`claude`, `codex`, `opencode`, `hermes`, `qodercli`, and any future integration. Targets
accept a **live agent name** (`[a-z][a-z0-9_-]{0,31}`) or the **pane id hosting the agent**;
terminal ids and agent-kind labels are not accepted. Nothing is tied to a specific agent
type. Use `herdr_integration_status` to see what's available.

## How it works

```
MCP client ──stdio(MCP)──> herdr-mesh ──exec "herdr …"──> herdr CLI ──socket──> herdr server
```

Each tool runs the `herdr` CLI as a subprocess and returns its JSON output. No separate
protocol implementation — herdr's own version/protocol handling stays authoritative.

## Requirements

- Node.js 18+
- [herdr](https://herdr.dev) installed and a server running (`herdr status` shows `running`).
  **Requires herdr ≥ 0.9.5.** Set `HERDR_BIN` if `herdr` is not on `PATH`.
  herdr-mesh 0.3.0 targets the 0.9.5 CLI (`agent prompt`, `pane wait-output`, `agent start --kind`);
  it does not work against older herdr releases. Task result files are read from the local
  filesystem, so `herdr --machine` remote servers are out of scope.

## Install (recommended)

Install globally, then let the built-in installer detect your agents and register
herdr-mesh with them:

```bash
npm i -g https://github.com/wquesadac/herdr-mesh/archive/refs/heads/main.tar.gz
herdr-mesh install
```

> Installed straight from GitHub (not the npm registry). The repo ships a prebuilt
> `dist/`, so install needs only network access — no build step. To update later,
> re-run the same command.
>
> The shorter `npm i -g wquesadac/herdr-mesh` also works on npm setups that
> handle git installs cleanly; if it doesn't create a working `herdr-mesh` command,
> use the tarball URL above. Don't want a global install at all? See
> [Manual registration](#manual-registration) — `npx` works without one.

`herdr-mesh install` detects installed agents and registers herdr-mesh with the
ones you pick:

- **Claude Code** — via `claude mcp add -s user`
- **Codex** — adds `[mcp_servers.herdr-mesh]` to `~/.codex/config.toml`
- **opencode** — merges into `~/.config/opencode/opencode.json`
- Other agents — prints the exact config snippet to paste

It is **safe**: existing config is parsed and merged (never overwritten), a `.bak`
backup is made before writing, and re-running skips agents already registered.
Use `herdr-mesh install -y` to register with all detected agents non-interactively.

Restart the agent(s) afterward so they pick up herdr-mesh.

## Manual registration

Each agent is its own MCP client; register herdr-mesh once per agent. All agents
on the same machine share the same herdr socket, so they can see and message each
other. The server command is `herdr-mesh` (after a global install).

Claude Code:

```bash
claude mcp add -s user herdr-mesh herdr-mesh
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.herdr-mesh]
command = "herdr-mesh"
```

Generic MCP config (stdio):

```json
{
  "mcpServers": {
    "herdr-mesh": {
      "command": "herdr-mesh"
    }
  }
}
```

> Prefer not to install globally? Use `npx -y wquesadac/herdr-mesh` as the
> command instead of `herdr-mesh` (npx fetches the prebuilt repo from GitHub;
> first run is slower while it downloads).

## Build from source (local development)

```bash
git clone https://github.com/wquesadac/herdr-mesh.git
cd herdr-mesh
npm install
npm run build
node dist/index.js          # run the server directly
node dist/index.js install  # or run the installer from source
```

## Usage — just talk to your agent

You don't type tool names. Talk to your agent (Claude, Codex, …) in plain
language; it decides when to call a herdr-mesh tool and reports back. The phrases
below are examples of what to say and which capability they trigger.

**See what's running**
- "What agents are running in herdr right now?" → lists agents + status
- "Which agent integrations does herdr support?" → integration status

**Read another agent's context (handoff in)**
- "Read the codex pane and summarize what it's working on."
- "Grab the last 100 lines from the agent named *reviewer*."

**Send a message / hand off work**
- "Tell codex: 'please review the diff on this branch'."
- "Ask the *reviewer* agent to run the tests and report back."
- "Send `npm test` to pane w65343…-3 and run it." (executes with Enter)

**Coordinate / wait**
- "Wait until codex is idle, then send it the next task."
- "Watch the build pane and tell me when it prints 'BUILD SUCCESS'."

**Spawn / manage agents**
- "Start a new codex agent in a split to the right and have it review my work."
- "Open a new agent named *tester* running claude."

**Sessions & workspace**
- "List herdr sessions." / "Create a new workspace for the docs project."

A typical handoff, all from natural language:

> "Take my current changes, hand them to a fresh codex agent for review, wait
> for it to finish, then summarize its feedback for me."

The agent chains `herdr_agent_start` → `herdr_agent_send` → `herdr_agent_wait` →
`herdr_agent_read` on its own.

**Good to know when phrasing requests**
- Be explicit about whether you want a message just *delivered* vs *run/submitted*
  — e.g. "just type it for them" vs "send it and run it". (Delivery only types
  text into the other agent's input; it does not press Enter.)
- If output looks empty, ask for it "based on what's **on screen** now". The
  "recent command output" region can be empty when nothing has been tracked.

## Tools (reference for the LLM)

These are the tool names exposed to the agent — listed here for reference, not for
you to type.

**Agent messaging & context (core)**
- `herdr_relay` — deliver a message to an agent **and submit it** (uses `agent prompt`).
  Preferred for messaging; avoids the "typed but never submitted" pitfall. `submit: false`
  types via `pane send-text` instead.
- `herdr_handoff` — send a task, wait for the agent to finish, and read its result
  back — in one step. Accepts `wait_status`, `read_source`, `read_lines`, `timeout_ms`,
  plus `compact`, `since_last` and `max_chars` for the read-back.
  Preferred for review/fix/verify loops so the chain can't break.
- `herdr_agent_list` — list agents with state (idle/working/blocked/done)
- `herdr_agent_get` — agent details
- `herdr_agent_read` — read another agent's pane output (sources: `visible`, `recent`,
  `recent-unwrapped`, `detection`). Supports `compact`, `since_last` and `max_chars`.
- `herdr_agent_send` — low-level: type literal text to an agent (no Enter; uses `pane send-text`)
- `herdr_agent_send_keys` — send key presses (`enter`, `esc`, `tab`, `ctrl+c`, `up`, …)
- `herdr_agent_prompt` — submit a prompt (text + Enter); optional `wait`, `until`, `timeout_ms`
- `herdr_agent_wait` — block until an agent reaches a status. `until` accepts one state or
  an array; `status` remains as a legacy alias. Omit both for herdr's default
  (idle, done or blocked).
- `herdr_wait_output` — block until a pane's output matches text/regex
  (`pane wait-output`); supports `source`, `lines`, `timeout_ms`, `raw`

**Agent lifecycle & discovery**
- `herdr_agent_start` — start a supported agent in a pane. Inputs: `name` (required),
  `kind` (required: `pi`, `claude`, `codex`, `gemini`, `cursor`, `devin`, `agy`, `cline`,
  `omp`, `mastracode`, `opencode`, `copilot`, `kimi`, `kiro`, `droid`, `amp`, `grok`,
  `hermes`, `kilo`, `qodercli`, `qwen`, `letta`, `maki`, `muse`), and optional `args`
  (extra agent args after `--`), `pane_id`, `workspace`, `split_from` + `direction`,
  `split`, `cwd`, `focus`, `timeout_ms`. Without `pane_id`, it creates a workspace, tab or
  pane first and cleans it up if startup fails.
  - **Breaking since 0.1.0:** `argv` → `kind` + `args`; `tab` was removed. `split`
    (right/down) still works and splits the current pane.
- `herdr_agent_rename`, `herdr_agent_focus`
- `herdr_integration_status` — list agent integrations herdr knows about and their status

**Sessions**
- `herdr_session_list`, `herdr_session_stop`, `herdr_session_delete`

**Panes**
- `herdr_pane_list` / `get` / `read` / `split` / `run` / `send_text` / `send_keys` / `close` / `rename`
- Use `herdr_pane_run` to type a command **and** press Enter; use `*_send_text` for literal text.

**Tabs & workspaces**
- `herdr_tab_*` — list / create / get / focus / rename / close
- `herdr_workspace_*` — list / create / get / focus / rename / close

**Task tools**
- `herdr_task_run` — start an agent (new workspace, new git worktree, or existing
  pane) or hand a task to an already-running agent, optionally wait, and return
  only the compact result.
- `herdr_task_wait` — wait for one or more tasks (`mode: any | all`).
- `herdr_task_status` — plain-text status for registered tasks.
- `herdr_task_close` — stop tracking a task and close what `task_run` created.

## Task tools

Task tools move the waiting and screen watching into the MCP server. The orchestrator
does not poll panes or spend model tokens while a builder works; it gets a small JSON
result when the builder is done.

### Result contract

A task ends when the builder writes a **result file** (JSON) and goes idle:

```json
{
  "status": "done | blocked | failed",
  "summary": "what happened (≤ 30 lines)",
  "files_changed": ["src/a.ts"],
  "commits": ["abc1234"],
  "tests": [{ "command": "npm test", "passed": true, "notes": "104 tests" }],
  "questions": ["should this stay opt-in?"],
  "followups": ["add integration coverage"]
}
```

`tests` may be one object or an array. Unknown keys are kept. The server never
auto-answers permission dialogs: a blocked agent is reported, not approved.

Only a result file ends a task, except a prompt that is still unacknowledged
after two attempts (that task fails without a result file) and `herdr_task_close`.
`blocked` (an agent sitting at a dialog),
`missing_result` (idle with no result file) and `timeout` (this wait call's slice)
are per-call observations: they are returned in `state`, but the task stays
registered as running. Approve the dialog and call `herdr_task_wait` again to pick
up a result written later. `herdr_task_status` shows `running` for non-final tasks,
with the last observation when there is one, e.g. `running (blocked)`. A prompt
that was sent and not yet acknowledged shows `running (awaiting ack)`.

The default result path is `.agent/out/<name>.json` inside the agent cwd. Add
`.agent/` to the repository's `.gitignore` so builders do not commit result files;
`herdr_task_close` already ignores `.agent/` when checking a worktree for dirt.

If the agent stops at a startup dialog (for example a folder-trust prompt), `herdr_task_run`
returns `state: "blocked"` with the dialog text. Answer the dialog, then call
`herdr_task_wait`: it sends the task prompt as soon as the agent is idle.

### Example flow

```text
herdr_task_run { name: "builder-a", kind: "claude", cwd: "/repo/a",
                 task: "Implement the parser", wait: false }
herdr_task_run { name: "builder-b", kind: "codex", worktree: { repo: "/repo", branch: "feat/b" },
                 task_file: "docs/task.md", wait: false }
herdr_task_wait { names: ["builder-a", "builder-b"], mode: "any", timeout_ms: 600000 }
herdr_task_wait { names: ["builder-a", "builder-b"], mode: "all", timeout_ms: 600000 }
herdr_task_close { name: "builder-a" }
herdr_task_close { name: "builder-b", remove_worktree: true }
```

### Hand a task to a running agent

`agent` does not start an agent. `name` must be that agent's live name; `agent`
may be the name or a pane id. The agent must be `idle` or `done`. A working
agent is left alone (`agent <name> is <status>; wait for it to be idle`).

`worktree` together with `agent` runs `git worktree add -b` (no new herdr pane).
The branch must not already exist. The default path is
`<parent of repo>/<repo name>-<branch>` with `/` in the branch replaced by `-`.
The agent stays in its own pane. When that path differs from the agent's cwd,
the task starts with one line telling it to work only there. `result_path` is
resolved against that work directory. `herdr_task_close`
never closes the pane, tab, or workspace. `remove_worktree: true` runs
`git worktree remove` and keeps the branch, with the same dirty and unpushed
checks as a herdr worktree. If the handoff fails before the prompt is delivered,
the checkout is removed. The branch is deleted only when its tip is still the
base commit recorded at creation, so a retry can reuse the name. A branch that
already has new commits is kept.

`clear` is an optional command sent before the task, for example `/clear` or
`/new`. There is no default and no per-kind guess. The server records
`state_change_seq`, sends the clear, and polls `agent get` every 500 ms for up
to 10 s until that sequence advances. It then waits until the agent is idle or
done (30 s) and only then sends the task. If the sequence never moves, the task
still continues after a 3 s settle and the result includes `clear_unconfirmed: true`.

`ack_ms` (default 20000, minimum 5000) is how long the server waits for the
agent to acknowledge the prompt. Acknowledgement is the agent going to work, or
`completion_seq` moving past the baseline taken at dispatch. If the agent is
idle or done when that window ends, the same prompt is sent once more. A second
miss fails the task. A dialog (`blocked`) is reported and does not count as a
missed prompt; once the agent is idle again the same rules apply. While the
prompt is unacknowledged and still inside the window, an idle agent is not
reported as `missing_result`. The output includes `prompt_attempts` when the
prompt was sent more than once.

`journal` is an absolute directory. When a task finishes, or is closed without
a result, the server appends one markdown entry to `<journal>/<YYYY-MM-DD>.md`.
Use a git-ignored directory such as `<repo>/.agent/journal`. The orchestrator
can curate that into committed project memory. A journal write failure never
fails the task.

Bypass-mode agents follow only their rules file, so a worktree per task is
recommended.

```text
herdr_task_run { name: "agy-tarif", agent: "agy-tarif",
                 worktree: { repo: "/repo", branch: "feat/task" },
                 clear: "/clear", task_file: "docs/task.md" }
```

`herdr_task_run` defaults to `wait: true` and `timeout_ms: 600000` (max 1800000).
`wait: false` returns immediately with `state: "running"`; call `herdr_task_wait`
later. `herdr_task_status` lists registered tasks without waiting and appends the
last observation to `running`, for example `running (blocked)` or
`running (awaiting ack)`.

### Long-running calls and timeouts

Blocking task tools can run for up to 30 minutes. Configure the MCP client's tool
timeout above the requested `timeout_ms`:

- **Claude Code:** `MCP_TOOL_TIMEOUT` (milliseconds).
- **OpenCode:** the per-server `timeout` option.

If you are unsure, use `wait: false` plus repeated `herdr_task_wait` calls with
`timeout_ms ≤ 600000`. While waiting, the server sends progress notifications every
30 seconds, and returns the current state if the client aborts the request.

### Compact reads

`herdr_agent_read`, `herdr_pane_read` and `herdr_handoff` accept:

- `compact: true` — strip ANSI escapes and TUI decoration, collapse blank/repeated
  lines (`line (×3)`), and drop spinner/box-drawing-only lines.
- `since_last: true` — return only lines added since the previous read of that pane
  (keyed by resolved pane id, in memory). The first read returns the full text.
- `max_chars` — cap the returned text.

Defaults are unchanged, so existing callers see no difference.

### Security and scope

Result files and task files must be regular files (not symlinks, FIFOs or devices),
at most 64 KB, and inside the agent cwd. The registry and ledger store no prompt
text, screen output or environment variables. Task result files are read from the
local filesystem, so remote `herdr --machine` servers are out of scope.

## Behavior notes (for the LLM / developers)

Tool-level behavior details — not end-user tips, but what the LLM relies on to
use the tools correctly and what developers should understand.

- **Sending messages / commands**
  - Deliver text only: `herdr_agent_send` (does not press Enter)
  - Submit text: `herdr_agent_prompt` / `herdr_relay`
  - Send special keys: `herdr_agent_send_keys` or `herdr_pane_send_keys`
    (`enter`, `esc`, `tab`, `ctrl+c`, `up`, `down`, `left`, `right`, …)
  - Run a shell command: `herdr_pane_run` (types **and** presses Enter) — simplest
- **Targets**: use a live agent name or the pane id hosting it. Terminal ids and
  agent-kind labels are rejected by herdr 0.9.5; call `herdr_agent_list` to discover
  valid names.
- **Key names**: `esc` is canonical (`escape` is accepted and normalized); `ctrl-c`,
  `Ctrl-Shift-C` and other modifier forms are rewritten to `ctrl+c` / `ctrl+shift+C`.
- **Reading output**: for context retrieval, `source: "visible"` most reliably
  returns on-screen content. `recent` / `recent-unwrapped` can be empty when there
  is no tracked command-output region; `detection` reads what herdr used for agent
  detection.

## Context & session sharing

- **Context sharing**: pull another agent's output with `herdr_agent_read`, push to
  it with `herdr_agent_send` / `herdr_pane_run`.
- **Sessions**: all agents attached to the same herdr server already share one
  session (socket) — that's the foundation context sharing relies on. Over MCP you
  can observe/manage sessions (`session_list` / `stop` / `delete`). Human remote
  `session attach` (SSH attach) is a native herdr feature and interactive, so it is
  intentionally excluded from the MCP tools.

## Troubleshooting

Natural-language requests usually work, but the agent (an LLM) ultimately decides
whether and how to call the tools, so it isn't 100% deterministic. If something
doesn't happen:

- **The agent answered without acting.** Be explicit: name the capability, e.g.
  "use herdr-mesh to message codex" or "call the herdr tools to do this".
- **A message was sent but nothing ran.** `herdr_agent_send` types without Enter.
  Ask to "send it **and run it**", or rely on `herdr_relay` / `herdr_handoff`,
  which submit for you.
- **Wrong or missing target.** Tell it to "list the agents first", then refer to
  one by the name/id from that list.
- **Read came back empty.** Ask for output "from what's **on screen** now"
  (`source: visible`); tracked "recent" output can be empty.
- **A multi-step handoff stalled midway.** Use `herdr_handoff` (send + wait + read
  in one tool) instead of asking the agent to chain several calls itself.
- **Tools not available at all.** Check the server is connected: `claude mcp list`
  or `/mcp` inside the session. Confirm herdr is up with `herdr status`.
- **Still stuck?** Errors are returned verbatim from herdr, so ask the agent to
  "show the exact error it got" — it usually names the cause (e.g. `agent_not_found`).

## Development

```bash
npm run dev    # run from source via tsx
npm run build  # compile to dist/
```

> `dist/` is committed so the package installs from GitHub without a build step.
> After changing anything under `src/`, run `npm run build` and commit `dist/` too.

## License

MIT
