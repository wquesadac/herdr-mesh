# Review of herdr-0.9.5-compat.md Implementation Plan

This review assesses the `docs/plans/herdr-0.9.5-compat.md` implementation plan against the installed `herdr 0.9.5` CLI and existing source files in `src/`.

---

1. [blocker] **Race condition and dangling resources in multi-step `herdr_agent_start`**
   - **Section**: `### src/tools/agent.ts` (lines 48–53)
   - **Issue**: `herdr agent start` requires that the target pane already be at an interactive shell prompt (`"The pane must be at its interactive shell prompt. Success means the expected agent was detected in the same terminal and is ready for input."`). Spawning a new workspace (`workspace create`), tab (`tab create`), or pane (`pane split`) starts a new shell asynchronously. Immediately running `agent start` without verifying that the shell has initialized and printed its prompt will intermittently fail with startup errors (`agent_pane_not_found`, `agent_start_input_failed`, or shell startup race). Furthermore, if `agent start` fails after layout creation, the newly created workspace, tab, or pane is leaked and left dangling.
   - **Concrete Fix**:
     1. Add an interactive shell readiness wait before issuing `agent start` (or use a retry loop on `agent start` up to `timeout_ms`).
     2. In the `run` handler, wrap the creation in a `try...catch`. If `agent start` fails, clean up the newly created entity (`workspace close`, `tab close`, or `pane close`) only if it was created by this invocation (i.e. do not close when `pane_id` was explicitly supplied by the caller).

2. [blocker] **`execTool` timeout calculation does not apply to composite `run` handlers**
   - **Section**: `### src/tools/types.ts` (line 40)
   - **Issue**: The plan states: *"`execTool`: when `args.timeout_ms` is a number, set the subprocess timeout to `max(tool.timeoutMs ?? 30000, timeout_ms + 10000)`. Today the fixed 120000 cap kills longer waits early."* In `src/tools/types.ts:38-42`, `if (tool.run) return await tool.run(args);` executes before `buildArgs` and `runHerdr`. Because `herdr_handoff`, `herdr_relay`, and the rewritten `herdr_agent_start` are implemented via `run`, any timeout adjustment made inside `execTool`'s fallback `buildArgs` path will never affect `run` handlers. Calls to `runHerdr` inside `tool.run` will still use `runHerdr`'s default `DEFAULT_TIMEOUT_MS = 30_000`, causing long-running `agent start` (which defaults to 30s and can take up to 300s) or `handoff` prompts to be killed prematurely by `execFile`.
   - **Concrete Fix**:
     1. Update `execTool` to pass the computed execution timeout into `tool.run(args, { timeoutMs })`.
     2. In `run` handlers (`agent_start`, `handoff`), explicitly pass `{ timeoutMs: Math.max(30000, Number(a.timeout_ms || 30000) + 10000) }` to all internal `runHerdr` invocations that invoke `agent start`, `agent prompt`, or `agent wait`.

3. [blocker] **Unacknowledged breaking changes in `herdr_agent_start` (`tab` dropped, `split` changed)**
   - **Section**: `## Constraints` (line 29) & `### src/tools/agent.ts` (lines 48–53)
   - **Issue**: Line 29 states: *"Only `herdr_agent_start` changes its interface in a breaking way. Every other tool name and input stays backward compatible."* Line 53 states: *"Remove the old `argv` input (breaking, which is why the version becomes 0.2.0)."* However, the plan also silently removes the existing `tab` parameter and renames `split: z.enum(["right", "down"])` to `split_from` + `direction`. Existing callers passing `tab` or `split` will encounter schema validation errors.
   - **Concrete Fix**:
     1. Document `tab` and `split` in the list of breaking changes alongside `argv`.
     2. Retain backward compatibility where possible: allow `tab: z.string().optional()` (create a pane in the specified tab if supported, or error cleanly), and accept `split: z.enum(["right", "down"]).optional()` as a fallback/alias for `direction` when `split_from` is specified.

