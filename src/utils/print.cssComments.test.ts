// Regression test for a real bug found during a systematic codebase audit: two of print.ts's
// embedded <style> blocks (printExecutiveSummarySheet, printKpiReportSheet) had their
// "Bug fix (print pagination)" explanation written as JS-style "//" line comments INSIDE the
// CSS template-literal string — but "//" is not valid CSS comment syntax (only /* */ is). Per
// the CSS Syntax spec's error-recovery rules, that text becomes a garbage selector prelude for
// the next rule (the apostrophe in "ROW's" even opens an unterminated string token spanning to
// end-of-line), so the browser silently discarded the ENTIRE next rule — prelude through its
// matching `{...}` block — on the real printed/PDF output. That dropped `table.rows { width:
// 100%; border-collapse: collapse; font-size: ...pt; }` from both the executive-summary and KPI
// report sheets, both official documents meant to be filed/handed to a PTC committee or
// pharmacy head. Note: jsdom's own (non-spec-compliant) CSS parser does NOT reproduce this
// exact browser failure mode, so this is a static source check rather than a rendered-DOM
// assertion — it directly targets the root cause (no "//" lines inside any <style> block in
// this file, ever) rather than relying on a CSS engine that wouldn't actually catch it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(join(process.cwd(), 'src/utils/print.ts'), 'utf-8');

describe('print.ts — no invalid "//" line comments inside embedded <style> blocks', () => {
  it('every <style>...</style> block only ever uses /* */ CSS comments, never JS-style //', () => {
    const styleBlocks = [...source.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
    expect(styleBlocks.length).toBeGreaterThan(0); // sanity check the regex actually found blocks

    for (const [i, block] of styleBlocks.entries()) {
      const offendingLines = block.split('\n').filter((line) => /^\s*\/\//.test(line));
      expect(offendingLines, `style block #${i + 1} has invalid JS-style "//" comment line(s): ${JSON.stringify(offendingLines)}`).toEqual([]);
    }
  });
});
