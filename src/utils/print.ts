import { qrSvgMarkup } from './qr';
import { titleSizeStep } from './labelName';
import { fiscalYear } from './format';

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

// Font size (pt) per titleSizeStep() — a short name (most of them, once shortLabelName() has
// trimmed packaging detail) reads large and bold; a longer one steps down instead of
// truncating mid-strength (losing the "500 mg" is worse than smaller text).
const TITLE_PT_BY_STEP = [17, 15, 13, 11.5, 10, 9];
function titleFontSizePt(title: string): number {
  return TITLE_PT_BY_STEP[titleSizeStep(title)];
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
            <div class="title" style="font-size:${titleFontSizePt(l.title)}pt">${escapeHtml(l.title)}</div>
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
     in the run (the last page just has empty grid cells). QR is sized to fill the strip's
     full height (minus a hair of margin) — a QR shrunk to make room for bigger name text
     stops scanning reliably once it's out of a lab's ideal lighting/printer, so the QR's
     physical size wins that trade-off, not the name text. */
  .strip { width: 100mm; height: 20mm; display: flex; align-items: stretch; border: 0.3mm solid #999; border-radius: 1mm; overflow: hidden; break-inside: avoid; }
  .strip .bin { flex: none; width: 11.5mm; background: #f5c518; color: #1a1a1a; font-weight: 800; font-size: 12.5pt; display: flex; align-items: center; justify-content: center; text-align: center; line-height: 1.05; padding: 1mm; border-right: 0.3mm solid #d9ac00; }
  .strip .qr { flex: none; width: 16.6mm; height: 16.6mm; margin: 1.4mm 1.4mm 1.4mm 1.7mm; }
  .strip .meta { flex: 1; min-width: 0; padding: 0 2.8mm; display: flex; flex-direction: column; justify-content: center; overflow: hidden; border-left: 0.25mm solid #e5e5e0; }

  .qr svg { width: 100%; height: 100%; }
  .title { font-size: 8pt; font-weight: 700; line-height: 1.2; margin-top: .5mm; }
  /* Drug name + strength is the thing staff actually read at a glance while shelving — one
     line only (name is pre-shortened to "generic + strength", packaging detail like "Vial"/
     "(2 mL.)" trimmed off — see shortLabelName()), sized as large as that comfortably fits. */
  .strip .title { font-size: 17pt; font-weight: 800; margin-top: 0; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #14231a; }
  .tag { font-size: 6pt; font-weight: 700; color: #b3261e; margin-top: .5mm; }
  .strip .tag { font-size: 8.5pt; margin-top: .8mm; letter-spacing: .02em; }

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

export interface PickListRow {
  bin: string;
  name: string;
  qty: number;
  unit: string;
}

/**
 * The "Auto Pick-List" for the morning shelf-fill routine — a plain, sorted-by-shelf-position
 * A4 sheet someone can carry while walking the substock room, instead of trying to remember
 * (or re-derive on a phone screen) what the app's suggested-fill cart said. Deliberately not a
 * QR/label sheet — this is a checklist to work from and cross off, not something that gets cut
 * up and stuck anywhere.
 */
export function printPickListSheet(rows: PickListRow[], heading: string, subheading: string, colLabels: { bin: string; qty: string } = { bin: 'ชั้น', qty: 'จำนวนที่ต้องหยิบ' }): boolean {
  const sorted = rows.slice().sort((a, b) => a.bin.localeCompare(b.bin));
  const body = sorted
    .map((r, i) => `<tr>
      <td class="n">${i + 1}</td>
      <td class="bin">${escapeHtml(r.bin || '—')}</td>
      <td class="name">${escapeHtml(r.name)}</td>
      <td class="qty">${r.qty.toLocaleString('en-US')} ${escapeHtml(r.unit)}</td>
      <td class="check">☐</td>
    </tr>`)
    .join('');

  const html = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(heading)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Noto Sans Thai', system-ui, -apple-system, sans-serif; margin: 0; color: #12211a; }
  h1 { font-size: 16pt; margin: 0 0 2mm; }
  .meta { font-size: 10pt; color: #555; margin-bottom: 6mm; }
  table { width: 100%; border-collapse: collapse; font-size: 11pt; }
  th { text-align: left; font-size: 9pt; color: #666; border-bottom: 1.5pt solid #12211a; padding: 2mm 3mm; }
  td { padding: 2.5mm 3mm; border-bottom: 0.4pt solid #ccc; }
  .n { width: 8mm; color: #888; }
  .bin { width: 26mm; font-weight: 800; white-space: nowrap; }
  .qty { width: 32mm; font-weight: 700; text-align: right; }
  .check { width: 12mm; text-align: center; font-size: 13pt; }
  @media screen {
    body { background: #eee; padding: 14mm; }
    .sheet { background: #fff; padding: 14mm; margin: 0 auto; max-width: 210mm; box-shadow: 0 0 0 1px #ddd; }
  }
</style></head>
<body>
  <div class="sheet">
    <h1>${escapeHtml(heading)}</h1>
    <div class="meta">${escapeHtml(subheading)} · ${sorted.length} รายการ · พิมพ์เมื่อ ${new Date().toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}</div>
    <table>
      <thead><tr><th class="n">#</th><th class="bin">${escapeHtml(colLabels.bin)}</th><th class="name">รายการยา</th><th class="qty">${escapeHtml(colLabels.qty)}</th><th class="check">✓</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>
  <script>window.onload = function () { window.print(); };</script>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}

export interface SubstockCardRow {
  ts: number;
  received: number; // 0 when this row is a dispense/scrap line
  dispensed: number; // 0 when this row is a receive line
  balance: number;
  by: string;
}

/**
 * Digital replacement for the hand-written "บัตรคุมสต็อกยา" (yellow stock card) — same
 * วันที่/รับ/จ่าย/คงเหลือ columns staff already read this off of, generated from real
 * transaction history instead of copied by hand onto a card that can go missing, get a
 * pen-run smudge, or just fall behind because nobody got around to writing today's line yet.
 */
export function printSubstockCardSheet(med: { code: string; name: string; parSub: number; unit: string }, rows: SubstockCardRow[]): boolean {
  const now = new Date();
  const fy = fiscalYear(now.getTime()) % 100;
  const body = rows
    .map((r, i) => `<tr>
      <td class="no">${i + 1}</td>
      <td class="date">${escapeHtml(new Date(r.ts).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' }))}</td>
      <td class="num recv">${r.received ? r.received.toLocaleString('en-US') : ''}</td>
      <td class="num disp">${r.dispensed ? r.dispensed.toLocaleString('en-US') : ''}</td>
      <td class="num bal">${r.balance.toLocaleString('en-US')}</td>
      <td class="by">${escapeHtml(r.by)}</td>
    </tr>`)
    .join('');

  // Styled after the real hand-written yellow "บัตรคุมสต็อกยา" ledger card — a boxed field
  // grid for the drug's identity up top (the way the paper card has ชื่อยา/รหัส/หน่วยนับ each
  // in their own ruled cell), then a fully grid-ruled table (vertical AND horizontal rules,
  // not just underlines) with a running-number column, same as the paper. A flat modern list
  // read fine on screen but didn't read as "the same card" once printed — this does.
  const html = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>บัตรสต็อก ${escapeHtml(med.name)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Noto Sans Thai', system-ui, -apple-system, sans-serif; margin: 0; color: #2a1f0a; }
  .card { border: 1.2pt solid #8a6d1a; border-radius: 2mm; overflow: hidden; }
  .band { background: #f5c518; padding: 3mm 5mm; display: flex; justify-content: space-between; align-items: center; border-bottom: 1.2pt solid #8a6d1a; }
  .band .title { font-size: 13pt; font-weight: 800; letter-spacing: .02em; }
  .band .fy { font-size: 9.5pt; font-weight: 700; }
  .fields { display: grid; grid-template-columns: 1fr 1fr; }
  .field { border-bottom: 0.6pt solid #d9c27a; border-right: 0.6pt solid #d9c27a; padding: 2.4mm 5mm; display: flex; gap: 2mm; }
  .field:nth-child(2n) { border-right: 0; }
  .field .lbl { flex: none; font-size: 8.5pt; color: #7a6a30; font-weight: 700; width: 24mm; }
  .field .val { font-size: 10.5pt; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
  th { text-align: center; font-size: 8.5pt; color: #5a4a12; background: #fbf0cc; border: 0.6pt solid #d9c27a; padding: 2mm 2mm; font-weight: 700; }
  th.num, td.num { text-align: right; }
  td { padding: 1.8mm 2.6mm; border: 0.4pt solid #e3d7ab; text-align: left; }
  td.no { text-align: center; color: #9a8b55; width: 9mm; font-size: 9pt; }
  td.date { width: 22mm; }
  .recv { color: #17552f; font-weight: 700; }
  .disp { color: #a32b22; font-weight: 700; }
  .bal { font-weight: 700; }
  .by { font-size: 9pt; color: #7a6a30; }
  .foot { display: flex; justify-content: space-between; font-size: 8.5pt; color: #8a7a45; padding: 2.5mm 5mm; border-top: 0.6pt solid #d9c27a; background: #fbf0cc; }
  @media screen {
    body { background: #eee; padding: 14mm; }
    .sheet { background: #fffdf5; padding: 10mm; margin: 0 auto; max-width: 210mm; box-shadow: 0 2px 14px rgba(0,0,0,.15); }
  }
</style></head>
<body>
  <div class="sheet">
    <div class="card">
      <div class="band"><span class="title">บัตรคุมสต็อกยา (Substock)</span><span class="fy">ปีงบประมาณ ${fy}</span></div>
      <div class="fields">
        <div class="field"><span class="lbl">ชื่อยา</span><span class="val">${escapeHtml(med.name)}</span></div>
        <div class="field"><span class="lbl">รหัสยา</span><span class="val">${escapeHtml(med.code)}</span></div>
        <div class="field"><span class="lbl">หน่วยนับ</span><span class="val">${escapeHtml(med.unit)}</span></div>
        <div class="field"><span class="lbl">par substock</span><span class="val">${med.parSub.toLocaleString('en-US')} ${escapeHtml(med.unit)}</span></div>
      </div>
      <table>
        <thead><tr><th style="width:9mm">ลำดับ</th><th style="width:22mm">วันที่</th><th class="num">รับ</th><th class="num">จ่าย</th><th class="num">คงเหลือ</th><th>โดย</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
      ${rows.length === 0 ? '<div style="text-align:center;color:#8a7a45;padding:12mm 0;">ยานี้ยังไม่มีประวัติ substock</div>' : ''}
      <div class="foot"><span>ห้องยา OPD · รพ.กรงปินัง</span><span>พิมพ์จากระบบ ${escapeHtml(now.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }))}</span></div>
    </div>
  </div>
  <script>window.onload = function () { window.print(); };</script>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}
