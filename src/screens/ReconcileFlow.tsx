// Presentational pieces of the guided HOSxP flow: a 4-step stepper, one status card that says in a single
// glance whether the file is ready to deduct, a progress bar for the (deliberately one-by-one) commit, and
// a persistent result card with an undo button. No data logic lives here.
import { useState } from 'react';
import type { ReconcileResult } from '../types';
import { nf } from '../utils/format';

export const STEPS = ['แนบไฟล์', 'แก้รายการที่มีปัญหา', 'ตรวจสรุป', 'ตัดยอด'] as const;

export function ReconcileStepper({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <ol data-testid="reconcile-stepper" aria-label="ขั้นตอนการตัดยอด" style={{ display: 'flex', gap: 4, listStyle: 'none', padding: 0, margin: '0 0 12px' }}>
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const cur = n === step;
        return (
          <li key={label} aria-current={cur ? 'step' : undefined} style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
            <div style={{ height: 4, borderRadius: 4, background: done || cur ? 'var(--green)' : 'var(--border)', opacity: cur ? 1 : done ? 0.6 : 0.5, marginBottom: 4 }} />
            <div style={{ fontSize: 10.5, lineHeight: 1.3, fontWeight: cur ? 700 : 500, color: cur ? 'var(--green)' : 'var(--muted)' }}>
              {done ? '✓ ' : n + '. '}{label}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function ReconcileStatusCard({ matched, needDecision, totalUnits, shortCount, alreadyCount, totalRows, ready, onGoFix, rangeLabel }: {
  matched: number; needDecision: number; totalUnits: number; shortCount: number; alreadyCount: number; totalRows: number;
  ready: boolean; onGoFix: () => void; rangeLabel: string | null;
}) {
  const bg = ready ? 'var(--green-tint)' : 'var(--red-bg)';
  const color = ready ? 'var(--green)' : 'var(--red)';
  return (
    <div data-testid="reconcile-status" data-ready={ready ? '1' : '0'} role="status" style={{ background: bg, color, borderRadius: 14, padding: '13px 14px', marginBottom: 12 }}>
      <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.3 }}>
        {ready ? '✓ พร้อมตัดยอด' : '⚠ ยังมี ' + nf(needDecision) + ' รายการที่ต้องตัดสินใจ'}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 6, fontSize: 12.5, fontWeight: 600 }}>
        <span>ในไฟล์ {nf(totalRows)} รายการ</span>
        <span>จับคู่ได้ {nf(matched)}</span>
        {needDecision > 0 && <span>ต้องตัดสินใจ {nf(needDecision)}</span>}
        <span>จะตัดรวม {nf(totalUnits)} หน่วย</span>
        {alreadyCount > 0 && <span>เคยตัดแล้ว {nf(alreadyCount)} (ไม่ตัดซ้ำ)</span>}
        {shortCount > 0 && <span>ยอดหน้างานไม่พอ {nf(shortCount)}</span>}
        {rangeLabel && <span>ช่วงวันที่ {rangeLabel}</span>}
      </div>
      {!ready && needDecision > 0 && (
        <button type="button" onClick={onGoFix} style={{ marginTop: 8, border: 0, background: 'transparent', color, fontWeight: 700, fontSize: 12.5, padding: '6px 0', textDecoration: 'underline', minHeight: 36 }}>
          ไปแก้รายการที่ค้างอยู่ ↓
        </button>
      )}
    </div>
  );
}

export function ReconcileProgress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div data-testid="reconcile-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} style={{ marginBottom: 10 }}>
      <div style={{ height: 8, borderRadius: 8, background: 'var(--border)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: pct + '%', background: 'var(--green)', transition: 'width .2s' }} />
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 4, textAlign: 'center' }}>กำลังตัดยอด — ตัดแล้ว {nf(done)}/{nf(total)} รายการ (อย่าปิดหน้านี้)</div>
    </div>
  );
}

