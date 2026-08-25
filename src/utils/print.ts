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
  // Shelf strips print at their real physical size — 20mm × 100mm — 2 columns × 14 rows
  // fills an A4 sheet exactly (28 labels/page), matching what was asked for: consistent,
  // known-size labels that cut cleanly and line up with the shelf edge.
  const qrPx = isStrip ? 300 : 120;

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
  @page { size: A4; margin: ${isStrip ? '8.5mm 5mm' : '10mm'}; }
  * { box-sizing: border-box; }
  body { font-family: 'Noto Sans Thai', system-ui, -apple-system, sans-serif; margin: 0; }
  .sheet {
    display: grid;
    ${isStrip
      ? 'grid-template-columns: repeat(2, 100mm); grid-auto-rows: 20mm; gap: 0; justify-content: center;'
      : 'grid-template-columns: repeat(4, 1fr); gap: 3mm;'}
  }

  .lbl { border: 1px solid #999; border-radius: 2mm; padding: 2.5mm; display: flex; gap: 2mm; align-items: center; break-inside: avoid; }
  .lbl .qr { flex: none; width: 16mm; height: 16mm; }
  .lbl .meta { min-width: 0; }
  .code { font-size: 6.5pt; letter-spacing: .05em; color: #666; font-weight: 600; }
  .sub { font-size: 6.5pt; color: #666; margin-top: .5mm; }

  /* Real physical size: 100mm × 20mm, exactly — 2 cols × 14 rows fills an A4 page (28
     labels), so every sheet prints the same known size regardless of how many meds are
     in the run (the last page just has empty grid cells). */
  .strip { width: 100mm; height: 20mm; display: flex; align-items: stretch; border: 0.3mm solid #999; overflow: hidden; break-inside: avoid; }
  .strip .bin { flex: none; width: 15mm; background: #f5c518; color: #1a1a1a; font-weight: 800; font-size: 13.5pt; display: flex; align-items: center; justify-content: center; text-align: center; line-height: 1.05; padding: 1mm; }
  .strip .qr { flex: none; width: 16mm; height: 16mm; margin: 2mm 1.5mm; }
  .strip .meta { flex: 1; min-width: 0; padding: 0 2.5mm; display: flex; flex-direction: column; justify-content: center; overflow: hidden; }

  .qr svg { width: 100%; height: 100%; }
  .title { font-size: 8pt; font-weight: 700; line-height: 1.2; margin-top: .5mm; }
  .strip .title { font-size: 12pt; font-weight: 800; margin-top: 0; line-height: 1.15; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .tag { font-size: 6pt; font-weight: 700; color: #b3261e; margin-top: .5mm; }
  .strip .tag { font-size: 8pt; margin-top: .8mm; }

  @media screen {
    body { background: #eee; padding: 10mm; }
    .sheet { background: #fff; padding: ${isStrip ? '8.5mm 5mm' : '10mm'}; margin: 0 auto; width: 210mm; box-shadow: 0 0 0 1px #ddd; }
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
