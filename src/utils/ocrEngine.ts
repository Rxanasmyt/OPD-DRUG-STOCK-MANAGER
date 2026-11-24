import { parseLabelText, mergeParses, type LabelParse } from './labelOcr';

/**
 * On-device OCR for drug-box labels (Tesseract, English model — Lot and expiry are Latin
 * letters/digits). Everything is self-hosted under /ocr (worker, wasm core, traineddata) so it
 * needs no third-party CDN and the photo never leaves the phone. tesseract.js is dynamically
 * imported: a ~10 MB feature only the receive screen's camera button ever touches.
 */
type Worker = { recognize: (img: Blob) => Promise<{ data: { text: string } }>; setParameters: (p: Record<string, unknown>) => Promise<unknown>; terminate: () => Promise<unknown> };
let workerP: Promise<Worker> | null = null;

function abs(path: string): string {
  return new URL(import.meta.env.BASE_URL + path, window.location.href).href;
}

async function getWorker(): Promise<Worker> {
  if (!workerP) {
    workerP = (async () => {
      const { createWorker, PSM } = await import('tesseract.js');
      const w = await createWorker('eng', 1, {
        workerPath: abs('ocr/worker.min.js'),
        corePath: abs('ocr'),
        langPath: abs('ocr'),
      });
      // Sparse text: a box label is scattered words, not a paragraph.
      await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1' });
      return w as unknown as Worker;
    })().catch((e) => { workerP = null; throw e; });
  }
  return workerP;
}

/** Decode a photo on every browser: createImageBitmap with EXIF orientation where supported, then without
 * the options bag (older Safari rejects it), then a plain <img> (no createImageBitmap at all). */
async function decodeImage(file: Blob): Promise<{ width: number; height: number; close?: () => void } & CanvasImageSource> {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions); } catch { /* try without options */ }
    try { return await createImageBitmap(file); } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight });
  } finally { URL.revokeObjectURL(url); }
}

type Mode = { kind: 'adaptive'; frac: number; c: number } | { kind: 'stretch' };

/** Long side ~2400px, grayscale, then either local-mean adaptive thresholding (beats glare, shadows
 * and the uneven lighting of a phone photo of a glossy box — the big accuracy win on real
 * photos) or a plain percentile contrast stretch. */
async function preprocess(file: Blob, mode: Mode): Promise<Blob> {
  const bmp = await decodeImage(file);
  const scale = Math.min(2.5, 2400 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(bmp, 0, 0, w, h);
  (bmp as { close?: () => void }).close?.();
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  const put = (i: number, v: number) => { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; };
  if (mode.kind === 'adaptive') {
    const W = w + 1;
    const I = new Float64Array(W * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row; }
    }
    const r = Math.max(8, Math.round(Math.max(w, h) * mode.frac));
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const mean = (I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));
        put(y * w + x, g[y * w + x] < mean - mode.c ? 0 : 255);
      }
    }
  } else {
    const hist = new Array<number>(256).fill(0);
    for (let i = 0; i < w * h; i++) hist[Math.round(g[i])]++;
    const total = w * h; let lo = 0, hi = 255, acc = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * 0.01) { lo = i; break; } }
    acc = 0;
    for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= total * 0.01) { hi = i; break; } }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < w * h; i++) put(i, Math.max(0, Math.min(255, ((g[i] - lo) * 255) / span)));
  }
  ctx.putImageData(img, 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
}

export interface LabelScanResult extends LabelParse { text: string }

const PASSES: Mode[] = [
  { kind: 'adaptive', frac: 0.02, c: 8 },
  { kind: 'adaptive', frac: 0.04, c: 12 },
  { kind: 'stretch' },
];

/** Reads a photo of a drug box with up to three differently-preprocessed OCR passes; a Lot/expiry
 * that independent passes agree on (`votes`) is ranked first. Stops once both fields have 2+ votes. */
export async function scanLabelPhoto(file: Blob, onStage?: (s: string) => void): Promise<LabelScanResult> {
  onStage?.('กำลังโหลดตัวอ่านตัวอักษร (ครั้งแรกอาจใช้เวลาสักครู่)…');
  const w = await getWorker();
  const parses: LabelParse[] = [];
  let texts = '';
  let merged = mergeParses([]);
  for (let k = 0; k < PASSES.length; k++) {
    onStage?.('กำลังอ่านฉลาก… (' + (k + 1) + '/' + PASSES.length + ')');
    const text = (await w.recognize(await preprocess(file, PASSES[k]))).data.text;
    texts += '\n' + text;
    parses.push(parseLabelText(text));
    merged = mergeParses(parses);
    const eOk = (merged.expiries[0]?.votes || 0) >= 2 && merged.expiryConfident;
    const lOk = (merged.lots[0]?.votes || 0) >= 2;
    if (k >= 1 && eOk && lOk) break;
  }
  return { ...merged, text: texts };
}

/** Copies the current video frame to a JPEG blob (null when the video has no size yet). */
export async function grabFrame(video: HTMLVideoElement): Promise<Blob | null> {
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.92));
}

/** One OCR pass over a live-camera frame. Frames alternate between the three preprocessing modes (frame k uses mode k % 3),
 * so a glare/shadow problem that defeats one mode on a frame is usually fine on the next — and the 2-frame agreement rule
 * (liveScanVerdict) still protects against a single misread. */
export async function scanLiveFrame(frame: Blob, k: number, onStage?: (s: string) => void): Promise<LabelParse> {
  onStage?.('กำลังโหลดตัวอ่านตัวอักษร (ครั้งแรกอาจใช้เวลาสักครู่)…');
  const w = await getWorker();
  onStage?.('กำลังอ่านฉลาก…');
  const text = (await w.recognize(await preprocess(frame, PASSES[k % PASSES.length]))).data.text;
  return parseLabelText(text);
}
