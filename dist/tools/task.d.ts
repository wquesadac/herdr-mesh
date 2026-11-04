import { type ToolDef } from "./types.js";
import { type TaskResult } from "../task/contract.js";
import { type TaskRecord } from "../task/registry.js";
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
/** herdr worktree create argv (exported for argv tests). */
export declare function worktreeCreateArgv(name: string, worktree: WorktreeInput): string[];
/** herdr worktree remove argv (exported for argv tests). */
export declare function worktreeRemoveArgv(workspaceId: string, force?: boolean): string[];
/** Resolve a result path and reject anything outside the agent cwd. */
export declare function resolveResultPath(cwd: string, resultPath: string): string;
/** Last 30 lines / 3000 chars of a result summary. */
export declare function trimSummary(summary: string): string;
export declare function formatElapsed(ms: number): string;
/** Serialize one task output under the size budget. */
export declare function serializeTaskOutput(output: TaskOutput, maxChars?: number): string;
/** Serialize a task_wait array under the size budget. */
export declare function serializeTaskOutputs(outputs: TaskOutput[], maxChars?: number): string;
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
export declare const taskTools: ToolDef[];
export {};
