import { useRef, useState, type CSSProperties } from 'react';
import { useApp } from '../store/AppContext';
import { usesSubstock } from '../store/selectors';
import { BottomSheet } from './BottomSheet';
import { NumberStepper } from './NumberStepper';
import { MedDot } from './MedDot';
import { WardBadge } from './WardBadge';
import { MedMiniCard } from './MedMiniCard';
import { recognizeLotLabel } from '../utils/ocr';

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
  const { state, sub, setRecvLot, setRecvExp, setRecvQty, addRecv, cancelReceivePick, toast } = useApp();
  const recvMed = state.recvMed ? state.meds.find((m) => m.id === state.recvMed) : null;
  const [ocrBusy, setOcrBusy] = useState(false);
  const ocrInputRef = useRef<HTMLInputElement>(null);

  const handleOcrPhoto = async (file: File) => {
    setOcrBusy(true);
    try {
      const { lotNo, expIso } = await recognizeLotLabel(file);
      if (lotNo) setRecvLot(lotNo);
      if (expIso) setRecvExp(expIso);
      if (!lotNo && !expIso) toast('อ่านฉลากไม่พบ lot หรือวันหมดอายุที่ชัดเจน — กรอกเองด้านล่าง');
      else toast('อ่านฉลากแล้ว — ตรวจสอบให้ตรงกับฉลากจริงก่อนบันทึกเสมอ' + (!lotNo ? ' (ไม่พบ lot — กรอกเอง)' : '') + (!expIso ? ' (ไม่พบวันหมดอายุ — กรอกเอง)' : ''));
    } catch (e) {
      console.error('OCR read failed:', e);
      toast('อ่านฉลากไม่สำเร็จ — กรอกเองแทน');
    } finally {
      setOcrBusy(false);
    }
  };

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
          <input
            ref={ocrInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleOcrPhoto(f); e.target.value = ''; }}
          />
          <button
            type="button"
            onClick={() => ocrInputRef.current?.click()}
            disabled={ocrBusy}
            className={'press-spring' + (ocrBusy ? '' : ' ai-glow')}
            style={{ width: '100%', border: '1.5px solid var(--ai-1)', background: 'var(--bg-card)', padding: '10px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, minHeight: 42, marginBottom: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: ocrBusy ? 0.7 : 1 }}
          >
            <span className={ocrBusy ? undefined : 'ai-text'} style={{ color: ocrBusy ? 'var(--muted)' : undefined }}>
              {ocrBusy ? '⏳ กำลังอ่านฉลาก…' : '📷 ถ่ายรูปฉลากเพื่ออ่าน lot/วันหมดอายุอัตโนมัติ'}
            </span>
          </button>
          <div className="grid-2" style={{ marginBottom: 9 }}>
            <label>
              <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Lot no.</span>
              <input value={state.recvLot} onChange={(e) => setRecvLot(e.target.value)} placeholder="เช่น A2609" style={inputStyle} />
            </label>
            <label>
              <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>วันหมดอายุ</span>
              <input value={state.recvExp} onChange={(e) => setRecvExp(e.target.value)} type="date" style={inputStyle} />
            </label>
          </div>
          <label style={{ display: 'block', marginBottom: 4 }}>
            <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>จำนวนที่รับ ({recvMed.unit})</span>
            <NumberStepper value={state.recvQty} onChange={setRecvQty} unit={recvMed.unit} />
          </label>
          <button
            onClick={cancelReceivePick}
            style={{ display: 'block', width: '100%', textAlign: 'center', border: 0, background: 'transparent', color: 'var(--red)', fontSize: 12.5, fontWeight: 600, padding: '10px 0 4px' }}
          >
            ยกเลิกรายการนี้ — ไม่รับยาตัวนี้
          </button>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              onClick={() => addRecv()}
              className="btn-outline"
              style={{ flex: 1, padding: 12, borderRadius: 10, fontSize: 13, fontWeight: 600, minHeight: 46 }}
            >
              เพิ่มลงใบรับ · เสร็จสิ้น
            </button>
            <button
              onClick={() => addRecv({ scanNext: true })}
              className="btn-primary"
              style={{ flex: 1, padding: 12, borderRadius: 10, fontSize: 13, fontWeight: 700, minHeight: 46 }}
            >
              เพิ่มลงใบรับ · สแกนตัวต่อไป
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

const inputStyle: CSSProperties = { width: '100%', border: '1px solid var(--border)', background: 'var(--bg-card)', borderRadius: 10, padding: '11px 12px', fontSize: 16, minHeight: 44 };
