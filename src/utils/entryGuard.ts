// Entry guard: catches the data-entry mistakes that corrupt stock before they are saved (pure, no UI, no Firestore).
//   • count      — typed count looks like the OTHER store's number (นับหน้างาน แต่เลขเป็นของ substock), an extra/missing digit,
//                  a count of 0 for stock that exists, or a delta far outside what this drug's par says is plausible
//   • transfer   — refill that would push the shelf past its Max
//   • receive    — receive that would take substock past 2× par, or isn't a whole number of boxes
// Each finding has a plain-Thai message that reads back the numbers so the person can tell at a glance whether it is a typo.
import { nf } from './format';

export type FindingCode = 'scope_mixup' | 'extra_digit' | 'zero_count' | 'big_delta' | 'over_max' | 'over_par' | 'pack_multiple';
export interface Finding {
  code: FindingCode;
  /** 'stop' = very likely a mistake (shown first, wording is firmer); 'warn' = unusual, please double-check. Both need an explicit confirm. */
  severity: 'stop' | 'warn';
  message: string;
}

const scopeLabel = (s: 'floor' | 'sub') => (s === 'floor' ? 'หน้างาน (ชั้นจ่ายยา)' : 'substock');
const yod = (s: 'floor' | 'sub') => 'ยอด' + (s === 'sub' ? ' ' : '') + scopeLabel(s); // "ยอดหน้างาน…" / "ยอด substock"

export interface CountInput {
  name: string; unit: string;
  scope: 'floor' | 'sub';
  counted: number;
  /** system quantity of the store being counted */
  system: number;
  /** system quantity of the OTHER store (floor↔substock), for the mix-up check */
  other: number;
  /** par of the store being counted */
  par: number;
}

export function assessCount(a: CountInput): Finding[] {
  const out: Finding[] = [];
  const { counted: c, system: s, other: o, par } = a;
  if (!Number.isFinite(c) || c < 0) return out;
  const otherScope = a.scope === 'floor' ? 'sub' : 'floor';
  const delta = c - s;

  // 1) the typed number matches the OTHER store, not this one — the classic "counted substock into the floor field"
  const farFromThis = Math.abs(delta) > 0.3 * Math.max(s, 20);
  const closeToOther = o > 0 && Math.abs(c - o) <= 0.1 * o;
  const storesDiffer = Math.abs(o - s) > 0.3 * Math.max(o, s, 1);
  if (farFromThis && closeToOther && storesDiffer && c !== s) {
    out.push({ code: 'scope_mixup', severity: 'stop', message:
      'ตัวเลข ' + nf(c) + ' ใกล้เคียง' + yod(otherScope) + ' (' + nf(o) + ') มากกว่า' + yod(a.scope) + ' (' + nf(s) + ') — '
      + 'แน่ใจว่ากำลังนับ ' + scopeLabel(a.scope) + '? (ถ้านับ ' + scopeLabel(otherScope) + ' ให้สลับปุ่มนับด้านบน)' });
  }

  // 2) one digit too many / too few
  if (s >= 10 && c >= 1) {
    const r = c / s;
    const tenX = (r >= 9.5 && r <= 10.5) || (r >= 95 && r <= 105);
    const tenth = (r >= 0.095 && r <= 0.105) || (r >= 0.0095 && r <= 0.0105);
    if ((tenX || tenth) && !out.some((f) => f.code === 'scope_mixup')) {
      out.push({ code: 'extra_digit', severity: 'warn', message:
        'นับได้ ' + nf(c) + ' แต่ยอดระบบ ' + nf(s) + ' (' + (tenX ? 'มากกว่า' : 'น้อยกว่า') + 'ประมาณ 10 เท่า) — พิมพ์เลข' + (tenX ? 'เกิน' : 'ขาด') + ' 1 หลักหรือเปล่า?' });
    }
  }

  // 3) counted zero where stock exists
  if (c === 0 && s > 0) {
    out.push({ code: 'zero_count', severity: 'warn', message: 'นับได้ 0 แต่ยอดระบบมี ' + nf(s) + ' ' + a.unit + ' — หมดจริง หรือยังไม่ได้นับ/ลืมกรอก?' });
  }

  // 4) delta far outside anything this drug's par makes plausible (the original ×8 rule, kept as the backstop)
  if (!out.length && Math.abs(delta) > Math.max(par, 20) * 8) {
    out.push({ code: 'big_delta', severity: 'warn', message:
      'นับได้ ' + nf(c) + ' ต่างจากยอดระบบ (' + nf(s) + ') ' + nf(Math.abs(delta)) + ' ' + a.unit + ' — มากผิดปกติเมื่อเทียบกับ par (' + nf(par) + ')' });
  }
  return out;
}

