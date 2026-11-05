import assert from "node:assert/strict";
import test from "node:test";
import { compactText, diffSinceLast } from "../src/compact.js";

test("compactText", async (t) => {
  await t.test("strips ANSI escapes and trailing whitespace", () => {
    assert.equal(
      compactText("\x1b[31mred\x1b[0m  \n\x1b[1mbold\x1b[0m\t"),
      "red\nbold",
    );
  });

  await t.test("drops spinner and box-drawing lines but keeps ASCII", () => {
    const input = [
      "⠋",
      "────",
      "●",
      "▸",
      "…",
      "---",
      "| a | b |",
      "real output",
    ].join("\n");
    assert.equal(compactText(input), "---\n| a | b |\nreal output");
  });

  await t.test("collapses repeated lines and blank runs", () => {
    assert.equal(
      compactText("a\na\na\n\n\n\nb\nb"),
      "a (×3)\n\nb (×2)",
    );
  });

  await t.test("maxLines keeps the tail", () => {
    const input = ["1", "2", "3", "4", "5"].join("\n");
    assert.equal(compactText(input, { maxLines: 2 }), "4\n5");
  });

  await t.test("maxChars cuts from the start", () => {
    assert.equal(compactText("abcdef", { maxChars: 3 }), "abc");
  });
});

test("diffSinceLast", async (t) => {
  await t.test("returns the tail after a full overlap", () => {
    assert.equal(diffSinceLast("a\nb", "a\nb\nc"), "c");
  });

  await t.test("returns the tail after a partial overlap", () => {
    assert.equal(diffSinceLast("a\nb\nc", "b\nc\nd"), "d");
  });

  await t.test("returns next whole when there is no overlap", () => {
    assert.equal(diffSinceLast("x", "y"), "y");
  });

  await t.test("returns empty when next repeats prev", () => {
    assert.equal(diffSinceLast("a\nb", "a\nb"), "");
  });
});
