import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { runHerdr } from "../herdr.js";
import {
  type ToolDef,
  type ToolResult,
  type ToolContext,
  ok,
  flag,
} from "./types.js";
import {
  AGENT_KINDS,
  type Created,
  startAgent,
  cleanupCreated,
  createWorkspaceAgent,
  isAgentNotReady,
  errorMessage,
} from "./agent.js";
import {
  buildTaskPrompt,
  parseResult,
  type TaskResult,
} from "../task/contract.js";
import {
  getRegistry,
  elapsedMs,
  type FinalStatus,
  type TaskObservation,
  type TaskRecord,
  type TaskRegistry,
  type WorktreeRecord,
} from "../task/registry.js";
import { detectFinish } from "../task/detect.js";
import { compactText } from "../compact.js";

const DEFAULT_TIMEOUT_MS = 600_000;
const MAX_TIMEOUT_MS = 1_800_000;
const DEFAULT_POLL_MS = 3_000;
const DEFAULT_MAX_CHARS = 4_000;
const MAX_FILE_BYTES = 64 * 1024;
const PROGRESS_INTERVAL_MS = 30_000;

type OutputState =
  | "running"
  | "done"
  | "blocked"
  | "failed"
  | "timeout"
  | "missing_result";

interface TaskOutput {
  name: string;
  state: OutputState;
  elapsed_ms?: number;
  cwd?: string;
  result_path?: string;
  result?: TaskResult;
  result_error?: { error: string; raw?: string } | string;
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

interface InspectedFile {
  exists: boolean;
  mtimeMs?: number;
  path: string;
  error?: string;
}

/** herdr worktree create argv (exported for argv tests). */
export function worktreeCreateArgv(
  name: string,
  worktree: WorktreeInput,
): string[] {
  const argv = [
    "worktree",
    "create",
    "--cwd",
    worktree.repo,
    "--branch",
    worktree.branch,
  ];
  flag(argv, "--base", worktree.base);
  flag(argv, "--path", worktree.path);
  argv.push("--label", name, "--no-focus");
  return argv;
}

/** herdr worktree remove argv (exported for argv tests). */
export function worktreeRemoveArgv(
  workspaceId: string,
  force = false,
): string[] {
  const argv = ["worktree", "remove", "--workspace", workspaceId];
  if (force) argv.push("--force");
  return argv;
}

/** Resolve a result path and reject anything outside the agent cwd. */
export function resolveResultPath(cwd: string, resultPath: string): string {
  const resolved = path.resolve(cwd, resultPath);
  const relative = path.relative(cwd, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `result_path must stay inside the agent cwd (${cwd}): ${resultPath}`,
    );
  }
  return resolved;
}

/** lstat + size + realpath containment. Symlinks and special files are rejected. */
function inspectFile(file: string, cwd: string): InspectedFile {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false, path: file };
    }
    return {
      exists: false,
      path: file,
      error: `could not stat file: ${errorMessage(err)}`,
    };
  }

  if (!stat.isFile()) {
    return { exists: false, path: file, error: "not a regular file" };
  }
  if (stat.size > MAX_FILE_BYTES) {
    return { exists: false, path: file, error: "file exceeds 64 KB" };
  }

  let realFile: string;
  let realCwd: string;
  try {
    realFile = fs.realpathSync(file);
    realCwd = fs.realpathSync(cwd);
  } catch (err) {
    return {
      exists: false,
      path: file,
      error: `could not resolve path: ${errorMessage(err)}`,
    };
  }
  const prefix = realCwd.endsWith(path.sep) ? realCwd : `${realCwd}${path.sep}`;
  if (!realFile.startsWith(prefix)) {
    return {
      exists: false,
      path: file,
      error: "file is outside the agent cwd",
    };
  }
  return { exists: true, mtimeMs: stat.mtimeMs, path: file };
}

function inspectResultFile(record: TaskRecord): InspectedFile {
  return inspectFile(record.result_path, record.cwd);
}

function isFreshResult(record: TaskRecord, file: InspectedFile): boolean {
  if (!file.exists || file.mtimeMs === undefined) return false;
  const dispatched = Date.parse(record.dispatched_at);
  return Number.isFinite(dispatched) && file.mtimeMs >= dispatched;
}

