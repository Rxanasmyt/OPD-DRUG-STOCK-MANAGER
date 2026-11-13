/** Minimal RFC4180-ish CSV line parser — handles quoted fields with embedded commas/quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else if (c === '\r') {
      // skip, \n handles the row break
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export type DownloadOutcome = 'saved' | 'declined' | 'unavailable';

/**
 * Export rows (array of arrays) as a CSV file.
 *
 * Tries the Claude Artifact `downloads` capability first (the page may be running
 * inside the sandboxed artifact viewer, where a plain `<a download>` click is inert).
 * Falls back to the classic Blob-URL anchor click for a normally-hosted deployment,
 * where no such capability exists.
 */
export async function downloadCsv(rows: (string | number)[][], filename: string): Promise<DownloadOutcome> {
  const body = rows
    .map((r) => r.map((c) => {
      // Bug fix (audit finding — CSV/formula injection, OWASP): a free-text cell (med name,
      // adjust/return/stock-hold reason, audit note — none of these restrict what characters a
      // user can type) that happens to start with =, +, - or @ gets opened by Excel/Sheets as a
      // live formula instead of displayed as text — the classic CSV-injection vector, up to and
      // including DDE/HYPERLINK-based exfiltration. Only applies to actual STRING cells: a
      // genuine negative number this app computes itself (e.g. a qty delta) is passed as a real
      // JS `number`, which Excel's CSV import always parses as a plain number regardless of
      // sign — sanitizing only strings protects every typed free-text field without touching
      // legitimate numeric columns. Prefixing with a single quote is the standard mitigation
      // (OWASP CSV Injection cheat sheet): it forces text interpretation, at the cost of that
      // literal quote char showing up in the opened cell — an acceptable, visible trade for not
      // silently executing a formula.
      const s = typeof c === 'string' && /^[=+\-@]/.test(c) ? "'" + c : String(c);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(','))
    .join('\r\n');
  const csvText = '﻿' + body;

  const claude = (window as any).claude;
  if (claude && typeof claude.use === 'function') {
    try {
      const downloads = await claude.use('downloads');
      if (downloads) {
        try {
          await downloads.save({ filename, data: csvText });
          return 'saved';
        } catch (err: any) {
          if (err && err.code === 'declined') return 'declined';
          // extension_not_enabled / rejected_extension / too_large / etc — fall through to the anchor method below
        }
      }
    } catch {
      // claude.use() itself failing — fall through
    }
  }

  try {
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    return 'saved';
  } catch {
    return 'unavailable';
  }
}
