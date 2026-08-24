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

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(10,18,14,.72)', display: 'flex', alignItems: 'flex-end', zIndex: 20, animation: 'fade .16s' }}>
      <div style={{ background: 'var(--ink)', color: 'var(--ink-soft)', width: '100%', borderRadius: '20px 20px 0 0', padding: '18px 18px 22px', animation: 'pop .22s' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
          <div style={{ fontSize: 16.5, fontWeight: 600 }}>{title}</div>
          <button onClick={closeQr} style={{ border: 0, background: 'rgba(255,255,255,.14)', color: 'var(--ink-soft)', width: 32, height: 32, borderRadius: 9, fontSize: 15 }}>✕</button>
        </div>
        <div style={{ fontSize: 12.5, opacity: 0.7, lineHeight: 1.5, marginBottom: 14 }}>{desc}</div>
        <div style={{ position: 'relative', height: 172, borderRadius: 14, background: '#0a120e', overflow: 'hidden', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 120, height: 120, border: '2px solid rgba(242,245,239,.5)', borderRadius: 12 }} />
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '34%', background: 'linear-gradient(to bottom, rgba(23,85,47,0), rgba(90,220,140,.35))', animation: 'sweep 1.7s infinite ease-in-out' }} />
          <div style={{ position: 'absolute', bottom: 10, left: 0, right: 0, textAlign: 'center', fontSize: 11.5, opacity: 0.6 }}>กำลังค้นหา QR ในกรอบ…</div>
        </div>
        <button onClick={qrSuccess} style={{ width: '100%', border: 0, background: 'var(--ink-soft)', color: 'var(--ink)', padding: 15, borderRadius: 11, fontSize: 15.5, fontWeight: 600, minHeight: 52, marginBottom: 8 }}>จำลองสแกนสำเร็จ</button>
        <button onClick={qrManual} style={{ width: '100%', border: '1px solid rgba(255,255,255,.22)', background: 'transparent', color: 'var(--ink-soft)', padding: 13, borderRadius: 11, fontSize: 13.5, minHeight: 46 }}>กรอกรหัสด้วยมือ (กรณีฉลากชำรุด)</button>
        {state.qrManualOpen && (
          <div style={{ marginTop: 10 }}>
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
