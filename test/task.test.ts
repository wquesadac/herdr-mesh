import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildTaskPrompt, parseResult } from "../src/task/contract.js";
import { detectFinish } from "../src/task/detect.js";
import {
  TaskRegistry,
  type TaskRecord,
} from "../src/task/registry.js";
import {
  closeDecision,
  resolveResultPath,
  serializeTaskOutput,
  trimSummary,
} from "../src/tools/task.js";

const DISPATCHED = "2026-01-01T00:00:00.000Z";
const DISPATCHED_MS = Date.parse(DISPATCHED);

function record(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    name: "builder",
    kind: "claude",
    pane_id: "w1:p1",
    workspace_id: "w1",
    cwd: "/tmp/work",
    placement: "cwd",
    result_path: "/tmp/work/.agent/out/builder.json",
    dispatched_at: DISPATCHED,
    observed_working: false,
    ...overrides,
  };
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "herdr-mesh-task-"));
}

test("buildTaskPrompt", async (t) => {
  await t.test("keeps the footer identical and only varies the last line", () => {
    const task1 = "fix the parser";
    const task2 = "write a much longer task description";
    const prompt1 = buildTaskPrompt(task1, "/tmp/a.json");
    const prompt2 = buildTaskPrompt(task2, "/tmp/b.json");

    assert.ok(prompt1.startsWith(`${task1}\n\n`));
    assert.ok(prompt2.startsWith(`${task2}\n\n`));

    const suffix1 = prompt1.slice(task1.length).split("\n");
    const suffix2 = prompt2.slice(task2.length).split("\n");
    assert.deepEqual(suffix1.slice(0, -1), suffix2.slice(0, -1));
    assert.notEqual(suffix1.at(-1), suffix2.at(-1));
    assert.equal(suffix1.at(-1), "Result file path: `/tmp/a.json`");
    assert.equal(suffix2.at(-1), "Result file path: `/tmp/b.json`");
  });
});

test("parseResult", async (t) => {
  await t.test("accepts a valid result", () => {
    const parsed = parseResult(
      JSON.stringify({
        status: "done",
        summary: "ok",
        files_changed: ["src/a.ts"],
        commits: ["abc1234"],
        tests: { command: "npm test", passed: true, notes: "all green" },
        questions: [],
        followups: [],
      }),
    );
    assert.ok(parsed.ok);
    assert.equal(parsed.result.status, "done");
    assert.equal(parsed.result.summary, "ok");
  });

  await t.test("rejects a missing status", () => {
    const parsed = parseResult(JSON.stringify({ summary: "ok" }));
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.match(parsed.error, /status/);
  });

  await t.test("rejects non-JSON", () => {
    const parsed = parseResult("not json");
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.match(parsed.error, /invalid JSON/);
  });

  await t.test("keeps unknown keys", () => {
    const parsed = parseResult(
      JSON.stringify({ status: "done", summary: "ok", custom: 42 }),
    );
    assert.ok(parsed.ok);
    assert.equal((parsed.result as Record<string, unknown>).custom, 42);
  });

  await t.test("truncates raw to 2000 chars", () => {
    const parsed = parseResult("x".repeat(3000));
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.raw.length, 2000);
  });

  await t.test("accepts tests as an object and as an array", () => {
    const one = parseResult(
      JSON.stringify({
        status: "done",
        summary: "ok",
        tests: { command: "npm test", passed: true },
      }),
    );
    const many = parseResult(
      JSON.stringify({
        status: "done",
        summary: "ok",
        tests: [
          { command: "npm test", passed: true },
          { command: "npm run build", passed: false, notes: "type error" },
        ],
      }),
    );
    assert.ok(one.ok);
    assert.ok(many.ok);
  });

  await t.test("a 40-line summary still parses", () => {
    const summary = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    const parsed = parseResult(JSON.stringify({ status: "done", summary }));
    assert.ok(parsed.ok);
    assert.equal(parsed.result.summary.split("\n").length, 40);
  });
});

