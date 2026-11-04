import { type ToolDef, type ToolContext } from "./types.js";
import { type TaskResult } from "../task/contract.js";
import { type TaskObservation, type TaskRecord, type TaskRegistry } from "../task/registry.js";
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
/** Resolve a result path and reject anything outside the agent cwd. */
export declare function resolveResultPath(cwd: string, resultPath: string): string;
/** Last 30 lines / 3000 chars of a result summary. */
export declare function trimSummary(summary: string): string;
export declare function formatElapsed(ms: number): string;
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
/** Queue a task prompt for delivery by the wait loop (exported for tests). */
export declare function queuePendingPrompt(name: string, text: string): void;
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
export type CloseAction = "none" | "worktree_remove" | "workspace_close" | "tab_close" | "pane_close";
export interface CloseOptions {
    remove_worktree?: boolean;
    force?: boolean;
    dirty?: boolean;
    unpushed?: boolean;
}
/**
 * Decide what `herdr_task_close` should close. A pane_id placement never closes
 * anything (the pane and workspace belong to the caller).
 */
export declare function closeDecision(record: TaskRecord, options: CloseOptions): {
    action: CloseAction;
    refuse?: string;
};
/** `git status` argv for the dirty check; `.agent/` holds result files, not work. */
export declare function worktreeStatusArgv(): string[];
export declare const taskTools: ToolDef[];
export {};
