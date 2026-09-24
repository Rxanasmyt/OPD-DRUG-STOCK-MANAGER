import { useApp } from '../store/AppContext';
import { BottomSheet } from './BottomSheet';
import { NumberStepper } from './NumberStepper';
import { nf } from '../utils/format';

/**
 * One med, one confirm — shown right after a เติมหน้างาน (transfer) scan closes the camera.
 * Real-world request: the previous flow kept the camera open and silently bumped the cart on
 * every scan with no per-item confirmation, which left genuine doubt about whether an item had
 * actually been added yet and what quantity landed on it (walking a whole shelf run, easy to
 * lose track). This shows exactly what's about to go in — editable — before either scanning the
 * next item or going back to review the list, so each scan is an explicit, visible step instead
 * of a silent one.
 */
export default function ScanConfirmSheet() {
  const { state, sub, setCartQty, confirmScanAndNext, confirmScanAndStop, cancelScanConfirm } = useApp();
  const medId = state.scanConfirmMedId;
  const med = medId ? state.meds.find((m) => m.id === medId) : null;

  // Closing via backdrop tap/✕ (BottomSheet's own onClose) keeps whatever quantity is already
  // showing — same as tapping "ยืนยัน · กลับไปหน้ารายการ" below — just without forcing a choice
  // first. Never silently discards: only the explicit "ยกเลิกรายการนี้" button does that.
  const onClose = () => confirmScanAndStop();

  return (
    <BottomSheet open={!!med} onClose={onClose} title={med ? med.name : undefined}>
      {med && (
        <div style={{ paddingBottom: 4 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
            เติมจาก substock (มี {nf(sub(med.id))} {med.unit}) เข้าชั้นจ่ายยา {med.bin ? '· ชั้น ' + med.bin : ''}
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>จำนวนที่จะเติม ({med.unit})</div>
          <NumberStepper
            value={String(state.cart[med.id] || 0)}
            onChange={(v) => setCartQty(med.id, v)}
            unit={med.unit}
            max={sub(med.id)}
          />
          <button
            onClick={() => cancelScanConfirm(med.id)}
            style={{ display: 'block', width: '100%', textAlign: 'center', border: 0, background: 'transparent', color: 'var(--red)', fontSize: 12.5, fontWeight: 600, padding: '10px 0 4px' }}
          >
            ยกเลิกรายการนี้ — ไม่เติมยาตัวนี้
          </button>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              onClick={confirmScanAndStop}
              className="btn-outline"
              style={{ flex: 1, padding: 12, borderRadius: 10, fontSize: 13, fontWeight: 600, minHeight: 46 }}
            >
              ยืนยัน · กลับไปหน้ารายการ
            </button>
            <button
              onClick={confirmScanAndNext}
              className="btn-primary"
              style={{ flex: 1, padding: 12, borderRadius: 10, fontSize: 13, fontWeight: 700, minHeight: 46 }}
            >
              ยืนยัน · สแกนตัวต่อไป
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
