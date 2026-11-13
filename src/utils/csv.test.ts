// Regression test for a real audit finding: downloadCsv() — the single shared function every
// CSV export in the app funnels through — escaped delimiter-breaking characters (quote, comma,
// newline) but had no defense against the classic CSV/formula-injection vector (OWASP): a cell
// whose text starts with =, +, - or @ gets opened by Excel/Google Sheets as a live formula
// instead of displayed as text. Free-text fields with no character restriction (med name,
// adjust/return/stock-hold reason, audit note) flow unmodified into several exports (discrepancy,
// audit_log, exec summary, etc.), so a staff member typing e.g. a med name starting with "="
// could plant a formula that fires the moment anyone opens that export in Excel.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { downloadCsv } from './csv';

async function exportedText(rows: (string | number)[][]): Promise<string> {
  let captured = '';
  (window as any).claude = { use: async () => ({ save: async ({ data }: { data: string }) => { captured = data; } }) };
  await downloadCsv(rows, 'test.csv');
  return captured;
}

describe('downloadCsv — CSV/formula injection regression', () => {
  afterEach(() => { delete (window as any).claude; });

  it('prefixes a formula-triggering string cell with a quote instead of exporting it raw', async () => {
    const text = await exportedText([['name'], ['=SUM(A1:A9)']]);
    // Without the fix, this would be the raw, live-formula-triggering "=SUM(A1:A9)".
    expect(text).toContain("'=SUM(A1:A9)");
    expect(text).not.toContain('\n=SUM');
  });

  it('also guards +, -, and @ leading characters (the full OWASP CSV-injection set)', async () => {
    const text = await exportedText([['note'], ['+1+1'], ['@cmd|calc'], ['-2+3']]);
    expect(text).toContain("'+1+1");
    expect(text).toContain("'@cmd|calc");
    expect(text).toContain("'-2+3");
  });

  it('does not touch a genuine negative-number cell (real JS number, never user-typed text)', async () => {
    const text = await exportedText([['qty'], [-5]]);
    // A real number this app computes (e.g. a qty delta) must stay a plain, sortable number in
    // the opened spreadsheet — sanitization only applies to actual string cells.
    expect(text).toContain('\r\n-5');
    expect(text).not.toContain("'-5");
  });

  it('still escapes a comma/quote/newline inside an otherwise-safe cell (pre-existing behavior)', async () => {
    const text = await exportedText([['note'], ['a, "quoted" value']]);
    expect(text).toContain('"a, ""quoted"" value"');
  });
});
