import type { TaskResult } from "./contract.js";
export type Placement = "cwd" | "worktree" | "pane_id" | "agent";
/**
 * Statuses that end a task and produce exactly one ledger line. `blocked` here
 * means the builder wrote a blocked result file; an agent that is merely sitting
 * at a dialog is a per-call observation, not a final status.
 */
export type FinalStatus = "done" | "blocked" | "failed" | "closed";
/** Per-call wait observations that never finalize a task. */
export type TaskObservation = "blocked" | "missing_result" | "timeout";
export interface CreatedResource {
    kind: "workspace" | "tab" | "pane";
    id: string;
}
export interface WorktreeRecord {
    path: string;
    branch: string;
    base?: string;
    /** Set when this checkout was created with `git worktree add`, not herdr. */
    created_by?: "git";
    /** Main repository for `git -C <repo> worktree`. */
    repo?: string;
    /** Commit the branch pointed at when the worktree was created. */
    base_sha?: string;
}
export interface TaskRecord {
    name: string;
    kind: string;
    pane_id: string;
    workspace_id: string;
    cwd: string;
    placement: Placement;
    /** What task_run created, if anything. */
    created?: CreatedResource;
    /** Absolute path of the result file. */
    result_path: string;
    worktree?: WorktreeRecord;
    /** ISO timestamp of dispatch. */
    dispatched_at: string;
    /** Absent until the agent has completed a turn at least once. */
    baseline_completion_seq?: number;
    /** Set the first time a poll sees "working". */
    observed_working: boolean;
    /** Dispatches so far, including the first send and any resend. */
    prompt_attempts?: number;
    /** How long to wait for acknowledgement before resending or failing. */
    ack_ms?: number;
    /** Set when a clear was sent but state_change_seq never advanced. */
    clear_unconfirmed?: boolean;
    /** Absolute directory for a markdown journal. Unset means no journal. */
    journal_dir?: string;
    /**
     * True while the task prompt is still undelivered because the agent was blocked
     * at startup. The prompt text itself is kept in memory only (never persisted).
     */
    pending_prompt?: boolean;
    /** Last per-call observation, for `task_status` only; never final. */
    last_observation?: TaskObservation;
    finished_at?: string;
    final_status?: FinalStatus;
    /** Extra agent arguments, kept for the ledger (never the task prompt). */
    args?: string[];
}
/** `$XDG_STATE_HOME/herdr-mesh` or `~/.local/state/herdr-mesh`. */
export declare function defaultStateDir(): string;
export declare function elapsedMs(record: TaskRecord, now?: number): number;
export declare function formatElapsed(ms: number): string;
/**
 * One markdown journal entry. With no result, only the heading and the
 * directory line are written (a close that never finished).
 */
export declare function formatJournalEntry(record: TaskRecord, result: Partial<TaskResult> | undefined, now: Date): string;
export declare class TaskRegistry {
    readonly dir: string;
    private readonly records;
    private loaded;
    constructor(dir?: string);
    private get file();
    private get ledgerFile();
    /** Load from disk, dropping records older than 7 days. */
    load(): void;
    get(name: string): TaskRecord | undefined;
    list(): TaskRecord[];
    /** Insert or replace a record and persist it. */
    set(record: TaskRecord): void;
    /** Persist the current in-memory records (e.g. after observed_working flips). */
    persist(): void;
    /**
     * Mark a task finished exactly once, persist it, and append a ledger line.
     * Returns false when the task was already finished.
     */
    finalize(record: TaskRecord, status: FinalStatus, result?: Partial<TaskResult>): boolean;
    /**
     * Stop tracking a task. Unfinished tasks become "closed"; finished tasks keep
     * their status. A ledger line is appended only when this is the first finish.
     */
    close(record: TaskRecord): FinalStatus;
    private writeJournal;
    private save;
    private appendLedger;
}
/** Process-wide registry, loaded from disk on first use. */
export declare function getRegistry(): TaskRegistry;
/** Test hook: forget the process-wide registry. */
export declare function resetRegistry(): void;