export function ReconcileResultCard({ result, onUndo, onDismiss, busy }: {
  result: ReconcileResult; onUndo: () => void; onDismiss: () => void; busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const range = result.from === result.to ? result.from : result.from + ' ถึง ' + result.to;
  return (
    <div data-testid="reconcile-result" style={{ background: 'var(--bg-card)', border: '1.5px solid ' + (result.undone ? 'var(--border)' : 'var(--green)'), borderRadius: 14, padding: '13px 14px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, fontSize: 14.5, fontWeight: 800, color: result.undone ? 'var(--muted)' : 'var(--green)' }}>
          {result.undone ? 'ย้อนการตัดยอดแล้ว' : '✓ ตัดยอดเสร็จแล้ว'} · {range}
        </div>
        <button type="button" onClick={onDismiss} aria-label="ปิดสรุปผล" style={{ border: 0, background: 'transparent', fontSize: 18, color: 'var(--muted)', minWidth: 36, minHeight: 36 }}>×</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 6, fontSize: 12.5, fontWeight: 600 }}>
        <span>ตัดแล้ว {nf(result.applied)} รายการ</span>
        {result.alreadyDone > 0 && <span>เคยตัดครบแล้ว {nf(result.alreadyDone)}</span>}
        {result.zeroQty > 0 && <span>จำนวน 0 (ไม่ตัด) {nf(result.zeroQty)}</span>}
        {result.skipped.length > 0 && <span style={{ color: 'var(--amber-ink)' }}>ข้าม {nf(result.skipped.length)}</span>}
        {result.clamped.length > 0 && <span style={{ color: 'var(--red)' }}>ยอดไม่พอ {nf(result.clamped.length)}</span>}
      </div>
      {result.clamped.length > 0 && (
        <div style={{ marginTop: 8, background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 9, padding: '8px 10px', fontSize: 12, lineHeight: 1.6 }}>
          <b>ยอดหน้างานไม่พอ — ตัดได้เท่าที่มี (ตรวจนับ/เติมยา):</b>
          {result.clamped.map((c) => <div key={c.name}>• {c.name}: ไฟล์จ่าย {nf(c.reported)} แต่ตัดได้ {nf(c.deducted)} {c.unit}</div>)}
        </div>
      )}
      {result.skipped.length > 0 && (
        <div style={{ marginTop: 8, background: 'var(--amber-bg)', color: 'var(--amber-ink)', borderRadius: 9, padding: '8px 10px', fontSize: 12, lineHeight: 1.6 }}>
          <b>ข้าม (ไม่ได้ตัดยอด):</b>
          {result.skipped.slice(0, 8).map((n) => <div key={n}>• {n}</div>)}
          {result.skipped.length > 8 && <div>และอีก {result.skipped.length - 8} รายการ</div>}
        </div>
      )}
      {result.entries.length > 0 && (
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={{ marginTop: 8, border: 0, background: 'transparent', color: 'var(--green)', fontWeight: 700, fontSize: 12.5, padding: '6px 0', minHeight: 36 }}>
          {open ? 'ซ่อนรายการที่ตัด ▲' : 'ดูรายการที่ตัดทั้งหมด (' + result.entries.length + ') ▾'}
        </button>
      )}
      {open && (
        <div style={{ maxHeight: 260, overflowY: 'auto', fontSize: 12, lineHeight: 1.7 }}>
          {result.entries.map((e) => <div key={e.txId + e.medId} style={{ display: 'flex', gap: 8 }}><span style={{ flex: 1, minWidth: 0 }}>{e.name}</span><span style={{ flex: 'none', fontWeight: 600 }}>−{nf(e.deducted)} {e.unit}</span></div>)}
        </div>
      )}
      {!result.undone && result.entries.length > 0 && (
        <button type="button" disabled={busy} onClick={onUndo} style={{ marginTop: 10, width: '100%', border: '1.5px solid var(--red)', background: 'transparent', color: 'var(--red)', borderRadius: 10, fontWeight: 700, fontSize: 13, minHeight: 44, opacity: busy ? 0.5 : 1 }}>
          ↶ ย้อนการตัดยอดครั้งนี้ (ถ้าตัดผิดวัน/ผิดไฟล์)
        </button>
      )}
    </div>
  );
}
