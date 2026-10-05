/** Real-world request: "อยากให้เลือกเป็นชุดชั้นวางยาได้ครับ เช่น A1-A7" — printing a whole run
 * of numbered shelf bins at once (LabelsScreen's "เลือกยาเฉพาะบางตัว" picker), not just one bin
 * code at a time. Shelf codes here are free-typed text (see sanitizeBin() in MedsScreen.tsx —
 * uppercase A-Z0-9 + Thai script + "-", no enforced convention), but the common real pattern is
 * a letter prefix plus a running number ("A1".."A7"), so a range means "same prefix, number
 * between these two inclusive" — anything that doesn't fit that shape isn't a range at all, and
 * the caller should fall back to a plain substring search instead. */

export interface BinRange { prefix: string; from: number; to: number }

/** Parses "A1-A7" or the shorthand "A1-7" (second side reusing the first's prefix). Case- and
 * space-insensitive. Returns null for anything that isn't cleanly "letters+digits - [letters+]
 * digits" with matching prefixes and a non-decreasing numeric range — a single bin code like
 * "J4", a plain drug-name search, or a hand-typed code with mismatched prefixes on each side
 * are all correctly NOT a range. */
export function parseBinRange(raw: string): BinRange | null {
  const s = raw.trim().toUpperCase().replace(/\s+/g, '');
  const m = s.match(/^([A-Z฀-๿]*)(\d+)-([A-Z฀-๿]*)(\d+)$/);
  if (!m) return null;
  const [, p1, n1raw, p2, n2raw] = m;
  if (p2 && p2 !== p1) return null; // e.g. "A1-B7" — different shelf letters, not one coherent run
  const from = parseInt(n1raw, 10);
  const to = parseInt(n2raw, 10);
  if (from > to) return null;
  return { prefix: p1, from, to };
}

/** Whether shelf/bin `code` falls inside `range` — same prefix, numeric suffix within
 * [from, to] inclusive. A code that isn't cleanly "prefix + number" (rare, hand-typed oddities)
 * never matches; range picking only makes sense for that common convention. */
export function binInRange(code: string, range: BinRange): boolean {
  const m = code.trim().toUpperCase().match(/^([A-Z฀-๿]*)(\d+)$/);
  if (!m) return false;
  const [, prefix, numRaw] = m;
  if (prefix !== range.prefix) return false;
  const num = parseInt(numRaw, 10);
  return num >= range.from && num <= range.to;
}

/** The number to sort a range match by — code's own numeric suffix when it parses, otherwise
 * pushed to the end (kept, not dropped, since an unparseable code can still be a real match on
 * a range whose prefix is empty and just happens to fail the same-shape check some other way). */
export function binSortKey(code: string): number {
  const m = code.trim().toUpperCase().match(/(\d+)$/);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

// Real-world request: "ปริ้นยังไงให้สามารถปริ้นตามชั้นวางเรียงไปเรื่อยๆตามลำดับ เพื่อง่ายต่อการ
// แปะป้ายชั้นวางยา" — printLabels() (AppContext.tsx) used to print in whatever order `state.meds`
// happened to iterate in (Firestore snapshot order, not shelf order), so a sticker sheet for a
// whole aisle came out jumbled and someone walking the shelf had to hunt through the stack for
// each label instead of sticking them down in one pass. binSortKey() above only sorts WITHIN one
// already-same-prefix range (LabelsScreen's "A1-A7" picker) — reused across a WHOLE formulary
// spanning multiple shelf letters, it would interleave different prefixes by number alone ("A1,
// B1, C1, A2, B2, …"). This compares the prefix first (so every "A" code sorts before any "B"
// code), then the numeric suffix within that prefix (numerically, not as text — "A2" before
// "A10" — the same common bug fefoLot's own `?? Infinity` convention avoids for expiry dates).
// A code with no numeric suffix, or no code at all, sorts to the very end of its group/the whole
// list rather than being dropped — still printed, just last, since there's no shelf position to
// place it ahead of anything by.
function binSortGroup(code: string): [string, number] {
  const c = (code || '').trim().toUpperCase();
  if (!c) return ['￿', Number.MAX_SAFE_INTEGER];
  const m = c.match(/^([A-Z฀-๿]*)(\d+)$/);
  return m ? [m[1], parseInt(m[2], 10)] : [c, Number.MAX_SAFE_INTEGER];
}

export function binCompare(a: string, b: string): number {
  const [pa, na] = binSortGroup(a);
  const [pb, nb] = binSortGroup(b);
  return pa !== pb ? (pa < pb ? -1 : 1) : na - nb;
}
