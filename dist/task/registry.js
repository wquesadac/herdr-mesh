import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LEDGER_LIMIT_BYTES = 1024 * 1024;
/** `$XDG_STATE_HOME/herdr-mesh` or `~/.local/state/herdr-mesh`. */
export function defaultStateDir() {
    const xdg = process.env.XDG_STATE_HOME;
    if (xdg && xdg.trim())
        return path.join(xdg, "herdr-mesh");
    return path.join(os.homedir(), ".local", "state", "herdr-mesh");
}
export function elapsedMs(record, now = Date.now()) {
    const started = Date.parse(record.dispatched_at);
    if (!Number.isFinite(started))
        return 0;
    const finished = record.finished_at ? Date.parse(record.finished_at) : now;
    if (!Number.isFinite(finished))
        return 0;
    return Math.max(0, finished - started);
}
function isTaskRecord(value) {
    if (!value || typeof value !== "object")
        return false;
    const record = value;
    return (typeof record.name === "string" &&
        typeof record.kind === "string" &&
        typeof record.pane_id === "string" &&
        typeof record.workspace_id === "string" &&
        typeof record.cwd === "string" &&
        (record.placement === "cwd" ||
            record.placement === "worktree" ||
            record.placement === "pane_id") &&
        typeof record.result_path === "string" &&
        typeof record.dispatched_at === "string" &&
        typeof record.observed_working === "boolean");
}
export class TaskRegistry {
    dir;
    records = new Map();
    loaded = false;
    constructor(dir = defaultStateDir()) {
        this.dir = dir;
    }
    get file() {
        return path.join(this.dir, "tasks.json");
    }
    get ledgerFile() {
        return path.join(this.dir, "ledger.jsonl");
    }
    /** Load from disk, dropping records older than 7 days. */
    load() {
        if (this.loaded)
            return;
        this.loaded = true;
        let raw;
        try {
            raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
        }
        catch {
            return;
        }
        const list = Array.isArray(raw)
            ? raw
            : raw && typeof raw === "object" && Array.isArray(raw.tasks)
                ? raw.tasks
                : [];
        const cutoff = Date.now() - MAX_AGE_MS;
        let dropped = false;
        for (const value of list) {
            if (!isTaskRecord(value)) {
                dropped = true;
                continue;
            }
            const dispatched = Date.parse(value.dispatched_at);
            if (!Number.isFinite(dispatched) || dispatched < cutoff) {
                dropped = true;
                continue;
            }
            this.records.set(value.name, value);
        }
        if (dropped)
            this.save();
    }
    get(name) {
        this.load();
        return this.records.get(name);
    }
    list() {
        this.load();
        return [...this.records.values()];
    }
    /** Insert or replace a record and persist it. */
    set(record) {
        this.load();
        this.records.set(record.name, record);
        this.save();
    }
    /** Persist the current in-memory records (e.g. after observed_working flips). */
    persist() {
        this.load();
        this.save();
    }
    /**
     * Mark a task finished exactly once, persist it, and append a ledger line.
     * Returns false when the task was already finished.
     */
    finalize(record, status, result) {
        this.load();
        if (record.final_status)
            return false;
        record.final_status = status;
        record.finished_at = new Date().toISOString();
        this.records.set(record.name, record);
        this.save();
        this.appendLedger(record, result);
        return true;
    }
    /**
     * Stop tracking a task. Unfinished tasks become "closed"; finished tasks keep
     * their status. A ledger line is appended only when this is the first finish.
     */
    close(record) {
        this.load();
        const status = record.final_status ?? "closed";
        if (!record.final_status) {
            record.final_status = "closed";
            record.finished_at = new Date().toISOString();
            this.appendLedger(record);
        }
        this.records.delete(record.name);
        this.save();
        return status;
    }
    save() {
        fs.mkdirSync(this.dir, { recursive: true });
        const tmp = path.join(this.dir, `tasks.json.tmp.${process.pid}.${Date.now()}`);
        fs.writeFileSync(tmp, `${JSON.stringify([...this.records.values()], null, 2)}\n`);
        fs.renameSync(tmp, this.file);
    }
    appendLedger(record, result) {
        fs.mkdirSync(this.dir, { recursive: true });
        try {
            if (fs.statSync(this.ledgerFile).size > LEDGER_LIMIT_BYTES) {
                fs.renameSync(this.ledgerFile, `${this.ledgerFile}.1`);
            }
        }
        catch {
            /* no ledger yet */
        }
        const line = {
            name: record.name,
            kind: record.kind,
            args: record.args ?? [],
            started: record.dispatched_at,
            finished: record.finished_at ?? new Date().toISOString(),
            elapsed_ms: elapsedMs(record),
            final_status: record.final_status ?? "closed",
            files_changed_count: result?.files_changed?.length ?? 0,
        };
        fs.appendFileSync(this.ledgerFile, `${JSON.stringify(line)}\n`);
    }
}
let registry;
/** Process-wide registry, loaded from disk on first use. */
export function getRegistry() {
    if (!registry) {
        registry = new TaskRegistry();
        registry.load();
    }
    return registry;
}
/** Test hook: forget the process-wide registry. */
export function resetRegistry() {
    registry = undefined;
}
//# sourceMappingURL=registry.js.map