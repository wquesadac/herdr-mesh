import { z } from "zod";
/** The result file a builder writes when it finishes (or gets blocked). */
export declare const testSchema: z.ZodObject<{
    command: z.ZodString;
    passed: z.ZodBoolean;
    notes: z.ZodOptional<z.ZodString>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    command: z.ZodString;
    passed: z.ZodBoolean;
    notes: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    command: z.ZodString;
    passed: z.ZodBoolean;
    notes: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">>;
export declare const resultSchema: z.ZodObject<{
    status: z.ZodEnum<["done", "blocked", "failed"]>;
    summary: z.ZodString;
    files_changed: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    commits: z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodEffects<z.ZodObject<{
        sha: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        sha: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        sha: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>, string, z.objectInputType<{
        sha: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>]>, "many">>;
    tests: z.ZodOptional<z.ZodUnion<[z.ZodObject<{
        command: z.ZodString;
        passed: z.ZodBoolean;
        notes: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        command: z.ZodString;
        passed: z.ZodBoolean;
        notes: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        command: z.ZodString;
        passed: z.ZodBoolean;
        notes: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>, z.ZodArray<z.ZodObject<{
        command: z.ZodString;
        passed: z.ZodBoolean;
        notes: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        command: z.ZodString;
        passed: z.ZodBoolean;
        notes: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        command: z.ZodString;
        passed: z.ZodBoolean;
        notes: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>, "many">]>>;
    questions: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    followups: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    status: z.ZodEnum<["done", "blocked", "failed"]>;
    summary: z.ZodString;
    files_changed: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    commits: z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodEffects<z.ZodObject<{
        sha: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        sha: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        sha: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>, string, z.objectInputType<{
        sha: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>]>, "many">>;
    tests: z.ZodOptional<z.ZodUnion<[z.ZodObject<{
        command: z.ZodString;
        passed: z.ZodBoolean;
        notes: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        command: z.ZodString;
        passed: z.ZodBoolean;
        notes: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        command: z.ZodString;
        passed: z.ZodBoolean;
        notes: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>, z.ZodArray<z.ZodObject<{
        command: z.ZodString;
        passed: z.ZodBoolean;
        notes: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        command: z.ZodString;
        passed: z.ZodBoolean;
        notes: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        command: z.ZodString;
        passed: z.ZodBoolean;
        notes: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>, "many">]>>;
    questions: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    followups: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    status: z.ZodEnum<["done", "blocked", "failed"]>;
    summary: z.ZodString;
    files_changed: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    commits: z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodEffects<z.ZodObject<{
        sha: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        sha: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        sha: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>, string, z.objectInputType<{
        sha: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>]>, "many">>;
    tests: z.ZodOptional<z.ZodUnion<[z.ZodObject<{
        command: z.ZodString;
        passed: z.ZodBoolean;
        notes: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        command: z.ZodString;
        passed: z.ZodBoolean;
        notes: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        command: z.ZodString;
        passed: z.ZodBoolean;
        notes: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>, z.ZodArray<z.ZodObject<{
        command: z.ZodString;
        passed: z.ZodBoolean;
        notes: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        command: z.ZodString;
        passed: z.ZodBoolean;
        notes: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        command: z.ZodString;
        passed: z.ZodBoolean;
        notes: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>, "many">]>>;
    questions: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    followups: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, z.ZodTypeAny, "passthrough">>;
export type TaskResult = z.infer<typeof resultSchema>;
export type TaskResultStatus = TaskResult["status"];
export interface ParseResultOk {
    ok: true;
    result: TaskResult;
}
export interface ParseResultError {
    ok: false;
    error: string;
    raw: string;
}
export type ParseResult = ParseResultOk | ParseResultError;
/** Build the prompt: the task, a blank line, the fixed footer, then the path. */
export declare function buildTaskPrompt(task: string, resultPath: string): string;
/** Parse a result file: JSON + schema check. `raw` is truncated for output. */
export declare function parseResult(text: string): ParseResult;
