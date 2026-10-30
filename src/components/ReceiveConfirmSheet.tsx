import type { CSSProperties } from 'react';
import { useApp } from '../store/AppContext';
import { usesSubstock } from '../store/selectors';
import { BottomSheet } from './BottomSheet';
import { NumberStepper } from './NumberStepper';
import { MedDot } from './MedDot';
import { WardBadge } from './WardBadge';
import { PackSizeBadge } from './Qty';
import { MedMiniCard } from './MedMiniCard';

/**
 * One med, one confirm — shown as soon as a รับเข้า (receive) scan (or search/quick-pick) picks
 * a med, same "one scan at a time, no ambiguity about what's happening" request that produced
 * ScanConfirmSheet for เติมหน้างาน. Receiving already forced typing lot/exp/qty per item (never
 * silently added anything), but that form used to render inline, further down a page that also
 * has a search box and two other pickable lists above it — easy to scan, not notice where the
 * page landed, and end up unsure whether the item was actually queued. Putting it in a sheet
 * gives it the same "impossible to miss, nothing else on screen" treatment.
 */
export default function ReceiveConfirmSheet() {
  const { state, sub, setRecvLot, setRecvExp, setRecvQty, addRecv, cancelReceivePick } = useApp();
  const recvMed = state.recvMed ? state.meds.find((m) => m.id === state.recvMed) : null;

  return (
    <BottomSheet open={!!recvMed} onClose={cancelReceivePick} title={recvMed ? recvMed.name : undefined}>
      {recvMed && (
        <div style={{ paddingBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
            <MedDot code={recvMed.code} /> <WardBadge med={recvMed} size="md" />
          </div>
          {!usesSubstock(recvMed) && (
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--amber-ink)', marginBottom: 9 }}>
              ไม่มี substock — รับเข้าแล้วขึ้นหน้างานทันที ไม่ต้องเติมอีกขั้น
            </div>
          )}
          {usesSubstock(recvMed) && (
            <div style={{ marginBottom: 9 }}>
              <MedMiniCard medId={recvMed.id} unit={recvMed.unit} />
            </div>
          )}
          {/* Real-world request: "...ไม่ต้องบังคับให้ใส่ Lot และวันหมดอายุ...อาจจะใส่ในบางเคสที่
              เป็นยาใช้น้อย เนื่องจากตอนนี้ภาระหน้างานหนัก...หากในอนาคตคงที่แล้วค่อยใส่ lot และ exp
              แบบเต็มรูปแบบ" — both fields below are optional now (only "ถ้ามี" labels below
              changed; nothing here blocks "เพิ่มลงใบรับ" when they're left blank). */}
          <div className="grid-2" style={{ marginBottom: 9 }}>
            <label>
              <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Lot no. (ถ้ามี)</span>
              <input value={state.recvLot} onChange={(e) => setRecvLot(e.target.value)} placeholder="เช่น A2609" style={inputStyle} />
            </label>
            <label>
              <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>วันหมดอายุ (ถ้ามี)</span>
              <input value={state.recvExp} onChange={(e) => setRecvExp(e.target.value)} type="date" style={inputStyle} />
            </label>
          </div>
          <label style={{ display: 'block', marginBottom: 4 }}>
            <span className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 4 }}>
              จำนวนที่รับ ({recvMed.unit})
              {/* Real-world request: "...อยากให้มีรายละเอียดว่า 1 กล่องมีจำนวนยาเท่าไร..." —
                  right where the real received qty actually gets typed in, not just somewhere
                  earlier on the page already scrolled past. */}
              <PackSizeBadge packSize={recvMed.packSize} unit={recvMed.unit} />
            </span>
            <NumberStepper value={state.recvQty} onChange={setRecvQty} unit={recvMed.unit} packSize={recvMed.packSize} />
          </label>
          <button
            onClick={cancelReceivePick}
            style={{ display: 'block', width: '100%', textAlign: 'center', border: 0, background: 'transparent', color: 'var(--red)', fontSize: 12.5, fontWeight: 600, padding: '10px 0 4px' }}
          >
            ยกเลิกรายการนี้ — ไม่รับยาตัวนี้
          </button>
          <div style={{ marginTop: 10 }}>
            <button
              onClick={() => addRecv()}
              className="btn-primary"
              style={{ width: '100%', padding: 12, borderRadius: 10, fontSize: 13, fontWeight: 700, minHeight: 46 }}
            >
              เพิ่มลงใบรับ
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

const inputStyle: CSSProperties = { width: '100%', border: '1px solid var(--border)', background: 'var(--bg-card)', borderRadius: 10, padding: '11px 12px', fontSize: 16, minHeight: 44 };
