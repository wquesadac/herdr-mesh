export type Placement = "cwd" | "worktree" | "pane_id";
export type FinalStatus = "done" | "blocked" | "failed" | "timeout" | "missing_result" | "closed";
export interface CreatedResource {
    kind: "workspace" | "tab" | "pane";
    id: string;
}
export interface WorktreeRecord {
    path: string;
    branch: string;
    base?: string;
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
    finished_at?: string;
    final_status?: FinalStatus;
    /** Extra agent arguments, kept for the ledger (never the task prompt). */
    args?: string[];
}
/** `$XDG_STATE_HOME/herdr-mesh` or `~/.local/state/herdr-mesh`. */
export declare function defaultStateDir(): string;
export declare function elapsedMs(record: TaskRecord, now?: number): number;
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
    finalize(record: TaskRecord, status: FinalStatus, result?: {
        files_changed?: string[];
    }): boolean;
    /**
     * Stop tracking a task. Unfinished tasks become "closed"; finished tasks keep
     * their status. A ledger line is appended only when this is the first finish.
     */
    close(record: TaskRecord): FinalStatus;
    private save;
    private appendLedger;
}
/** Process-wide registry, loaded from disk on first use. */
export declare function getRegistry(): TaskRegistry;
/** Test hook: forget the process-wide registry. */
export declare function resetRegistry(): void;
