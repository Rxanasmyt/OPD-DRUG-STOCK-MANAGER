import { useEffect, useRef, useState } from 'react';
import { grabFrame, scanLiveFrame } from '../utils/ocrEngine';
import { liveScanVerdict, mergeParses, type LabelParse } from '../utils/labelOcr';

const FRAME_GAP_MS = 600;     // pause between OCR passes (keeps the phone cool, lets the user steady the box)
const MAX_FRAMES = 40;        // ≈ 40 passes, then stop and show the best candidates found
const MAX_MS = 45000;

/**
 * Live camera scan: opens the camera, reads frame after frame with no shutter tap, and stops by itself as soon as the
 * Lot/expiry are seen in 2+ frames. Same safety model as the photo scan — a value is only PRE-filled (never saved), the
 * pharmacist still confirms every field against the box. Frames are processed on the phone; nothing is uploaded.
 */
export function LabelLiveScan({ onLot, onExp, currentLot, currentExp, onClose }: {
  onLot: (v: string) => void; onExp: (iso: string) => void; currentLot: string; currentExp: string; onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stage, setStage] = useState('กำลังเปิดกล้อง…');
  const [err, setErr] = useState<string | null>(null);
  const [live, setLive] = useState<LabelParse | null>(null);
  const [done, setDone] = useState(false);
  const cur = useRef({ lot: currentLot, exp: currentExp });
  cur.current = { lot: currentLot, exp: currentExp };

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    const parses: LabelParse[] = [];
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera api');
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        // best-effort continuous autofocus (ignored where unsupported)
        const track = stream.getVideoTracks()[0];
        try { await track?.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }); } catch { /* not supported */ }
        const v = videoRef.current;
        if (v) { v.srcObject = stream; try { await v.play(); } catch { /* autoplay quirks: muted+playsInline normally allow it */ } }
        setStage('ถือกล่องให้เห็นบรรทัด LOT / EXP ชัด ๆ ในกรอบ — กำลังอ่านอัตโนมัติ');
        const t0 = Date.now();
        for (let k = 0; !stopped && k < MAX_FRAMES && Date.now() - t0 < MAX_MS; k++) {
          const frame = v ? await grabFrame(v) : null;
          if (frame) {
            const p = await scanLiveFrame(frame, k);
            if (stopped) return;
            parses.push(p);
            const merged = mergeParses(parses);
            setLive(merged);
            if (liveScanVerdict(merged, parses.length) === 'done') {
              const e = merged.expiryConfident ? merged.expiries[0] : null;
              const l = merged.lots[0] && (merged.lots[0].anchored || (merged.lots[0].votes || 0) >= 2) ? merged.lots[0] : null;
              if (e && !cur.current.exp) onExp(e.iso);
              if (l && !cur.current.lot) onLot(l.value);
              setDone(true);
              setStage('อ่านได้แล้ว ✓ ตรวจเทียบกับกล่องจริงก่อนกดเพิ่มลงใบรับ');
              return;
            }
          }
          await new Promise((r) => window.setTimeout(r, FRAME_GAP_MS));
        }
        if (!stopped) setStage('อ่านไม่ครบ — ลองถือให้นิ่ง/ใกล้ขึ้น หรือใช้ปุ่ม “ถ่ายกล่องยา” แทน');
      } catch (e) {
        console.error('live label scan failed:', e);
        if (!stopped) setErr('เปิดกล้องไม่ได้ (ต้องอนุญาตการใช้กล้อง) — ใช้ปุ่ม “ถ่ายกล่องยา” แทนได้');
      }
    })();
    return () => { stopped = true; stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one live session per mount; current Lot/exp are read via ref
  }, []);

  const chip = { border: '1px solid var(--green)', background: 'var(--green-tint)', borderRadius: 999, padding: '4px 10px', fontSize: 12.5, fontWeight: 700 } as const;
  return (
    <div role="dialog" aria-label="สแกนกล่องยาอัตโนมัติ" data-testid="live-scan" style={{ position: 'fixed', inset: 0, zIndex: 80, background: '#000', display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <video ref={videoRef} playsInline muted autoPlay style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <div aria-hidden="true" style={{ position: 'absolute', inset: '18% 8%', border: '3px solid rgba(255,255,255,.85)', borderRadius: 16, boxShadow: '0 0 0 9999px rgba(0,0,0,.35)', pointerEvents: 'none' }} />
      </div>
      <div style={{ background: 'rgba(0,0,0,.88)', color: '#fff', padding: '12px 14px calc(env(safe-area-inset-bottom, 0px) + 12px)' }}>
        <div data-testid="live-stage" style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.45 }}>{err ?? stage}</div>
        {live && (live.expiries.length > 0 || live.lots.length > 0) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, color: 'var(--ink)' }}>
            {live.expiries.slice(0, 2).map((x) => <span key={x.iso} style={chip}>EXP {x.iso.split('-').reverse().join('/')}</span>)}
            {live.lots.slice(0, 2).map((x) => <span key={x.value} style={chip}>LOT {x.value}</span>)}
          </div>
        )}
        <button type="button" onClick={onClose} className="btn-primary" style={{ width: '100%', marginTop: 12, padding: 14, borderRadius: 12, fontSize: 15, fontWeight: 700 }}>{done ? 'ตกลง — ใช้ค่าที่อ่านได้' : 'ปิดกล้อง'}</button>
      </div>
    </div>
  );
}