function resultOf(json: unknown): Record<string, unknown> | undefined {
  if (!json || typeof json !== "object") return undefined;
  const result = (json as { result?: unknown }).result;
  return result && typeof result === "object"
    ? (result as Record<string, unknown>)
    : undefined;
}

function agentMap(json: unknown): Map<string, AgentSnapshot> {
  const map = new Map<string, AgentSnapshot>();
  const result = resultOf(json);
  const agents = Array.isArray(result?.agents) ? result.agents : [];
  for (const value of agents) {
    if (!value || typeof value !== "object") continue;
    const agent = value as Record<string, unknown>;
    if (typeof agent.name !== "string") continue;
    map.set(agent.name, {
      agent_status:
        typeof agent.agent_status === "string" ? agent.agent_status : "unknown",
      completion_seq:
        typeof agent.completion_seq === "number"
          ? agent.completion_seq
          : undefined,
    });
  }
  return map;
}

function completionSeq(json: unknown): number | undefined {
  const result = resultOf(json);
  const agent = result?.agent;
  if (!agent || typeof agent !== "object") return undefined;
  const seq = (agent as Record<string, unknown>).completion_seq;
  return typeof seq === "number" ? seq : undefined;
}

function paneInfo(json: unknown): { cwd?: string; workspace_id?: string } {
  const result = resultOf(json);
  const pane = result?.pane;
  if (!pane || typeof pane !== "object") return {};
  const value = pane as Record<string, unknown>;
  return {
    cwd: typeof value.cwd === "string" ? value.cwd : undefined,
    workspace_id:
      typeof value.workspace_id === "string" ? value.workspace_id : undefined,
  };
}

function worktreeInfo(json: unknown): {
  workspaceId?: string;
  path?: string;
} {
  const result = resultOf(json);
  const workspace = result?.workspace;
  const worktree = result?.worktree;
  const workspaceId =
    workspace && typeof workspace === "object"
      ? (workspace as Record<string, unknown>).workspace_id
      : undefined;
  const worktreePath =
    worktree && typeof worktree === "object"
      ? (worktree as Record<string, unknown>).path
      : undefined;
  return {
    workspaceId: typeof workspaceId === "string" ? workspaceId : undefined,
    path: typeof worktreePath === "string" ? worktreePath : undefined,
  };
}

async function paneInWorkspace(
  workspaceId: string,
  ctx: ToolContext,
): Promise<string> {
  const result = await runHerdr(["pane", "list", "--workspace", workspaceId], {
    timeoutMs: ctx.timeoutMs,
  });
  const list = resultOf(result.json);
  const panes = Array.isArray(list?.panes) ? list.panes : [];
  const ids = panes
    .map((pane) =>
      pane && typeof pane === "object"
        ? (pane as Record<string, unknown>).pane_id
        : undefined,
    )
    .filter((id): id is string => typeof id === "string");
  if (ids.length !== 1) {
    throw new Error(
      `expected exactly one pane in workspace ${workspaceId}, found ${ids.length}`,
    );
  }
  return ids[0];
}

/** Last 30 lines / 3000 chars of a result summary. */
export function trimSummary(summary: string): string {
  let text = summary.split("\n").slice(-30).join("\n");
  if (text.length > 3000) text = text.slice(-3000);
  return text;
}

export function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
  }
  return `${hoursPart(minutes)}h${String(minutes % 60).padStart(2, "0")}m`;
}

function hoursPart(minutes: number): number {
  return Math.floor(minutes / 60);
}

async function readView(
  record: TaskRecord,
  mode: "blocked" | "tail",
  ctx: ToolContext,
): Promise<string | undefined> {
  const sources = mode === "blocked" ? ["detection", "visible"] : ["visible"];
  for (const source of sources) {
    try {
      const result = await runHerdr(
        [
          "agent",
          "read",
          record.name,
          "--source",
          source,
          "--lines",
          "200",
          "--format",
          "text",
        ],
        { timeoutMs: ctx.timeoutMs },
      );
      const compacted = compactText(result.stdout, { maxLines: 40 });
      if (compacted.trim()) return compacted;
    } catch {
      /* the agent may be gone; try the next source */
    }
  }
  return undefined;
}

