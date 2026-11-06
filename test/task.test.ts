import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildTaskPrompt, parseResult } from "../src/task/contract.js";
import { ackDecision, detectFinish } from "../src/task/detect.js";
import {
  formatJournalEntry,
  TaskRegistry,
  type TaskRecord,
} from "../src/task/registry.js";
import {
  agentWorktreePath,
  buildOutput,
  closeDecision,
  gitWorktreeAddArgv,
  gitWorktreeRemoveArgv,
  removeGitWorktree,
  resolveResultPath,
  validatePlacement,
  workPrefix,
  worktreeStatusArgv,
  queuePendingPrompt,
  cleanupFailedHandoff,
  clearSettled,
  serializeTaskOutput,
  shouldDeleteFailedBranch,
  taskStatusText,
  trimSummary,
  waitForRecords,
  parseLiveAgent,
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

function writeResult(file: string, status: string, summary = "ok"): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ status, summary }));
}

function ledgerLines(dir: string): string[] {
  try {
    return fs
      .readFileSync(path.join(dir, "ledger.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
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

test("wait observations stay pending", async (t) => {
  const waitOptions = { mode: "any" as const, timeoutMs: 60_000, pollMs: 1, ctx: {} };

  function pendingRecord(dir: string): TaskRecord {
    const task = record({
      cwd: dir,
      result_path: path.join(dir, ".agent/out/builder.json"),
      dispatched_at: new Date(Date.now() - 10_000).toISOString(),
    });
    return task;
  }

  await t.test("blocked is observed, then a fresh result becomes done", async () => {
    const dir = tempDir();
    const registry = new TaskRegistry(dir);
    const task = pendingRecord(dir);
    registry.set(task);

    const first = await waitForRecords([task], waitOptions, {
      registry,
      listAgents: async () =>
        new Map([["builder", { agent_status: "blocked" }]]),
    });
    assert.equal(first.get("builder"), "blocked");
    assert.equal(task.final_status, undefined);
    assert.equal(task.last_observation, "blocked");
    assert.deepEqual(ledgerLines(dir), []);

    writeResult(task.result_path, "done");
    const second = await waitForRecords([task], waitOptions, {
      registry,
      listAgents: async () =>
        new Map([["builder", { agent_status: "idle", completion_seq: 2 }]]),
    });
    assert.equal(second.has("builder"), false);
    assert.equal(task.final_status, "done");
    assert.equal((await buildOutput(task, {})).state, "done");

    registry.close(task);
    const lines = ledgerLines(dir);
    assert.equal(lines.length, 1);
    assert.equal(
      (JSON.parse(lines[0]) as { final_status: string }).final_status,
      "done",
    );
  });

  await t.test("a timeout slice is observed, then a fresh result becomes done", async () => {
    const dir = tempDir();
    const registry = new TaskRegistry(dir);
    const task = pendingRecord(dir);
    registry.set(task);

    let clock = 0;
    const first = await waitForRecords([task], waitOptions, {
      registry,
      listAgents: async () =>
        new Map([["builder", { agent_status: "working" }]]),
      now: () => (clock++ === 0 ? 0 : 61_000),
    });
    assert.equal(first.get("builder"), "timeout");
    assert.equal(task.final_status, undefined);
    assert.equal(task.last_observation, "timeout");
    assert.deepEqual(ledgerLines(dir), []);

    writeResult(task.result_path, "done");
    const second = await waitForRecords([task], waitOptions, {
      registry,
      listAgents: async () =>
        new Map([["builder", { agent_status: "idle", completion_seq: 2 }]]),
    });
    assert.equal(second.has("builder"), false);
    assert.equal(task.final_status, "done");

    registry.close(task);
    assert.equal(ledgerLines(dir).length, 1);
  });

  await t.test("repeated observations never duplicate ledger lines", async () => {
    const dir = tempDir();
    const registry = new TaskRegistry(dir);
    const task = pendingRecord(dir);
    registry.set(task);
    const blocked = async () =>
      waitForRecords([task], waitOptions, {
        registry,
        listAgents: async () =>
          new Map([["builder", { agent_status: "blocked" }]]),
      });

    assert.equal((await blocked()).get("builder"), "blocked");
    assert.equal((await blocked()).get("builder"), "blocked");
    assert.deepEqual(ledgerLines(dir), []);

    writeResult(task.result_path, "failed");
    await waitForRecords([task], waitOptions, {
      registry,
      listAgents: async () =>
        new Map([["builder", { agent_status: "idle", completion_seq: 2 }]]),
    });
    registry.close(task);

    const lines = ledgerLines(dir);
    assert.equal(lines.length, 1);
    assert.equal(
      (JSON.parse(lines[0]) as { final_status: string }).final_status,
      "failed",
    );
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

  await t.test("agent placement never closes the pane", () => {
    const task = record({
      placement: "agent",
      created: { kind: "workspace", id: "w1" },
    });
    assert.equal(closeDecision(task, {}).action, "none");
    const refused = closeDecision(task, { remove_worktree: true });
    assert.equal(refused.action, "none");
    assert.match(refused.refuse ?? "", /no git worktree/);
  });

  await t.test("a git worktree is removed without deleting the branch", () => {
    const task = record({
      placement: "agent",
      worktree: {
        path: "/wt",
        branch: "feat/x",
        created_by: "git",
        repo: "/repo",
      },
    });
    assert.equal(
      closeDecision(task, { remove_worktree: true }).action,
      "git_worktree_remove",
    );
    const refused = closeDecision(task, {
      remove_worktree: true,
      dirty: true,
    });
    assert.equal(refused.action, "none");
    assert.match(refused.refuse ?? "", /uncommitted/);
    assert.equal(
      closeDecision(task, { remove_worktree: true, dirty: true, force: true })
        .action,
      "git_worktree_remove",
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
      view: `banner\n${"v".repeat(10_000)}\nAllow this command? DIALOG-END`,
      result: { status: "done" as const, summary: "s".repeat(100) },
    };

    const json = serializeTaskOutput(output, 4000);
    assert.ok(json.length <= 4000);
    const parsed = JSON.parse(json) as {
      view: string;
      result: { summary: string };
    };
    assert.ok(parsed.view.length < 10_000);
    assert.ok(parsed.view.endsWith("DIALOG-END"), "the tail (dialog) survives");
    assert.equal(parsed.view.startsWith("banner"), false);
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

test("validatePlacement", () => {
  assert.throws(
    () => validatePlacement({ agent: "agy-tarif", cwd: "/repo" }),
    /cwd/,
  );
  assert.throws(
    () => validatePlacement({ agent: "agy-tarif", pane_id: "w1:p1" }),
    /pane_id/,
  );
  assert.equal(
    validatePlacement({
      agent: "agy-tarif",
      worktree: { repo: "/repo", branch: "feat/x" },
    }),
    "agent",
  );
  assert.equal(validatePlacement({ agent: "agy-tarif" }), "agent");
  assert.equal(validatePlacement({ cwd: "/repo" }), "cwd");
  assert.throws(() => validatePlacement({}), /exactly one/);
  assert.throws(
    () => validatePlacement({ cwd: "/repo", worktree: { repo: "/repo", branch: "b" } }),
    /exactly one/,
  );
});

test("agentWorktreePath", () => {
  assert.equal(agentWorktreePath("/w/repo", "feat/x"), "/w/repo-feat-x");
});

test("workPrefix", () => {
  const line =
    "Work only in /w/repo-feat-x (a git worktree on branch feat/x): cd there for every command and edit files only under it.";
  assert.equal(workPrefix("/w/repo-feat-x", "feat/x", "/w/repo"), line);
  assert.equal(workPrefix("/w/repo", "feat/x", "/w/repo"), "");
});

test("git worktree add and remove leave the branch", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-mesh-wt-"));
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  const git = (args: string[]) =>
    execFileSync("git", args, { encoding: "utf8" });
  try {
    git(["-C", repo, "init", "-q"]);
    git(["-C", repo, "config", "user.email", "test@example.com"]);
    git(["-C", repo, "config", "user.name", "test"]);
    fs.writeFileSync(path.join(repo, "README"), "x\n");
    git(["-C", repo, "add", "README"]);
    git(["-C", repo, "commit", "-q", "-m", "init"]);
    const branch = "feat/x";
    const wt = agentWorktreePath(repo, branch);
    git(gitWorktreeAddArgv(repo, branch, wt, "HEAD"));
    assert.equal(fs.existsSync(path.join(wt, "README")), true);
    git(gitWorktreeRemoveArgv(repo, wt));
    assert.equal(fs.existsSync(wt), false);
    git(["-C", repo, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("git worktree remove still leaves the branch when .agent/ holds a result", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-mesh-wt-"));
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  const git = (args: string[]) =>
    execFileSync("git", args, { encoding: "utf8" });
  try {
    git(["-C", repo, "init", "-q"]);
    git(["-C", repo, "config", "user.email", "test@example.com"]);
    git(["-C", repo, "config", "user.name", "test"]);
    fs.writeFileSync(path.join(repo, "README"), "x\n");
    git(["-C", repo, "add", "README"]);
    git(["-C", repo, "commit", "-q", "-m", "init"]);
    const branch = "feat/x";
    const wt = agentWorktreePath(repo, branch);
    git(gitWorktreeAddArgv(repo, branch, wt));
    fs.mkdirSync(path.join(wt, ".agent", "out"), { recursive: true });
    fs.writeFileSync(path.join(wt, ".agent", "out", "builder.json"), "{}\n");
    await removeGitWorktree(repo, wt, false);
    assert.equal(fs.existsSync(wt), false);
    git(["-C", repo, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("worktree dirty check ignores .agent/", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-mesh-dirty-"));
  try {
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    git("init", "-q");
    fs.mkdirSync(path.join(repo, ".agent", "out"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".agent", "out", "builder.json"), "{}");
    assert.equal(git(...worktreeStatusArgv()).trim(), "");
    fs.writeFileSync(path.join(repo, "work.txt"), "x");
    assert.match(git(...worktreeStatusArgv()), /work\.txt/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("ackDecision", async (t) => {
  const past = DISPATCHED_MS + 20_000;
  const inside = DISPATCHED_MS + 19_999;
  const idle = { agent_status: "idle", completion_seq: 4 };
  const base = record({
    ack_ms: 20_000,
    prompt_attempts: 1,
    baseline_completion_seq: 4,
  });

  await t.test("blocked past the window is blocked at any attempt count", () => {
    assert.equal(
      ackDecision({ agent_status: "blocked" }, base, past),
      "blocked",
    );
    assert.equal(
      ackDecision(
        { agent_status: "blocked" },
        record({ ...base, prompt_attempts: 5 }),
        past,
      ),
      "blocked",
    );
  });

  await t.test("idle or done under 2 attempts asks for a resend", () => {
    assert.equal(ackDecision(idle, base, past), "resend");
    assert.equal(
      ackDecision({ agent_status: "done", completion_seq: 4 }, base, past),
      "resend",
    );
  });

  await t.test("idle or done at 2 attempts fails", () => {
    const twice = record({ ...base, prompt_attempts: 2 });
    assert.equal(ackDecision(idle, twice, past), "fail");
    assert.equal(
      ackDecision({ agent_status: "done", completion_seq: 4 }, twice, past),
      "fail",
    );
  });

  await t.test("working and unknown do nothing once the window has passed", () => {
    assert.equal(
      ackDecision({ agent_status: "working" }, base, past),
      "wait",
    );
    assert.equal(
      ackDecision({ agent_status: "unknown" }, base, past),
      "wait",
    );
  });

  await t.test("a higher completion_seq acknowledges without observed_working", () => {
    assert.equal(
      ackDecision(
        { agent_status: "idle", completion_seq: 5 },
        record({ ...base, observed_working: false }),
        past,
      ),
      "acked",
    );
  });

  await t.test("an agent still inside the window waits", () => {
    assert.equal(ackDecision(idle, base, inside), "wait");
    assert.equal(
      ackDecision({ agent_status: "blocked" }, base, inside),
      "wait",
    );
  });

  await t.test("observed_working acknowledges even inside the window", () => {
    assert.equal(
      ackDecision(idle, record({ ...base, observed_working: true }), inside),
      "acked",
    );
  });
});

test("prompt acknowledgement in the wait loop", async (t) => {
  const ackMs = 5_000;

  function idleAgents(seq = 3) {
    return new Map([["builder", { agent_status: "idle", completion_seq: seq }]]);
  }

  await t.test("an idle agent inside the window is not missing_result", async () => {
    const dir = tempDir();
    const registry = new TaskRegistry(dir);
    const start = 1_000_000;
    const task = record({
      cwd: dir,
      result_path: path.join(dir, "out.json"),
      dispatched_at: new Date(start).toISOString(),
      prompt_attempts: 1,
      ack_ms: 60_000,
    });
    registry.set(task);
    queuePendingPrompt(task.name, "the prompt");

    let clock = start;
    const observed = await waitForRecords(
      [task],
      { mode: "any", timeoutMs: 1_000, pollMs: 1_000, ctx: {} },
      {
        registry,
        listAgents: async () => idleAgents(1),
        prompt: async () => assert.fail("must not resend inside the window"),
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      },
    );
    assert.equal(observed.get("builder"), "timeout");
    assert.equal(task.final_status, undefined);
    assert.equal(task.prompt_attempts, 1);
  });

  await t.test("resends once, then fails after the second window", async () => {
    const dir = tempDir();
    const registry = new TaskRegistry(dir);
    const start = 1_000_000;
    const task = record({
      cwd: dir,
      result_path: path.join(dir, "out.json"),
      dispatched_at: new Date(start).toISOString(),
      baseline_completion_seq: 3,
      prompt_attempts: 1,
      ack_ms: ackMs,
    });
    registry.set(task);
    queuePendingPrompt(task.name, "the prompt");

    let clock = start;
    const sent: string[] = [];
    await waitForRecords(
      [task],
      { mode: "any", timeoutMs: 60_000, pollMs: ackMs, ctx: {} },
      {
        registry,
        listAgents: async () => idleAgents(3),
        prompt: async (_name, text) => void sent.push(text),
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      },
    );
    assert.deepEqual(sent, ["the prompt"]);
    assert.equal(task.prompt_attempts, 2);
    assert.equal(task.final_status, "failed");
    assert.equal(task.baseline_completion_seq, 3);
  });

  await t.test("working after a resend finishes from the result file", async () => {
    const dir = tempDir();
    const registry = new TaskRegistry(dir);
    const start = 1_000_000;
    const task = record({
      cwd: dir,
      result_path: path.join(dir, "out.json"),
      dispatched_at: new Date(start).toISOString(),
      baseline_completion_seq: 3,
      prompt_attempts: 1,
      ack_ms: ackMs,
    });
    registry.set(task);
    queuePendingPrompt(task.name, "the prompt");

    let clock = start;
    let stage: "idle" | "sent" | "working" | "done" = "idle";
    const sent: string[] = [];
    await waitForRecords(
      [task],
      { mode: "any", timeoutMs: 60_000, pollMs: ackMs, ctx: {} },
      {
        registry,
        listAgents: async () => {
          if (stage === "sent") {
            stage = "working";
            return new Map([["builder", { agent_status: "working", completion_seq: 3 }]]);
          }
          if (stage === "working" || stage === "done") {
            writeResult(task.result_path, "done", "finished");
            stage = "done";
            return idleAgents(4);
          }
          return idleAgents(3);
        },
        prompt: async (_name, text) => {
          sent.push(text);
          stage = "sent";
        },
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      },
    );
    assert.deepEqual(sent, ["the prompt"]);
    assert.equal(task.final_status, "done");
    assert.equal(task.observed_working, true);
  });
});

test("startup-blocked tasks get their prompt from the wait loop", async (t) => {
  const waitOptions = { mode: "any" as const, timeoutMs: 20, pollMs: 1, ctx: {} };

  await t.test("prompt is sent once the agent is idle", async () => {
    const dir = tempDir();
    const registry = new TaskRegistry(dir);
    const task = record({
      name: "starter",
      cwd: dir,
      result_path: path.join(dir, ".agent/out/starter.json"),
      dispatched_at: new Date(Date.now() - 10_000).toISOString(),
      pending_prompt: true,
    });
    registry.set(task);
    queuePendingPrompt("starter", "do the thing");
    const sent: string[] = [];

    const first = await waitForRecords([task], waitOptions, {
      registry,
      listAgents: async () => new Map([["starter", { agent_status: "blocked" }]]),
      prompt: async (_name, text) => void sent.push(text),
    });
    assert.equal(first.get("starter"), "blocked");
    assert.deepEqual(sent, []);

    await waitForRecords([task], waitOptions, {
      registry,
      listAgents: async () =>
        new Map([["starter", { agent_status: "idle", completion_seq: 7 }]]),
      prompt: async (_name, text) => void sent.push(text),
    });
    assert.deepEqual(sent, ["do the thing"]);
    assert.equal(task.pending_prompt, false);
    assert.equal(task.prompt_attempts, 1);
    assert.equal(task.baseline_completion_seq, 7);
    assert.equal(task.final_status, undefined);
  });

  await t.test("a lost prompt (server restart) fails the task", async () => {
    const dir = tempDir();
    const registry = new TaskRegistry(dir);
    const task = record({
      name: "orphan",
      cwd: dir,
      result_path: path.join(dir, ".agent/out/orphan.json"),
      dispatched_at: new Date().toISOString(),
      pending_prompt: true,
    });
    registry.set(task);
    await waitForRecords([task], waitOptions, {
      registry,
      listAgents: async () => new Map([["orphan", { agent_status: "idle" }]]),
      prompt: async () => assert.fail("must not prompt"),
    });
    assert.equal(task.final_status, "failed");
  });
});

test("task status while a prompt is unacknowledged", async () => {
  assert.equal(
    taskStatusText(record({ prompt_attempts: 1, observed_working: false })),
    "running (awaiting ack)",
  );
  assert.equal(
    taskStatusText(record({ prompt_attempts: 1, last_observation: "blocked" })),
    "running (blocked)",
  );
  assert.equal(
    taskStatusText(record({ observed_working: true })),
    "running",
  );
  assert.equal(taskStatusText(record({ final_status: "done" })), "done");
});

test("formatJournalEntry", async (t) => {
  const now = new Date(2026, 0, 2, 14, 5, 9);
  const started = new Date(now.getTime() - 12_000);

  await t.test("full result", () => {
    const text = formatJournalEntry(
      record({
        dispatched_at: started.toISOString(),
        finished_at: now.toISOString(),
        final_status: "done",
        cwd: "/tmp/work",
        worktree: { path: "/tmp/wt", branch: "feat/x" },
      }),
      {
        status: "done",
        summary: "did the thing\nand more",
        files_changed: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"],
        commits: ["abc", "def"],
        questions: ["why?"],
        followups: ["next", "then"],
      },
      now,
    );
    assert.equal(
      text,
      [
        "## 14:05 builder (claude): done",
        "- dir: /tmp/work · branch: feat/x · elapsed: 12s",
        "- commits: abc, def",
        "- files: 6 (a.ts, b.ts, c.ts, d.ts, e.ts)",
        "- summary:",
        "  did the thing",
        "  and more",
        "- questions: why?",
        "- followups: next",
        "  then",
      ].join("\n"),
    );
  });

  await t.test("no result omits result fields", () => {
    const text = formatJournalEntry(
      record({
        final_status: "closed",
        dispatched_at: now.toISOString(),
      }),
      undefined,
      now,
    );
    assert.equal(
      text,
      [
        "## 14:05 builder (claude): closed",
        "- dir: /tmp/work · branch: - · elapsed: 0s",
      ].join("\n"),
    );
  });

  await t.test("summary is capped at 30 lines", () => {
    const summary = Array.from({ length: 35 }, (_, i) => `line ${i}`).join("\n");
    const text = formatJournalEntry(
      record({ final_status: "done", dispatched_at: now.toISOString() }),
      { status: "done", summary },
      now,
    );
    const summaryLines = text.split("\n").filter((line) => line.startsWith("  line "));
    assert.equal(summaryLines.length, 30);
    assert.equal(summaryLines[0], "  line 0");
    assert.equal(summaryLines[29], "  line 29");
    assert.equal(text.includes("line 30"), false);
  });

  await t.test("missing commits are a dash", () => {
    const text = formatJournalEntry(
      record({ final_status: "done", dispatched_at: now.toISOString() }),
      { status: "done", summary: "ok", files_changed: ["a.ts"] },
      now,
    );
    assert.match(text, /- commits: -/);
    assert.match(text, /- files: 1 \(a\.ts\)/);
    assert.match(text, /- questions: -/);
    assert.match(text, /- followups: -/);
  });
});

test("finalize writes a journal file", () => {
  const dir = tempDir();
  const journal = path.join(dir, "journal");
  const registry = new TaskRegistry(dir);
  const task = record({
    dispatched_at: new Date().toISOString(),
    journal_dir: journal,
    cwd: "/repo",
    worktree: { path: "/repo", branch: "feat/j" },
  });
  registry.set(task);
  assert.equal(
    registry.finalize(task, "done", {
      status: "done",
      summary: "shipped it",
      files_changed: ["src/a.ts"],
      commits: ["abc1234"],
      questions: ["keep it?"],
      followups: [],
    }),
    true,
  );

  const names = fs.readdirSync(journal);
  assert.equal(names.length, 1);
  assert.match(names[0], /^\d{4}-\d{2}-\d{2}\.md$/);
  const file = path.join(journal, names[0]);
  const body = fs.readFileSync(file, "utf8");
  assert.match(body, new RegExp(`^# Task journal ${names[0].slice(0, 10)}`));
  assert.match(body, /builder \(claude\): done/);
  assert.match(body, /dir: \/repo · branch: feat\/j/);
  assert.match(body, /abc1234/);
  assert.match(body, /1 \(src\/a\.ts\)/);
  assert.match(body, / {2}shipped it/);
  assert.match(body, /keep it\?/);

  const other = record({
    name: "other",
    dispatched_at: new Date().toISOString(),
    journal_dir: journal,
  });
  registry.set(other);
  assert.equal(registry.close(other), "closed");
  const again = fs.readFileSync(file, "utf8");
  assert.equal(again.indexOf("# Task journal"), 0);
  assert.equal(again.indexOf("# Task journal", 1), -1);
  const closed = again.split("\n## ").at(-1) ?? "";
  assert.match(closed, /other \(claude\): closed/);
  assert.equal(closed.includes("commits"), false);
  assert.equal(closed.includes("summary"), false);

  const blocker = path.join(dir, "not-a-dir");
  fs.writeFileSync(blocker, "x");
  const bad = record({
    name: "bad",
    dispatched_at: new Date().toISOString(),
    journal_dir: blocker,
  });
  registry.set(bad);
  assert.equal(
    registry.finalize(bad, "failed", { status: "failed", summary: "nope" }),
    true,
  );
  assert.equal(bad.final_status, "failed");
});

test("shouldDeleteFailedBranch", () => {
  assert.equal(shouldDeleteFailedBranch("abc", "abc"), true);
  assert.equal(shouldDeleteFailedBranch("abc", "def"), false);
  assert.equal(shouldDeleteFailedBranch("", "abc"), false);
  assert.equal(shouldDeleteFailedBranch("abc", ""), false);
});

function initRepo(repo: string): void {
  const git = (args: string[]) =>
    execFileSync("git", args, { encoding: "utf8" });
  git(["-C", repo, "init", "-q"]);
  git(["-C", repo, "config", "user.email", "test@example.com"]);
  git(["-C", repo, "config", "user.name", "test"]);
  fs.writeFileSync(path.join(repo, "README"), "x\n");
  git(["-C", repo, "add", "README"]);
  git(["-C", repo, "commit", "-q", "-m", "init"]);
}

test("failed handoff removes an unchanged branch", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-mesh-wt-"));
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  const git = (args: string[]) =>
    execFileSync("git", args, { encoding: "utf8" });
  try {
    initRepo(repo);
    const branch = "feat/x";
    const wt = agentWorktreePath(repo, branch);
    const baseSha = git(["-C", repo, "rev-parse", "HEAD"]).trim();
    git(gitWorktreeAddArgv(repo, branch, wt, "HEAD"));
    await cleanupFailedHandoff({ repo, path: wt, branch, baseSha });
    assert.equal(fs.existsSync(wt), false);
    assert.throws(() =>
      git(["-C", repo, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`]),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("failed handoff keeps a branch that moved past the base", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-mesh-wt-"));
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  const git = (args: string[]) =>
    execFileSync("git", args, { encoding: "utf8" });
  try {
    initRepo(repo);
    const branch = "feat/x";
    const wt = agentWorktreePath(repo, branch);
    const baseSha = git(["-C", repo, "rev-parse", "HEAD"]).trim();
    git(gitWorktreeAddArgv(repo, branch, wt, "HEAD"));
    fs.writeFileSync(path.join(wt, "more.txt"), "y\n");
    git(["-C", wt, "add", "more.txt"]);
    git(["-C", wt, "commit", "-q", "-m", "work"]);
    await cleanupFailedHandoff({ repo, path: wt, branch, baseSha });
    assert.equal(fs.existsSync(wt), false);
    git(["-C", repo, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("clearSettled", () => {
  assert.equal(clearSettled(undefined, 2), false);
  assert.equal(clearSettled(1, undefined), false);
  assert.equal(clearSettled(1, 1), false);
  assert.equal(clearSettled(2, 1), false);
  assert.equal(clearSettled(1, 2), true);
});

test("task output includes clear_unconfirmed when a clear did not move", async () => {
  const output = await buildOutput(
    record({ clear_unconfirmed: true, result_path: "/no/such.json" }),
    {},
  );
  assert.equal(output.clear_unconfirmed, true);
  const confirmed = await buildOutput(
    record({ result_path: "/no/such.json" }),
    {},
  );
  assert.equal(confirmed.clear_unconfirmed, undefined);
});

test("task output includes prompt_attempts after a resend", async () => {
  const once = await buildOutput(
    record({ prompt_attempts: 1, result_path: "/no/such.json" }),
    {},
  );
  assert.equal(once.prompt_attempts, undefined);
  const twice = await buildOutput(
    record({ prompt_attempts: 2, result_path: "/no/such.json" }),
    {},
  );
  assert.equal(twice.prompt_attempts, 2);
});

test("parseLiveAgent reads the agent kind, not the session id type", () => {
  const live = parseLiveAgent({
    result: {
      agent: {
        agent: "agy",
        agent_session: { agent: "agy", kind: "id", value: "x" },
        agent_status: "idle",
        cwd: "/w/repo",
        name: "agy-tarif",
        pane_id: "w1:p1",
        workspace_id: "w1",
        state_change_seq: 7,
      },
    },
  });
  assert.equal(live.kind, "agy");
  assert.equal(live.state_change_seq, 7);
});

test("parseResult accepts commits as strings or as sha and message objects", () => {
  const parsed = parseResult(
    JSON.stringify({
      status: "done",
      summary: "ok",
      commits: ["abc one", { sha: "def", message: "two" }, { sha: "fed" }],
    }),
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.result.commits, ["abc one", "def two", "fed"]);
  }
});

test("an empty result file stays pending while the agent is still working", async () => {
  const dir = tempDir();
  const registry = new TaskRegistry(dir);
  const task = record({
    cwd: dir,
    result_path: path.join(dir, ".agent/out/builder.json"),
    dispatched_at: new Date(Date.now() - 10_000).toISOString(),
    observed_working: true,
  });
  registry.set(task);
  fs.mkdirSync(path.dirname(task.result_path), { recursive: true });
  fs.writeFileSync(task.result_path, "");

  let polls = 0;
  const statuses = ["working", "working", "idle"];
  await waitForRecords(
    [task],
    { mode: "any", timeoutMs: 60_000, pollMs: 1, ctx: {} },
    {
      registry,
      sleep: async () => undefined,
      listAgents: async () => {
        const status = statuses[Math.min(polls, statuses.length - 1)] ?? "idle";
        if (polls === 1) writeResult(task.result_path, "done");
        polls += 1;
        return new Map([["builder", { agent_status: status }]]);
      },
    },
  );
  assert.equal(task.final_status, "done");
});

test("parseResult joins a summary written as a list of lines", () => {
  const parsed = parseResult(
    JSON.stringify({ status: "done", summary: ["one", "two"] }),
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.result.summary, "one\ntwo");
});
