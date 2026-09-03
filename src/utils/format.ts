export const DAY = 86400000;

export function nf(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function thDate(ms: number): string {
  return new Date(ms).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' });
}

export function thTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

export function isoDate(ms: number): string {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Calendar-day difference, not a raw 24h-window count — matters because it drives both the
// "ใกล้หมดอายุ" warning threshold and, more importantly, the "หมดอายุแล้ว" cutoff used to scrap
// stock. A raw `floor((exp - now) / DAY)` doesn't tick over at local midnight — it ticks over
// exactly 24h after whatever moment this happens to be called, so a lot dated to expire "on"
// Dec 31 could already read as expired (negative) at any time *during* Dec 31 itself, up to a
// full day before pharmacy convention would actually call it expired (good through the end of
// its labeled date). Comparing local calendar dates instead means the boundary always lands
// exactly at midnight on the labeled date, however many hours into today this happens to run.
export function daysUntil(ms: number): number {
  const now = new Date();
  const target = new Date(ms);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  return Math.round((startOfTarget - startOfToday) / DAY);
}

/** Thai fiscal year (ปีงบประมาณ) — runs Oct-Sep, named for the Buddhist-era year it ends in.
 * The substock card (บัตรคุมสต็อกยา) is always kept per fiscal year on the paper original, so
 * every place that shows or prints one needs this same number. */
export function fiscalYear(ms: number = Date.now()): number {
  const d = new Date(ms);
  const buddhistYear = d.getFullYear() + 543;
  return d.getMonth() >= 9 ? buddhistYear + 1 : buddhistYear;
}

/** Deterministic pseudo-random generator (mulberry32), seeded per-index so seed data is stable across reloads. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '');
}

export function parseIntSafe(raw: string, fallback = 0): number {
  const n = parseInt(digitsOnly(String(raw)), 10);
  return isNaN(n) ? fallback : n;
}
