/** Compact terminal output for low-token reads. Pure functions only. */
export interface CompactOptions {
    /** Keep only the last N lines (after collapsing). */
    maxLines?: number;
    /** Cut the result to this many characters from the start. */
    maxChars?: number;
}
/**
 * Compact terminal text: strip ANSI, drop TUI decoration-only lines, collapse
 * blanks and repeated lines, keep the last `maxLines`, then cut to `maxChars`
 * from the start.
 */
export declare function compactText(text: string, options?: CompactOptions): string;
/**
 * Return the lines of `next` after the longest overlap between the end of
 * `prev` and the start of `next`. With no overlap, return `next` whole.
 */
export declare function diffSinceLast(prev: string, next: string): string;
