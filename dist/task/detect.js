const DEFAULT_ACK_MS = 20_000;
/** True once the agent has been seen working, or a turn completed after dispatch. */
export function isAcknowledged(snapshot, record) {
    if (record.observed_working)
        return true;
    return (record.baseline_completion_seq !== undefined &&
        snapshot.completion_seq !== undefined &&
        snapshot.completion_seq > record.baseline_completion_seq);
}
/**
 * Decide what to do with a prompt that has not been acknowledged.
 * Inside `ack_ms` the caller waits. Past it, a dialog is reported, an idle
 * agent is prompted again once, and a second miss fails the task.
 */
export function ackDecision(snapshot, record, now) {
    if (isAcknowledged(snapshot, record))
        return "acked";
    const ackMs = record.ack_ms ?? DEFAULT_ACK_MS;
    const dispatched = Date.parse(record.dispatched_at);
    const elapsed = Number.isFinite(dispatched) ? now - dispatched : 0;
    if (elapsed < ackMs)
        return "wait";
    if (snapshot.agent_status === "blocked")
        return "blocked";
    if (snapshot.agent_status === "idle" || snapshot.agent_status === "done") {
        return (record.prompt_attempts ?? 1) < 2 ? "resend" : "fail";
    }
    return "wait";
}
/** A result file only counts when it was written after dispatch. */
function isFresh(record, resultFile) {
    if (!resultFile.exists || resultFile.mtimeMs === undefined)
        return false;
    const dispatched = Date.parse(record.dispatched_at);
    if (!Number.isFinite(dispatched))
        return false;
    return resultFile.mtimeMs >= dispatched;
}
/**
 * Decide whether a task is finished, from one poll's snapshot.
 *
 * Order matters: a fresh result file wins over any agent status (an agent may
 * write a "blocked" result and then sit at a dialog). No poll counting: an agent
 * that never starts simply runs into the caller's timeout.
 */
export function detectFinish(snapshot, record, resultFile) {
    if (isFresh(record, resultFile))
        return "result";
    if (snapshot.agent_status === "blocked")
        return "blocked";
    if (snapshot.agent_status === "idle" || snapshot.agent_status === "done") {
        if (record.baseline_completion_seq !== undefined) {
            return snapshot.completion_seq !== undefined &&
                snapshot.completion_seq > record.baseline_completion_seq
                ? "idle_no_result"
                : "running";
        }
        return snapshot.completion_seq !== undefined || record.observed_working
            ? "idle_no_result"
            : "running";
    }
    return "running";
}
//# sourceMappingURL=detect.js.map