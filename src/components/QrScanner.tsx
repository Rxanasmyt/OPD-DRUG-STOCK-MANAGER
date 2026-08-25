import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

/**
 * Real camera QR scanner — opens the device camera (rear-facing on phones/tablets),
 * decodes frames with jsQR, and calls `onDecode` with whatever text it reads. Debounces
 * repeat reads of the same code so it doesn't spam the caller every frame, but keeps
 * scanning continuously so a mismatched/retry scan (wrong label) resolves itself once the
 * right one is in frame.
 */
export function QrScanner({ active, onDecode }: { active: boolean; onDecode: (raw: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let last: { text: string; at: number } | null = null;
    setError(null);

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        const video = videoRef.current;
        if (video) { video.srcObject = s; void video.play(); }
        raf = requestAnimationFrame(tick);
      })
      .catch(() => setError('เปิดกล้องไม่ได้ — ตรวจสอบสิทธิ์การใช้กล้องของเบราว์เซอร์ในการตั้งค่า หรือกรอกรหัสด้วยมือแทนด้านล่าง'));

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (code && code.data) {
            const now = Date.now();
            if (!last || last.text !== code.data || now - last.at > 1500) {
              last = { text: code.data, at: now };
              onDecode(code.data);
            }
          }
        }
      }
      raf = requestAnimationFrame(tick);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active, onDecode]);

  if (error) {
    return <div style={{ padding: '0 14px', textAlign: 'center', fontSize: 12, lineHeight: 1.55, opacity: 0.85 }}>{error}</div>;
  }
  return (
    <>
      <video ref={videoRef} muted playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </>
  );
}