test("detectFinish", async (t) => {
  const fresh = { exists: true, mtimeMs: DISPATCHED_MS + 1000 };
  const stale = { exists: true, mtimeMs: DISPATCHED_MS - 1000 };
  const missing = { exists: false };

  await t.test("a fresh result wins whatever the status", () => {
    assert.equal(
      detectFinish({ agent_status: "working" }, record(), fresh),
      "result",
    );
    assert.equal(
      detectFinish({ agent_status: "blocked" }, record(), fresh),
      "result",
    );
    assert.equal(
      detectFinish({ agent_status: "idle" }, record(), fresh),
      "result",
    );
  });

  await t.test("a stale result does not count", () => {
    assert.equal(
      detectFinish({ agent_status: "blocked" }, record(), stale),
      "blocked",
    );
    assert.equal(
      detectFinish(
        { agent_status: "idle", completion_seq: 10 },
        record(),
        stale,
      ),
      "idle_no_result",
    );
  });

  await t.test("blocked status is reported", () => {
    assert.equal(
      detectFinish({ agent_status: "blocked" }, record(), missing),
      "blocked",
    );
  });

  await t.test("baseline defined requires a greater completion_seq", () => {
    const withBaseline = record({ baseline_completion_seq: 5 });
    assert.equal(
      detectFinish(
        { agent_status: "idle", completion_seq: 6 },
        withBaseline,
        missing,
      ),
      "idle_no_result",
    );
    assert.equal(
      detectFinish(
        { agent_status: "done", completion_seq: 5 },
        withBaseline,
        missing,
      ),
      "running",
    );
    assert.equal(
      detectFinish(
        { agent_status: "idle", completion_seq: undefined },
        withBaseline,
        missing,
      ),
      "running",
    );
  });

  await t.test("undefined baseline uses completion_seq or observed_working", () => {
    assert.equal(
      detectFinish(
        { agent_status: "idle", completion_seq: 1 },
        record(),
        missing,
      ),
      "idle_no_result",
    );
    assert.equal(
      detectFinish(
        { agent_status: "idle", completion_seq: undefined },
        record(),
        missing,
      ),
      "running",
    );
    assert.equal(
      detectFinish(
        { agent_status: "idle", completion_seq: undefined },
        record({ observed_working: true }),
        missing,
      ),
      "idle_no_result",
    );
  });

  await t.test("working and unknown stay running", () => {
    assert.equal(
      detectFinish({ agent_status: "working" }, record(), missing),
      "running",
    );
    assert.equal(
      detectFinish({ agent_status: "unknown" }, record(), missing),
      "running",
    );
  });
});

