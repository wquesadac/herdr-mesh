/** Compact terminal output for low-token reads. Pure functions only. */

export interface CompactOptions {
  /** Keep only the last N lines (after collapsing). */
  maxLines?: number;
  /** Cut the result to this many characters from the start. */
  maxChars?: number;
}

// CSI sequences, OSC sequences and single-character escapes.
const ANSI_PATTERN =
  /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\)|[@-_])/g;

// TUI-only decoration: box drawing, braille spinners, bullets and ellipsis.
// ASCII is intentionally absent, so markdown tables, `---` rules and pipes survive.
const TUI_ONLY = /^[\s─-╿⠀-⣿◐◓◑◒●○▸▪…]*$/u;

/** Strip ANSI escapes and trailing whitespace from every line. */
function cleanLines(text: string): string[] {
  return text
    .replace(ANSI_PATTERN, "")
    .split("\n")
    .map((line) => line.replace(/\s+$/u, ""));
}

/**
 * Collapse runs of blank lines to one, and runs of identical consecutive
 * non-blank lines to one line plus `(×N)`.
 */
function collapseLines(lines: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      out.push("");
      i++;
      while (i < lines.length && lines[i].trim() === "") i++;
      continue;
    }

    let j = i + 1;
    while (j < lines.length && lines[j] === line) j++;
    const count = j - i;
    out.push(count > 1 ? `${line} (×${count})` : line);
    i = j;
  }
  return out;
}

/**
 * Compact terminal text: strip ANSI, drop TUI decoration-only lines, collapse
 * blanks and repeated lines, keep the last `maxLines`, then cut to `maxChars`
 * from the start.
 */
export function compactText(text: string, options: CompactOptions = {}): string {
  const lines = cleanLines(text).filter(
    (line) => line.length === 0 || !TUI_ONLY.test(line),
  );
  let collapsed = collapseLines(lines);
  if (options.maxLines !== undefined && collapsed.length > options.maxLines) {
    collapsed = collapsed.slice(-options.maxLines);
  }
  let result = collapsed.join("\n");
  if (options.maxChars !== undefined && result.length > options.maxChars) {
    result = result.slice(0, options.maxChars);
  }
  return result;
}

/**
 * Return the lines of `next` after the longest overlap between the end of
 * `prev` and the start of `next`. With no overlap, return `next` whole.
 */
export function diffSinceLast(prev: string, next: string): string {
  if (!prev) return next;
  const before = prev.split("\n");
  const after = next.split("\n");
  const limit = Math.min(before.length, after.length);
  for (let size = limit; size > 0; size--) {
    const tail = before.slice(before.length - size).join("\n");
    const head = after.slice(0, size).join("\n");
    if (tail === head) return after.slice(size).join("\n");
  }
  return next;
}
