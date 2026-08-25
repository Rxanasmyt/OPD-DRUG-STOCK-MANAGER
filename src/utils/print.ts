import { qrSvgMarkup } from './qr';

export interface PrintLabel {
  payload: string;
  id: string;
  title: string;
  sub: string;
  tag?: string;
  /** Shelf/bin code (e.g. "J4") — when present, prints as a real shelf tag strip
   * (bin code + QR + name) matching the hospital's existing paper labels, instead of
   * the generic card layout used for lot/location sheets. */
  bin?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/**
 * Opens a new tab with a real, printable A4 sticker sheet and triggers the browser print
 * dialog once it's laid out. Returns false if the popup was blocked, so the caller can tell
 * the user what happened.
 *
 * Two layouts, picked automatically per label:
 *  - shelf strip (has `bin`) — [bin code][QR][name] in one horizontal strip, sized and
 *    colored to match the hospital's existing shelf-edge labels, just with a scannable QR
 *    added in — meant to replace those directly.
 *  - card (no `bin`) — QR + code + name/sub, used for lot and floor-location sheets.
 */
export function printLabelSheet(labels: PrintLabel[], heading: string): boolean {
  const isStrip = labels.length > 0 && labels[0].bin != null;
  const qrPx = isStrip ? 90 : 120;

  const items = labels
    .map((l) => {
      if (isStrip) {
        return `<div class="strip">
          <div class="bin">${escapeHtml(l.bin || '')}</div>
          <div class="qr">${qrSvgMarkup(l.payload, qrPx)}</div>
          <div class="meta">
            <div class="title">${escapeHtml(l.title)}</div>
            ${l.tag ? `<div class="tag">${escapeHtml(l.tag)}</div>` : ''}
          </div>
        </div>`;
      }
      return `<div class="lbl">
        <div class="qr">${qrSvgMarkup(l.payload, qrPx)}</div>
        <div class="meta">
          <div class="code">${escapeHtml(l.id)}</div>
          <div class="title">${escapeHtml(l.title)}</div>
          <div class="sub">${escapeHtml(l.sub)}</div>
          ${l.tag ? `<div class="tag">${escapeHtml(l.tag)}</div>` : ''}
        </div>
      </div>`;
    })
    .join('');

  const html = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(heading)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Noto Sans Thai', system-ui, -apple-system, sans-serif; margin: 0; }
  .sheet { display: grid; grid-template-columns: repeat(${isStrip ? 2 : 4}, 1fr); gap: ${isStrip ? '2mm 4mm' : '3mm'}; }

  .lbl { border: 1px solid #999; border-radius: 2mm; padding: 2.5mm; display: flex; gap: 2mm; align-items: center; break-inside: avoid; }
  .lbl .qr { flex: none; width: 16mm; height: 16mm; }
  .lbl .meta { min-width: 0; }
  .code { font-size: 6.5pt; letter-spacing: .05em; color: #666; font-weight: 600; }
  .sub { font-size: 6.5pt; color: #666; margin-top: .5mm; }

  .strip { display: flex; align-items: stretch; border: 1px solid #999; border-radius: 1.5mm; overflow: hidden; break-inside: avoid; height: 15mm; }
  .strip .bin { flex: none; width: 12mm; background: #f5c518; color: #1a1a1a; font-weight: 800; font-size: 11pt; display: flex; align-items: center; justify-content: center; text-align: center; line-height: 1.1; }
  .strip .qr { flex: none; width: 15mm; padding: 1.5mm; display: flex; align-items: center; justify-content: center; }
  .strip .meta { flex: 1; min-width: 0; padding: 0 3mm; display: flex; flex-direction: column; justify-content: center; }

  .qr svg { width: 100%; height: 100%; }
  .title { font-size: 8pt; font-weight: 700; line-height: 1.2; margin-top: .5mm; }
  .strip .title { font-size: 9pt; margin-top: 0; }
  .tag { font-size: 6pt; font-weight: 700; color: #b3261e; margin-top: .5mm; }

  @media screen {
    body { background: #eee; padding: 10mm; }
    .sheet { background: #fff; padding: 10mm; margin: 0 auto; max-width: 210mm; box-shadow: 0 0 0 1px #ddd; }
  }
</style></head>
<body>
  <div class="sheet">${items}</div>
  <script>window.onload = function () { window.print(); };</script>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}
