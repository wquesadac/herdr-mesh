import { z } from "zod";
/** The result file a builder writes when it finishes (or gets blocked). */
export const testSchema = z
    .object({
    command: z.string(),
    passed: z.boolean(),
    notes: z.string().optional(),
})
    .passthrough();
export const resultSchema = z
    .object({
    status: z.enum(["done", "blocked", "failed"]),
    summary: z.string(),
    files_changed: z.array(z.string()).optional(),
    commits: z.array(z.string()).optional(),
    tests: z.union([testSchema, z.array(testSchema)]).optional(),
    questions: z.array(z.string()).optional(),
    followups: z.array(z.string()).optional(),
})
    .passthrough();
const RAW_LIMIT = 2000;
/** Fixed footer; only the final result-file line varies between tasks. */
const FOOTER = [
    "When you finish, or if you are blocked and cannot continue, write the result file as JSON",
    'with keys: status ("done" | "blocked" | "failed"), summary (≤ 30 lines), files_changed,',
    "commits, tests {command, passed, notes}, questions, followups. Write the file with your",
    "file tool; do not print its contents. Then stop and wait.",
].join("\n");
/** Build the prompt: the task, a blank line, the fixed footer, then the path. */
export function buildTaskPrompt(task, resultPath) {
    return `${task}\n\n${FOOTER}\nResult file path: \`${resultPath}\``;
}
/** Parse a result file: JSON + schema check. `raw` is truncated for output. */
export function parseResult(text) {
    const raw = text.slice(0, RAW_LIMIT);
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `invalid JSON: ${message}`, raw };
    }
    const checked = resultSchema.safeParse(parsed);
    if (!checked.success) {
        const error = checked.error.issues
            .map((issue) => {
            const where = issue.path.length > 0 ? issue.path.join(".") : "(root)";
            return `${where}: ${issue.message}`;
        })
            .join("; ");
        return { ok: false, error: `invalid result: ${error}`, raw };
    }
    return { ok: true, result: checked.data };
}
//# sourceMappingURL=contract.js.map