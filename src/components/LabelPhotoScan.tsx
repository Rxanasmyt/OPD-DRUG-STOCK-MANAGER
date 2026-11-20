import { useRef, useState } from 'react';
import { scanLabelPhoto, type LabelScanResult } from '../utils/ocrEngine';

/**
 * "📷 ถ่ายกล่องยา" — photograph the box, OCR reads Lot and expiry, the pharmacist CONFIRMS. Uses the
 * phone's native camera via <input capture> (full resolution, autofocus, flash — better than a
 * live video frame for small print). The best anchored candidate pre-fills the field, every
 * other candidate is a tap-to-use chip, and the photo stays visible next to the result so the
 * value can be checked against the real box. Nothing is saved by this component itself.
 */
export function LabelPhotoScan({ onLot, onExp, currentLot, currentExp }: {
  onLot: (v: string) => void; onExp: (iso: string) => void; currentLot: string; currentExp: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [res, setRes] = useState<LabelScanResult | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setErr(null); setRes(null);
    if (thumb) URL.revokeObjectURL(thumb);
    setThumb(URL.createObjectURL(f));
    setBusy('กำลังเตรียมภาพ…');
    try {
      const r = await scanLabelPhoto(f, setBusy);
      setRes(r);
      const e = r.expiryConfident ? r.expiries[0] : null;
      const l = r.lots[0] && (r.lots[0].anchored || (r.lots[0].votes || 0) >= 2) ? r.lots[0] : null;
      if (e && !currentExp) onExp(e.iso);
      if (l && !currentLot) onLot(l.value);
    } catch (e) {
      console.error('label ocr failed:', e);
      setErr('อ่านฉลากไม่สำเร็จ (ตรวจสอบอินเทอร์เน็ตครั้งแรกที่ใช้งาน) — กรอก Lot/วันหมดอายุด้วยมือได้เลย');
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const chip = (active: boolean) => ({
    border: '1px solid ' + (active ? 'var(--green)' : 'var(--border)'), background: active ? 'var(--green-tint)' : 'var(--bg-card)',
    borderRadius: 999, padding: '6px 11px', fontSize: 12.5, fontWeight: 600, minHeight: 34,
  } as const);

  return (
    <div style={{ marginBottom: 9 }}>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden data-testid="label-photo-input" onChange={(e) => void onFile(e.target.files?.[0])} />
      <button type="button" disabled={!!busy} onClick={() => inputRef.current?.click()} style={{ width: '100%', border: '1.5px dashed var(--green)', background: 'var(--green-tint)', color: 'var(--green)', borderRadius: 10, padding: '11px 12px', fontSize: 13.5, fontWeight: 700, minHeight: 46 }}>
        {busy ? '⏳ ' + busy : '📷 ถ่ายกล่องยา — อ่าน Lot และวันหมดอายุอัตโนมัติ'}
      </button>
      {err && <div style={{ color: 'var(--red)', fontSize: 12.5, marginTop: 6, lineHeight: 1.5 }}>{err}</div>}
      {res && (
        <div data-testid="label-scan-result" style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'flex-start' }}>
          {thumb && <img src={thumb} alt="ภาพที่ถ่าย" style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 8, flex: 'none', border: '1px solid var(--border)' }} />}
          <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.5 }}>
            <div className="muted" style={{ fontWeight: 600 }}>วันหมดอายุที่อ่านได้ (แตะเพื่อเลือก)</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '4px 0 8px' }}>
              {res.expiries.length === 0 && <span className="muted">ไม่พบวันที่ — ถ่ายใหม่ให้เห็นบรรทัด EXP ชัด ๆ หรือกรอกเอง</span>}
              {res.expiries.slice(0, 5).map((x) => (
                <button type="button" key={x.iso} onClick={() => onExp(x.iso)} style={chip(currentExp === x.iso)}>
                  {x.iso.split('-').reverse().join('/')}{!x.plausible ? ' ⚠' : ''}
                </button>
              ))}
            </div>
            <div className="muted" style={{ fontWeight: 600 }}>Lot ที่อ่านได้</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '4px 0 6px' }}>
              {res.lots.length === 0 && <span className="muted">ไม่พบคำว่า LOT/BATCH — แตะคำด้านล่างที่ตรงกับ Lot บนกล่อง</span>}
              {res.lots.slice(0, 4).map((x) => (
                <button type="button" key={x.value} onClick={() => onLot(x.value)} style={chip(currentLot === x.value)}>{x.value}</button>
              ))}
              {res.lots.length === 0 && res.words.map((w) => (
                <button type="button" key={w} onClick={() => onLot(w)} style={chip(currentLot === w)}>{w}</button>
              ))}
            </div>
            <div style={{ color: 'var(--amber-ink)', fontWeight: 600 }}>ตรวจเทียบกับกล่องจริงก่อนกดเพิ่มลงใบรับทุกครั้ง</div>
          </div>
        </div>
      )}
    </div>
  );
}
