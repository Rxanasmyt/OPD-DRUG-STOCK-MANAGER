// Return (คืนยา) reasons, grouped so a long list stays quick to pick from, plus the reversal convention.
// Stored strings are the reason text itself (txs.reason / returns.reason) — existing ones must never be renamed:
// ADR_RETURN_REASON drives the repeat-ADR report (selectors.ts), and old records carry these exact strings.
import type { DrugReturnRecord } from '../types';

export const ADR_RETURN_REASON = 'แพ้ยา/ผลข้างเคียงการรักษา';

export interface ReasonGroup { key: string; icon: string; label: string; reasons: string[] }

export const RETURN_REASON_GROUPS: ReasonGroup[] = [
  { key: 'treat', icon: '🩺', label: 'การรักษา', reasons: ['ปรับเปลี่ยนการรักษา', ADR_RETURN_REASON, 'แพทย์สั่งหยุดยา', 'อาการดีขึ้น/หายแล้ว'] },
  { key: 'patient', icon: '👤', label: 'ผู้ป่วย', reasons: ['Non-compliance', 'ไม่ประสงค์รับยา', 'ผู้ป่วยเสียชีวิต', 'ย้ายสถานพยาบาล/จำหน่ายผู้ป่วย'] },
  { key: 'qty', icon: '📦', label: 'ปริมาณยาเหลือ', reasons: ['ได้ยาเกินจากวันนัดรอบก่อน', 'ยาตามอาการเหลือ', 'ยาโรคเรื้อรังเหลือเยอะ'] },
  { key: 'error', icon: '⚠️', label: 'ความคลาดเคลื่อน', reasons: ['จ่ายยาผิดตัว/ผิดความแรง', 'จ่ายยาเกิน/ผิดจำนวน', 'ยกเลิกใบสั่งยา (ยังไม่ได้ส่งมอบ)'] },
  { key: 'unit', icon: '🏥', label: 'หน่วยงาน', reasons: ['ยาเหลือจากหน่วยงาน/ตึกผู้ป่วย', 'ยาตู้ฉุกเฉิน/รถ Refer ไม่ได้ใช้'] },
];

export const RETURN_REASONS: string[] = RETURN_REASON_GROUPS.flatMap((g) => g.reasons);

/** A cancelled return is recorded as a NEW row (txs/returns are append-only in firestore.rules), never an edit/delete:
 * its reason is REVERSAL_PREFIX + the original reason, and its note carries "#<original returns doc id>". */
export const REVERSAL_PREFIX = '↩ ยกเลิกรายการคืน · ';
export const isReversalReason = (reason: string | undefined): boolean => !!reason && reason.startsWith(REVERSAL_PREFIX);
export const reversalNote = (origId: string, removed: number, unit: string): string => '#' + origId + ' · หักยอดหน้างานจริง ' + removed + ' ' + unit;
export const reversalTargetId = (note: string | undefined): string | null => {
  const m = /^#([A-Za-z0-9]+)\b/.exec(note ?? '');
  return m ? (m[1] ?? null) : null;
};

/** ids of originals that a reversal row in `records` cancels. */
export function reversedIds(records: DrugReturnRecord[]): Set<string> {
  const out = new Set<string>();
  for (const r of records) if (isReversalReason(r.reason)) { const id = reversalTargetId(r.note); if (id) out.add(id); }
  return out;
}

/** For reports: a reversal row counts NEGATIVE (qty and value), so cancelled returns net to zero. */
export function netReturnRecords(records: DrugReturnRecord[]): DrugReturnRecord[] {
  return records.map((r) => (isReversalReason(r.reason) ? { ...r, qty: -Math.abs(r.qty), value: -Math.abs(r.value) } : r));
}
