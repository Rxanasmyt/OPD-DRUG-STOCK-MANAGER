import { parseLabelText, type LabelParse } from './labelOcr';

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

/** Downscale/upscale to ~2000px on the long side, grayscale + contrast stretch (optionally inverted). */
async function preprocess(file: Blob, invert: boolean): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const scale = Math.min(2.5, 2000 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
    d[i] = g; hist[g]++;
  }
  // percentile stretch (1%–99%) so a dim phone photo still has full contrast
  const total = w * h; let lo = 0, hi = 255, acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * 0.01) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= total * 0.01) { hi = i; break; } }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    let v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span));
    if (invert) v = 255 - v;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
}

export interface LabelScanResult extends LabelParse { text: string }

/** Reads a photo of a drug box. A second, inverted pass runs only when the first found neither
 * field (white-on-dark printing, embossed foil). */
export async function scanLabelPhoto(file: Blob, onStage?: (s: string) => void): Promise<LabelScanResult> {
  onStage?.('กำลังโหลดตัวอ่านตัวอักษร (ครั้งแรกอาจใช้เวลาสักครู่)…');
  const w = await getWorker();
  onStage?.('กำลังอ่านฉลาก…');
  let text = (await w.recognize(await preprocess(file, false))).data.text;
  let parsed = parseLabelText(text);
  if (!parsed.expiries.length || !parsed.lots.length) {
    onStage?.('อ่านไม่ครบ ลองอ่านอีกรอบ…');
    const t2 = (await w.recognize(await preprocess(file, true))).data.text;
    const p2 = parseLabelText(text + '\n' + t2);
    text = text + '\n' + t2;
    parsed = p2;
  }
  return { ...parsed, text };
}
