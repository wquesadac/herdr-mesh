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
export type AckDecision = "acked" | "wait" | "resend" | "blocked" | "fail";
/** True once the agent has been seen working, or a turn completed after dispatch. */
export declare function isAcknowledged(snapshot: AgentSnapshot, record: TaskRecord): boolean;
/**
 * Decide what to do with a prompt that has not been acknowledged.
 * Inside `ack_ms` the caller waits. Past it, a dialog is reported, an idle
 * agent is prompted again once, and a second miss fails the task.
 */
export declare function ackDecision(snapshot: AgentSnapshot, record: TaskRecord, now: number): AckDecision;
/**
 * Decide whether a task is finished, from one poll's snapshot.
 *
 * Order matters: a fresh result file wins over any agent status (an agent may
 * write a "blocked" result and then sit at a dialog). No poll counting: an agent
 * that never starts simply runs into the caller's timeout.
 */
export declare function detectFinish(snapshot: AgentSnapshot, record: TaskRecord, resultFile: ResultFileSnapshot): FinishDecision;
