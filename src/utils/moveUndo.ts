// Undo support for เติมหน้างาน (transfer_to_floor) and รับเข้า (receive_from_central).
// The txs rules forbid new fields, so the lot provenance rides in the existing free-text note:
//   transfer: "FEFO lot <lotNo> exp <expLabel> (<take>), <lotNo> exp <expLabel> (<take>) · <box note>"
//   receive : "ใบเบิก <no> · lot <lotNo> exp <expLabel> · <box note> — <...>"
// These helpers read them back. Anything that does not parse CLEANLY (old-format note, sum != qty) returns null, and
// the caller refuses to undo — a wrong restore of real stock is worse than "adjust it by hand".
import { expLabel, lotLabel } from './format';

export interface LotTake { lotLabel: string; expText: string; take: number }

/** The note written by commitTransfer for one med: the "FEFO lot …" part with exp + qty per lot. */
export function transferNote(takes: { lotNo: string | undefined; exp: number | undefined; take: number }[], boxNote?: string): string {
  return 'FEFO lot ' + takes.map((t) => lotLabel(t.lotNo) + ' exp ' + expLabel(t.exp) + ' (' + t.take.toLocaleString('en-US') + ')').join(', ') + (boxNote ? ' · ' + boxNote : '');
}

export function parseTransferNote(note: string | undefined, qty: number): LotTake[] | null {
  if (!note || !note.startsWith('FEFO lot ')) return null;
  const head = note.slice('FEFO lot '.length).split(' · ')[0];
  const out: LotTake[] = [];
  const re = /(.+?) exp (.+?) \(([\d,]+)\)(?:, |$)/gy;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = re.exec(head)) !== null) {
    out.push({ lotLabel: m[1], expText: m[2], take: Number(m[3].replace(/,/g, '')) });
    consumed = re.lastIndex;
    if (consumed >= head.length) break;
  }
  if (!out.length || consumed < head.length) return null;
  const sum = out.reduce((s, t) => s + t.take, 0);
  return sum === qty && out.every((t) => t.take > 0) ? out : null;
}

export function parseReceiveNote(note: string | undefined): { lotLabel: string; expText: string } | null {
  if (!note) return null;
  const m = /(?:^|· )lot (.+?) exp (.+?)(?: · | — |$)/.exec(note);
  return m ? { lotLabel: m[1], expText: m[2] } : null;
}

/** The ids of moves that already have a reversal row ("#<id> …" note on a reversal-reason count row). */
export function cancelledMoveIds(txs: { type: string; reason?: string; note?: string }[], isReversal: (r: string | undefined) => boolean): Set<string> {
  const s = new Set<string>();
  for (const t of txs) if (t.type === 'count' && isReversal(t.reason)) { const m = /^#([A-Za-z0-9]+)/.exec(t.note ?? ''); if (m?.[1]) s.add(m[1]); }
  return s;
}
