import type { TaskRecord } from "./registry.js";
export interface AgentSnapshot {
    agent_status: string;
    completion_seq?: number;
}
export interface ResultFileSnapshot {
    exists: boolean;
    mtimeMs?: number;
}
export type FinishDecision = "running" | "result" | "blocked" | "idle_no_result";
/**
 * Decide whether a task is finished, from one poll's snapshot.
 *
 * Order matters: a fresh result file wins over any agent status (an agent may
 * write a "blocked" result and then sit at a dialog). No poll counting: an agent
 * that never starts simply runs into the caller's timeout.
 */
export declare function detectFinish(snapshot: AgentSnapshot, record: TaskRecord, resultFile: ResultFileSnapshot): FinishDecision;
