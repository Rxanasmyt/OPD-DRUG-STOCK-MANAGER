import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useApp } from '../store/AppContext';
import { daysUntil, wardOf, binFor, isSharedMed } from '../store/selectors';
import { thDate } from '../utils/format';
import { QrCode } from '../components/QrCode';
import { encodeQr } from '../utils/qr';
import { shortLabelName, fitSingleLineFontSizePx } from '../utils/labelName';
import { SearchInput } from '../components/SearchInput';
import { MedDot } from '../components/MedDot';
import { LOCS } from '../data/locations';
import type { LabelType, Ward } from '../types';

// Mirrors print.ts's MAX_TITLE_PT/MIN_TITLE_PT (its pt values, here in px since the preview
// card isn't a fixed physical size — it stretches to whatever width mobile/tablet gives it).
const TITLE_MAX_PX = 19;
const TITLE_MIN_PX = 7;
// Bin/shelf code — mirrors print.ts's MAX_BINCODE_PT/MIN_BINCODE_PT. A long code (e.g. a HAD
// sub-shelf code like "HAD1-1") used to sit at a fixed 12.5px and wrap onto a second line,
// visibly overflowing the yellow bin tag's fixed-width box — see AutoFitText below.
const BIN_MAX_PX = 12.5;
// Lower floor than the title's — matches print.ts's MIN_BINCODE_PT (a supporting field, not
// the primary read; still reads clearly bold on the solid yellow tag at this size).
const BIN_MIN_PX = 6;

/** Auto-fits `text` to the largest font size that renders it on a single line within its own
 * box, same technique print.ts uses for the real printout (see its titleFontSizePt/
 * bincodeFontSizePt) — measures the box's actual rendered width (via ResizeObserver, since
 * this card's width is responsive, not a fixed mm size like the print CSS) and asks
 * fitSingleLineFontSizePx() for the largest font that fits it, instead of a fixed size that
 * can wrap or overflow for a longer-than-usual name/code. `white-space: nowrap` +
 * `text-overflow: ellipsis` stays as the backstop for text still too dense at `minPx`. */
function AutoFitText({ text, maxPx, minPx, color, style }: { text: string; maxPx: number; minPx: number; color: string; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(maxPx);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const width = el.clientWidth;
      if (width > 0) setFontSize(fitSingleLineFontSizePx(text, width, maxPx, minPx));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, maxPx, minPx]);

  return (
    <div
      ref={ref}
      style={{ fontSize, fontWeight: 800, lineHeight: 1.2, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...style }}
    >
      {text}
    </div>
  );
}

const TABS: [LabelType, string][] = [['med', 'ฉลากตัวยา'], ['lot', 'ฉลาก lot'], ['loc', 'ฉลากชั้นวาง']];

// These preview cards are deliberately styled with literal colors (white background, #999
// borders) since they represent actual printed paper, not themed app chrome — this badge
// matches that same literal palette (and the literal ink colors print.ts uses for the same
// badge on the real printout), rather than the app's dark-mode-aware --ipd/--green tokens.
// `onYellow` — the shelf-strip preview's bin tag sits on a solid yellow background (matches
// print.ts's .strip .bin); the default pastel fill would wash out there, so that variant gets
// an opaque white pill for real contrast, same fix as print.ts's stripWardBadge().
function printWardBadge(ward?: Ward, onYellow?: boolean) {
  if (!ward) return null;
  const ipd = ward === 'ipd';
  return (
    <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.03em', padding: '1px 5px', borderRadius: 10, background: onYellow ? '#fff' : ipd ? '#e9e6fb' : '#e1efe5', color: ipd ? '#4a3fb5' : '#0e3a20' }}>
      {ipd ? 'IPD' : 'OPD'}
    </span>
  );
}

