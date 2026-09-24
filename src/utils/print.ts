import { qrSvgMarkup } from './qr';
import { fitSingleLineFontSizePx, splitTitleForDisplay } from './labelName';
import { fiscalYear, thDateLong } from './format';
import { HOSPITAL_CREST_DATA_URI } from './crestImage';
import type { DailyMetrics } from '../types';

// The real crest (see HospitalCrest.tsx / crestImage.ts) as a plain <img>, sized to fit an
// sizePx-tall box while keeping its real (non-square) aspect ratio — the source crop is
// wider than tall, and stretching it to a forced square would visibly distort it.
function crestImgMarkup(sizePx: number): string {
  return `<img src="${HOSPITAL_CREST_DATA_URI}" alt="ตรารพ.กรงปินัง" style="height:${sizePx}px;width:auto;display:block;" />`;
}

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
  /** OPD and IPD versions of a drug deliberately share a name (own record, own bin/QR/par —
   * see wardOf/Ward) — printed without this, two labels reading the same name at a glance
   * would be indistinguishable once cut apart from their on-screen context. Shown on both
   * layouts whenever present. */
  ward?: 'opd' | 'ipd';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// Bug fix (readability/consistency): the title used to pick from a handful of discrete font
// sizes by character count (titleSizeStep/TITLE_PT_BY_STEP) and wrap onto up to 2 lines when a
// name ran long. Per what was asked, the strip title must always end in a single line — a
// wrapped second line made some labels visibly taller-reading / less uniform than others next
// to them on the same sheet. Single line means roughly half the width budget a 2-line wrap had,
// so the same discrete steps would either overflow or need a much more conservative (guessed)
// recalibration. Measuring the actual title with a real canvas (fitSingleLineFontSizePx) and
// scaling it to exactly fill the strip's real available width is correct for any name instead
// of a guess — see that function's doc comment. `.strip .title`'s CSS below still carries
// `text-overflow: ellipsis` as a hard backstop so an extreme outlier (past MIN_TITLE_PT, where
// shrinking further would be unreadable rather than useful) still visibly ends in one line
// instead of overflowing the box, it just loses its tail.
// Real-world request: printed shelf labels read a bit small, wanted "ขนาดใหญ่กว่านี้อีกนิด" —
// nudged from 19pt to 21pt. Titles are already auto-fit to the strip's real available width
// (fitSingleLineFontSizePx), so this only raises the ceiling for names short enough to hit it;
// anything longer still scales down from there same as before.
const MAX_TITLE_PT = 21;
const MIN_TITLE_PT = 7;
const PT_TO_PX = 96 / 72; // same CSS reference-px basis this stylesheet's mm/pt units resolve to
const MM_TO_PX = 96 / 25.4;
// .strip is 100mm wide: .bin (12mm + 0.3mm border) + .qrwrap (15mm QR + 1.7mm/0.9mm L/R
// margin = 17.6mm) + .meta's own L/R padding (2.8mm × 2) + its left border (0.25mm) all eat
// into it before any text — see the .strip/.bin/.qrwrap/.meta rules below. What's left for the
// title text itself: 100 − 12.3 − 17.6 − 5.6 − 0.25 = 64.25mm (unchanged from before .bin grew
// 0.5mm — that 0.5mm came out of .qrwrap's own margin, not the title's share). Recompute this
// if any of those widths change.
const STRIP_TITLE_MAX_WIDTH_PX = 64.25 * MM_TO_PX;
function titleFontSizePt(title: string): number {
  const fittedPx = fitSingleLineFontSizePx(
    title,
    STRIP_TITLE_MAX_WIDTH_PX,
    MAX_TITLE_PT * PT_TO_PX,
    MIN_TITLE_PT * PT_TO_PX,
  );
  return fittedPx / PT_TO_PX;
}