export async function buildOutput(
  record: TaskRecord,
  ctx: ToolContext,
  observation?: TaskObservation,
): Promise<TaskOutput> {
  const file = inspectResultFile(record);
  let result: TaskResult | undefined;
  let resultError: { error: string; raw: string } | string | undefined;
  let state: OutputState | undefined;

  if (file.exists && isFreshResult(record, file)) {
    try {
      const parsed = parseResult(fs.readFileSync(file.path, "utf8"));
      if (parsed.ok) {
        result = { ...parsed.result, summary: trimSummary(parsed.result.summary) };
        state = parsed.result.status;
      } else {
        resultError = { error: parsed.error, raw: parsed.raw };
        state = "failed";
      }
    } catch (err) {
      resultError = `could not read result file: ${errorMessage(err)}`;
      state = "failed";
    }
  } else if (file.error) {
    resultError = file.error;
  }

  const final = record.final_status;
  if (final === "closed") state = "failed";
  else if (final && !state) state = final as OutputState;
  // Observations are per-call only; a final result always wins over them.
  if (!state) state = observation ?? "running";

  const output: TaskOutput = {
    name: record.name,
    state,
    elapsed_ms: elapsedMs(record),
    cwd: record.cwd,
    result_path: record.result_path,
  };
  if (result) output.result = result;
  if (resultError) output.result_error = resultError;

  if (state === "blocked") {
    output.view = await readView(record, "blocked", ctx);
  } else if (
    state === "missing_result" ||
    state === "timeout" ||
    (state === "failed" && resultError !== undefined)
  ) {
    output.view = await readView(record, "tail", ctx);
  }
  return output;
}

interface StringTarget {
  get: () => string | undefined;
  set: (value: string) => void;
  del?: () => void;
}

function stringTargets(outputs: TaskOutput[]): StringTarget[] {
  const targets: StringTarget[] = [];

  // 1. view
  for (const output of outputs) {
    targets.push({
      get: () => output.view,
      set: (value) => {
        output.view = value;
      },
      del: () => {
        delete output.view;
      },
    });
  }

  // 2. result.summary
  for (const output of outputs) {
    targets.push({
      get: () => {
        const result = output.result as Record<string, unknown> | undefined;
        return typeof result?.summary === "string" ? result.summary : undefined;
      },
      set: (value) => {
        const result = output.result as Record<string, unknown> | undefined;
        if (result) result.summary = value;
      },
    });
  }

  // 3. result_error.raw
  for (const output of outputs) {
    targets.push({
      get: () => {
        const error = output.result_error;
        return error && typeof error === "object" ? error.raw : undefined;
      },
      set: (value) => {
        const error = output.result_error;
        if (error && typeof error === "object") error.raw = value;
      },
      del: () => {
        const error = output.result_error;
        if (error && typeof error === "object") delete error.raw;
      },
    });
  }

  // Last resort: drop optional objects rather than cutting serialized JSON.
  for (const output of outputs) {
    targets.push({
      get: () => undefined,
      set: () => {},
      del: () => {
        delete output.result;
      },
    });
  }
  for (const output of outputs) {
    targets.push({
      get: () => undefined,
      set: () => {},
      del: () => {
        delete output.result_error;
      },
    });
  }

  return targets;
}

function budgetJson(
  value: unknown,
  outputs: TaskOutput[],
  maxChars: number,
): string {
  let json = JSON.stringify(value);
  if (json.length <= maxChars) return json;

  for (const target of stringTargets(outputs)) {
    const current = target.get();
    if (typeof current !== "string" || current.length === 0) continue;

    let low = 0;
    let high = current.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      target.set(current.slice(0, mid));
      if (JSON.stringify(value).length <= maxChars) low = mid;
      else high = mid - 1;
    }
    target.set(current.slice(0, low));
    json = JSON.stringify(value);
    if (json.length <= maxChars) return json;
  }

  for (const target of stringTargets(outputs)) {
    if (JSON.stringify(value).length <= maxChars) break;
    target.del?.();
  }
  return JSON.stringify(value);
}