4. [should] **`herdr_wait_output` misses CLI option `--raw` and inverts CLI positional argv**
   - **Section**: `### src/tools/agent.ts` (line 44) & `## Why` (line 11)
   - **Issue**:
     1. The plan mentions `--raw` in the comparison table (line 11), but line 44 omits it from the changes: `herdr_wait_output → ["pane","wait-output",pane,...]: if regex: true, emit --regex <match>, otherwise --match <match>. Add optional lines (--lines). Keep source and timeout_ms.` The installed `herdr 0.9.5` CLI explicitly supports `--raw` (*"Keep ANSI escape sequences while matching"*).
     2. `herdr pane wait-output --help` syntax is: `herdr pane wait-output [OPTIONS] <--match <TEXT>|--regex <PATTERN>> <PANE_ID>`. Placing `<pane_id>` after subcommands before options (`["pane", "wait-output", pane, ...]`) relies on non-standard positional parsing instead of standard CLI argument ordering.
   - **Concrete Fix**:
     1. Add `raw: z.boolean().optional().describe("Keep ANSI escape sequences while matching.")` to `herdr_wait_output`'s schema and emit `--raw` when `true`.
     2. Build argv with `<PANE_ID>` at the end:
        ```ts
        const argv = ["pane", "wait-output"];
        if (a.regex) argv.push("--regex", String(a.match));
        else argv.push("--match", String(a.match));
        flag(argv, "--source", a.source);
        flag(argv, "--lines", a.lines);
        flag(argv, "--timeout", a.timeout_ms);
        boolFlag(argv, "--raw", undefined, a.raw);
        argv.push(String(a.pane_id));
        ```

5. [should] **`herdr_wait_output` tool naming and namespace inconsistency**
   - **Section**: `### src/tools/agent.ts` (line 44) & `### src/tools/pane.ts`
   - **Issue**: In `herdr 0.1.0`, `herdr_wait_output` was grouped in `src/tools/agent.ts` because the underlying CLI command was `herdr wait output`. In `herdr 0.9.5`, this command was relocated to the `pane` group: `herdr pane wait-output`. Leaving `herdr_wait_output` exclusively in `src/tools/agent.ts` violates tool namespace consistency, as users and agents looking for pane operations expect `herdr_pane_wait_output`.
   - **Concrete Fix**: Add `herdr_pane_wait_output` to `src/tools/pane.ts` (or export it from `pane.ts` as the primary tool) and re-export `herdr_wait_output` in `src/tools/agent.ts` as an alias referencing the same definition for backward compatibility.

6. [should] **`herdr_handoff` schema omits `read_source` input**
   - **Section**: `### src/tools/composite.ts` (line 58)
   - **Issue**: Line 58 states: *"`herdr_handoff`: agent prompt <target> <message> --wait [--until ...] --timeout <t>, then agent read <target> --source <read_source|recent> --lines <n> --format text."* In `src/tools/composite.ts:68-88`, `herdr_handoff` only accepts `target`, `message`, `wait_status`, `timeout_ms`, `read_lines`. It has no `read_source` parameter. Without declaring `read_source` in `inputSchema`, zod will strip or reject it.
   - **Concrete Fix**: Add `read_source` to `herdr_handoff`'s `inputSchema`:
     ```ts
     read_source: z
       .enum(["visible", "recent", "recent-unwrapped", "detection"])
       .optional()
       .describe("Portion of pane buffer to read back (default: recent)."),
     ```
     And use `(a.read_source as string) ?? "recent"` when executing `agent read`.

7. [should] **Schema inconsistency between `herdr_agent_wait` (`status`) and `herdr_agent_prompt` (`until`)**
   - **Section**: `### src/tools/agent.ts` (lines 43, 47)
   - **Issue**: `herdr agent wait` and `herdr agent prompt` in herdr 0.9.5 both use the exact same CLI option `--until <STATUS>`. In the plan, line 43 keeps the input named `status` for `herdr_agent_wait`, while line 47 introduces `until` for `herdr_agent_prompt`. Having two tools wrapping identical underlying CLI semantics with different schema property names will confuse LLM tool callers.
   - **Concrete Fix**: Support both `until` and `status` in `herdr_agent_wait` (e.g. `status: z.union([statusEnum, z.array(statusEnum)]).optional()`, `until: z.union([statusEnum, z.array(statusEnum)]).optional()`), falling back from `until` to `status` in `buildArgs`.

