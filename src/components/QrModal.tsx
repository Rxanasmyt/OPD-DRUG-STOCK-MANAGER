import type { CSSProperties } from 'react';
import { useApp } from '../store/AppContext';
import { QrScanner } from './QrScanner';

/** The camera view fills almost the entire screen now — it used to be a ~172px box inside a
 * bottom sheet, which on a real phone (reported: "กล้องเล็กมากถ้าเทียบกับหน้าจอโทรศัพท์") left
 * so little of the frame actually scanning that getting a label centered in it took several
 * tries. Everything else (title, hint, manual-entry fallback) is now a thin overlay on top of
 * the camera instead of pushing it into a small box, so the thing people actually need — a
 * big, well-lit view of the QR — gets almost the whole screen. */
// รับเข้า (คลังใหญ่ → substock) and เติมหน้างาน (substock → ชั้นจ่ายยา) used to be visually
// identical scan screens — same black background, same green frame, same green sweep — with
// only the title/desc text (easy to miss mid-scan) telling them apart. Reported confusion:
// "จพ.เภสัชสแกนแล้วไม่มึนว่าอยู่หน้าไหน" wants color AND shape both different, not just text.
// Amber for รับเข้า (matches the ⬓ receive nav icon), green for เติมหน้างาน (matches the ⇄
// transfer nav icon) — same colors those two already wear everywhere else in the app, so this
// isn't a new color vocabulary to learn, just the existing one carried into the scanner too.
const MODE_THEME: Record<'receive' | 'transfer' | 'other', { accent: string; accentRgb: string; icon: string; flow: string; corner: 'square' | 'arrow' }> = {
  receive: { accent: '#e0a94a', accentRgb: '224,169,74', icon: '⬓', flow: 'คลังใหญ่ → substock', corner: 'square' },
  transfer: { accent: '#5adc8c', accentRgb: '90,220,140', icon: '⇄', flow: 'substock → ชั้นจ่ายยา', corner: 'arrow' },
  other: { accent: '#5adc8c', accentRgb: '90,220,140', icon: '◈', flow: '', corner: 'square' },
};