/** Serialize one task output under the size budget. */
export function serializeTaskOutput(
  output: TaskOutput,
  maxChars = DEFAULT_MAX_CHARS,
): string {
  return budgetJson(output, [output], maxChars);
}

/** Serialize a task_wait array under the size budget. */
export function serializeTaskOutputs(
  outputs: TaskOutput[],
  maxChars = DEFAULT_MAX_CHARS,
): string {
  return budgetJson(outputs, outputs, maxChars);
}

interface WaitOptions {
  mode: "any" | "all";
  timeoutMs: number;
  pollMs: number;
  ctx: ToolContext;
}

/** Injection points used by tests; production callers use the defaults. */
export interface WaitDeps {
  registry?: TaskRegistry;
  listAgents?: () => Promise<Map<string, AgentSnapshot>>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function observe(
  record: TaskRecord,
  observation: TaskObservation,
  registry: TaskRegistry,
  observations: Map<string, TaskObservation>,
): void {
  observations.set(record.name, observation);
  if (record.last_observation !== observation) {
    record.last_observation = observation;
    registry.persist();
  }
}

/**
 * Poll herdr (one `agent list` per tick) until finished, observed, or timed out.
 *
 * Only a parsed result file (or an unparseable one, as "failed") is final. A
 * blocked agent, an idle agent with no result, and a wait timeout are returned
 * as per-call observations so the next call re-polls and can pick up a result
 * written after the orchestrator approves a dialog.
 */
export async function waitForRecords(
  records: TaskRecord[],
  options: WaitOptions,
  deps: WaitDeps = {},
): Promise<Map<string, TaskObservation>> {
  const registry = deps.registry ?? getRegistry();
  const now = deps.now ?? Date.now;
  const pause =
    deps.sleep ??
    ((ms: number) =>
      sleep(ms, undefined, { signal: options.ctx.signal }).then(() => undefined));
  const observations = new Map<string, TaskObservation>();
  const satisfied = (): boolean =>
    options.mode === "any"
      ? records.some(
          (record) => record.final_status || observations.has(record.name),
        )
      : records.every(
          (record) => record.final_status || observations.has(record.name),
        );

  const started = now();
  let lastProgress = started;
  let agents = new Map<string, AgentSnapshot>();

  while (true) {
    if (satisfied()) return observations;
    if (options.ctx.signal?.aborted) return observations;

    try {
      agents = deps.listAgents
        ? await deps.listAgents()
        : agentMap((await runHerdr(["agent", "list"])).json);
    } catch {
      /* keep the previous snapshot; the result file may still finish */
    }

    for (const record of records) {
      if (record.final_status) continue;
      const snapshot = agents.get(record.name) ?? { agent_status: "unknown" };
      if (snapshot.agent_status === "working") {
        if (!record.observed_working) {
          record.observed_working = true;
          registry.persist();
        }
        if (record.last_observation) {
          record.last_observation = undefined;
          registry.persist();
        }
      }

      const file = inspectResultFile(record);
      const decision = detectFinish(snapshot, record, file);
      if (decision === "result") {
        let parsed: ReturnType<typeof parseResult> | undefined;
        try {
          parsed = parseResult(fs.readFileSync(file.path, "utf8"));
        } catch {
          /* treat as a parse failure below */
        }
        if (parsed?.ok) {
          registry.finalize(record, parsed.result.status, parsed.result);
        } else {
          registry.finalize(record, "failed");
        }
        observations.delete(record.name);
      } else if (decision === "blocked") {
        observe(record, "blocked", registry, observations);
      } else if (decision === "idle_no_result") {
        observe(record, "missing_result", registry, observations);
      }
    }

    if (satisfied()) return observations;

    const at = now();
    if (at - started >= options.timeoutMs) {
      for (const record of records) {
        if (!record.final_status && !observations.has(record.name)) {
          observe(record, "timeout", registry, observations);
        }
      }
      return observations;
    }

    if (options.ctx.sendProgress && at - lastProgress >= PROGRESS_INTERVAL_MS) {
      lastProgress = at;
      const pending = records.find(
        (record) => !record.final_status && !observations.has(record.name),
      );
      const status = pending
        ? (agents.get(pending.name)?.agent_status ?? "unknown")
        : "finished";
      try {
        await options.ctx.sendProgress(
          Math.floor((at - started) / 1000),
          Math.ceil(options.timeoutMs / 1000),
          `${pending?.name ?? "task"}: ${status}`,
        );
      } catch {
        /* progress is best effort */
      }
    }

    const remaining = options.timeoutMs - (now() - started);
    if (remaining <= 0) continue;
    try {
      await pause(Math.min(options.pollMs, remaining));
    } catch {
      return observations;
    }
  }
}

export type CloseAction =
  | "none"
  | "worktree_remove"
  | "workspace_close"
  | "tab_close"
  | "pane_close";

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
export function closeDecision(
  record: TaskRecord,
  options: CloseOptions,
): { action: CloseAction; refuse?: string } {
  if (record.placement === "pane_id") return { action: "none" };

  if (options.remove_worktree && record.placement === "worktree") {
    if ((options.dirty || options.unpushed) && !options.force) {
      const reasons: string[] = [];
      if (options.dirty) reasons.push("the worktree has uncommitted changes");
      if (options.unpushed) reasons.push("it has commits that exist on no remote");
      return {
        action: "none",
        refuse:
          `refusing to remove worktree ${record.worktree?.path ?? ""}: ` +
          `${reasons.join(" and ")}; pass force=true to remove it anyway`,
      };
    }
    return { action: "worktree_remove" };
  }

  if (record.created) {
    if (record.created.kind === "workspace") return { action: "workspace_close" };
    if (record.created.kind === "tab") return { action: "tab_close" };
    return { action: "pane_close" };
  }
  return { action: "none" };
}

function runGit(
  cwd: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      { encoding: "utf8", timeout: 30_000 },
      (error, stdout) => {
        resolve({ ok: !error, stdout: stdout ?? "" });
      },
    );
  });
}