export interface TransferInput { name: string; unit: string; qty: number; floor: number; parFloor: number }
export function assessTransfer(a: TransferInput): Finding[] {
  const out: Finding[] = [];
  if (a.parFloor > 0 && a.floor + a.qty > a.parFloor * 1.25) {
    out.push({ code: 'over_max', severity: 'warn', message:
      'เติม ' + nf(a.qty) + ' ' + a.unit + ' แล้วหน้างานจะมี ' + nf(a.floor + a.qty) + ' เกิน Max (' + nf(a.parFloor) + ') ' + nf(a.floor + a.qty - a.parFloor) + ' ' + a.unit });
  }
  return out;
}

export interface ReceiveInput { name: string; unit: string; qty: number; sub: number; parSub: number; packSize?: number | undefined }
export function assessReceive(a: ReceiveInput): Finding[] {
  const out: Finding[] = [];
  if (a.parSub > 0 && a.sub + a.qty > a.parSub * 2) {
    out.push({ code: 'over_par', severity: 'warn', message:
      'รับเข้า ' + nf(a.qty) + ' ' + a.unit + ' แล้ว substock จะมี ' + nf(a.sub + a.qty) + ' มากกว่า 2 เท่าของ par (' + nf(a.parSub) + ')' });
  }
  const ps = a.packSize ?? 0;
  if (ps > 1 && a.qty > ps && a.qty % ps !== 0) {
    out.push({ code: 'pack_multiple', severity: 'warn', message:
      nf(a.qty) + ' ' + a.unit + ' ไม่ครบกล่องพอดี (1 กล่อง = ' + nf(ps) + ') — ได้รับเป็นกล่อง + เศษ ใช่ไหม?' });
  }
  return out;
}

/** One confirm-dialog text for a med's findings. */
export function describeFindings(title: string, findings: Finding[]): string {
  const stop = findings.some((f) => f.severity === 'stop');
  return (stop ? '⛔ น่าจะผิด — ' : '⚠️ ตรวจก่อนบันทึก — ') + title + '\n' + findings.map((f) => '• ' + f.message).join('\n') + '\n\nยืนยันว่าตัวเลขถูกต้องแล้วบันทึกต่อ?';
}

/** One summary confirm for a whole batch (บันทึกทั้งหมด): lists the flagged rows' first finding each (max 4). */
export function summarizeFlagged(title: string, total: number, rows: { name: string; f: Finding[] }[]): string {
  const stop = rows.some((r) => r.f.some((x) => x.severity === 'stop'));
  const shown = rows.slice(0, 4).map((r) => '• ' + r.name + ' — ' + (r.f.find((x) => x.severity === 'stop') ?? r.f[0]!).message).join('\n');
  return (stop ? '⛔ น่าจะผิด — ' : '⚠️ ตรวจก่อนบันทึก — ') + title + ': ' + rows.length + ' จาก ' + total + ' รายการมีตัวเลขผิดปกติ\n' + shown
    + (rows.length > 4 ? '\nและอีก ' + (rows.length - 4) + ' รายการ' : '') + '\n\nยืนยันว่าตัวเลขทั้งหมดถูกต้องแล้วบันทึกต่อ?';
}
