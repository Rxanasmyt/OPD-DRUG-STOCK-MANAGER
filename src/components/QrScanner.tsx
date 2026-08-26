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

    // navigator.mediaDevices is only exposed in a secure context (https:// or localhost) —
    // on plain http:// it's simply undefined, and `?.getUserMedia(...)` would then
    // short-circuit the whole chain silently (no promise, no .catch, no error shown), leaving
    // a blank camera box that looks "stuck" forever. Check explicitly instead.
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        window.isSecureContext === false
          ? 'เปิดกล้องไม่ได้ — หน้านี้ต้องเปิดผ่าน https:// เบราว์เซอร์บล็อกกล้องบนการเชื่อมต่อที่ไม่ปลอดภัย กรอกรหัสด้วยมือแทนด้านล่าง'
          : 'เบราว์เซอร์นี้ไม่รองรับการเปิดกล้อง — กรอกรหัสด้วยมือแทนด้านล่าง'
      );
      return;
    }

    navigator.mediaDevices
      // Without explicit resolution constraints, some phone browsers (notably iOS Safari)
      // default the camera stream to a low capture resolution (as low as 640×480) — plenty
      // for a video call, not enough to resolve a QR that only fills a small part of the
      // frame (e.g. a phone held back far enough to see several shelf labels at once). Ask
      // for a much higher resolution; "ideal" is a hint, so this can't fail the getUserMedia
      // call on a device/camera that can't deliver it.
      .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        // Keep autofocus hunting continuously — without this some devices focus once on
        // whatever was in frame when the camera opened (often the background) and never
        // refocus on a label held up afterwards. Not all cameras expose this; ignore if not.
        const [track] = s.getVideoTracks();
        track?.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {});
        const video = videoRef.current;
        if (video) { video.srcObject = s; void video.play(); }
        raf = requestAnimationFrame(tick);
      })
      .catch((err) => {
        const name = (err as { name?: string })?.name;
        setError(
          name === 'NotAllowedError'
            ? 'ไม่ได้รับอนุญาตให้ใช้กล้อง — กดอนุญาตสิทธิ์กล้องในเบราว์เซอร์ (หรือแก้ในการตั้งค่าเว็บไซต์) แล้วลองใหม่ หรือกรอกรหัสด้วยมือแทนด้านล่าง'
            : name === 'NotFoundError'
            ? 'ไม่พบกล้องในอุปกรณ์นี้ — กรอกรหัสด้วยมือแทนด้านล่าง'
            : 'เปิดกล้องไม่ได้ — กรอกรหัสด้วยมือแทนด้านล่าง'
        );
      });

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
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
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
