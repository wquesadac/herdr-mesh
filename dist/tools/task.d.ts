import { type ToolDef, type ToolContext } from "./types.js";
import { type TaskResult } from "../task/contract.js";
import { formatElapsed, type TaskObservation, type TaskRecord, type TaskRegistry } from "../task/registry.js";
type OutputState = "running" | "done" | "blocked" | "failed" | "timeout" | "missing_result";
interface TaskOutput {
    name: string;
    state: OutputState;
    elapsed_ms?: number;
    cwd?: string;
    result_path?: string;
    result?: TaskResult;
    result_error?: {
        error: string;
        raw?: string;
    } | string;
    view?: string;
    /** Present only after the prompt has been sent more than once. */
    prompt_attempts?: number;
    /** Present when a clear was sent but state_change_seq never moved. */
    clear_unconfirmed?: boolean;
}
export interface WorktreeInput {
    repo: string;
    branch: string;
    base?: string;
    path?: string;
}
interface AgentSnapshot {
    agent_status: string;
    completion_seq?: number;
}
/** herdr worktree create argv (exported for argv tests). */
export declare function worktreeCreateArgv(name: string, worktree: WorktreeInput): string[];
/** herdr worktree remove argv (exported for argv tests). */
export declare function worktreeRemoveArgv(workspaceId: string, force?: boolean): string[];
export type PlacementMode = "cwd" | "worktree" | "pane_id" | "agent";
/**
 * Placement is exactly one of cwd, worktree, pane_id, or agent.
 * `agent` may be combined with `worktree` (a git worktree for that agent).
 */
export declare function validatePlacement(input: {
    cwd?: unknown;
    worktree?: unknown;
    pane_id?: unknown;
    agent?: unknown;
}): PlacementMode;
/**
 * Default git worktree path: `<parent>/<repo basename>-<branch>`, with `/` in
 * the branch replaced by `-`.
 */
export declare function agentWorktreePath(repo: string, branch: string): string;
/**
 * One-line instruction when the task's work directory is not the agent's cwd.
 * Empty when the two directories are the same path.
 */
export declare function workPrefix(dir: string, branch: string, agentCwd: string): string;
/** `git -C <repo> worktree add -b <branch> <path> [<base>]`. */
export declare function gitWorktreeAddArgv(repo: string, branch: string, wtPath: string, base?: string): string[];
/** `git -C <repo> worktree remove [--force] <path>`. Never deletes the branch. */
export declare function gitWorktreeRemoveArgv(repo: string, wtPath: string, force?: boolean): string[];
/**
 * Remove a git worktree created for an agent task. The branch is kept.
 * Result files live under `.agent/`; git treats those as untracked even when
 * the dirty check ignores them, so a non-force remove deletes that directory
 * first and then refuses if anything else is dirty.
 */
export declare function removeGitWorktree(repo: string, wtPath: string, force?: boolean): Promise<void>;
/** Resolve a result path and reject anything outside the agent cwd. */
export declare function resolveResultPath(cwd: string, resultPath: string): string;
/** Last 30 lines / 3000 chars of a result summary. */
export declare function trimSummary(summary: string): string;
export { formatElapsed };
export declare function buildOutput(record: TaskRecord, ctx: ToolContext, observation?: TaskObservation): Promise<TaskOutput>;
/** Serialize one task output under the size budget. */
export declare function serializeTaskOutput(output: TaskOutput, maxChars?: number): string;
/** Serialize a task_wait array under the size budget. */
export declare function serializeTaskOutputs(outputs: TaskOutput[], maxChars?: number): string;
interface WaitOptions {
    mode: "any" | "all";
    timeoutMs: number;
    pollMs: number;
    ctx: ToolContext;
}
/** Remember a task prompt for delivery or resend (exported for tests). */
export declare function queuePendingPrompt(name: string, text: string): void;
/** Status token for `herdr_task_status`. */
export declare function taskStatusText(record: TaskRecord): string;
/** Injection points used by tests; production callers use the defaults. */
export interface WaitDeps {
    registry?: TaskRegistry;
    listAgents?: () => Promise<Map<string, AgentSnapshot>>;
    prompt?: (name: string, text: string) => Promise<void>;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}
/**
 * Poll herdr (one `agent list` per tick) until finished, observed, or timed out.
 *
 * Only a parsed result file (or an unparseable one, as "failed") is final. A
 * blocked agent, an idle agent with no result, and a wait timeout are returned
 * as per-call observations so the next call re-polls and can pick up a result
 * written after the orchestrator approves a dialog.
 */
export declare function waitForRecords(records: TaskRecord[], options: WaitOptions, deps?: WaitDeps): Promise<Map<string, TaskObservation>>;
export type CloseAction = "none" | "worktree_remove" | "git_worktree_remove" | "workspace_close" | "tab_close" | "pane_close";
export interface CloseOptions {
    remove_worktree?: boolean;
    force?: boolean;
    dirty?: boolean;
    unpushed?: boolean;
}
/**
 * Decide what `herdr_task_close` should close. A pane_id or agent placement
 * never closes a pane, tab, or workspace (those belong to the caller).
 */
export declare function closeDecision(record: TaskRecord, options: CloseOptions): {
    action: CloseAction;
    refuse?: string;
};
/**
 * Delete a branch left by a failed hand-off only when it is still the base
 * commit, so a retry can reuse the name. A branch with new commits stays.
 */
export declare function shouldDeleteFailedBranch(tipSha: string, baseSha: string): boolean;
/** Remove a worktree created for a task that never received its prompt. */
export declare function cleanupFailedHandoff(created: {
    repo: string;
    path: string;
    branch: string;
    baseSha: string;
}): Promise<void>;
/** True when a later `state_change_seq` shows the clear was processed. */
export declare function clearSettled(before: number | undefined, after: number | undefined): boolean;
/** `git status` argv for the dirty check; `.agent/` holds result files, not work. */
export declare function worktreeStatusArgv(): string[];
export declare const taskTools: ToolDef[];
