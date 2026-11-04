import { type ToolDef, type ToolContext } from "./types.js";
export declare const AGENT_KINDS: readonly ["pi", "claude", "codex", "gemini", "cursor", "devin", "agy", "cline", "omp", "mastracode", "opencode", "copilot", "kimi", "kiro", "droid", "amp", "grok", "hermes", "kilo", "qodercli", "qwen", "letta", "maki", "muse"];
export type Created = {
    kind: "workspace" | "tab" | "pane";
    id: string;
};
export declare function errorMessage(err: unknown): string;
export declare function isAgentNotReady(err: unknown): boolean;
/** Read an id from a documented herdr result shape, e.g. result.tab.tab_id. */
export declare function resultId(json: unknown, section: "tab" | "workspace", field: "tab_id" | "workspace_id"): string | undefined;
/** Best-effort cleanup of a workspace/tab/pane created by agent_start. */
export declare function cleanupCreated(created: Created | undefined): Promise<void>;
/**
 * Create a workspace in `cwd` and return its only pane. Shared by
 * `herdr_agent_start` (default placement) and `herdr_task_run` (cwd placement).
 */
export declare function createWorkspaceAgent(name: string, cwd: string | undefined, ctx: ToolContext): Promise<{
    paneId: string;
    created: Created;
    workspaceId?: string;
}>;
export declare function startAgent(name: string, kind: string, paneId: string, extraArgs: string[] | undefined, timeoutMs: number | undefined, ctx: ToolContext): Promise<{
    ok: true;
    text: string;
} | {
    ok: false;
    error: unknown;
}>;
/** herdr_agent_read argv (exported so tests keep asserting the exact CLI shape). */
export declare function agentReadArgv(a: Record<string, unknown>): string[];
export declare const agentTools: ToolDef[];