test("registry", async (t) => {
  await t.test("persists and reloads", () => {
    const dir = tempDir();
    const registry = new TaskRegistry(dir);
    const task = record({ dispatched_at: new Date().toISOString() });
    registry.set(task);

    const reloaded = new TaskRegistry(dir);
    reloaded.load();
    assert.equal(reloaded.get("builder")?.name, "builder");
    assert.equal(reloaded.get("builder")?.result_path, task.result_path);
  });

  await t.test("drops records older than 7 days", () => {
    const dir = tempDir();
    const old = record({
      name: "old",
      dispatched_at: new Date(
        Date.now() - 8 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    });
    fs.writeFileSync(path.join(dir, "tasks.json"), JSON.stringify([old]));

    const registry = new TaskRegistry(dir);
    registry.load();
    assert.equal(registry.get("old"), undefined);
  });

  await t.test("ledger has no prompt text and records files_changed_count", () => {
    const dir = tempDir();
    const registry = new TaskRegistry(dir);
    const task = record({
      dispatched_at: new Date().toISOString(),
      args: ["--model", "fast"],
    });
    registry.set(task);
    registry.finalize(task, "done", { files_changed: ["a.ts", "b.ts"] });

    const ledger = fs.readFileSync(path.join(dir, "ledger.jsonl"), "utf8");
    const line = JSON.parse(ledger.trim()) as Record<string, unknown>;
    assert.equal(line.files_changed_count, 2);
    assert.deepEqual(line.args, ["--model", "fast"]);
    assert.equal(line.final_status, "done");
    assert.equal(ledger.includes("secret prompt"), false);
    assert.equal("prompt" in line, false);
  });

  await t.test("close finishes an unfinished task once", () => {
    const dir = tempDir();
    const registry = new TaskRegistry(dir);
    const task = record({ dispatched_at: new Date().toISOString() });
    registry.set(task);

    assert.equal(registry.close(task), "closed");
    assert.equal(registry.get("builder"), undefined);

    const lines = fs
      .readFileSync(path.join(dir, "ledger.jsonl"), "utf8")
      .trim()
      .split("\n");
    assert.equal(lines.length, 1);
  });
});

test("resolveResultPath", async (t) => {
  await t.test("rejects ../x.json", () => {
    assert.throws(() => resolveResultPath("/work", "../x.json"), /inside/);
  });

  await t.test("rejects an absolute path outside the cwd", () => {
    assert.throws(() => resolveResultPath("/work", "/other/x.json"), /inside/);
  });

  await t.test("accepts a relative path inside the cwd", () => {
    assert.equal(
      resolveResultPath("/work", ".agent/out/a.json"),
      "/work/.agent/out/a.json",
    );
  });
});

test("closeDecision", async (t) => {
  await t.test("pane_id placement closes nothing", () => {
    const task = record({
      placement: "pane_id",
      created: { kind: "workspace", id: "w1" },
    });
    assert.equal(
      closeDecision(task, {
        remove_worktree: true,
        dirty: true,
        unpushed: true,
      }).action,
      "none",
    );
  });

  await t.test("a dirty worktree refuses without force", () => {
    const task = record({
      placement: "worktree",
      worktree: { path: "/wt", branch: "feat" },
      created: { kind: "workspace", id: "w1" },
    });
    const refused = closeDecision(task, {
      remove_worktree: true,
      dirty: true,
    });
    assert.equal(refused.action, "none");
    assert.match(refused.refuse ?? "", /uncommitted/);
    assert.equal(
      closeDecision(task, {
        remove_worktree: true,
        dirty: true,
        force: true,
      }).action,
      "worktree_remove",
    );
  });

  await t.test("unpushed commits refuse without force", () => {
    const task = record({
      placement: "worktree",
      worktree: { path: "/wt", branch: "feat" },
      created: { kind: "workspace", id: "w1" },
    });
    const refused = closeDecision(task, {
      remove_worktree: true,
      unpushed: true,
    });
    assert.equal(refused.action, "none");
    assert.match(refused.refuse ?? "", /no remote/);
    assert.equal(
      closeDecision(task, {
        remove_worktree: true,
        unpushed: true,
        force: true,
      }).action,
      "worktree_remove",
    );
  });

  await t.test("falls back to the created resource", () => {
    assert.equal(
      closeDecision(record({ created: { kind: "workspace", id: "w1" } }), {})
        .action,
      "workspace_close",
    );
    assert.equal(
      closeDecision(record({ created: { kind: "tab", id: "t1" } }), {}).action,
      "tab_close",
    );
    assert.equal(
      closeDecision(record({ created: { kind: "pane", id: "p1" } }), {}).action,
      "pane_close",
    );
  });
});

test("output cutting", async (t) => {
  await t.test("cuts the view first and keeps the JSON parseable", () => {
    const output = {
      name: "builder",
      state: "blocked" as const,
      elapsed_ms: 1000,
      cwd: "/work",
      result_path: "/work/.agent/out/builder.json",
      view: "v".repeat(10_000),
      result: { status: "done" as const, summary: "s".repeat(100) },
    };

    const json = serializeTaskOutput(output, 4000);
    assert.ok(json.length <= 4000);
    const parsed = JSON.parse(json) as {
      view: string;
      result: { summary: string };
    };
    assert.ok(parsed.view.length < 10_000);
    assert.equal(parsed.result.summary.length, 100);
  });

  await t.test("trims the summary to its last 30 lines and 3000 chars", () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    assert.equal(trimSummary(lines).split("\n").length, 30);
    assert.equal(trimSummary(lines).split("\n")[0], "line 10");

    const long = "x".repeat(4000);
    assert.equal(trimSummary(long).length, 3000);
  });
});