// Bug fix: the bin/shelf code (e.g. "J4") sat at a fixed 12.5pt regardless of length — fine for
// the usual 2-3 char codes, but a longer sub-shelf code (e.g. this hospital's HAD sub-bins like
// "HAD1-1") wrapped onto a second line at that fixed size and visibly overflowed the yellow bin
// tag's fixed-width box (see .strip .bin below). Same fix as the title above: measure and fit
// to the box's real width instead of assuming every code is short.
const MAX_BINCODE_PT = 12.5;
// Lower floor than the title's — the shelf code is a supporting field, not the primary read,
// and 6pt bold on the solid yellow tag still reads clearly at arm's length (about the same
// scale as the 5–5.5pt ward badge/med code text already on this label).
const MIN_BINCODE_PT = 6;
// .strip .bin is 12mm wide with 1mm padding on every side and a 0.3mm right border (all inside
// its box-sizing: border-box width) — content width left for the code text itself:
// 12 − 1×2 − 0.3 = 9.7mm. Recompute this if .strip .bin's width/padding/border changes.
const STRIP_BINCODE_MAX_WIDTH_PX = 9.7 * MM_TO_PX;
function bincodeFontSizePt(bin: string): number {
  const fittedPx = fitSingleLineFontSizePx(
    bin,
    STRIP_BINCODE_MAX_WIDTH_PX,
    MAX_BINCODE_PT * PT_TO_PX,
    MIN_BINCODE_PT * PT_TO_PX,
  );
  return fittedPx / PT_TO_PX;
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

  // Same OPD/green · IPD/purple convention used everywhere in the app (on-screen WardBadge,
  // HomeScreen, TransferScreen, etc.) — printed here as literal ink colors since paper
  // doesn't have a theme.
  const wardBadge = (w: PrintLabel['ward']) => w
    ? `<span class="wardtag" style="background:${w === 'ipd' ? '#e9e6fb' : '#e1efe5'};color:${w === 'ipd' ? '#4a3fb5' : '#0e3a20'}">${w === 'ipd' ? 'IPD' : 'OPD'}</span>`
    : '';
  // The shelf-strip's bin tag sits on a solid yellow background (see .strip .bin) — the
  // regular wardtag's pastel fill (built for a plain white card background) would wash out
  // against that yellow, so this variant gets an opaque white pill instead for real contrast.
  const stripWardBadge = (w: PrintLabel['ward']) => w
    ? `<span class="wardtag" style="background:#fff;color:${w === 'ipd' ? '#4a3fb5' : '#0e3a20'}">${w === 'ipd' ? 'IPD' : 'OPD'}</span>`
    : '';

  const items = labels
    .map((l) => {
      if (isStrip) {
        // Bug fix (readability): the med code (MED-xxxx) and OPD/IPD badge used to sit on
        // their own row next to the title — real info, but not what anyone actually reads at
        // a glance while shelving (the code exists for scanning a damaged label back in by
        // hand; the ward just needs to be visible, not prominent). Moved the code under the
        // QR (small — it's a fallback, not a primary read) and the ward badge onto the bin
        // tag itself (right next to the shelf code it's clarifying), freeing that whole row
        // for the title to use instead — see titleFontSizePt()'s doc comment above.
        return `<div class="strip">
          <div class="bin">
            <div class="bincode" style="font-size:${bincodeFontSizePt(l.bin || '')}pt">${escapeHtml(l.bin || '')}</div>
            ${stripWardBadge(l.ward)}
          </div>
          <div class="qrwrap">
            <div class="qr">${qrSvgMarkup(l.payload, qrPx)}</div>
            <div class="medcode">${escapeHtml(l.id)}</div>
          </div>
          <div class="meta">
            ${(() => {
              // Bug fix (safety): split into a shrinkable/ellipsis-able name span and a dose
              // span that's never allowed to truncate — see splitTitleForDisplay()'s doc
              // comment for why (a name too dense to fit even at the smallest font used to
              // ellipsis-truncate from the end, and the dose is always what's there).
              const { name, dose } = splitTitleForDisplay(l.title);
              const doseHtml = dose ? `<span class="tdose">${escapeHtml(dose)}</span>` : '';
              return `<div class="title" style="font-size:${titleFontSizePt(l.title)}pt"><span class="tname">${escapeHtml(name)}</span>${doseHtml}</div>`;
            })()}
            ${l.tag ? `<div class="tag">${escapeHtml(l.tag)}</div>` : ''}
          </div>
        </div>`;
      }
      return `<div class="lbl">
        <div class="qr">${qrSvgMarkup(l.payload, qrPx)}</div>
        <div class="meta">
          <div class="code">${escapeHtml(l.id)}${wardBadge(l.ward)}</div>
          <div class="title">${escapeHtml(l.title)}</div>
          <div class="sub">${escapeHtml(l.sub)}</div>
          ${l.tag ? `<div class="tag">${escapeHtml(l.tag)}</div>` : ''}
        </div>
      </div>`;
    })
    .join('');

  const html = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(heading)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: ${isStrip ? '8.5mm 5mm' : '10mm'}; }
  * { box-sizing: border-box; }
  /* Bug fix: this sheet listed 'Noto Sans Thai' as its primary font but — unlike every other
     print sheet in this file (pick list, executive summary, substock card, KPI report), all of
     which load it from Google Fonts — never actually loaded it from anywhere, so it silently
     fell through to whatever generic system-ui/sans-serif font happens to be installed on the
     printing device: inconsistent with the rest of the app's deliberately-chosen official
     typeface, and on some setups noticeably worse Thai glyph rendering at the small sizes this
     sheet uses. Sarabun (the closest freely-loadable match to TH Sarabun New, the Thai
     government's 2015-mandated official-document typeface — see printPickListSheet's own doc
     comment) is now loaded the same way as every other sheet, with 'Noto Sans Thai'/system-ui
     kept as the fallback if a label gets printed before the web font finishes loading. */
  body { font-family: 'Sarabun', 'Noto Sans Thai', system-ui, -apple-system, sans-serif; margin: 0; }
  .sheet {
    display: grid;
    ${isStrip
      ? 'grid-template-columns: repeat(2, 100mm); grid-auto-rows: 20mm; gap: 0; justify-content: center;'
      : 'grid-template-columns: repeat(4, 1fr); gap: 3mm;'}
  }

  .lbl { border: 1px solid #999; border-radius: 2mm; padding: 2.5mm; display: flex; gap: 2mm; align-items: center; break-inside: avoid; }
  .lbl .qr { flex: none; width: 16mm; height: 16mm; }
  .lbl .meta { min-width: 0; }
  .code { font-size: 6.5pt; letter-spacing: .05em; color: #666; font-weight: 600; display: flex; align-items: center; gap: 1.2mm; }
  .sub { font-size: 6.5pt; color: #666; margin-top: .5mm; }
  .wardtag { font-size: 5.5pt; font-weight: 800; padding: .3mm 1.4mm; border-radius: 3mm; letter-spacing: .03em; }

  /* Real physical size: 100mm × 20mm, exactly — 2 cols × 14 rows fills an A4 page (28
     labels), so every sheet prints the same known size regardless of how many meds are
     in the run (the last page just has empty grid cells). */
  .strip { width: 100mm; height: 20mm; display: flex; align-items: stretch; border: 0.3mm solid #999; border-radius: 1mm; overflow: hidden; break-inside: avoid; }
  /* Bug fix (readability): bin now stacks the shelf code over its OPD/IPD badge (was a single
     centered line; the badge used to live on the title row instead — see the strip markup
     comment above) so it reads as "shelf J9, IPD side" in one glance without stealing room
     from the name. */
  /* Bug fix: bin code box widened 11.5mm → 12mm (the 0.5mm taken from .qrwrap's right margin
     below, so the strip's total width and the title's available width are unaffected — see
     STRIP_BINCODE_MAX_WIDTH_PX/STRIP_TITLE_MAX_WIDTH_PX derivations above) — a bin code longer
     than the usual 2-3 chars (e.g. a HAD sub-shelf code like "HAD1-1") needs the extra room to
     stay legible at bincodeFontSizePt()'s floor instead of ellipsis-truncating. */
  .strip .bin { flex: none; width: 12mm; background: #f5c518; color: #1a1a1a; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .8mm; text-align: center; padding: 1mm; border-right: 0.3mm solid #d9ac00; }
  .strip .bin .bincode { font-weight: 800; line-height: 1.05; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .strip .bin .wardtag { font-size: 5pt; padding: .25mm 1.1mm; }
  /* QR trimmed from the old 16.6mm down to 15mm — still comfortably scannable at arm's length
     (well above what a modern phone camera needs even in ordinary shelf lighting) — to make
     real room for the med code line underneath it, which used to sit on the title row instead.
     Right margin trimmed 1.4mm → 0.9mm to give .strip .bin the extra 0.5mm above. */
  .strip .qrwrap { flex: none; display: flex; flex-direction: column; align-items: center; justify-content: center; margin: 1mm 0.9mm 1mm 1.7mm; }
  .strip .qrwrap .qr { width: 15mm; height: 15mm; }
  .strip .medcode { font-size: 5.5pt; color: #666; font-weight: 600; letter-spacing: .03em; margin-top: .6mm; }
  .strip .meta { flex: 1; min-width: 0; padding: 0 2.8mm; display: flex; flex-direction: column; justify-content: center; overflow: hidden; border-left: 0.25mm solid #e5e5e0; }

  .qr svg { width: 100%; height: 100%; }
  .title { font-size: 8pt; font-weight: 700; line-height: 1.2; margin-top: .5mm; }
  /* Drug name + strength is the thing staff actually read at a glance while shelving (name is
     pre-shortened to "generic + strength", packaging detail like "Vial"/"(2 mL.)" trimmed off
     — see shortLabelName()), sized as large as that comfortably fits.
     Bug fix (consistency): must always end in one line — see titleFontSizePt()'s doc comment
     above for why this is now a real canvas-measured fit instead of a step guess, and why a
     wrapped second line (the previous design) is gone.
     Bug fix (safety): a flex row of two spans, not one plain ellipsis-able block — a name too
     dense to fit even at MIN_TITLE_PT needs an ellipsis SOMEWHERE, but it must never be able to
     eat the dose (see splitTitleForDisplay()'s doc comment: this used to print something like
     "150 iu./m…" with the unit cut off). .tname is the only part allowed to shrink/truncate;
     .tdose is a flex-none sibling after it, always rendered in full. */
  /* Real-world request: printed labels read the name+dose as one undifferentiated run of text
     ("Manidipine 20 mg" all one color/weight) — hard to tell at a glance where the drug name
     ends and its strength begins. justify-content: center (new) centers the name+dose group as
     a unit within the row instead of pinning it to the left edge — .tname's flex-grow dropped
     from 1 to 0 so it stops force-filling the row's leftover width, which is what let it sit
     flush left before; flex-shrink stays on (still the one span allowed to ellipsis, per the
     safety fix below), and the row itself is still full-width via .meta's column-stretch, so the
     ellipsis-triggering width constraint is unchanged for a name too dense to fit. */
  .strip .title {
    font-size: 17pt; font-weight: 800; margin-top: 0; line-height: 1.15; color: #14231a;
    display: flex; align-items: baseline; justify-content: center; min-width: 0;
  }
  .strip .title .tname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 0 1 auto; }
  /* Dose now gets its own bold teal (matches this file's existing #245a59 accent — see
     .metabox .k) instead of the name's near-black, so the two read as two distinct label
     components ("what" vs "how much") instead of one continuous phrase. margin-left widened
     .35mm -> .8mm for a clearer gap — kept modest (not a bordered divider box) since this extra
     chrome isn't counted by fitSingleLineFontSizePx's width measurement (it only measures the
     text itself): titleFontSizePt()'s 97%-of-box fit already leaves ~1.9mm of slack for exactly
     this kind of unaccounted decoration, and .8mm safely fits inside that with real margin to
     spare, where a bordered box would have eaten most of it. */
  .strip .title .tdose { flex: none; white-space: nowrap; margin-left: .8mm; color: #245a59; }
  .tag { font-size: 6pt; font-weight: 700; color: #b3261e; margin-top: .5mm; }
  /* Bumped from 8.5pt now that the row it used to share the strip with (med code + ward badge)
     is gone — a HIGH ALERT drug is exactly the case where this line needs to read as loudly
     as the name itself, not smaller than it. Centered to match the now-centered title above it. */
  .strip .tag { font-size: 11pt; margin-top: .8mm; letter-spacing: .02em; text-align: center; }

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
  // Optional flag line under the drug name — e.g. when the printed qty had to be capped by
  // what substock actually has on hand, so it won't fully bring the shelf up to par even
  // after every row on this sheet is picked. Absent for every existing caller (unset renders
  // nothing extra), so this is additive, not a breaking change to the pick-list layout.
  note?: string;
}

/**
 * The "Auto Pick-List" for the morning shelf-fill routine — a sorted-by-shelf-position A4
 * sheet someone can carry while walking the substock room, instead of trying to remember (or
 * re-derive on a phone screen) what the app's suggested-fill cart said. Deliberately not a
 * QR/label sheet — this is a checklist to work from and cross off, not something that gets cut
 * up and stuck anywhere.
 *
 * Styled as a formal document (letterhead with the hospital crest, TH Sarabun — the Thai
 * government-mandated official-document typeface, per the 2015 cabinet resolution on font
 * standardization — a full spelled-out date, and a signature block) rather than a plain
 * checklist, so the same sheet also works as the paper record of what left/entered stock —
 * ต้องใช้เป็นเอกสารทางราชการได้ (สำหรับใช้อ้างอิง/แนบสำนวนได้ ไม่ใช่แค่กระดาษกากบาทระหว่างเดิน).
 */
export function printPickListSheet(
  rows: PickListRow[],
  heading: string,
  subheading: string,
  colLabels: { bin: string; qty: string } = { bin: 'ชั้น', qty: 'จำนวนที่ต้องหยิบ' },
  meta: { printedBy?: string } = {},
): boolean {
  const sorted = rows.slice().sort((a, b) => a.bin.localeCompare(b.bin));
  const now = Date.now();
  const body = sorted
    .map((r, i) => `<tr>
      <td class="n">${i + 1}</td>
      <td class="bin">${escapeHtml(r.bin || '—')}</td>
      <td class="name">${escapeHtml(r.name)}${r.note ? `<div class="note">หมายเหตุ: ${escapeHtml(r.note)}</div>` : ''}</td>
      <td class="qty">${r.qty.toLocaleString('en-US')} ${escapeHtml(r.unit)}</td>
      <td class="check">☐</td>
    </tr>`)
    .join('');

  const html = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(heading)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  /* Sarabun is the closest freely-loadable match to TH Sarabun New — the typeface the 2015
     cabinet resolution set as the standard for official Thai government documents — with
     'Noto Sans Thai'/system sans as a fallback if the page prints before the web font loads. */
  body { font-family: 'Sarabun', 'Noto Sans Thai', system-ui, -apple-system, sans-serif; margin: 0; color: #14211a; font-size: 11.5pt; }

  .letterhead { display: flex; align-items: center; gap: 4mm; padding-bottom: 3mm; border-bottom: 1pt solid #14211a; }
  .letterhead .crest { flex: none; display: flex; align-items: center; }
  .letterhead .org .h1 { font-size: 14.5pt; font-weight: 700; line-height: 1.3; }
  .letterhead .org .h2 { font-size: 10.5pt; color: #444; line-height: 1.3; }

  .doctitle { text-align: center; font-size: 16.5pt; font-weight: 700; margin: 5mm 0 1mm; letter-spacing: .01em; }
  .docsub { text-align: center; font-size: 10.5pt; color: #555; margin-bottom: 4mm; }

  .metabox { width: 100%; border-collapse: collapse; font-size: 10.5pt; margin-bottom: 5mm; }
  .metabox td { border: 0.6pt solid #b8c4bd; padding: 1.8mm 3mm; }
  .metabox .k { background: #eef6f6; font-weight: 700; color: #245a59; width: 24mm; white-space: nowrap; }
  .metabox .v { width: 63mm; }

  table.rows { width: 100%; border-collapse: collapse; font-size: 11pt; }
  table.rows th { text-align: left; font-size: 9.5pt; font-weight: 700; color: #14211a; background: #eef6f6; border: 0.6pt solid #9fb8b8; padding: 2.2mm 3mm; }
  table.rows td { padding: 2.4mm 3mm; border: 0.5pt solid #cdd6d1; }
  table.rows tbody tr:nth-child(even) { background: #f8faf9; }
  .n { width: 8mm; color: #667; text-align: center; }
  .bin { width: 24mm; font-weight: 700; white-space: nowrap; }
  .qty { width: 34mm; font-weight: 700; text-align: right; }
  .check { width: 12mm; text-align: center; font-size: 13pt; }
  .note { font-size: 8.5pt; color: #a15c00; font-weight: 600; margin-top: 0.5mm; }

  .signoff { display: flex; justify-content: space-between; gap: 8mm; margin-top: 14mm; break-inside: avoid; }
  .signoff .sig { flex: 1; text-align: center; font-size: 10pt; }
  .signoff .sig .line { border-bottom: 0.6pt solid #14211a; height: 11mm; }
  .signoff .sig .lbl { margin-top: 2mm; font-weight: 700; }
  .signoff .sig .date { margin-top: 5mm; color: #555; }

  @media screen {
    body { background: #eee; padding: 14mm; }
    .sheet { background: #fff; padding: 14mm 12mm; margin: 0 auto; max-width: 210mm; box-shadow: 0 0 0 1px #ddd; }
  }
</style></head>
<body>
  <div class="sheet">
    <div class="letterhead">
      <div class="crest">${crestImgMarkup(56)}</div>
      <div class="org">
        <div class="h1">โรงพยาบาลกรงปินัง</div>
        <div class="h2">ห้องยา ฝ่ายเภสัชกรรม</div>
      </div>
    </div>
    <div class="doctitle">${escapeHtml(heading)}</div>
    <div class="docsub">${escapeHtml(subheading)}</div>
    <table class="metabox">
      <tr><td class="k">วันที่</td><td class="v">${escapeHtml(thDateLong(now))}</td><td class="k">จำนวนรายการ</td><td class="v">${sorted.length} รายการ</td></tr>
      <tr><td class="k">ผู้จัดทำรายการ</td><td class="v">${escapeHtml(meta.printedBy || '—')}</td><td class="k">วันที่จัดพิมพ์เอกสาร</td><td class="v">${escapeHtml(new Date(now).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }))}</td></tr>
    </table>
    <table class="rows">
      <thead><tr><th class="n">ลำดับ</th><th class="bin">${escapeHtml(colLabels.bin)}</th><th class="name">รายการยา</th><th class="qty">${escapeHtml(colLabels.qty)}</th><th class="check">✓</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    <div class="signoff">
      <div class="sig"><div class="line"></div><div class="lbl">ผู้จัดทำรายการ</div><div class="date">วันที่ ____ /____ /______</div></div>
      <div class="sig"><div class="line"></div><div class="lbl">ผู้ตรวจสอบ / ผู้รับของ</div><div class="date">วันที่ ____ /____ /______</div></div>
      <div class="sig"><div class="line"></div><div class="lbl">ผู้อนุมัติ</div><div class="date">วันที่ ____ /____ /______</div></div>
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
export function printSubstockCardSheet(
  // parLabel/heading let a noSubstock med (injectables/liquids — see usesSubstock() in
  // selectors.ts) print the SAME sheet shape against its floor par instead of substock par,
  // for a drug whose floor plays substock's role (see fetchFloorLedger in AppContext.tsx) —
  // both default to the original substock wording so every existing call site is unaffected.
  med: { code: string; name: string; parSub: number; unit: string; ward?: 'opd' | 'ipd'; parLabel?: string; heading?: string },
  rows: SubstockCardRow[],
  fyLabel?: number | 'all',
  // Real-world request: this used to be a flat row-by-row table with nothing to tie the
  // numbers together — no running total, no starting point, and no way to check the printed
  // history against the actual shelf without opening the app. `totals` mirrors the on-screen
  // summary tiles, `openingBalance` (received − dispensed subtracted back out of the first
  // row) gives the ledger a starting point the way a real ยอดยกมา line does, and `liveBalance`
  // — when it disagrees with the ledger's own last balance — lets the sheet say so itself
  // instead of only the on-screen mismatch banner knowing.
  meta: { totals?: { received: number; dispensed: number }; openingBalance?: number; liveBalance?: number } = {},
): boolean {
  const now = new Date();
  // Defaults to today's fiscal year (the original single-year behavior), but the substock
  // card screen now lets someone view/print a past year or "ทุกปี" pooled together — the
  // printed band has to say which one, or a sheet for last year's history would misleadingly
  // print with this year's fiscal-year number on it.
  const fy = fyLabel === undefined ? String(fiscalYear(now.getTime()) % 100)
    : fyLabel === 'all' ? 'ทั้งหมด'
    : String(fyLabel % 100);
  // Bug fix (real-world request): a running balance can go negative when the ledger's history
  // doesn't cover every unit ever on the shelf (e.g. opening stock from before this app tracked
  // substock) — SubstockCardScreen already flags that on screen (the "ยอดจากประวัติธุรกรรม...
  // ไม่ตรงกับยอดจริง" banner), but the printed sheet used to show the same negative number with
  // nothing explaining it. Someone reading only the paper (not the screen) had no way to know
  // it wasn't an app bug. Flag each negative row in red-on-tint and add a footnote once, rather
  // than repeating the explanation on every row.
  const hasNegative = rows.some((r) => r.balance < 0);
  // ยอดยกมา — a real paper stock card always opens with a starting balance before its first
  // ruled entry; this table used to jump straight into "balance AFTER the first transaction"
  // with no way to tell where it started from. Rendered as its own muted, non-numbered row
  // (not row #1) so it reads as context, not as an actual transaction that happened.
  const openingRow = meta.openingBalance !== undefined ? `<tr style="background:#f3f6f4">
      <td class="no">—</td>
      <td class="date" style="font-style:italic;color:#245a59">ยอดยกมา</td>
      <td class="num"></td>
      <td class="num"></td>
      <td class="num bal">${meta.openingBalance.toLocaleString('en-US')}</td>
      <td class="by"></td>
    </tr>` : '';
  const body = openingRow + rows
    .map((r, i) => `<tr${r.balance < 0 ? ' style="background:#fbeceb"' : ''}>
      <td class="no">${i + 1}</td>
      <td class="date">${escapeHtml(new Date(r.ts).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' }))}</td>
      <td class="num recv">${r.received ? r.received.toLocaleString('en-US') : ''}</td>
      <td class="num disp">${r.dispensed ? r.dispensed.toLocaleString('en-US') : ''}</td>
      <td class="num bal" style="${r.balance < 0 ? 'color:#a32b22' : ''}">${r.balance.toLocaleString('en-US')}${r.balance < 0 ? ' *' : ''}</td>
      <td class="by">${escapeHtml(r.by)}</td>
    </tr>`)
    .join('');

  // Styled after the real hand-written yellow "บัตรคุมสต็อกยา" ledger card — a boxed field
  // grid for the drug's identity up top (the way the paper card has ชื่อยา/รหัส/หน่วยนับ each
  // in their own ruled cell), then a fully grid-ruled table (vertical AND horizontal rules,
  // not just underlines) with a running-number column, same as the paper. A flat modern list
  // read fine on screen but didn't read as "the same card" once printed — this does.
  //
  // Bug fix (real-world request): this used to be its own generic gold/amber "old paper card"
  // palette with no letterhead at all — every OTHER printed sheet in the app (printPickListSheet
  // below) already carries the real hospital crest + official TH Sarabun New font + the
  // hospital's own teal brand color, and this one didn't match any of that. A pharmacist
  // printing this to file or hand to someone outside the department had no way to tell at a
  // glance which hospital it came from. Brought in line: same letterhead block, same font, and
  // the band recolored from generic gold to the hospital's own teal (--green/--green-dark),
  // with the coral brand accent as a thin rule under it instead of introducing a third color.
  const html = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>บัตรสต็อก ${escapeHtml(med.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Sarabun', 'Noto Sans Thai', system-ui, -apple-system, sans-serif; margin: 0; color: #14211a; }

  .letterhead { display: flex; align-items: center; gap: 4mm; padding-bottom: 3mm; margin-bottom: 5mm; border-bottom: 1pt solid #14211a; }
  .letterhead .org .h1 { font-size: 14.5pt; font-weight: 700; line-height: 1.3; }
  .letterhead .org .h2 { font-size: 10.5pt; color: #444; line-height: 1.3; }

  .card { border: 1.2pt solid #004c4b; border-radius: 2mm; overflow: hidden; }
  .band { background: linear-gradient(135deg, #007371, #004c4b); color: #fff; padding: 3mm 5mm; display: flex; justify-content: space-between; align-items: center; border-bottom: 1.4pt solid #f7a68b; }
  .band .title { font-size: 13pt; font-weight: 800; letter-spacing: .02em; }
  .band .fy { font-size: 9.5pt; font-weight: 700; background: rgba(255,255,255,.18); padding: 1mm 2.6mm; border-radius: 8pt; }
  .fields { display: grid; grid-template-columns: 1fr 1fr; }
  .field { border-bottom: 0.6pt solid #cfe3e3; border-right: 0.6pt solid #cfe3e3; padding: 2.4mm 5mm; display: flex; gap: 2mm; background: #eef6f6; }
  .field:nth-child(2n) { border-right: 0; }
  .field .lbl { flex: none; font-size: 8.5pt; color: #245a59; font-weight: 700; width: 24mm; }
  .field .val { font-size: 10.5pt; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
  th { text-align: center; font-size: 8.5pt; color: #14211a; background: #eef6f6; border: 0.6pt solid #9fb8b8; padding: 2mm 2mm; font-weight: 700; }
  th.num, td.num { text-align: right; }
  td { padding: 1.8mm 2.6mm; border: 0.4pt solid #cdd6d1; text-align: left; }
  td.no { text-align: center; color: #667; width: 9mm; font-size: 9pt; }
  td.date { width: 22mm; }
  .recv { color: #175554; font-weight: 700; }
  .disp { color: #a32b22; font-weight: 700; }
  .bal { font-weight: 700; }
  .by { font-size: 9pt; color: #667; }
  /* Period summary — mirrors the on-screen SummaryTile cards (รับเข้ารวม/เติมหน้างานรวม) that
     used to only exist on screen; without them the printed sheet made someone re-derive the
     same totals by hand-adding every row in the table. */
  .totals { display: flex; border-top: 0.6pt solid #cfe3e3; }
  .totals .t { flex: 1; padding: 2.4mm 5mm; border-right: 0.6pt solid #cfe3e3; }
  .totals .t:last-child { border-right: 0; }
  .totals .k { display: block; font-size: 8pt; color: #245a59; font-weight: 700; }
  .totals .v { display: block; font-size: 12pt; font-weight: 800; margin-top: 0.5mm; }
  .totals .v.recv { color: #175554; }
  .totals .v.disp { color: #a32b22; }
  /* Ledger-vs-shelf tie-out — puts "what the paper trail says" next to "what's really on the
     shelf right now" side by side, so a mismatch (see the ยอดจากประวัติ... banner on screen) is
     visible on the printed page itself, not only discoverable by opening the app. .off tints
     it amber the same way the on-screen mismatch banner does. */
  .tieout { display: flex; border-top: 0.6pt solid #cfe3e3; background: #fbf6ea; }
  .tieout.off { background: #fdf3e2; }
  .tieout .t { flex: 1; padding: 2.4mm 5mm; border-right: 0.6pt solid #f0dfbc; }
  .tieout .t:last-child { border-right: 0; }
  .tieout .k { display: block; font-size: 8pt; color: #8a5407; font-weight: 700; }
  .tieout .v { display: block; font-size: 12pt; font-weight: 800; margin-top: 0.5mm; }
  .note { font-size: 8pt; color: #a32b22; line-height: 1.5; padding: 2mm 5mm; background: #fbeceb; border-top: 0.6pt solid #cfe3e3; }
  .foot { display: flex; justify-content: space-between; font-size: 8.5pt; color: #245a59; padding: 2.5mm 5mm; border-top: 0.6pt solid #cfe3e3; background: #eef6f6; }
  @media screen {
    body { background: #eee; padding: 14mm; }
    .sheet { background: #fff; padding: 10mm; margin: 0 auto; max-width: 210mm; box-shadow: 0 2px 14px rgba(0,0,0,.15); }
  }
</style></head>
<body>
  <div class="sheet">
    <div class="letterhead">
      <div class="crest">${crestImgMarkup(52)}</div>
      <div class="org">
        <div class="h1">โรงพยาบาลกรงปินัง</div>
        <div class="h2">ห้องยา ฝ่ายเภสัชกรรม</div>
      </div>
    </div>
    <div class="card">
      <div class="band"><span class="title">${escapeHtml(med.heading || 'บัตรคุมสต็อกยา (Substock)')}</span><span class="fy">ปีงบประมาณ ${fy}</span></div>
      <div class="fields">
        <div class="field"><span class="lbl">ชื่อยา</span><span class="val">${escapeHtml(med.name)}</span></div>
        <div class="field"><span class="lbl">รหัสยา</span><span class="val">${escapeHtml(med.code)}</span></div>
        <div class="field"><span class="lbl">หน่วยนับ</span><span class="val">${escapeHtml(med.unit)}</span></div>
        <div class="field"><span class="lbl">${escapeHtml(med.parLabel || 'par substock')}</span><span class="val">${med.parSub.toLocaleString('en-US')} ${escapeHtml(med.unit)}</span></div>
      </div>
      <table>
        <thead><tr><th style="width:9mm">ลำดับ</th><th style="width:22mm">วันที่</th><th class="num">รับ</th><th class="num">จ่าย</th><th class="num">คงเหลือ</th><th>ผู้บันทึก</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
      ${rows.length === 0 ? '<div style="text-align:center;color:#245a59;padding:12mm 0;">รายการยานี้ยังไม่มีประวัติการเคลื่อนไหวในระบบสำรองคลังย่อย (Substock)</div>' : ''}
      ${meta.totals ? `<div class="totals">
        <div class="t"><span class="k">รับเข้ารวม</span><span class="v recv">${meta.totals.received.toLocaleString('en-US')} ${escapeHtml(med.unit)}</span></div>
        <div class="t"><span class="k">เติมหน้างานรวม</span><span class="v disp">${meta.totals.dispensed.toLocaleString('en-US')} ${escapeHtml(med.unit)}</span></div>
      </div>` : ''}
      ${meta.liveBalance !== undefined ? (() => {
        const lastBal = rows.length ? rows[rows.length - 1].balance : (meta.openingBalance ?? 0);
        const tie = lastBal === meta.liveBalance;
        return `<div class="tieout${tie ? '' : ' off'}">
          <div class="t"><span class="k">ยอดคงเหลือตามประวัติ (รายการล่าสุด)</span><span class="v">${lastBal.toLocaleString('en-US')} ${escapeHtml(med.unit)}</span></div>
          <div class="t"><span class="k">ยอดคงเหลือจริงในปัจจุบัน (เรียลไทม์)</span><span class="v">${meta.liveBalance.toLocaleString('en-US')} ${escapeHtml(med.unit)}</span></div>
        </div>${!tie ? '<div class="note">หมายเหตุ: ยอดคงเหลือทั้งสองรายการข้างต้นไม่สอดคล้องกัน โปรดตรวจสอบรายละเอียดเพิ่มเติมในระบบบันทึกการตรวจสอบ (Audit Log)</div>' : ''}`;
      })() : ''}
      ${hasNegative ? '<div class="note">หมายเหตุ: ยอดคงเหลือในรายการนี้คำนวณจากประวัติการทำธุรกรรมภายในระบบเท่านั้น ปรากฏเป็นจำนวนติดลบเนื่องจากมีสต็อกยกยอดเริ่มต้นหรือรายการก่อนการบันทึกข้อมูลในระบบซึ่งไม่ปรากฏในประวัตินี้ มิใช่ยอดคงเหลือที่แท้จริงบนชั้นวาง โปรดตรวจสอบยอดคงเหลือที่แท้จริงผ่านหน้าจอ "บัตรสต็อก substock" เท่านั้น</div>' : ''}
      <div class="foot"><span>ห้องยา ${med.ward === 'ipd' ? 'IPD' : 'OPD'} · รพ.กรงปินัง</span><span>จัดพิมพ์จากระบบเมื่อวันที่ ${escapeHtml(now.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }))}</span></div>
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

export interface ExecSummaryStat { label: string; value: string; note?: string; tone?: 'red' | 'amber' | 'green' | 'ink' }
export interface ExecSummaryRow { name: string; unit: string; a: string; b: string }

/**
 * Real-world request: "Dashboard สรุปภาพรวมสำหรับผู้บริหาร/หัวหน้าเภสัชกรรม" — a one-page
 * printable summary meant for a PTC (Pharmacy and Therapeutics Committee) meeting or a
 * pharmacy-head's desk, not for someone operating the app day to day. Headline numbers first
 * (the things a committee agenda actually opens with), then the two "what to look at" lists —
 * highest-value holdings and fastest movers — a reader can scan in under a minute instead of
 * having to open the app and piece the same picture together from four separate report tabs.
 */
export function printExecutiveSummarySheet(
  stats: ExecSummaryStat[],
  topValue: ExecSummaryRow[],
  topUsage: ExecSummaryRow[],
  meta: { printedBy?: string; periodLabel: string } = { periodLabel: '' },
): boolean {
  const now = Date.now();
  const toneColor = (t?: string) => t === 'red' ? '#b3261e' : t === 'amber' ? '#a15c00' : t === 'green' ? '#175554' : '#14211a';
  const statCards = stats
    .map((s) => `<div class="stat">
      <div class="v" style="color:${toneColor(s.tone)}">${escapeHtml(s.value)}</div>
      <div class="l">${escapeHtml(s.label)}</div>
      ${s.note ? `<div class="n">${escapeHtml(s.note)}</div>` : ''}
    </div>`)
    .join('');
  const rowsHtml = (rows: ExecSummaryRow[], aLabel: string, bLabel: string) => `<table class="rows">
    <thead><tr><th class="n">#</th><th class="name">รายการยา</th><th class="a">${escapeHtml(aLabel)}</th><th class="b">${escapeHtml(bLabel)}</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr>
      <td class="n">${i + 1}</td>
      <td class="name">${escapeHtml(r.name)}</td>
      <td class="a">${escapeHtml(r.a)}</td>
      <td class="b">${escapeHtml(r.b)} ${escapeHtml(r.unit)}</td>
    </tr>`).join('')}</tbody>
  </table>`;

  const html = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>ภาพรวมสำหรับผู้บริหาร</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Sarabun', 'Noto Sans Thai', system-ui, -apple-system, sans-serif; margin: 0; color: #14211a; font-size: 11.5pt; }

  .letterhead { display: flex; align-items: center; gap: 4mm; padding-bottom: 3mm; border-bottom: 1pt solid #14211a; }
  .letterhead .crest { flex: none; display: flex; align-items: center; }
  .letterhead .org .h1 { font-size: 14.5pt; font-weight: 700; line-height: 1.3; }
  .letterhead .org .h2 { font-size: 10.5pt; color: #444; line-height: 1.3; }

  .doctitle { text-align: center; font-size: 16.5pt; font-weight: 700; margin: 5mm 0 1mm; letter-spacing: .01em; }
  .docsub { text-align: center; font-size: 10.5pt; color: #555; margin-bottom: 5mm; }

  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin-bottom: 6mm; }
  .stat { border: 0.6pt solid #b8c4bd; border-radius: 2mm; padding: 3mm 3mm 2.5mm; background: #f8faf9; }
  .stat .v { font-size: 15pt; font-weight: 700; line-height: 1.15; }
  .stat .l { font-size: 8.8pt; color: #444; margin-top: 1mm; line-height: 1.35; }
  .stat .n { font-size: 8pt; color: #667; margin-top: 0.5mm; }

  .sectitle { font-size: 12pt; font-weight: 700; margin: 6mm 0 2.5mm; padding-top: 4mm; border-top: 0.6pt solid #cdd6d1; }
  .sectitle:first-of-type { border-top: none; padding-top: 0; }

  table.rows { width: 100%; border-collapse: collapse; font-size: 10pt; break-inside: avoid; }
  table.rows th { text-align: left; font-size: 9pt; font-weight: 700; color: #14211a; background: #eef6f6; border: 0.6pt solid #9fb8b8; padding: 1.8mm 2.6mm; }
  table.rows td { padding: 2mm 2.6mm; border: 0.5pt solid #cdd6d1; }
  table.rows tbody tr:nth-child(even) { background: #f8faf9; }
  table.rows .n { width: 7mm; color: #667; text-align: center; }
  table.rows .a, table.rows .b { width: 30mm; text-align: right; font-weight: 600; white-space: nowrap; }

  .foot { display: flex; justify-content: space-between; font-size: 8.5pt; color: #667; margin-top: 6mm; padding-top: 2.5mm; border-top: 0.5pt solid #cdd6d1; }

  @media screen {
    body { background: #eee; padding: 14mm; }
    .sheet { background: #fff; padding: 14mm 12mm; margin: 0 auto; max-width: 210mm; box-shadow: 0 0 0 1px #ddd; }
  }
</style></head>
<body>
  <div class="sheet">
    <div class="letterhead">
      <div class="crest">${crestImgMarkup(56)}</div>
      <div class="org">
        <div class="h1">โรงพยาบาลกรงปินัง</div>
        <div class="h2">ห้องยา ฝ่ายเภสัชกรรม</div>
      </div>
    </div>
    <div class="doctitle">ภาพรวมคลังยาสำหรับผู้บริหาร</div>
    <div class="docsub">${escapeHtml(meta.periodLabel)} · จัดทำเพื่อประกอบวาระการประชุมคณะกรรมการเภสัชกรรมและการบำบัด (PTC) หรือการรายงานต่อผู้บริหาร</div>

    <div class="stats">${statCards}</div>

    <div class="sectitle">รายการยาที่มีมูลค่าคงคลังสูงสุด 10 อันดับแรก</div>
    ${rowsHtml(topValue, 'จำนวนคงเหลือ', 'มูลค่า (บาท)')}

    <div class="sectitle">รายการยาที่มีอัตราการใช้สูงสุด 10 อันดับแรก (ยอดจ่ายในรอบ 30 วัน)</div>
    ${rowsHtml(topUsage, 'จ่าย 30 วัน', 'คงคลัง (วัน)')}

    <div class="foot"><span>จัดทำโดย: ${escapeHtml(meta.printedBy || '—')}</span><span>จัดพิมพ์จากระบบเมื่อวันที่ ${escapeHtml(new Date(now).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }))}</span></div>
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

/**
 * A minimal, dependency-free SVG line chart — this app has no charting library, and pulling
 * one in just for a single printed report isn't worth the weight (see usageImport.ts's own
 * note on why `xlsx`, a much smaller ask, is already lazy-loaded). Plain inline SVG prints
 * crisply at any resolution (unlike a canvas snapshot) and needs nothing from the page's own
 * script to render, which matters here since this is a NEW popup window's static HTML string,
 * same as every other sheet in this file.
 */
function trendChartSvg(rows: { label: string; value: number }[], color: string, valueFmt: (n: number) => string): string {
  const width = 700, height = 170, padL = 56, padR = 12, padT = 10, padB = 24;
  const plotW = width - padL - padR, plotH = height - padT - padB;
  if (!rows.length) return '<div style="padding:20px;text-align:center;color:#8a9490;font-size:10.5pt">ไม่มีข้อมูลในช่วงที่เลือก</div>';
  const values = rows.map((r) => r.value);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const x = (i: number) => padL + (rows.length === 1 ? plotW / 2 : (i / (rows.length - 1)) * plotW);
  const y = (v: number) => padT + plotH - ((v - min) / range) * plotH;
  const pathD = rows.map((r, i) => (i === 0 ? 'M' : 'L') + ' ' + x(i).toFixed(1) + ' ' + y(r.value).toFixed(1)).join(' ');
  const dots = rows.map((r, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(r.value).toFixed(1)}" r="2" fill="${color}"/>`).join('');
  const gridN = 4;
  let grid = '', yLabels = '';
  for (let g = 0; g <= gridN; g++) {
    const v = min + (range * g) / gridN;
    const gy = y(v);
    grid += `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${width - padR}" y2="${gy.toFixed(1)}" stroke="#e1e8e4" stroke-width="0.6"/>`;
    yLabels += `<text x="${padL - 6}" y="${(gy + 3).toFixed(1)}" font-size="7.5" fill="#667" text-anchor="end" font-family="Sarabun, sans-serif">${escapeHtml(valueFmt(Math.round(v)))}</text>`;
  }
  // Sparse x labels (at most ~7) — a full 90-day range printed with every date would be
  // unreadable; the underlying data table below the chart still carries every single day.
  const maxXLabels = 7;
  const step = Math.max(1, Math.ceil(rows.length / maxXLabels));
  let xLabels = '';
  rows.forEach((r, i) => {
    if (i % step === 0 || i === rows.length - 1) {
      xLabels += `<text x="${x(i).toFixed(1)}" y="${height - 6}" font-size="7.5" fill="#667" text-anchor="middle" font-family="Sarabun, sans-serif">${escapeHtml(r.label)}</text>`;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="display:block;width:100%;height:auto">
    ${grid}<path d="${pathD}" fill="none" stroke="${color}" stroke-width="1.6"/>${dots}${yLabels}${xLabels}
  </svg>`;
}

/**
 * Formal printed version of the "📅 ตัวชี้วัดย้อนหลัง" report tab — same letterhead/Sarabun/teal
 * treatment as every other official sheet in this file (printPickListSheet/
 * printExecutiveSummarySheet), for a pharmacy head/PTC reader who wants the trend as a real
 * document to file or hand up the chain, not just a screen they have to open the app for.
 * Takes the already-fetched range (see fetchDailyMetrics in AppContext.tsx) rather than
 * querying anything itself — this file has no Firestore access of its own, by design (every
 * other sheet here works the same way).
 */
export function printKpiReportSheet(rows: DailyMetrics[], meta: { fromDate: string; toDate: string; printedBy?: string } = { fromDate: '', toDate: '' }): boolean {
  const now = new Date();
  const sum = (f: (r: DailyMetrics) => number) => rows.reduce((s, r) => s + f(r), 0);
  const last = rows[rows.length - 1];
  const short = (d: string) => d.slice(5); // "2026-09-22" -> "09-22", plenty for a chart axis
  const stats: { label: string; value: string; note?: string; tone?: string }[] = [
    { label: 'มูลค่าคงคลังล่าสุด', value: last ? Math.round(last.totalStockValue).toLocaleString('en-US') + ' บาท' : '—', note: last ? 'ณ ' + last.date : undefined },
    { label: 'รับเข้ารวมช่วงนี้', value: sum((r) => r.receivedQty).toLocaleString('en-US'), note: sum((r) => r.receivedCount).toLocaleString('en-US') + ' ครั้ง' },
    { label: 'จ่ายจริงรวม (HOSxP)', value: sum((r) => r.dispensedQty).toLocaleString('en-US') },
    { label: 'par ผิดพลาดล่าสุด', value: last ? last.parErrorCount.toLocaleString('en-US') + ' รายการ' : '—', tone: last && last.parErrorCount > 0 ? '#b3261e' : '#175554' },
    {
      label: 'อัตราขาดสต็อกจริงล่าสุด',
      value: last && last.usedMedCount > 0 ? ((last.stockoutCount / last.usedMedCount) * 100).toFixed(1) + '%' : '—',
      tone: last && last.stockoutCount > 0 ? '#b3261e' : '#175554',
    },
    {
      label: 'เวลารอเบิกยาเฉลี่ย',
      value: (() => {
        const totalApproved = sum((r) => r.receiveApprovedCount);
        if (!totalApproved) return '—';
        const totalHours = rows.reduce((s, r) => s + (r.receiveLeadTimeAvgHours ?? 0) * r.receiveApprovedCount, 0);
        return (totalHours / totalApproved).toFixed(1) + ' ชม.';
      })(),
    },
  ];
  const statCards = stats
    .map((s) => `<div class="stat"><div class="v" style="color:${s.tone || '#14211a'}">${escapeHtml(s.value)}</div><div class="l">${escapeHtml(s.label)}</div>${s.note ? `<div class="n">${escapeHtml(s.note)}</div>` : ''}</div>`)
    .join('');

  const valueChart = trendChartSvg(rows.map((r) => ({ label: short(r.date), value: r.totalStockValue })), '#007371', (n) => n.toLocaleString('en-US'));
  const dispensedChart = trendChartSvg(rows.map((r) => ({ label: short(r.date), value: r.dispensedQty })), '#a15c00', (n) => n.toLocaleString('en-US'));
  const parErrorChart = trendChartSvg(rows.map((r) => ({ label: short(r.date), value: r.parErrorCount })), '#b3261e', (n) => n.toLocaleString('en-US'));

  const tableRows = rows
    .map((r) => `<tr>
      <td>${escapeHtml(r.date)}</td>
      <td class="num">${Math.round(r.totalStockValue).toLocaleString('en-US')}</td>
      <td class="num">${r.receivedQty.toLocaleString('en-US')}</td>
      <td class="num">${r.dispensedQty.toLocaleString('en-US')}</td>
      <td class="num" style="${r.parErrorCount > 0 ? 'color:#b3261e;font-weight:700' : ''}">${r.parErrorCount.toLocaleString('en-US')}</td>
      <td class="num">${r.stockoutCount.toLocaleString('en-US')}</td>
      <td class="num">${r.activeUserCount.toLocaleString('en-US')}</td>
    </tr>`)
    .join('');

  const html = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>รายงานตัวชี้วัดคลังยา</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Sarabun', 'Noto Sans Thai', system-ui, -apple-system, sans-serif; margin: 0; color: #14211a; font-size: 11.5pt; }

  .letterhead { display: flex; align-items: center; gap: 4mm; padding-bottom: 3mm; border-bottom: 1pt solid #14211a; }
  .letterhead .crest { flex: none; display: flex; align-items: center; }
  .letterhead .org .h1 { font-size: 14.5pt; font-weight: 700; line-height: 1.3; }
  .letterhead .org .h2 { font-size: 10.5pt; color: #444; line-height: 1.3; }

  .doctitle { text-align: center; font-size: 16.5pt; font-weight: 700; margin: 5mm 0 1mm; letter-spacing: .01em; }
  .docsub { text-align: center; font-size: 10.5pt; color: #555; margin-bottom: 5mm; }

  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; margin-bottom: 6mm; }
  .stat { border: 0.6pt solid #b8c4bd; border-radius: 2mm; padding: 3mm 3mm 2.5mm; background: #f8faf9; break-inside: avoid; }
  .stat .v { font-size: 14pt; font-weight: 700; line-height: 1.15; }
  .stat .l { font-size: 8.8pt; color: #444; margin-top: 1mm; line-height: 1.35; }
  .stat .n { font-size: 8pt; color: #667; margin-top: 0.5mm; }

  .sectitle { font-size: 12pt; font-weight: 700; margin: 6mm 0 2.5mm; padding-top: 4mm; border-top: 0.6pt solid #cdd6d1; break-after: avoid; }
  .sectitle:first-of-type { border-top: none; padding-top: 0; }
  .chartbox { border: 0.6pt solid #b8c4bd; border-radius: 2mm; padding: 3mm; background: #fff; break-inside: avoid; margin-bottom: 4mm; }

  table.rows { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  table.rows th { text-align: left; font-size: 8.8pt; font-weight: 700; color: #14211a; background: #eef6f6; border: 0.6pt solid #9fb8b8; padding: 1.8mm 2.4mm; }
  table.rows td { padding: 1.8mm 2.4mm; border: 0.5pt solid #cdd6d1; }
  table.rows tbody tr:nth-child(even) { background: #f8faf9; }
  table.rows .num { text-align: right; }

  .foot { display: flex; justify-content: space-between; font-size: 8.5pt; color: #667; margin-top: 6mm; padding-top: 2.5mm; border-top: 0.5pt solid #cdd6d1; }

  @media screen {
    body { background: #eee; padding: 14mm; }
    .sheet { background: #fff; padding: 14mm 12mm; margin: 0 auto; max-width: 210mm; box-shadow: 0 0 0 1px #ddd; }
  }
</style></head>
<body>
  <div class="sheet">
    <div class="letterhead">
      <div class="crest">${crestImgMarkup(56)}</div>
      <div class="org">
        <div class="h1">โรงพยาบาลกรงปินัง</div>
        <div class="h2">ห้องยา ฝ่ายเภสัชกรรม</div>
      </div>
    </div>
    <div class="doctitle">รายงานตัวชี้วัดคลังยา (KPI Report)</div>
    <div class="docsub">ช่วงวันที่ ${escapeHtml(meta.fromDate)} ถึง ${escapeHtml(meta.toDate)} · ${rows.length} วัน</div>

    <div class="stats">${statCards}</div>

    <div class="sectitle">แนวโน้มมูลค่าคงคลัง (บาท)</div>
    <div class="chartbox">${valueChart}</div>

    <div class="sectitle">แนวโน้มจ่ายจริงรายวัน (ตามไฟล์ HOSxP)</div>
    <div class="chartbox">${dispensedChart}</div>

    <div class="sectitle">แนวโน้ม par ที่ผิดพลาดรายวัน</div>
    <div class="chartbox">${parErrorChart}</div>

    <div class="sectitle">ข้อมูลรายวัน</div>
    <table class="rows">
      <thead><tr><th>วันที่</th><th class="num">มูลค่าคงคลัง</th><th class="num">รับเข้า</th><th class="num">จ่ายจริง</th><th class="num">par ผิด</th><th class="num">ขาดสต็อก</th><th class="num">ผู้ใช้งาน</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>

    <div class="foot"><span>จัดทำโดย: ${escapeHtml(meta.printedBy || '—')}</span><span>จัดพิมพ์จากระบบเมื่อวันที่ ${escapeHtml(now.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }))}</span></div>
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
