import QRCode from 'qrcode';

/**
 * Real QR payloads used across the app — printed on labels via <QrCode>, decoded back
 * by the camera scanner in <QrModal>/<QrScanner>. Kept intentionally tiny/stable so a
 * label printed today still scans correctly after a future data re-seed.
 */
export type QrType = 'med' | 'lot' | 'loc';
export interface QrPayload { t: QrType; id: string }

export function encodeQr(t: QrType, id: string): string {
  return JSON.stringify({ t, id });
}

/** Parses a decoded/typed-in code back into a payload. Accepts the JSON form produced by
 * encodeQr, and — for manual entry on a damaged label — a bare code like "MED-0035" or
 * "LOT-0035-1", inferring the type from its prefix. Returns null if unrecognized. */
export function parseQr(raw: string): QrPayload | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const obj = JSON.parse(s);
    if (obj && typeof obj === 'object' && typeof obj.id === 'string' && (obj.t === 'med' || obj.t === 'lot' || obj.t === 'loc')) {
      return { t: obj.t, id: obj.id };
    }
  } catch { /* not JSON — fall through to bare-code guess */ }
  const up = s.toUpperCase();
  if (up.startsWith('LOT-')) return { t: 'lot', id: up };
  if (up.startsWith('LOC-')) return { t: 'loc', id: up };
  if (up.startsWith('MED-')) return { t: 'med', id: up };
  return null;
}

/** QR module bitmap for `value`, shared by the on-screen <QrCode> component and the
 * server-less print-sheet renderer below so both stay pixel-identical. */
export function qrModules(value: string) {
  try {
    return QRCode.create(value, { errorCorrectionLevel: 'M' }).modules;
  } catch {
    return null;
  }
}

/** Standalone `<svg>` markup for `value` at `sizePx` — used to build the print sheet
 * (a fresh window's HTML), where React isn't rendering. */
export function qrSvgMarkup(value: string, sizePx: number): string {
  const modules = qrModules(value);
  if (!modules) return '';
  const n = modules.size;
  const quiet = 2;
  const total = n + quiet * 2;
  const cell = sizePx / total;
  let rects = '';
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (modules.get(row, col)) rects += `<rect x="${(col + quiet) * cell}" y="${(row + quiet) * cell}" width="${cell}" height="${cell}" fill="#12211a"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}" viewBox="0 0 ${sizePx} ${sizePx}" shape-rendering="crispEdges" style="display:block;background:#fff">${rects}</svg>`;
}