8. [should] **Recursive `findPaneId` contradicts plan's explicit JSON parsing rule**
   - **Section**: `### src/tools/types.ts` (line 39) vs `Verified JSON output shapes` (line 24)
   - **Issue**: Line 24 warns: *"Read `result.root_pane.pane_id` or `result.pane.pane_id` explicitly. Don't rely on a recursive 'first pane_id' search for new panes."* Yet line 39 says: *"Move `findPaneId` and `resolvePaneId` from `composite.ts` into a shared helper (e.g. `src/tools/resolve.ts`) and reuse them."* In herdr 0.9.5 responses, objects often include nested fields such as `previous_pane_id`, `panes: [...]`, or `root_pane`. A recursive search across arbitrary object graphs is non-deterministic.
   - **Concrete Fix**: Replace recursive `findPaneId` with explicit type-guarded property lookup:
     ```ts
     function extractPaneId(json: any): string | undefined {
       if (!json || typeof json !== "object") return undefined;
       return json.result?.agent?.pane_id ??
              json.result?.pane?.pane_id ??
              json.result?.root_pane?.pane_id ??
              json.pane_id;
     }
     ```

9. [should] **Smoke test script gaps and resource leak risk**
   - **Section**: `### Tests and smoke` (line 66)
   - **Issue**: The proposed `scripts/smoke.mjs` runs `workspace_create → pane_run → wait_output → pane_send_keys → workspace_close`.
     1. It tests only pane/workspace tools; it does not test any of the updated agent commands (`agent_list`, `agent_get`, `agent_prompt`, `agent_send_keys`, `agent_wait`), which is where all the breaking 0.9.5 changes are located.
     2. If any assertion fails between `workspace_create` and `workspace_close`, the script terminates, leaking an active workspace in the user's running herdr session.
   - **Concrete Fix**:
     1. Structure `scripts/smoke.mjs` with a `try...finally` block that guarantees `workspace_close` runs even on failure or unhandled rejection.
     2. Add read-only agent verifications to the smoke test (`agent_list`, `agent_get` on an existing or started agent) and assert key normalization behavior.

10. [nit] **`normalizeKey` specification ambiguity: case sensitivity, compound modifiers, and `escape`**
    - **Section**: `### src/tools/types.ts` (line 38)
    - **Issue**: The plan states: *"`normalizeKey(k)`: rewrite a `ctrl-`/`alt-`/`shift-`/`meta-` prefix to the `+` form (`ctrl-c` → `ctrl+c`); pass everything else through."* A naive single-prefix regex replacement will fail on compound modifiers like `ctrl-shift-c` (leaving `ctrl+shift-c` or missing subsequent hyphens), uppercase inputs like `Ctrl-C`, or `escape` (herdr canonical is `esc`).
    - **Concrete Fix**: Specify `normalizeKey` explicitly:
      ```ts
      export function normalizeKey(key: string): string {
        let k = key.trim().toLowerCase();
        if (k === "escape") return "esc";
        return k.replace(/^(ctrl|alt|shift|meta)-(?:(shift|alt|ctrl)-)?/g, (match) =>
          match.replace(/-/g, "+")
        );
      }
      ```

11. [nit] **`herdr_agent_start` argument schema: `args` typing**
    - **Section**: `### src/tools/agent.ts` (line 48)
    - **Issue**: Line 48 lists optional `args` (extra agent args after `--`). The CLI requires arguments after `--` to be distinct tokens (`[-- [AGENT_ARG]...]`). The plan does not specify whether `args` in the Zod schema is `z.array(z.string())` or `z.string()`.
    - **Concrete Fix**: Explicitly specify `args: z.array(z.string()).optional().describe("Extra arguments passed to the agent command after '--'.")` in `inputSchema`, and in `buildArgs`/`run`, push `["--", ...args]` only when `Array.isArray(args) && args.length > 0`.

12. [nit] **Overengineering: Creating a separate `src/tools/resolve.ts`**
    - **Section**: `### src/tools/types.ts` (line 39)
    - **Issue**: The plan proposes moving `resolvePaneId` and `findPaneId` into a new dedicated module `src/tools/resolve.ts`. The repository currently centralizes all common helpers (`flag`, `boolFlag`, schemas, execution handlers) in `src/tools/types.ts`. Creating a separate single-function file adds unnecessary fragmentation.
    - **Concrete Fix**: Keep `resolvePaneId` in `src/tools/types.ts` alongside other shared helpers.