/** `git status` argv for the dirty check; `.agent/` holds result files, not work. */
export function worktreeStatusArgv(): string[] {
  return ["status", "--porcelain", "--", ".", ":(exclude).agent"];
}

/** Dirty or unverifiable trees are unsafe to remove. */
async function isDirty(cwd: string): Promise<boolean> {
  const result = await runGit(cwd, worktreeStatusArgv());
  return !result.ok || result.stdout.trim().length > 0;
}

/** Commits on no remote (including branches with no upstream) are unsafe. */
async function hasUnpushed(cwd: string): Promise<boolean> {
  const result = await runGit(cwd, ["rev-list", "--count", "HEAD", "--not", "--remotes"]);
  return !result.ok || result.stdout.trim() !== "0";
}

const nameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,31}$/)
  .describe("Live agent name (unique, [a-z][a-z0-9_-]{0,31}).");

const worktreeSchema = z.object({
  repo: z.string().describe("Repository directory to create the worktree from."),
  branch: z.string().describe("Branch to check out or create."),
  base: z.string().optional().describe("Base ref for a new branch."),
  path: z.string().optional().describe("Explicit worktree path."),
});

const timeoutSchema = z
  .number()
  .int()
  .positive()
  .max(MAX_TIMEOUT_MS)
  .optional()
  .describe("Max time to wait in milliseconds (default 600000, max 1800000).");

const pollSchema = z
  .number()
  .int()
  .min(1_000)
  .optional()
  .describe("Poll interval in milliseconds (default 3000, min 1000).");

const maxCharsSchema = z
  .number()
  .int()
  .positive()
  .optional()
  .describe("Maximum characters in the returned JSON (default 4000).");

