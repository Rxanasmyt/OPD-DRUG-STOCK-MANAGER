import type { CSSProperties } from 'react';
import { useApp } from '../store/AppContext';

export default function QrModal() {
  const { state, closeQr, qrSuccess, qrManual, setQrCode } = useApp();
  if (!state.qrOpen) return null;

  const isReceive = state.qrPurpose === 'receive';
  const isTransfer = state.qrPurpose === 'transfer';
  const isSearch = state.qrPurpose === 'search';
  const title = isReceive ? 'สแกน QR ยาที่ substock' : isTransfer ? 'สแกน QR ยาที่ชั้นจ่ายยา' : isSearch ? 'สแกนฉลากยา / ชั้นวาง' : 'ยืนยันยา high alert';
  const desc = isReceive
    ? 'สแกน QR ที่ติดหน้ายาในชั้น substock — ระบบจะระบุตัวยาให้ทันที แล้วกรอก lot วันหมดอายุ และจำนวนที่รับ'
    : isTransfer
    ? 'สแกน QR ที่ติดชั้นจ่ายยา — ระบบจะเปิดรายการยานั้นให้ปรับจำนวนที่จะเติม'
    : isSearch
    ? 'จ่อกล้องที่ QR บนกล่องยาหรือขอบชั้น ระบบจะเปิดรายการนั้นให้ทันที'
    : 'forcing function — ต้องสแกน QR ที่ตัวยาให้ตรงกับรายการก่อนทำรายการต่อ';

  const corner = (top: boolean, left: boolean): CSSProperties => ({
    position: 'absolute',
    [top ? 'top' : 'bottom']: 0,
    [left ? 'left' : 'right']: 0,
    width: 22, height: 22,
    borderTop: top ? '2.5px solid #5adc8c' : 'none',
    borderBottom: top ? 'none' : '2.5px solid #5adc8c',
    borderLeft: left ? '2.5px solid #5adc8c' : 'none',
    borderRight: left ? 'none' : '2.5px solid #5adc8c',
    borderRadius: top && left ? '10px 0 0 0' : top ? '0 10px 0 0' : left ? '0 0 0 10px' : '0 0 10px 0',
  });

  return (
    <div
      style={{
        position: 'absolute', inset: 0, background: 'rgba(10,18,14,.72)',
        backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'flex-end', zIndex: 20,
        animation: 'backdropIn .2s var(--ease-out)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) closeQr(); }}
    >
      <div style={{ background: 'var(--ink)', color: 'var(--ink-soft)', width: '100%', borderRadius: '20px 20px 0 0', padding: '18px 18px 22px', animation: 'sheetIn .38s var(--ease-out)', boxShadow: '0 -16px 48px -8px rgba(0,0,0,.5)' }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.22)', margin: '0 auto 14px' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
          <div style={{ fontSize: 16.5, fontWeight: 600 }}>{title}</div>
          <button onClick={closeQr} style={{ border: 0, background: 'rgba(255,255,255,.14)', color: 'var(--ink-soft)', width: 32, height: 32, borderRadius: 9, fontSize: 15 }}>✕</button>
        </div>
        <div style={{ fontSize: 12.5, opacity: 0.7, lineHeight: 1.5, marginBottom: 14 }}>{desc}</div>
        <div style={{ position: 'relative', height: 172, borderRadius: 14, background: '#0a120e', overflow: 'hidden', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'relative', width: 120, height: 120 }}>
            <div style={corner(true, true)} /><div style={corner(true, false)} />
            <div style={corner(false, true)} /><div style={corner(false, false)} />
          </div>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '34%', background: 'linear-gradient(to bottom, rgba(23,85,47,0), rgba(90,220,140,.35))', animation: 'sweep 1.7s infinite ease-in-out' }} />
          <div style={{ position: 'absolute', bottom: 10, left: 0, right: 0, textAlign: 'center', fontSize: 11.5, opacity: 0.6 }}>
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#5adc8c', marginRight: 6, verticalAlign: 'middle', animation: 'pulse 1.6s infinite' }} />
            กำลังค้นหา QR ในกรอบ…
          </div>
        </div>
        <button onClick={qrSuccess} style={{ width: '100%', border: 0, background: 'var(--ink-soft)', color: 'var(--ink)', padding: 15, borderRadius: 11, fontSize: 15.5, fontWeight: 600, minHeight: 52, marginBottom: 8, boxShadow: '0 8px 20px -8px rgba(242,245,239,.3)' }}>จำลองสแกนสำเร็จ</button>
        <button onClick={qrManual} style={{ width: '100%', border: '1px solid rgba(255,255,255,.22)', background: 'transparent', color: 'var(--ink-soft)', padding: 13, borderRadius: 11, fontSize: 13.5, minHeight: 46 }}>กรอกรหัสด้วยมือ (กรณีฉลากชำรุด)</button>
        {state.qrManualOpen && (
          <div style={{ marginTop: 10, animation: 'fade .2s var(--ease-out)' }}>
            <input
              value={state.qrCode}
              onChange={(e) => setQrCode(e.target.value)}
              placeholder="เช่น MED-0035"
              style={{ width: '100%', border: '1px solid rgba(255,255,255,.22)', background: 'rgba(255,255,255,.08)', color: 'var(--ink-soft)', borderRadius: 10, padding: 12, fontSize: 14, minHeight: 46 }}
            />
            <div style={{ fontSize: 11.5, opacity: 0.6, marginTop: 6 }}>ต้องระบุเหตุผลที่สแกนไม่ได้ ระบบบันทึกลง audit trail</div>
          </div>
        )}
      </div>
    </div>
  );
}