export default function QrModal() {
  const { state, closeQr, qrDecoded, qrManual, setQrCode, setQrManualReason } = useApp();
  if (!state.qrOpen) return null;

  const isReceive = state.qrPurpose === 'receive';
  const isTransfer = state.qrPurpose === 'transfer';
  const isViewMed = state.qrPurpose === 'viewMed';
  const theme = MODE_THEME[isReceive ? 'receive' : isTransfer ? 'transfer' : 'other'];
  const title = isReceive ? 'สแกน QR ยาที่ substock' : isTransfer ? 'สแกน QR ยาที่ชั้นจ่ายยา' : isViewMed ? 'สแกนดูข้อมูลยา' : 'ยืนยันยา high alert';
  const desc = isReceive
    ? 'สแกน QR ที่ติดหน้ายาในชั้น substock'
    : isTransfer
    ? 'สแกน QR ที่ติดชั้นจ่ายยา'
    : isViewMed
    ? 'สแกน QR ที่ฉลากตัวยาหรือ lot'
    : 'ต้องสแกน QR ที่ตัวยาให้ตรงกับรายการก่อนทำรายการต่อ';

  // Two different frame shapes, not just two colors — receive gets sharp square corners
  // (matches its ⬓ icon, a filled block), transfer gets softly rounded corners (matches its
  // ⇄ icon's flowing feel) so the viewfinder itself, the thing someone's eyes are actually on
  // while scanning, carries the mode — not just text they may not stop to read.
  const corner = (top: boolean, left: boolean): CSSProperties => ({
    position: 'absolute',
    [top ? 'top' : 'bottom']: 0,
    [left ? 'left' : 'right']: 0,
    width: 34, height: 34,
    borderTop: top ? `3px solid ${theme.accent}` : 'none',
    borderBottom: top ? 'none' : `3px solid ${theme.accent}`,
    borderLeft: left ? `3px solid ${theme.accent}` : 'none',
    borderRight: left ? 'none' : `3px solid ${theme.accent}`,
    borderRadius: theme.corner === 'square'
      ? (top && left ? '4px 0 0 0' : top ? '0 4px 0 0' : left ? '0 0 0 4px' : '0 0 4px 0')
      : (top && left ? '16px 0 0 0' : top ? '0 16px 0 0' : left ? '0 0 0 16px' : '0 0 16px 0'),
  });

  return (
    <div
      style={{ position: 'absolute', inset: 0, background: '#000', zIndex: 20, animation: 'fade .18s var(--ease-out)', boxShadow: `inset 0 0 0 4px rgba(${theme.accentRgb},.9)` }}
      onClick={(e) => { if (e.target === e.currentTarget) closeQr(); }}
    >
      {/* Camera fills the whole modal — everything else floats on top of it. */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <QrScanner active={state.qrOpen} onDecode={qrDecoded} />
      </div>

      {/* Top bar — title/desc/close, on a gradient so it stays legible over any background. */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: 'calc(env(safe-area-inset-top, 0px) + 14px) 16px 40px', background: `linear-gradient(to bottom, rgba(${theme.accentRgb},.32), rgba(0,0,0,.7) 55%, rgba(0,0,0,0))`, pointerEvents: 'none' }}>
        {theme.flow && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: `rgba(${theme.accentRgb},.9)`, color: '#1a1408', fontWeight: 800, fontSize: 12, padding: '4px 11px 4px 8px', borderRadius: 20, marginBottom: 9 }}>
            <span style={{ fontSize: 15, lineHeight: 1 }}>{theme.icon}</span> {theme.flow}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16.5, fontWeight: 700, color: '#fff' }}>{title}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.75)', marginTop: 2 }}>{desc}</div>
          </div>
          <button onClick={closeQr} style={{ pointerEvents: 'auto', flex: 'none', border: 0, background: 'rgba(255,255,255,.18)', color: '#fff', width: 36, height: 36, borderRadius: 10, fontSize: 16 }}>✕</button>
        </div>
      </div>

      {/* Large centered viewfinder — the actual fix: this used to be 120x120 inside a 172px
          box; now it scales to most of the screen width, so a label filling the frame reads
          as genuinely large instead of a postage stamp in the middle of a tiny preview. */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <div style={{ position: 'relative', width: 'min(78vw, 78vh, 380px)', aspectRatio: '1 / 1' }}>
          <div style={corner(true, true)} /><div style={corner(true, false)} />
          <div style={corner(false, true)} /><div style={corner(false, false)} />
          <div style={{ position: 'absolute', left: '4%', right: '4%', top: 0, height: '30%', background: `linear-gradient(to bottom, rgba(${theme.accentRgb},0), rgba(${theme.accentRgb},.4))`, animation: 'sweep 1.7s infinite ease-in-out' }} />
        </div>
      </div>

      {/* Bottom bar — scan hint + manual-entry fallback, same gradient treatment as the top. */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '46px 16px calc(env(safe-area-inset-bottom, 0px) + 18px)', background: 'linear-gradient(to top, rgba(0,0,0,.8), rgba(0,0,0,0))' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 14, fontSize: 12, color: 'rgba(255,255,255,.85)', textShadow: '0 1px 4px rgba(0,0,0,.6)' }}>
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: theme.accent, animation: 'pulse 1.6s infinite' }} />
          เข้าใกล้จนเห็น QR ดวงเดียวเต็มกรอบ — ถ้าเห็นหลายดวงพร้อมกัน แต่ละดวงจะเล็กเกินกล้องจะอ่าน
        </div>
        <button onClick={qrManual} style={{ width: '100%', border: '1px solid rgba(255,255,255,.35)', background: 'rgba(255,255,255,.1)', color: '#fff', padding: 13, borderRadius: 11, fontSize: 13.5, minHeight: 46, backdropFilter: 'blur(6px)' }}>
          กรอกรหัสด้วยมือ (กรณีฉลากชำรุด)
        </button>
      </div>

      {/* Manual-entry fallback — a real sheet over the camera, not squeezed underneath it. */}
      {state.qrManualOpen && (
        <div
          style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'flex-end', animation: 'backdropIn .2s var(--ease-out)' }}
          onClick={(e) => { if (e.target === e.currentTarget) qrManual(); }}
        >
          <div style={{ background: 'var(--ink)', color: 'var(--ink-soft)', width: '100%', borderRadius: '20px 20px 0 0', padding: '18px 18px calc(env(safe-area-inset-bottom, 0px) + 22px)', animation: 'sheetIn .3s var(--ease-out)' }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.22)', margin: '0 auto 14px' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>กรอกรหัสด้วยมือ</div>
              <button onClick={qrManual} style={{ border: 0, background: 'rgba(255,255,255,.14)', color: 'var(--ink-soft)', width: 30, height: 30, borderRadius: 8, fontSize: 14 }}>✕</button>
            </div>
            <input
              value={state.qrCode}
              onChange={(e) => setQrCode(e.target.value)}
              placeholder="เช่น MED-0035"
              style={{ width: '100%', border: '1px solid rgba(255,255,255,.22)', background: 'rgba(255,255,255,.08)', color: 'var(--ink-soft)', borderRadius: 10, padding: 12, fontSize: 14, minHeight: 46, marginBottom: 8 }}
            />
            <input
              value={state.qrManualReason}
              onChange={(e) => setQrManualReason(e.target.value)}
              placeholder="เหตุผลที่สแกนไม่ได้ เช่น ฉลากขาด/เลอะ"
              style={{ width: '100%', border: '1px solid rgba(255,255,255,.22)', background: 'rgba(255,255,255,.08)', color: 'var(--ink-soft)', borderRadius: 10, padding: 12, fontSize: 13.5, minHeight: 44, marginBottom: 8 }}
            />
            <button
              onClick={() => qrDecoded(state.qrCode, true)}
              disabled={!state.qrCode.trim()}
              style={{ width: '100%', border: 0, background: state.qrCode.trim() ? 'var(--ink-soft)' : 'rgba(255,255,255,.14)', color: state.qrCode.trim() ? 'var(--ink)' : 'rgba(255,255,255,.4)', padding: 13, borderRadius: 10, fontSize: 14, fontWeight: 600, minHeight: 46 }}
            >
              ยืนยันรหัส
            </button>
            <div style={{ fontSize: 11.5, opacity: 0.6, marginTop: 6 }}>บันทึกการกรอกรหัสด้วยมือลง audit trail พร้อมเหตุผล</div>
          </div>
        </div>
      )}
    </div>
  );
}