export default function LabelsScreen() {
  const { state, setLabelType, setLocScope, setLabelWardScope, toggleLabelSelected, selectAllLabels, clearLabelSelected, printLabels, warn } = useApp();
  const [pickerQuery, setPickerQuery] = useState('');
  // OPD/IPD ward tabs removed — one combined list; a shared med's label shows its default
  // (OPD-side) shelf code via binFor()'s own fallback.
  const activeMeds = state.meds.filter((m) => m.active);
  // Mirrors printLabels()'s own "empty picker = print everything" rule exactly (see
  // AppContext.tsx) — this preview has to agree with what the button below it actually prints,
  // or someone could pick a handful of drugs, see the preview still show the whole formulary
  // (or vice versa), and print the wrong set without any way to tell beforehand.
  const selectedIds = Object.keys(state.labelSelected).filter((id) => state.labelSelected[id]);
  const selectedSet = new Set(selectedIds);
  const meds = selectedSet.size === 0 ? activeMeds : activeMeds.filter((m) => selectedSet.has(m.id));
  const chip = (active: boolean) => ({ border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green)' : 'var(--bg-card)', color: active ? '#fff' : 'var(--ink)' });
  const pickerMatches = pickerQuery.trim()
    ? activeMeds.filter((m) => m.name.toLowerCase().indexOf(pickerQuery.trim().toLowerCase()) >= 0).slice(0, 20)
    : [];

  // The substock shelf-strip labels (labelType 'loc' + locScope 'sub') are per-med shelf-strip
  // labels too — same style/shape as ฉลากตัวยา, just keyed off Med.binSub instead of bin/binIpd
  // — so both render with the "strip" layout below, and this flag decides that in one place.
  const isStrip = state.labelType === 'med' || (state.labelType === 'loc' && state.locScope === 'sub');
  // Only meds that actually have a substock rack assigned print anything here — there's no
  // generic "empty substock slot" label the way floor's ฉลากชั้นวาง has (see the bug-fix note
  // in printLabels' locScope==='sub' branch, AppContext.tsx, for why: a shelf-strip label needs
  // a real drug name on it, and a med with no binSub set has no code to put there yet).
  const subMeds = meds.filter((m) => !m.noSubstock && m.binSub);

  const medIds = new Set(meds.map((m) => m.id));
  const wardLots = state.lots.filter((l) => medIds.has(l.medId));
  // The real physical shelf sides this med prints a label for — mirrors printLabels()'s own
  // sides/scoping logic in AppContext.tsx exactly (see labelWardScope's doc comment there) so
  // this preview can never show/count something different from what the print button below
  // actually produces. A shared med with a distinct binIpd has TWO real sides (OPD + IPD); a
  // non-shared med has exactly one. 'all' scope keeps both; scoped to one ward keeps only the
  // side(s) that match — a med whose only side doesn't match contributes nothing at all.
  const medSides = (m: (typeof meds)[number]) => {
    const sides: { ward: Ward; bin: string }[] = isSharedMed(m) && m.binIpd
      ? [{ ward: 'opd', bin: m.bin }, { ward: 'ipd', bin: m.binIpd }]
      : [{ ward: wardOf(m), bin: binFor(m, wardOf(m)) }];
    return state.labelWardScope === 'all' ? sides : sides.filter((s) => s.ward === state.labelWardScope);
  };
  // Bug fix: this used to hide the OPD/IPD badge specifically for a shared med ("no single real
  // ward, showing one would misrepresent it") — true when this rendered ONE row per med, but
  // print.ts's real output already puts a distinct row per SIDE with a real, unambiguous ward
  // each (see printLabels()), so the preview was quietly showing less than what actually
  // prints. Now that this renders one row per real side too, every row has a genuine ward —
  // always show it, which also happens to be exactly what tells two sides of the same drug
  // apart when labelWardScope is 'all' and both are mixed into the same preview.
  const rows = state.labelType === 'med'
    ? meds.flatMap((m) => medSides(m).map((s) => ({ code: m.code, bin: s.bin, payload: encodeQr('med', m.code), title: shortLabelName(m.name), sub: 'หน่วย ' + m.unit + ' · ชั้น ' + s.bin, tag: m.had ? 'HIGH ALERT' : '', tagColor: 'var(--had)', ward: s.ward as Ward | undefined }))).slice(0, 8)
    : state.labelType === 'lot'
    ? wardLots.slice(0, 8).map((l) => {
        const m = meds.find((x) => x.id === l.medId);
        return { code: l.code, bin: undefined as string | undefined, payload: encodeQr('lot', l.code), title: m ? m.name : '—', sub: 'lot ' + l.lotNo + ' · exp ' + thDate(l.exp), tag: daysUntil(l.exp) < warn() ? 'ใกล้หมดอายุ' : '', tagColor: 'var(--amber)', ward: m && !isSharedMed(m) ? wardOf(m) : undefined };
      })
    : state.locScope === 'sub'
    ? subMeds.slice(0, 8).map((m) => ({ code: m.code, bin: m.binSub, payload: encodeQr('med', m.code), title: shortLabelName(m.name), sub: 'หน่วย ' + m.unit + ' · substock ' + m.binSub, tag: m.had ? 'HIGH ALERT' : '', tagColor: 'var(--had)', ward: undefined as Ward | undefined }))
    : LOCS.map((b) => ({ code: 'LOC-' + b, bin: undefined as string | undefined, payload: encodeQr('loc', 'LOC-' + b), title: 'ชั้นจ่ายยา ' + b, sub: 'หน้างาน OPD · สแกนเพื่อเปิดรายการในชั้นนี้', tag: '', tagColor: 'var(--muted)', ward: undefined as Ward | undefined }));

  // Bug fix: printLabels() (AppContext.tsx) emits TWO label rows for a shared med that has a
  // distinct binIpd — one per real shelf spot (OPD + IPD) — but this count used to just be
  // meds.length, silently undercounting the "พิมพ์ฉลากทั้งชุด (N ดวง)" button whenever the
  // formulary has any such shared meds. That number is what someone actually buying/counting
  // out A4 sticker sheets relies on before printing, so it has to match what really prints.
  // Now routed through medSides() so a ward-scoped print (labelWardScope !== 'all') counts
  // correctly too — a shared med scoped to one ward contributes exactly 1, not 2.
  const medLabelCount = meds.reduce((n, m) => n + medSides(m).length, 0);
  const labelCount = state.labelType === 'lot' ? wardLots.length : state.labelType === 'med' ? medLabelCount : state.locScope === 'sub' ? subMeds.length : LOCS.length;

  return (
    <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>ยังไม่มี QR ติดที่ยาและชั้นวาง — เริ่มจากพิมพ์ฉลาก 3 ชนิดนี้ รหัสถูกสร้างจาก master data โดยตรง เป็น QR จริงที่กล้องมือถือ/แท็บเล็ตสแกนได้ทันทีหลังติด</div>
      <div style={{ display: 'flex', gap: 7, marginBottom: 9 }}>
        {TABS.map(([t, label]) => (
          <button key={t} className="chip" style={{ ...chip(state.labelType === t), flex: 1, textAlign: 'center', minHeight: 42 }} onClick={() => setLabelType(t)}>{label}</button>
        ))}
      </div>

      {/* Only shows on the ฉลากตัวยา tab — lets someone print just one ward's shelf-strip
          labels instead of always getting a shared med's OPD+IPD pair mixed into one sheet.
          See AppState.labelWardScope's doc comment for why this exists. */}
      {state.labelType === 'med' && (
        <div style={{ display: 'flex', gap: 7, marginBottom: 12 }}>
          <button className="chip" style={{ ...chip(state.labelWardScope === 'all'), flex: 1, minHeight: 40 }} onClick={() => setLabelWardScope('all')}>ทั้งหมด (OPD+IPD)</button>
          <button className="chip" style={{ ...chip(state.labelWardScope === 'opd'), flex: 1, minHeight: 40 }} onClick={() => setLabelWardScope('opd')}>เฉพาะ OPD</button>
          <button className="chip" style={{ ...chip(state.labelWardScope === 'ipd'), flex: 1, minHeight: 40 }} onClick={() => setLabelWardScope('ipd')}>เฉพาะ IPD</button>
        </div>
      )}

      {/* Only shows on the ฉลากชั้นวาง tab — floor keeps the original generic (drug-less) shelf-
          frame labels, substock switches to real per-med shelf-strip labels (see isStrip). */}
      {state.labelType === 'loc' && (
        <>
          <div style={{ display: 'flex', gap: 7, marginBottom: 8 }}>
            <button className="chip" style={{ ...chip(state.locScope === 'floor'), flex: 1, minHeight: 40 }} onClick={() => setLocScope('floor')}>ชั้นวางหน้างาน (floor)</button>
            <button className="chip" style={{ ...chip(state.locScope === 'sub'), flex: 1, minHeight: 40 }} onClick={() => setLocScope('sub')}>ชั้นวาง substock</button>
          </div>
          {state.locScope === 'sub' && (
            <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5, marginBottom: 12 }}>
              แสดงเฉพาะยาที่กำหนด "ชั้นวาง substock" ไว้แล้ว (ตั้งได้ที่หน้าจัดการยา) — แต่ละดวงมี
              QR + ชื่อยา + ขนาดยา เหมือนฉลากตัวยาหน้างาน แค่โชว์รหัสชั้น substock แทน
            </div>
          )}
        </>
      )}

      {/* The picker below is per-med, so it applies to ฉลากตัวยา/ฉลาก lot and to ฉลากชั้นวาง's
          substock mode (also per-med now) — only floor's ฉลากชั้นวาง stays location-only. */}
      {(state.labelType !== 'loc' || state.locScope === 'sub') && (
        <div className="card" style={{ padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>เลือกยาเฉพาะบางตัว (ไม่บังคับ)</div>
          <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5, marginBottom: 8 }}>
            {selectedSet.size > 0
              ? `เลือกไว้ ${selectedSet.size} รายการ — ปุ่มพิมพ์ด้านล่างจะพิมพ์เฉพาะที่เลือกเท่านั้น`
              : 'ไม่เลือกเลย = พิมพ์ทั้งหมด (ค่าเริ่มต้น) — ค้นหาแล้วติ๊กเพื่อพิมพ์เฉพาะบางตัว'}
          </div>
          <SearchInput value={pickerQuery} onChange={setPickerQuery} placeholder="ค้นหาชื่อยาเพื่อเลือก" style={{ marginBottom: pickerMatches.length || selectedSet.size ? 9 : 0 }} />
          {pickerMatches.length > 0 && (
            <>
              <button
                onClick={() => selectAllLabels(pickerMatches.map((m) => m.id))}
                style={{ border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--ink)', padding: '6px 10px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, marginBottom: 8 }}
              >
                เลือกทั้งหมดที่ค้นเจอ ({pickerMatches.length})
              </button>
              <div style={{ border: '1px solid var(--border-soft)', borderRadius: 10, maxHeight: 240, overflowY: 'auto' }}>
                {pickerMatches.map((m) => {
                  const on = !!state.labelSelected[m.id];
                  return (
                    <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', borderBottom: '1px solid var(--border-soft)', cursor: 'pointer', background: on ? 'var(--green-tint)' : undefined }}>
                      <input type="checkbox" checked={on} onChange={() => toggleLabelSelected(m.id)} style={{ width: 17, height: 17, flex: 'none' }} />
                      <span style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}><MedDot code={m.code} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span></span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
          {selectedSet.size > 0 && (
            <button
              onClick={clearLabelSelected}
              style={{ width: '100%', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--red)', padding: '9px 10px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, marginTop: 9 }}
            >
              ล้างที่เลือกทั้งหมด ({selectedSet.size})
            </button>
          )}
        </div>
      )}

      {/* Bug-adjacent fix: the preview below always caps at 8 cards (rendering all 585+ QR
          codes live would be needless work for a page whose only real job is "does this look
          right before I print"), but nothing ever said so — a busy formulary made it read as
          "the app only made 8 labels", when the print button underneath already prints every
          one. Only shown once there's actually a gap between what's previewed and what prints. */}
      {labelCount > rows.length && (
        <div className="muted" style={{ fontSize: 11, marginBottom: 9 }}>แสดงตัวอย่าง {rows.length} จาก {labelCount} รายการ — ปุ่มพิมพ์ด้านล่างพิมพ์ครบทุกรายการ</div>
      )}
      {isStrip ? (
        <div className="stagger" style={{ marginBottom: 14 }}>
          {/* Bug fix (readability): mirrors print.ts's strip layout exactly (see its markup
              comment) — the med code moved from beside the title down under the QR (small,
              it's a scan-in-by-hand fallback, not a primary read), and the OPD/IPD badge moved
              off the title row onto the bin tag itself, freeing that whole row for the name +
              HIGH ALERT tag to render bigger. */}
          {rows.map((r, i) => (
            <div key={i} style={{ background: '#fff', border: '1px solid #999', borderRadius: 8, marginBottom: 7, display: 'flex', alignItems: 'stretch', height: 64, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,.04)' }}>
              <div style={{ flex: 'none', width: 36, background: '#f5c518', color: '#1a1a1a', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, textAlign: 'center', padding: '3px 2px', borderRight: '1px solid #d9ac00' }}>
                <AutoFitText text={r.bin || ''} maxPx={BIN_MAX_PX} minPx={BIN_MIN_PX} color="#1a1a1a" style={{ width: '100%' }} />
                {printWardBadge(r.ward, true)}
              </div>
              <div style={{ flex: 'none', padding: '0 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <QrCode value={r.payload} size={41} />
                <span style={{ fontSize: 8, color: '#777', fontWeight: 600, letterSpacing: '.02em', marginTop: 2 }}>{r.code}</span>
              </div>
              <div style={{ minWidth: 0, padding: '4px 10px', display: 'flex', flexDirection: 'column', justifyContent: 'center', borderLeft: '1px solid #e5e5e0' }}>
                <AutoFitText text={r.title} maxPx={TITLE_MAX_PX} minPx={TITLE_MIN_PX} color="#14231a" />
                {r.tag && <div style={{ fontSize: 13, color: r.tagColor, fontWeight: 800, marginTop: 2 }}>{r.tag}</div>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid-2 tablet-2 stagger" style={{ marginBottom: 14, gridTemplateColumns: 'repeat(2,1fr)' }}>
          {rows.map((r, i) => (
            <div key={i} style={{ background: '#fff', border: '1px solid #cfd1c8', borderRadius: 8, padding: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ flex: 'none' }}><QrCode value={r.payload} size={52} /></div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: 9.5, letterSpacing: '.08em', color: 'var(--muted)', fontWeight: 600 }}>{r.code}</span>
                  {printWardBadge(r.ward)}
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.25, marginTop: 2 }}>{r.title}</div>
                <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>{r.sub}</div>
                {r.tag && <div style={{ fontSize: 10, color: r.tagColor, fontWeight: 700, marginTop: 2 }}>{r.tag}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
      <button onClick={printLabels} className="btn-primary" style={{ width: '100%', padding: 15, borderRadius: 11, fontSize: 15, minHeight: 52 }}>
        {(state.labelType !== 'loc' || state.locScope === 'sub') && selectedSet.size > 0 ? 'พิมพ์ยาที่เลือก' : 'พิมพ์ฉลากทั้งชุด'} ({labelCount} ดวง · A4 กระดาษสติกเกอร์)
      </button>
      <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, marginTop: 11 }}>
        พิมพ์ลงกระดาษ A4 แล้วตัดติดหน้ายา/lot/ชั้นวางได้เลย — QR แต่ละดวงสแกนด้วยกล้องมือถือหรือแท็บเล็ตผ่านปุ่ม ▣ ในหน้ารับเข้า/เติมหน้างานได้ทันที
        {isStrip && <> ฉลากตัวยาพิมพ์ที่ขนาดจริง 2×10 ซม. ต่อดวง — 1 แผ่น A4 จุ 28 ดวงพอดี (2 คอลัมน์ × 14 แถว)</>}
      </div>
    </div>
  );
}
