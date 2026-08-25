import { qrSvgMarkup } from './qr';

export interface PrintLabel {
  payload: string;
  id: string;
  title: string;
  sub: string;
  tag?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/**
 * Opens a new tab with a real, printable A4 sticker sheet (one card per label: QR + code +
 * name + sub-text) and triggers the browser print dialog once it's laid out. Returns false
 * if the popup was blocked, so the caller can tell the user what happened.
 */
export function printLabelSheet(labels: PrintLabel[], heading: string): boolean {
  const qrPx = 120;
  const cards = labels
    .map(
      (l) => `<div class="lbl">
        <div class="qr">${qrSvgMarkup(l.payload, qrPx)}</div>
        <div class="meta">
          <div class="code">${escapeHtml(l.id)}</div>
          <div class="title">${escapeHtml(l.title)}</div>
          <div class="sub">${escapeHtml(l.sub)}</div>
          ${l.tag ? `<div class="tag">${escapeHtml(l.tag)}</div>` : ''}
        </div>
      </div>`
    )
    .join('');

  const html = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(heading)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Noto Sans Thai', system-ui, -apple-system, sans-serif; margin: 0; }
  .sheet { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; }
  .lbl { border: 1px solid #999; border-radius: 2mm; padding: 2.5mm; display: flex; gap: 2mm; align-items: center; break-inside: avoid; }
  .qr { flex: none; width: 16mm; height: 16mm; }
  .qr svg { width: 100%; height: 100%; }
  .meta { min-width: 0; }
  .code { font-size: 6.5pt; letter-spacing: .05em; color: #666; font-weight: 600; }
  .title { font-size: 8pt; font-weight: 700; line-height: 1.2; margin-top: .5mm; }
  .sub { font-size: 6.5pt; color: #666; margin-top: .5mm; }
  .tag { font-size: 6pt; font-weight: 700; color: #b3261e; margin-top: .5mm; }
  @media screen {
    body { background: #eee; padding: 10mm; }
    .sheet { background: #fff; padding: 10mm; margin: 0 auto; max-width: 210mm; box-shadow: 0 0 0 1px #ddd; }
  }
</style></head>
<body>
  <div class="sheet">${cards}</div>
  <script>window.onload = function () { window.print(); };</script>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}
