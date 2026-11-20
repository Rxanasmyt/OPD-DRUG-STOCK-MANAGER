// Presentational pieces of the guided HOSxP flow: a 4-step stepper, one status card that says in a single
// glance whether the file is ready to deduct, a progress bar for the (deliberately one-by-one) commit, and
// a persistent result card with an undo button. No data logic lives here. Styles: `.rc-*` in styles.css.
import { useState } from 'react';
import type { ReconcileResult } from '../types';
import { nf } from '../utils/format';

export const STEPS = ['แนบไฟล์', 'แก้รายการ', 'ตรวจสรุป', 'ตัดยอด'] as const;

/** Finished steps are tappable = "go back": 1 discards the file (with confirmation), 2/3 jump to that part without losing anything. */
export function ReconcileStepper({ step, onStep }: { step: 1 | 2 | 3 | 4; onStep?: (n: number) => void }) {
  return (
    <ol data-testid="reconcile-stepper" className="rc-steps" aria-label="ขั้นตอนการตัดยอด">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const cur = n === step;
        return (
          <li key={label} className="rc-step" data-done={done ? '1' : '0'} data-cur={cur ? '1' : '0'} aria-current={cur ? 'step' : undefined}>
            {done && onStep ? (
              <button type="button" onClick={() => onStep(n)} aria-label={'กลับไปขั้นที่ ' + n + ' ' + label} style={{ border: 0, background: 'transparent', padding: 0, width: '100%', minHeight: 44, cursor: 'pointer' }}>
                <div className="rc-dot">✓</div>
                <div className="rc-step-label">{n}. {label}</div>
              </button>
            ) : (
              <>
                <div className="rc-dot">{done ? '✓' : n}</div>
                <div className="rc-step-label">{n}. {label}</div>
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Tile({ n, label, warn }: { n: string; label: string; warn?: boolean }) {
  return (
    <div className="rc-tile" data-warn={warn ? '1' : '0'}>
      <div className="rc-tile-n">{n}</div>
      <div className="rc-tile-l">{label}</div>
    </div>
  );
}

export function ReconcileStatusCard({ matched, needDecision, totalUnits, shortCount, alreadyCount, totalRows, ready, onGoFix, rangeLabel, unusualCount = 0, unusualPending = 0, dateBlocked = false }: {
  matched: number; needDecision: number; totalUnits: number; shortCount: number; alreadyCount: number; totalRows: number;
  unusualCount?: number; unusualPending?: number; dateBlocked?: boolean;
  ready: boolean; onGoFix: () => void; rangeLabel: string | null;
}) {
  const title = ready ? 'พร้อมตัดยอด'
    : dateBlocked ? 'ยืนยันวันที่ของไฟล์ก่อน — ยังไม่แน่ใจว่าเป็นไฟล์ของวันที่ต้องตัด'
      : needDecision > 0 ? 'ยังมี ' + nf(needDecision) + ' รายการที่ต้องตัดสินใจ'
        : unusualPending > 0 ? 'ยืนยันตัวเลขที่สูงผิดปกติ ' + nf(unusualPending) + ' รายการ'
          : 'ยังตัดยอดไม่ได้ — ตรวจช่วงวันที่';
  return (
    <div data-testid="reconcile-status" data-ready={ready ? '1' : '0'} role="status" className="rc-status">
      <div className="rc-status-head">
        <div className="rc-status-icon" aria-hidden="true">{ready ? '✓' : '!'}</div>
        <div style={{ minWidth: 0 }}>
          <div className="rc-status-title">{ready ? '✓ ' : '⚠ '}{title}</div>
          {rangeLabel && <div style={{ fontSize: 12, opacity: 0.92, marginTop: 1 }}>ช่วงวันที่ {rangeLabel}</div>}
        </div>
      </div>
      <div className="rc-tiles">
        <Tile n={nf(totalRows)} label="รายการในไฟล์" />
        <Tile n={nf(matched)} label="จับคู่ได้" />
        <Tile n={nf(totalUnits)} label="หน่วยที่จะตัด" />
        {needDecision > 0 && <Tile n={nf(needDecision)} label="ต้องตัดสินใจ" warn />}
        {alreadyCount > 0 && <Tile n={nf(alreadyCount)} label="เคยตัดแล้ว (ไม่ตัดซ้ำ)" />}
        {shortCount > 0 && <Tile n={nf(shortCount)} label="ยอดหน้างานไม่พอ" warn />}
        {unusualCount > 0 && <Tile n={nf(unusualCount)} label="ตัวเลขสูงผิดปกติ" warn />}
      </div>
      {!ready && (needDecision > 0 || unusualPending > 0 || dateBlocked) && (
        <button type="button" className="rc-status-link" onClick={onGoFix}>ไปแก้รายการที่ค้างอยู่ ↓</button>
      )}
    </div>
  );
}

export function ReconcileProgress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div data-testid="reconcile-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} style={{ marginBottom: 10 }}>
      <div className="rc-progress-track"><div className="rc-progress-fill" style={{ width: pct + '%' }} /></div>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 5, textAlign: 'center' }}>กำลังตัดยอด — ตัดแล้ว {nf(done)}/{nf(total)} รายการ · อย่าปิดหน้านี้</div>
    </div>
  );
}

export function ReconcileResultCard({ result, onUndo, onDismiss, busy }: {
  result: ReconcileResult; onUndo: () => void; onDismiss: () => void; busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const range = result.from === result.to ? result.from : result.from + ' ถึง ' + result.to;
  return (
    <div data-testid="reconcile-result" className="rc-result" data-undone={result.undone ? '1' : '0'}>
      <div className="rc-result-head">
        <div className="rc-status-icon" aria-hidden="true">{result.undone ? '↶' : '✓'}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 800 }}>{result.undone ? 'ย้อนการตัดยอดแล้ว' : 'ตัดยอดเสร็จแล้ว'}</div>
          <div style={{ fontSize: 12, opacity: 0.92 }}>{range}</div>
        </div>
        <button type="button" onClick={onDismiss} aria-label="ปิดสรุปผล" style={{ border: 0, background: 'rgba(255,255,255,.2)', color: '#fff', fontSize: 18, borderRadius: 999, minWidth: 38, minHeight: 38 }}>×</button>
      </div>
      <div className="rc-result-body">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <span className="rc-pill" style={{ background: 'var(--green-tint)', color: 'var(--green)' }}>ตัดแล้ว {nf(result.applied)} รายการ</span>
          {result.alreadyDone > 0 && <span className="rc-pill">เคยตัดครบแล้ว {nf(result.alreadyDone)}</span>}
          {result.zeroQty > 0 && <span className="rc-pill">จำนวน 0 (ไม่ตัด) {nf(result.zeroQty)}</span>}
          {result.skipped.length > 0 && <span className="rc-pill" style={{ background: 'var(--amber-bg)', color: 'var(--amber-ink)' }}>ข้าม {nf(result.skipped.length)}</span>}
          {result.clamped.length > 0 && <span className="rc-pill" style={{ background: 'var(--red-bg)', color: 'var(--red)' }}>ยอดไม่พอ {nf(result.clamped.length)}</span>}
        </div>
        {result.clamped.length > 0 && (
          <div style={{ marginTop: 10, background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 11, padding: '9px 11px', fontSize: 12, lineHeight: 1.6 }}>
            <b>ยอดหน้างานไม่พอ — ตัดได้เท่าที่มี (ตรวจนับ/เติมยา):</b>
            {result.clamped.map((c) => <div key={c.name}>• {c.name}: ไฟล์จ่าย {nf(c.reported)} แต่ตัดได้ {nf(c.deducted)} {c.unit}</div>)}
          </div>
        )}
        {result.skipped.length > 0 && (
          <div style={{ marginTop: 10, background: 'var(--amber-bg)', color: 'var(--amber-ink)', borderRadius: 11, padding: '9px 11px', fontSize: 12, lineHeight: 1.6 }}>
            <b>ข้าม (ไม่ได้ตัดยอด):</b>
            {result.skipped.slice(0, 8).map((n) => <div key={n}>• {n}</div>)}
            {result.skipped.length > 8 && <div>และอีก {result.skipped.length - 8} รายการ</div>}
          </div>
        )}
        {result.entries.length > 0 && (
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={{ marginTop: 8, border: 0, background: 'transparent', color: 'var(--green)', fontWeight: 700, fontSize: 12.5, padding: '6px 0', minHeight: 38 }}>
            {open ? 'ซ่อนรายการที่ตัด ▲' : 'ดูรายการที่ตัดทั้งหมด (' + result.entries.length + ') ▾'}
          </button>
        )}
        {open && (
          <div style={{ maxHeight: 260, overflowY: 'auto', fontSize: 12, lineHeight: 1.7 }}>
            {result.entries.map((e) => <div key={e.txId + e.medId} style={{ display: 'flex', gap: 8 }}><span style={{ flex: 1, minWidth: 0 }}>{e.name}</span><span style={{ flex: 'none', fontWeight: 700 }}>−{nf(e.deducted)} {e.unit}</span></div>)}
          </div>
        )}
        {!result.undone && result.entries.length > 0 && (
          <button type="button" disabled={busy} onClick={onUndo} style={{ marginTop: 10, width: '100%', border: '1.5px solid var(--red)', background: 'transparent', color: 'var(--red)', borderRadius: 12, fontWeight: 800, fontSize: 13, minHeight: 46, opacity: busy ? 0.5 : 1 }}>
            ↶ ย้อนการตัดยอดครั้งนี้ (ถ้าตัดผิดวัน/ผิดไฟล์)
          </button>
        )}
      </div>
    </div>
  );
}