export const taskTools: ToolDef[] = [
  {
    name: "herdr_task_run",
    description:
      "Start an agent, hand it a task, optionally wait, and return only a compact structured result. The builder writes a JSON result file and goes idle; waiting happens inside the server (no model tokens). Placement is exactly one of `cwd` (new workspace), `worktree` (new git worktree), or `pane_id` (existing shell pane). Use `wait: false` for long tasks, then `herdr_task_wait`.",
    inputSchema: {
      name: nameSchema,
      kind: z.enum(AGENT_KINDS).describe("Supported agent kind."),
      args: z
        .array(z.string())
        .optional()
        .describe("Extra arguments passed to the agent command after '--'."),
      cwd: z
        .string()
        .optional()
        .describe("Placement: create a new workspace in this directory."),
      worktree: worktreeSchema
        .optional()
        .describe("Placement: create and open a git worktree."),
      pane_id: z
        .string()
        .optional()
        .describe("Placement: use an existing shell pane at its prompt."),
      task: z.string().optional().describe("Task text to hand to the agent."),
      task_file: z
        .string()
        .optional()
        .describe("Path (relative to the agent cwd) of a task file to read."),
      result_path: z
        .string()
        .optional()
        .describe("Result file path, relative to the agent cwd (default .agent/out/<name>.json)."),
      wait: z
        .boolean()
        .optional()
        .describe("Wait for the result before returning (default true)."),
      timeout_ms: timeoutSchema,
      poll_ms: pollSchema,
      max_chars: maxCharsSchema,
    },
    timeoutMs: 120_000,
    run: async (a, ctx): Promise<ToolResult> => {
      const registry = getRegistry();
      const name = String(a.name);
      const kind = String(a.kind);
      const extraArgs = Array.isArray(a.args)
        ? (a.args as string[])
        : undefined;
      const cliCtx: ToolContext = { ...ctx, timeoutMs: undefined };
      const timeoutMs =
        typeof a.timeout_ms === "number" ? a.timeout_ms : DEFAULT_TIMEOUT_MS;
      const pollMs =
        typeof a.poll_ms === "number" ? a.poll_ms : DEFAULT_POLL_MS;
      const maxChars =
        typeof a.max_chars === "number" ? a.max_chars : DEFAULT_MAX_CHARS;

      const placements = [a.cwd, a.worktree, a.pane_id].filter(
        (value) => value !== undefined,
      ).length;
      if (placements !== 1) {
        throw new Error("exactly one of cwd, worktree or pane_id is required");
      }
      const hasTask = a.task !== undefined;
      const hasTaskFile = a.task_file !== undefined;
      if (hasTask === hasTaskFile) {
        throw new Error("exactly one of task or task_file is required");
      }
      if (registry.get(name)) {
        throw new Error(`task "${name}" is already registered; close it first`);
      }

      let paneId: string;
      let cwd: string;
      let workspaceId = "";
      let created: Created | undefined;
      let worktree: WorktreeRecord | undefined;
      let placement: TaskRecord["placement"];

      try {
        if (a.pane_id !== undefined) {
          placement = "pane_id";
          paneId = String(a.pane_id);
          const info = paneInfo(
            (
              await runHerdr(["pane", "get", paneId], {
                timeoutMs: cliCtx.timeoutMs,
              })
            ).json,
          );
          cwd = path.resolve(info.cwd ?? process.cwd());
          workspaceId = info.workspace_id ?? "";
        } else if (a.worktree !== undefined) {
          placement = "worktree";
          const input = a.worktree as WorktreeInput;
          const info = worktreeInfo(
            (
              await runHerdr(worktreeCreateArgv(name, input), {
                timeoutMs: cliCtx.timeoutMs,
              })
            ).json,
          );
          if (!info.workspaceId || !info.path) {
            throw new Error("herdr worktree create returned no workspace or path");
          }
          workspaceId = info.workspaceId;
          cwd = path.resolve(info.path);
          worktree = { path: cwd, branch: input.branch, base: input.base };
          created = { kind: "workspace", id: workspaceId };
          paneId = await paneInWorkspace(workspaceId, cliCtx);
        } else {
          placement = "cwd";
          const targetCwd = path.resolve(String(a.cwd));
          const placed = await createWorkspaceAgent(name, targetCwd, cliCtx);
          paneId = placed.paneId;
          cwd = targetCwd;
          workspaceId = placed.workspaceId ?? "";
          created = placed.created;
        }

        let taskText: string;
        if (a.task !== undefined) {
          taskText = String(a.task);
        } else {
          const taskFile = String(a.task_file);
          const inspected = inspectFile(path.resolve(cwd, taskFile), cwd);
          if (!inspected.exists) {
            throw new Error(
              `task_file ${taskFile}: ${inspected.error ?? "not found"}`,
            );
          }
          taskText = `Read ${taskFile} and carry it out.`;
        }

        const resultPath = resolveResultPath(
          cwd,
          a.result_path !== undefined
            ? String(a.result_path)
            : `.agent/out/${name}.json`,
        );
        fs.mkdirSync(path.dirname(resultPath), { recursive: true });
        fs.rmSync(resultPath, { force: true });

        const started = await startAgent(
          name,
          kind,
          paneId,
          extraArgs,
          undefined,
          cliCtx,
        );

        let baseline: number | undefined;
        try {
          const got = await runHerdr(["agent", "get", name], {
            timeoutMs: cliCtx.timeoutMs,
          });
          baseline = completionSeq(got.json);
        } catch {
          /* baseline stays undefined; observed_working covers the rest */
        }

        const record: TaskRecord = {
          name,
          kind,
          pane_id: paneId,
          workspace_id: workspaceId,
          cwd,
          placement,
          created,
          result_path: resultPath,
          worktree,
          dispatched_at: new Date().toISOString(),
          baseline_completion_seq: baseline,
          observed_working: false,
          args: extraArgs,
        };

        if (!started.ok) {
          if (isAgentNotReady(started.error)) {
            registry.set(record);
            record.last_observation = "blocked";
            registry.persist();
            const blocked: TaskOutput = {
              name,
              state: "blocked",
              elapsed_ms: elapsedMs(record),
              cwd,
              result_path: resultPath,
              view: await readView(record, "blocked", cliCtx),
            };
            return ok(serializeTaskOutput(blocked, maxChars));
          }
          await cleanupCreated(created);
          throw started.error;
        }

        registry.set(record);
        try {
          await runHerdr(["agent", "prompt", name, buildTaskPrompt(taskText, resultPath)], {
            timeoutMs: cliCtx.timeoutMs,
          });
        } catch (err) {
          registry.finalize(record, "failed");
          await cleanupCreated(created);
          throw err;
        }

        if (a.wait === false) {
          return ok(
            serializeTaskOutput(await buildOutput(record, cliCtx), maxChars),
          );
        }

        const observations = await waitForRecords([record], {
          mode: "any",
          timeoutMs,
          pollMs,
          ctx,
        });
        return ok(
          serializeTaskOutput(
            await buildOutput(record, cliCtx, observations.get(record.name)),
            maxChars,
          ),
        );
      } catch (err) {
        await cleanupCreated(created);
        throw err;
      }
    },
  },
  {
    name: "herdr_task_wait",
    description:
      "Wait for one or more registered tasks to finish. Polls `agent list` once per tick and returns a JSON array with one compact object per requested name (finished or still running). Unknown names come back as failed with `unknown task`. Use `mode: \"all\"` to wait for every task.",
    inputSchema: {
      names: z.array(nameSchema).min(1).max(16),
      mode: z
        .enum(["any", "all"])
        .optional()
        .describe("Wait for any task (default) or all tasks."),
      timeout_ms: timeoutSchema,
      poll_ms: pollSchema,
      max_chars: maxCharsSchema,
    },
    timeoutMs: 120_000,
    run: async (a, ctx): Promise<ToolResult> => {
      const registry = getRegistry();
      const names = (a.names as string[]).map(String);
      const mode = (a.mode as "any" | "all" | undefined) ?? "any";
      const timeoutMs =
        typeof a.timeout_ms === "number" ? a.timeout_ms : DEFAULT_TIMEOUT_MS;
      const pollMs =
        typeof a.poll_ms === "number" ? a.poll_ms : DEFAULT_POLL_MS;
      const maxChars =
        typeof a.max_chars === "number" ? a.max_chars : DEFAULT_MAX_CHARS;
      const cliCtx: ToolContext = { ...ctx, timeoutMs: undefined };

      const records: TaskRecord[] = [];
      let unknown = 0;
      for (const name of names) {
        const record = registry.get(name);
        if (record) records.push(record);
        else unknown++;
      }

      const anyTerminal =
        unknown > 0 || records.some((record) => record.final_status);
      const allTerminal =
        unknown === names.length ||
        records.every((record) => record.final_status);
      const satisfied = mode === "any" ? anyTerminal : allTerminal;

      let observations = new Map<string, TaskObservation>();
      if (!satisfied) {
        observations = await waitForRecords(
          records.filter((record) => !record.final_status),
          { mode, timeoutMs, pollMs, ctx },
        );
      }

      const outputs: TaskOutput[] = [];
      for (const name of names) {
        const record = registry.get(name);
        if (!record) {
          outputs.push({
            name,
            state: "failed",
            result_error: "unknown task",
          });
        } else {
          outputs.push(
            await buildOutput(record, cliCtx, observations.get(record.name)),
          );
        }
      }
      return ok(serializeTaskOutputs(outputs, maxChars));
    },
  },
  {
    name: "herdr_task_status",
    description:
      "List registered tasks without waiting. Returns plain text, one line per task: name · kind · running|<final_status> · elapsed · result_path. Non-final tasks show `running` plus the last observation when there is one, e.g. `running (blocked)`.",
    inputSchema: {
      names: z.array(nameSchema).optional().describe("Only these task names."),
    },
    run: async (a): Promise<ToolResult> => {
      const registry = getRegistry();
      const filter = Array.isArray(a.names)
        ? new Set((a.names as string[]).map(String))
        : undefined;
      const lines = registry
        .list()
        .filter((record) => !filter || filter.has(record.name))
        .map((record) => {
          const status =
            record.final_status ??
            (record.last_observation
              ? `running (${record.last_observation})`
              : "running");
          return (
            `${record.name} · ${record.kind} · ${status} · ` +
            `${formatElapsed(elapsedMs(record))} · ${record.result_path}`
          );
        });
      return ok(lines.join("\n") || "(no tasks)");
    },
  },
  {
    name: "herdr_task_close",
    description:
      "Stop tracking a task and close what herdr_task_run created. `pane_id` placement closes nothing. With `remove_worktree: true` (worktree placement only) it refuses to remove a dirty worktree or one with commits on no remote unless `force: true`. Never deletes branches.",
    inputSchema: {
      name: nameSchema,
      remove_worktree: z
        .boolean()
        .optional()
        .describe("Remove the worktree checkout and its workspace (default false)."),
      force: z
        .boolean()
        .optional()
        .describe("Remove a dirty worktree or one with unpushed commits."),
    },
    run: async (a, ctx): Promise<ToolResult> => {
      const registry = getRegistry();
      const name = String(a.name);
      const record = registry.get(name);
      if (!record) throw new Error(`unknown task "${name}"`);

      const removeWorktree = a.remove_worktree === true;
      const force = a.force === true;
      let dirty = false;
      let unpushed = false;
      if (
        removeWorktree &&
        record.placement === "worktree" &&
        record.worktree
      ) {
        dirty = await isDirty(record.worktree.path);
        unpushed = await hasUnpushed(record.worktree.path);
      }

      const decision = closeDecision(record, {
        remove_worktree: removeWorktree,
        force,
        dirty,
        unpushed,
      });
      if (decision.refuse) {
        return {
          content: [{ type: "text", text: decision.refuse }],
          isError: true,
        };
      }

      if (decision.action === "worktree_remove") {
        await runHerdr(worktreeRemoveArgv(record.workspace_id, force), {
          timeoutMs: ctx.timeoutMs,
        });
      } else if (decision.action !== "none" && record.created) {
        const command =
          decision.action === "workspace_close"
            ? "workspace"
            : decision.action === "tab_close"
              ? "tab"
              : "pane";
        await runHerdr([command, "close", record.created.id], {
          timeoutMs: ctx.timeoutMs,
        });
      }

      const finalStatus: FinalStatus = registry.close(record);
      return ok(
        JSON.stringify({
          name,
          state: "closed",
          final_status: finalStatus,
          removed_worktree: decision.action === "worktree_remove",
        }),
      );
    },
  },
];
