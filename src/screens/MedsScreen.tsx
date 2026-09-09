import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';
import { nf, digitsOnly } from '../utils/format';
import { wardOf, wardLabel, floorMinOf, toneFor, isSharedMed, categoryOf } from '../store/selectors';
import { MedDot } from '../components/MedDot';
import { Qty } from '../components/Qty';
import type { Med, Ward } from '../types';
import { EmptyState } from '../components/EmptyState';
import { SearchInput } from '../components/SearchInput';
import { DRUG_CATEGORIES, categoryLabel } from '../data/categories';
import { suggestCategoryId } from '../data/categorySuggest';

type Filter = 'active' | 'inactive' | 'all' | 'parOne';

// Bug fix (mobile fit): iOS Safari auto-zooms the whole page in the instant a text input with
// a computed font-size under 16px receives focus (it assumes you need it magnified to read) —
// on an iPhone/iPad this yanked the layout out of "fits the screen" the moment anyone tapped
// into a field on this form, and stayed zoomed in until they tapped away, making data entry
// slower and more awkward than typing into a field that never needed zooming in the first
// place. 16px is the documented threshold iOS actually checks; every input on this form goes
// through this one const, so raising it here fixes every field at once.
const inputStyle = { width: '100%', border: '1px solid var(--border)', background: 'var(--bg-card)', borderRadius: 10, padding: '11px 12px', fontSize: 16, minHeight: 44 };

// Bug fix: the inline per-row bin edit (setMedBin in AppContext.tsx) has always sanitized to
// uppercase-alphanumeric-only, but this form's own bin/binIpd fields just took raw typed text
// (the `uppercase` on the input was CSS display only — didn't touch the actual stored value).
// A shelf QR code (see LOCS in data/locations.ts, e.g. "A1") only ever matches a med's bin
// EXACTLY — so typing "a1", "A1 ", or "A-1" here here silently produced a bin that could never
// match its own shelf's QR code, breaking "สแกน QR ที่ชั้นวาง" for that drug with no error
// shown anywhere. Same sanitize rule as setMedBin, applied at the same point.
// Shelf code text (bin/binIpd/binSub) is never itself encoded into a QR — the printed "ฉลาก
// ตัวยา"/"ฉลากชั้นวาง substock" strip's QR always carries the med's own code (see printLabels()
// in AppContext.tsx), and this text is just what's shown on the tag next to it plus what a
// scanned FLOOR location QR (LOCS — a separate, fixed A1..D2 list, unrelated to what's typed
// here) gets string-matched against. So there was never a real QR-format reason to force
// Latin-only: this used to reject Thai script and "-" outright, even though staff naturally
// write shelf codes like "ตู้ยา-1" or "ชั้น-A" in Thai. Widened to Thai script (U+0E00-U+0E7F)
// + "-" alongside the existing A-Z0-9; length cap raised a little (8→10) since a short Thai
// label needs more code units than the equivalent Latin one.
function sanitizeBin(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9\u0E00-\u0E7F-]/g, '').slice(0, 10);
}
const WARD_COLOR: Record<Ward, string> = { opd: 'var(--green)', ipd: 'var(--ipd)' };
const WARD_BG: Record<Ward, string> = { opd: 'var(--green-tint)', ipd: 'var(--ipd-bg)' };

interface MedFormValues {
  name: string;
  dosageForm: string;
  unit: string;
  price: string;
  had: boolean;
  bin: string;
  parSub: string;
  parFloor: string;
  floorMin: string;
  ward: Ward;
  noSubstock: boolean;
  volatility: string;
  // ยาที่ IPD หยิบตรงจากชั้น OPD (ไม่มีสต็อกแยก) — ดู isSharedMed()/Med.binIpd. เมื่อ true จะโชว์
  // ชั้นวางสองรหัส (OPD/IPD) แทนตัวเลือกหอผู้ป่วยเดี่ยว และ `bin`/`binIpd` ทั้งคู่บันทึกลงยา
  // รายการเดียวกัน — คนละกลไกกับ "รวมสต็อก" (mergeWardMeds) ที่ใช้ตอนมีสต็อกแยกสองรายการอยู่แล้ว
  shared: boolean;
  binIpd: string;
  // Substock's own shelf/rack code — see Med.binSub. Kept as its own field, never disabled/
  // cleared just because `noSubstock` happens to be ticked (someone may untick it again;
  // there's no reason to make them retype a code the form just erased) — the input itself is
  // only visually disabled while noSubstock is on, same treatment as par substock below it.
  binSub: string;
  category: string;
}

function blankForm(): MedFormValues {
  // shared:true by default — most drugs at this hospital are one pooled OPD/IPD stock (IPD
  // one-day-dose pulls straight off the OPD shelf), so a brand-new med should start there and
  // let someone opt OUT (untick "เลิกใช้ร่วมกัน") for the minority that genuinely need separate
  // stock, rather than opting in every single time.
  return { name: '', dosageForm: '', unit: '', price: '', had: false, bin: '', parSub: '', parFloor: '', floorMin: '', ward: 'opd', noSubstock: false, volatility: '1.10', shared: true, binIpd: '', binSub: '', category: '' };
}

function formFromMed(m: Med): MedFormValues {
  return {
    name: m.name, dosageForm: m.dosageForm, unit: m.unit, price: m.price ? String(m.price) : '',
    had: m.had, bin: m.bin, parSub: String(m.parSub), parFloor: String(m.parFloor), floorMin: String(floorMinOf(m)),
    ward: wardOf(m), noSubstock: !!m.noSubstock, volatility: m.volatility.toFixed(2),
    shared: isSharedMed(m), binIpd: m.binIpd || '', binSub: m.binSub || '', category: m.category || '',
  };
}

export default function MedsScreen() {
  const { state, sub, addMed, updateMedFull, mergeWardMeds, mergeAllWardPairs, shareAllMeds, autoCategorizeAll, setMedBin, toggleMedActive, deleteMed, deleteAllInactiveMeds, setMedsFocusId, openScanSearch } = useApp();
  const canEdit = state.role !== 'tech';
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [wardTab, setWardTab] = useState<'all' | 'shared' | Ward>('all');
  const [catTab, setCatTab] = useState<'all' | string>('all');
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // A QR scan (ดูข้อมูลยา) lands here with medsFocusId set — jump straight into that med's
  // edit panel instead of leaving the person to scroll through hundreds of rows to find it.
  useEffect(() => {
    if (!state.medsFocusId) return;
    const id = state.medsFocusId;
    const target = state.meds.find((m) => m.id === id);
    setFilter('all');
    // Bug fix: this reset `filter` (active/inactive) but not the ward tab — scanning an IPD
    // med's QR while this screen's ward tab was still on "OPD" set editingId to a row that
    // the ward filter below was hiding, so nothing visibly happened (no edit panel, nothing
    // to scroll to) even though the scan itself worked fine.
    setWardTab('all');
    setCatTab('all');
    // Bug fix: this used to clear the search box instead — with a 585-item formulary and the
    // list below capped to the first 150 (alphabetically sorted) results, a scanned med whose
    // name sorts past position 150 would never actually render, so editingId pointed at a row
    // that flat-out didn't exist in the DOM: no edit panel, nothing to scroll to, same silent
    // failure as the ward-tab bug above just via a different mechanism. Narrowing the search
    // to the med's own name guarantees it's the only (or first) match, always inside the cap.
    setQ(target ? target.name : '');
    setAddOpen(false);
    setEditingId(id);
    setMedsFocusId(null);
    window.setTimeout(() => rowRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
  }, [state.medsFocusId, state.meds, setMedsFocusId]);

  // Count for the "รวมกันเลย" bulk-merge button — same one-opd-one-ipd-only qualifying rule
  // mergeAllWardPairs() itself enforces, kept in sync here just to show an honest count.
  const mergeablePairCount = useMemo(() => {
    const byName = new Map<string, Med[]>();
    state.meds.forEach((m) => {
      if (!m.active || isSharedMed(m)) return;
      const arr = byName.get(m.name);
      if (arr) arr.push(m); else byName.set(m.name, [m]);
    });
    let n = 0;
    byName.forEach((arr) => {
      if (arr.length === 2 && arr.some((m) => wardOf(m) === 'opd') && arr.some((m) => wardOf(m) === 'ipd')) n++;
    });
    return n;
  }, [state.meds]);

  // Count for "ใช้ยาทั้งหมดร่วมกันทั้ง OPD/IPD" — every active med that isn't already shared,
  // regardless of whether it has a separate-ward counterpart at all. The common real case at a
  // formulary with no IPD records yet: mergeablePairCount above is 0 (nothing to fold two
  // records into), but this is still > 0 because every plain OPD-only med qualifies to just be
  // flagged shared outright — see shareAllMeds() in AppContext.tsx.
  const shareAllCount = useMemo(() => state.meds.filter((m) => m.active && !isSharedMed(m)).length, [state.meds]);

  // Count for "จัดหมวดหมู่ยาทั้งหมดอัตโนมัติ" — how many currently-uncategorized meds the
  // keyword engine (data/categorySuggest.ts) can actually put a category on right now. Meds
  // that already have a category, or whose name matches nothing in the keyword list, don't
  // count — see autoCategorizeAll() in AppContext.tsx for the same exact rule applied to the
  // real bulk write.
  const autoCategorizableCount = useMemo(
    () => state.meds.filter((m) => !m.category && suggestCategoryId(m.name)).length,
    [state.meds],
  );

  // Category counts computed BEFORE the category tab itself narrows anything — so each chip
  // can show how many meds are in that group under the current status/ward/search filters,
  // which is the whole point ("บางกลุ่มจ่ายออกเยอะ บางกลุ่มใช้น้อย"): the counts are what let
  // someone spot a high-volume group vs. a rarely-touched one at a glance, before even tapping.
  // "Max=Min=1" diagnostic: floorMinOf()'s own default-fallback (30% of Max, rounded to a nice
  // step) computes 0 whenever Max is 1 — Math.round(1*0.3/1)*1 = 0 — so the ONLY way a med ever
  // actually shows Min=1 alongside Max=1 is a real, explicit `floorMin: 1` stored on it (never
  // the auto-default). That in turn only happens two ways: someone typed "1" into the "จุดต่ำสุด
  // ต้องเติม (Min)" field by hand (this form, below), or a still-active med that legitimately
  // has almost no daily usage got "ใช้ค่าแนะนำ" applied — suggestPar()'s roundStep() has a hard
  // floor of 1 (`Math.max(step, ...)`, selectors.ts) so a near-zero-but-nonzero used30 can
  // legitimately round Max down to 1, and if Min had already been hand-set to 1 earlier (or to
  // match Max) it stays there. Either way this is real par data, not a bug in itself — but a Min
  // that equals Max leaves genuinely zero warning room before a shelf reads "ต้องเติมด่วน", so
  // it's worth being able to find at a glance instead of opening each med's edit form one by one.
  const parOneOnly = filter === 'parOne';
  const parOneCount = useMemo(
    () => state.meds.filter((m) => m.active && m.parFloor === 1 && floorMinOf(m) === 1).length,
    [state.meds],
  );

  const medsBeforeWard = state.meds
    .filter((m) => (filter === 'all' ? true : filter === 'active' ? m.active : filter === 'inactive' ? !m.active : (m.parFloor === 1 && floorMinOf(m) === 1)))
    .filter((m) => !q.trim() || m.name.toLowerCase().indexOf(q.trim().toLowerCase()) >= 0);

  // Bug fix (clarity): matchesWard() (used everywhere else — TransferScreen/ReceiveScreen/etc.)
  // deliberately puts a shared med under BOTH the "OPD" and "IPD" tab, since it really is
  // stocked on one shelf either ward draws from — correct for those actual dispensing
  // workflows. This management list is a different job (browsing/auditing the catalog, not
  // picking what to restock), where that overlap was exactly the complaint: "OPD" and "IPD"
  // here each silently included every shared med too, so the three groups were never actually
  // distinct and neither tab's count meant "OPD-only" or "IPD-only". A local, non-overlapping
  // split instead: "ร่วม OPD+IPD" (shared), "OPD" (ward-only, not shared), "IPD" (ward-only,
  // not shared) — every active/inactive med lands in exactly one of these three, so they sum
  // back up to "ทุกหอผู้ป่วย" with no double-counting.
  const wardCounts = useMemo(() => {
    const counts = { all: medsBeforeWard.length, shared: 0, opd: 0, ipd: 0 };
    medsBeforeWard.forEach((m) => {
      if (isSharedMed(m)) counts.shared++;
      else if (wardOf(m) === 'opd') counts.opd++;
      else counts.ipd++;
    });
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.meds, filter, q]);

  const medsBeforeCat = medsBeforeWard.filter((m) => {
    if (wardTab === 'all') return true;
    if (wardTab === 'shared') return isSharedMed(m);
    return !isSharedMed(m) && wardOf(m) === wardTab;
  });

  const catCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    medsBeforeCat.forEach((m) => { const c = categoryOf(m); counts[c] = (counts[c] || 0) + 1; });
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.meds, filter, wardTab, q]);

  const meds = medsBeforeCat
    .filter((m) => catTab === 'all' || categoryOf(m) === catTab)
    .sort((a, b) => a.name.localeCompare(b.name, 'th'));

  // Grouped-by-category view of the visible list — only built (and only shown) when browsing
  // "ทุกหมวด" with nothing narrowing it down further; picking one category tab already IS the
  // narrow view, repeating its own name as a lone group header on top would be noise.
  const groups = catTab === 'all'
    ? DRUG_CATEGORIES
      .map((c) => ({ id: c.id, label: c.label, items: meds.filter((m) => categoryOf(m) === c.id) }))
      .filter((g) => g.items.length > 0)
    : null;

  const chip = (active: boolean) => ({ border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green)' : 'var(--bg-card)', color: active ? '#fff' : 'var(--ink)' });

  if (!canEdit) {
    return (
      <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
        <div style={{ fontSize: 12.5, color: 'var(--amber-ink)', background: 'var(--amber-bg)', borderRadius: 10, padding: '10px 12px' }}>บทบาทผู้ช่วยเภสัชกรเข้าหน้านี้ไม่ได้ — การเพิ่ม/แก้ไข/ปิดใช้งาน/ลบยาสงวนไว้สำหรับเภสัชกรและ Admin</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
        ชื่อยา ขนาด รูปแบบยา หน่วย ราคา/หน่วย par substock/หน้างาน และชั้นวาง แก้ไขได้ในที่เดียวที่นี่ — กด "แก้ไขข้อมูล" ที่รายการ หรือสแกน QR ฉลากที่ติดหน้ายา/ชั้นวางเพื่อเปิดข้อมูลรายการนั้นโดยตรง เมื่อ รพ. เพิ่มยาใหม่หรือตัดยาออกจากบัญชี ก็จัดการที่นี่เช่นกัน — ยาที่ "ปิดใช้งาน" จะไม่ขึ้นในหน้าเติมหน้างาน/รับเข้าอีก แต่ประวัติธุรกรรมเดิมยังอยู่ครบ ส่วน "ลบถาวร" ทำได้เฉพาะยาที่ยอดคงเหลือเป็น 0 แล้วเท่านั้น
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button onClick={() => { setAddOpen((v) => !v); setEditingId(null); }} className="btn-primary" style={{ flex: 1, padding: 13, borderRadius: 11, fontSize: 14, fontWeight: 600, minHeight: 48 }}>+ เพิ่มยาใหม่</button>
        <button onClick={() => openScanSearch('viewMed')} className="btn-outline" style={{ flex: 'none', padding: '13px 16px', borderRadius: 11, fontSize: 17, minHeight: 48 }} title="สแกน QR ดูข้อมูลยา" aria-label="สแกน QR ดูข้อมูลยา">▣</button>
      </div>

      {addOpen && (
        <MedForm
          heading="เพิ่มยาใหม่"
          initial={blankForm()}
          submitLabel="บันทึก"
          onCancel={() => setAddOpen(false)}
          onSubmit={(v) => {
            addMed({ name: v.name, dosageForm: v.dosageForm, unit: v.unit, price: parseFloat(v.price) || 0, had: v.had, bin: v.bin, binSub: v.binSub || undefined, parSub: parseInt(v.parSub, 10) || 0, parFloor: parseInt(v.parFloor, 10) || 0, floorMin: parseInt(v.floorMin, 10) || 0, ward: v.shared ? 'opd' : v.ward, noSubstock: v.noSubstock, volatility: parseFloat(v.volatility) || 1.1, shared: v.shared, binIpd: v.shared ? v.binIpd : undefined, category: v.category || undefined });
            setAddOpen(false);
          }}
        />
      )}

      {/* Bug fix (clarity): "OPD"/"IPD" used to each silently include every shared med too (see
          wardCounts's doc comment above) — split into 4 non-overlapping groups so each tab's
          count actually means what its label says. Wraps to 2 rows on a narrow phone instead of
          squeezing 4 chips onto one (flex-wrap, not overflow-x scroll — every group is meant to
          be visible at a glance here, not tucked off-screen). */}
      <div style={{ display: 'flex', gap: 7, marginBottom: 8, flexWrap: 'wrap' }}>
        <button className="chip" style={{ ...chip(wardTab === 'all'), flex: 1, textAlign: 'center' }} onClick={() => setWardTab('all')}>ทุกหอผู้ป่วย ({wardCounts.all})</button>
        <button className="chip" style={{ ...chip(wardTab === 'shared'), flex: 1, textAlign: 'center', ...(wardTab === 'shared' ? { background: 'var(--green)', borderColor: 'var(--green)' } : {}) }} onClick={() => setWardTab('shared')}>ร่วม OPD+IPD ({wardCounts.shared})</button>
        <button className="chip" style={{ ...chip(wardTab === 'opd'), flex: 1, textAlign: 'center', ...(wardTab === 'opd' ? { background: WARD_COLOR.opd, borderColor: WARD_COLOR.opd } : {}) }} onClick={() => setWardTab('opd')}>OPD เดี่ยว ({wardCounts.opd})</button>
        <button className="chip" style={{ ...chip(wardTab === 'ipd'), flex: 1, textAlign: 'center', ...(wardTab === 'ipd' ? { background: WARD_COLOR.ipd, borderColor: WARD_COLOR.ipd } : {}) }} onClick={() => setWardTab('ipd')}>IPD เดี่ยว ({wardCounts.ipd})</button>
      </div>

      {autoCategorizableCount > 0 && (
        <button
          onClick={autoCategorizeAll}
          disabled={!!state.busy['autoCategorizeAll']}
          title="จับคู่จากชื่อยาสามัญที่ระบบรู้จัก — ยาที่ตั้งหมวดไว้แล้วจะไม่ถูกแก้ไข ยาที่ระบบไม่รู้จักชื่อจะยังไม่ถูกแตะต้อง"
          style={{ width: '100%', border: '1px solid var(--green)', background: 'var(--green-tint)', color: 'var(--green)', padding: '11px 14px', borderRadius: 11, fontSize: 12.5, fontWeight: 600, minHeight: 44, marginBottom: 10, opacity: state.busy['autoCategorizeAll'] ? 0.7 : 1 }}
        >
          {state.busy['autoCategorizeAll'] ? 'กำลังจัดหมวด…' : `🏷 จัดหมวดหมู่ยาทั้งหมดอัตโนมัติ (${autoCategorizableCount} รายการ)`}
        </button>
      )}
      {/* หมวดกลุ่มยา — เลื่อนดูได้ทางขวา แต่ละชิปโชว์จำนวนยาในหมวดนั้นภายใต้ตัวกรองด้านบน ทำให้
          เห็นได้ทันทีว่ากลุ่มไหนมีของเยอะ (จ่ายออกบ่อย) กลุ่มไหนมีน้อย (ใช้นาน ๆ ครั้ง) */}
      <div style={{ display: 'flex', gap: 7, marginBottom: 10, overflowX: 'auto', paddingBottom: 2 }}>
        <button className="chip" style={{ ...chip(catTab === 'all'), flex: 'none' }} onClick={() => setCatTab('all')}>ทุกหมวด ({medsBeforeCat.length})</button>
        {DRUG_CATEGORIES.map((c) => catCounts[c.id] ? (
          <button key={c.id} className="chip" style={{ ...chip(catTab === c.id), flex: 'none' }} onClick={() => setCatTab(c.id)}>{c.label} ({catCounts[c.id]})</button>
        ) : null)}
      </div>
      {shareAllCount > 0 && (
        <button
          onClick={shareAllMeds}
          disabled={!!state.busy['shareAllMeds']}
          style={{ width: '100%', border: 0, background: 'var(--green)', color: '#fff', padding: '11px 14px', borderRadius: 11, fontSize: 12.5, fontWeight: 600, minHeight: 44, marginBottom: 8, opacity: state.busy['shareAllMeds'] ? 0.7 : 1 }}
        >
          {state.busy['shareAllMeds'] ? 'กำลังตั้งค่า…' : `🔗 ใช้ยาทั้งหมดร่วมกันทั้ง OPD/IPD เลย (${shareAllCount} รายการ)`}
        </button>
      )}
      {mergeablePairCount > 0 && (
        <button
          onClick={mergeAllWardPairs}
          disabled={!!state.busy['mergeAllWardPairs']}
          style={{ width: '100%', border: '1px solid var(--green)', background: 'transparent', color: 'var(--green)', padding: '11px 14px', borderRadius: 11, fontSize: 12.5, fontWeight: 600, minHeight: 44, marginBottom: 10, opacity: state.busy['mergeAllWardPairs'] ? 0.7 : 1 }}
        >
          {state.busy['mergeAllWardPairs'] ? 'กำลังรวมสต็อก…' : `🔗 รวมสต็อก OPD+IPD ที่แยกเป็นคนละรายการอยู่ (${mergeablePairCount} คู่)`}
        </button>
      )}
      <div style={{ display: 'flex', gap: 7, marginBottom: parOneCount > 0 ? 8 : 10, flexWrap: 'wrap' }}>
        <button className="chip" style={chip(filter === 'active')} onClick={() => setFilter('active')}>ใช้งานอยู่</button>
        <button className="chip" style={chip(filter === 'inactive')} onClick={() => setFilter('inactive')}>ปิดใช้งาน</button>
        <button className="chip" style={chip(filter === 'all')} onClick={() => setFilter('all')}>ทั้งหมด</button>
        {/* Diagnostic filter, only shown when there's actually something to find — see
            parOneCount's doc comment above for exactly why a match here always means someone
            explicitly typed Min=1 (never floorMinOf()'s own auto-default). */}
        {parOneCount > 0 && (
          <button
            className="chip"
            style={{ border: parOneOnly ? '1px solid var(--amber)' : '1px solid var(--border)', background: parOneOnly ? 'var(--amber)' : 'var(--bg-card)', color: parOneOnly ? '#fff' : 'var(--amber-ink)' }}
            onClick={() => setFilter(parOneOnly ? 'active' : 'parOne')}
          >
            ⚠ Max=Min=1 ({parOneCount})
          </button>
        )}
      </div>
      {parOneOnly && (
        <div className="muted" style={{ fontSize: 11, lineHeight: 1.6, marginBottom: 10, background: 'var(--amber-bg)', color: 'var(--amber-ink)', borderRadius: 10, padding: '9px 11px' }}>
          ยา {parOneCount} รายการนี้มีจุดต่ำสุด (Min) เท่ากับจุดสูงสุด (Max) พอดี = 1 หน่วย — เกิดจากมีคนกรอก
          "Min" เป็น 1 ไว้ตรงๆ (ไม่ใช่ค่า default อัตโนมัติ ซึ่งกรณี Max=1 ระบบจะคำนวณ Min เริ่มต้นให้เป็น 0
          เสมอ) อาจเป็นเพราะยาตัวนั้นใช้น้อยมากจริง หรือกรอกไว้ตอนที่ยังไม่มีสถิติการใช้แม่นพอ — แตะยา
          แต่ละตัวด้านล่างเพื่อดู/แก้ Max-Min ได้เลย
        </div>
      )}

      {filter === 'inactive' && meds.length > 0 && (
        <button
          onClick={() => deleteAllInactiveMeds(meds.map((m) => m.id))}
          disabled={!!state.busy['deleteAllInactiveMeds']}
          style={{ width: '100%', border: '1px solid var(--red)', background: 'var(--red-bg)', color: 'var(--red)', padding: '11px 14px', borderRadius: 11, fontSize: 13, fontWeight: 600, minHeight: 46, marginBottom: 10, opacity: state.busy['deleteAllInactiveMeds'] ? 0.7 : 1 }}
        >
          {state.busy['deleteAllInactiveMeds'] ? 'กำลังลบ…' : `ลบยาที่ปิดใช้งานและยอดเป็น 0 ทั้งหมดออกจากระบบถาวร (${meds.length} รายการ)`}
        </button>
      )}

      <SearchInput value={q} onChange={setQ} placeholder="ค้นหาชื่อยา" style={{ marginBottom: 10 }} />

      <div className="card stagger" style={{ overflow: 'hidden' }}>
        {/* Category headers only render in the "ทุกหมวด" view — picking one category tab
            above is already the narrowed view, so repeating that same name as a lone header
            here would just be noise. groups (when present) determines display order, which
            is DRUG_CATEGORIES' own order rather than plain alphabetical. */}
        {(groups ? groups.flatMap((g) => g.items.map((m, i) => ({ m, header: i === 0 ? g : null }))) : meds.map((m) => ({ m, header: null })))
          .slice(0, 150)
          .map(({ m, header }) => {
          const stockLeft = m.floor > 0 || sub(m.id) > 0;
          const isEditing = editingId === m.id;
          return (
            <div key={m.id} ref={(el) => { rowRefs.current[m.id] = el; }} style={{ borderBottom: '1px solid var(--border-soft)' }}>
              {header && (
                <div style={{ padding: '9px 13px', background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-soft)', fontSize: 11.5, fontWeight: 700, color: 'var(--muted)' }}>
                  {header.label} · {header.items.length} รายการ
                </div>
              )}
              <div style={{ padding: '11px 13px', background: isEditing ? 'var(--green-tint)' : undefined }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 7 }}>
                      <MedDot code={m.code} />
                      <span>{m.name}</span>
                      {m.had && <span style={{ color: 'var(--had)', fontSize: 11, fontWeight: 700 }}>HAD</span>}
                    </div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                      {m.code} · ชั้น {isSharedMed(m) ? ('OPD ' + (m.bin || '—') + ' / IPD ' + (m.binIpd || '—')) : (m.bin || '—')}{!m.noSubstock && m.binSub ? ' · substock ' + m.binSub : ''} · {m.unit} · {nf(m.price)} บาท
                    </div>
                    {m.active && (
                      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                        หน้างาน <Qty value={m.floor} tone={toneFor(m)} size={11} /> · substock {nf(sub(m.id))} {m.unit}
                        {/* Only surfaced under the Max=Min=1 diagnostic filter above — showing
                            the actual numbers right on the row is the whole point of that
                            filter (spot them without opening each edit form one by one). */}
                        {parOneOnly && <span style={{ color: 'var(--amber-ink)', fontWeight: 600 }}> · Max {nf(m.parFloor)} / Min {nf(floorMinOf(m))} {m.unit}</span>}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 5, marginTop: 5 }}>
                      {isSharedMed(m) ? (
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--green)', background: 'var(--green-tint)', padding: '2px 7px', borderRadius: 20 }}>OPD+IPD ร่วมกัน</span>
                      ) : (
                        <span style={{ fontSize: 10, fontWeight: 700, color: WARD_COLOR[wardOf(m)], background: WARD_BG[wardOf(m)], padding: '2px 7px', borderRadius: 20 }}>{wardOf(m) === 'opd' ? 'OPD' : 'IPD'}</span>
                      )}
                      {m.noSubstock && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--amber-ink)', background: 'var(--amber-bg)', padding: '2px 7px', borderRadius: 20 }}>ไม่มี substock</span>}
                    </div>
                  </div>
                  <span style={{ flex: 'none', fontSize: 10.5, fontWeight: 700, color: m.active ? 'var(--green)' : 'var(--muted)', background: m.active ? 'var(--green-tint)' : 'var(--bg-subtle)', padding: '4px 8px', borderRadius: 20 }}>{m.active ? 'ใช้งานอยู่' : 'ปิดใช้งาน'}</span>
                </div>
                <div style={{ display: 'flex', gap: 7 }}>
                  <button onClick={() => { setEditingId(isEditing ? null : m.id); setAddOpen(false); }} style={{ flex: 1, border: '1px solid var(--green)', background: isEditing ? 'var(--green)' : 'var(--bg-card)', color: isEditing ? '#fff' : 'var(--green)', padding: '8px 4px', borderRadius: 9, fontSize: 12, fontWeight: 600, minHeight: 38 }}>
                    {isEditing ? 'ปิดฟอร์มแก้ไข' : 'แก้ไขข้อมูล'}
                  </button>
                  <button onClick={() => toggleMedActive(m.id)} style={{ flex: 1, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--ink)', padding: '8px 4px', borderRadius: 9, fontSize: 12, fontWeight: 600, minHeight: 38 }}>
                    {m.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                  </button>
                  <button
                    onClick={() => deleteMed(m.id)}
                    disabled={stockLeft}
                    title={stockLeft ? 'ยังมียอดคงเหลือ ต้องปรับยอดให้เป็น 0 ก่อน' : 'ลบถาวร'}
                    style={{ flex: 'none', border: '1px solid var(--border)', background: 'var(--bg-card)', color: stockLeft ? 'var(--muted)' : 'var(--red)', padding: '8px 11px', borderRadius: 9, fontSize: 12, minHeight: 38, whiteSpace: 'nowrap' }}
                  >
                    ลบถาวร
                  </button>
                </div>
              </div>
              {isEditing && (
                <div style={{ padding: '0 13px 14px' }}>
                  <MedForm
                    heading={null}
                    initial={formFromMed(m)}
                    submitLabel="บันทึกการแก้ไข"
                    onCancel={() => setEditingId(null)}
                    onSubmit={(v) => {
                      updateMedFull(m.id, { name: v.name, dosageForm: v.dosageForm, unit: v.unit, price: parseFloat(v.price) || 0, had: v.had, bin: v.bin, binSub: v.binSub || undefined, parSub: parseInt(v.parSub, 10) || 0, parFloor: parseInt(v.parFloor, 10) || 0, floorMin: parseInt(v.floorMin, 10) || 0, ward: v.shared ? 'opd' : v.ward, noSubstock: v.noSubstock, volatility: parseFloat(v.volatility) || 1.1, shared: v.shared, binIpd: v.shared ? v.binIpd : undefined, category: v.category || undefined });
                      setEditingId(null);
                    }}
                    // ยาชื่อเดียวกันที่แยกรายการไว้คนละ ward (คนละ Firestore doc ตามหลักการออกแบบ
                    // เดิม) มักมีชั้นวางคนละที่ ให้แก้ชั้นวางของอีกฝั่งได้จากฟอร์มนี้เลยเพื่อความ
                    // สะดวก โดยยังเป็นคนละ field ที่บันทึกแยก (setMedBin เขียนทันทีแบบ debounce
                    // เหมือนช่องอื่นๆ) — ใช้ได้เฉพาะยาที่ "ยังไม่รวมสต็อก" เท่านั้น (ถ้ารวมแล้ว
                    // isSharedMed(m) เป็น true ฟอร์มจะโชว์ชั้นวางสองรหัสของ record เดียวแทน ไม่ต้อง
                    // หา sibling อีก — และ record คู่เดิมที่ปิดใช้งานไปหลังรวม ก็ไม่ควรโผล่มาให้แก้)
                    sibling={isSharedMed(m) ? undefined : state.meds.find((x) => x.id !== m.id && x.active && x.name === m.name && wardOf(x) !== wardOf(m))}
                    onSiblingBinChange={(siblingId, val) => setMedBin(siblingId, val)}
                    onMerge={(siblingId) => mergeWardMeds(m.id, siblingId)}
                    mergeBusy={!!state.busy['mergeWardMeds:' + m.id]}
                  />
                </div>
              )}
            </div>
          );
        })}
        {meds.length === 0 && <EmptyState icon="💊" title="ไม่พบยาที่ค้นหา" sub="ลองเปลี่ยนคำค้นหา หรือสลับตัวกรองสถานะ/หอผู้ป่วยด้านบน" />}
      </div>
      {meds.length > 150 && <div className="muted" style={{ fontSize: 11.5, textAlign: 'center', marginTop: 10 }}>แสดง 150 รายการแรก — ค้นหาชื่อยาเพื่อหารายการอื่น</div>}
    </div>
  );
}

/** The one place every editable fact about a med lives — name+strength, dosage form, unit,
 * price, high-alert flag, shelf/bin, and both par levels — used both for "เพิ่มยาใหม่" (blank)
 * and a row's "แก้ไขข้อมูล" (pre-filled), so there's exactly one form to keep in sync. */
function MedForm({ heading, initial, submitLabel, onCancel, onSubmit, sibling, onSiblingBinChange, onMerge, mergeBusy }: {
  heading: string | null;
  initial: MedFormValues;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (v: MedFormValues) => void;
  /** The same drug's other-ward record (same name, opposite ward), if one exists — lets its
   * shelf code be edited right here instead of having to search it up as a separate row. */
  sibling?: Med;
  onSiblingBinChange?: (siblingId: string, val: string) => void;
  /** Folds `sibling`'s real stock into this med as one pooled OPD/IPD record — see
   * mergeWardMeds() in AppContext.tsx. Only offered when a sibling exists. */
  onMerge?: (siblingId: string) => void;
  /** True while this exact pair's mergeWardMeds() Firestore batch is in flight — a real write,
   * not instant, so the button shows "กำลังรวม…"/disables itself same as every other commit
   * button in the app instead of looking inert on a slow connection. */
  mergeBusy?: boolean;
}) {
  const [v, setV] = useState<MedFormValues>(initial);
  const set = <K extends keyof MedFormValues>(k: K, val: MedFormValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const suggestedCategory = suggestCategoryId(v.name);
  const setShared = (on: boolean) => setV((s) => ({ ...s, shared: on, binIpd: on ? s.binIpd : '' }));
  const chip = (active: boolean) => ({ border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green)' : 'var(--bg-card)', color: active ? '#fff' : 'var(--ink)' });

  return (
    <div className="card" style={{ padding: 13, marginBottom: 14, animation: 'fade .16s var(--ease-out)' }}>
      {heading && <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 10 }}>{heading}</div>}
      <label style={{ display: 'block', marginBottom: 9 }}>
        <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>ชื่อยา + ขนาด (เช่น Enalapril 5 mg)</span>
        <input value={v.name} onChange={(e) => set('name', e.target.value)} style={inputStyle} />
      </label>
      <label style={{ display: 'block', marginBottom: v.category ? 9 : 5 }}>
        <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>หมวดกลุ่มยา</span>
        <select value={v.category} onChange={(e) => set('category', e.target.value)} style={{ ...inputStyle, appearance: 'auto' as const }}>
          <option value="">— ยังไม่ระบุหมวด —</option>
          {DRUG_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </label>
      {/* Suggested from the drug's own name (see data/categorySuggest.ts) — never applied on
          its own, only offered as a one-tap accept, so a wrong guess never silently lands on
          a real med. Only shown while the category is still blank; picking anything (this
          suggestion or a manual choice) hides it. */}
      {!v.category && suggestedCategory && (
        <button
          type="button"
          onClick={() => set('category', suggestedCategory)}
          style={{ display: 'block', width: '100%', textAlign: 'left', border: '1px dashed var(--green)', background: 'var(--green-tint)', color: 'var(--green)', borderRadius: 9, padding: '7px 10px', fontSize: 11.5, fontWeight: 600, marginBottom: 9 }}
        >
          ระบบแนะนำหมวด: {categoryLabel(suggestedCategory)} — แตะเพื่อใช้
        </button>
      )}
      <div className="grid-2" style={{ marginBottom: 9 }}>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>รูปแบบยา</span>
          <input value={v.dosageForm} onChange={(e) => set('dosageForm', e.target.value)} placeholder="เช่น Tablet" style={inputStyle} />
        </label>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>หน่วย</span>
          <input value={v.unit} onChange={(e) => set('unit', e.target.value)} placeholder="เช่น เม็ด" style={inputStyle} />
        </label>
      </div>
      <div className="grid-2" style={{ marginBottom: 9 }}>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>ราคา/หน่วย (บาท)</span>
          <input value={v.price} onChange={(e) => set('price', e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" style={inputStyle} />
        </label>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>{v.shared ? 'ชั้นวาง (OPD)' : v.ward === 'ipd' ? 'ชั้นวาง (IPD)' : 'ชั้นวาง (OPD)'}</span>
          <input value={v.bin} onChange={(e) => set('bin', sanitizeBin(e.target.value))} placeholder="เช่น J4 หรือ ตู้ยา-1" style={{ ...inputStyle, textTransform: 'uppercase' as const, ...(!v.shared && v.ward === 'ipd' ? { borderColor: WARD_COLOR.ipd } : {}) }} />
        </label>
      </div>
      {/* Bug fix (usability): "เฉพาะ IPD" used to only be reachable by first unticking "ใช้ยอด
          ร่วมกัน" (on by default) and THEN picking a ward — two steps to get to a mode that's
          actually the common case for a lot of injectables (kept in a locked IPD cabinet, never
          on the OPD shelf at all). One direct 3-way choice up front instead — เฉพาะ IPD is now
          a single tap, same as เฉพาะ OPD and ใช้ร่วมกัน. */}
      <div style={{ marginBottom: 9 }}>
        <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>การใช้ชั้นวาง</span>
        <div style={{ display: 'flex', gap: 7 }}>
          {!sibling && (
            <button type="button" onClick={() => setShared(true)} style={{ flex: 1, border: v.shared ? '1px solid ' + WARD_COLOR.opd : '1px solid var(--border)', background: v.shared ? WARD_BG.opd : 'var(--bg-card)', color: v.shared ? WARD_COLOR.opd : 'var(--ink)', padding: '9px 4px', borderRadius: 9, fontSize: 12, fontWeight: 600, minHeight: 42 }}>ใช้ร่วมกัน<br />OPD+IPD</button>
          )}
          <button type="button" onClick={() => setV((s) => ({ ...s, shared: false, binIpd: '', ward: 'opd' }))} style={{ flex: 1, border: !v.shared && v.ward === 'opd' ? '1px solid ' + WARD_COLOR.opd : '1px solid var(--border)', background: !v.shared && v.ward === 'opd' ? WARD_BG.opd : 'var(--bg-card)', color: !v.shared && v.ward === 'opd' ? WARD_COLOR.opd : 'var(--ink)', padding: '9px 4px', borderRadius: 9, fontSize: 12, fontWeight: 600, minHeight: 42 }}>เฉพาะ<br />OPD</button>
          <button type="button" onClick={() => setV((s) => ({ ...s, shared: false, binIpd: '', ward: 'ipd' }))} style={{ flex: 1, border: !v.shared && v.ward === 'ipd' ? '1px solid ' + WARD_COLOR.ipd : '1px solid var(--border)', background: !v.shared && v.ward === 'ipd' ? WARD_BG.ipd : 'var(--bg-card)', color: !v.shared && v.ward === 'ipd' ? WARD_COLOR.ipd : 'var(--ink)', padding: '9px 4px', borderRadius: 9, fontSize: 12, fontWeight: 600, minHeight: 42 }}>เฉพาะ<br />IPD</button>
        </div>
        {v.shared ? (
          <div style={{ marginTop: 7 }}>
            <label style={{ display: 'block', marginBottom: 7 }}>
              <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>ชั้นวาง (IPD)</span>
              <input value={v.binIpd} onChange={(e) => set('binIpd', sanitizeBin(e.target.value))} placeholder="เช่น J4 หรือ ตู้ยา-1" style={{ ...inputStyle, textTransform: 'uppercase' as const, borderColor: WARD_COLOR.ipd }} />
            </label>
            <div style={{ fontSize: 10.5, lineHeight: 1.5, color: 'var(--green)', background: 'var(--green-tint)', borderRadius: 9, padding: '8px 10px' }}>
              ใช้สต็อกร่วมกันทั้ง OPD และ IPD — หน้างาน/par/substock เป็นยอดเดียวกันหมด ต่างกันแค่รหัสชั้นวางที่แสดงตามฝั่งที่ดู (IPD หยิบยาจากชั้น OPD ตรง ๆ)
            </div>
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.5, marginTop: 7 }}>
            {v.ward === 'ipd'
              ? 'สต็อกแยกต่างหาก เฉพาะฝั่ง IPD เท่านั้น (ไม่ขึ้นชั้น OPD เลย) — เหมาะกับยาฉีดส่วนใหญ่ที่เก็บในลิ้นชักล็อก IPD โดยเฉพาะ'
              : 'สต็อกแยกต่างหาก เฉพาะฝั่ง OPD เท่านั้น (ไม่ขึ้นชั้น IPD เลย)'}
            {' '}ถ้ายาตัวนี้ IPD จัด one-day dose โดยหยิบจากชั้น OPD ตรง ๆ (สต็อกก้อนเดียวกัน ต่างแค่ชั้นวาง) ให้เลือก "ใช้ร่วมกัน OPD+IPD" แทน
          </div>
        )}
      </div>
      {sibling && onSiblingBinChange && (
        <div className="card" style={{ padding: 11, marginBottom: 9, background: 'var(--bg-subtle)' }}>
          <label style={{ display: 'block', marginBottom: onMerge ? 9 : 0 }}>
            <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
              ชั้นวาง ({wardOf(sibling) === 'opd' ? 'OPD' : 'IPD'}) — อีกรายการของยานี้ (แยกสต็อกกันอยู่)
            </span>
            <input
              value={sibling.bin}
              onChange={(e) => onSiblingBinChange(sibling.id, e.target.value)}
              placeholder="เช่น J4 หรือ ตู้ยา-1"
              style={{ ...inputStyle, textTransform: 'uppercase' as const, borderColor: WARD_COLOR[wardOf(sibling)] }}
            />
            <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.5, marginTop: 5 }}>
              บันทึกทันทีแยกจากฟอร์มนี้ (คนละรายการยาใน DB) — แก้แค่ชั้นวาง ไม่รวมสต็อก
            </div>
          </label>
          {onMerge && (
            <button
              type="button"
              onClick={() => onMerge(sibling.id)}
              disabled={mergeBusy}
              style={{ width: '100%', border: 0, background: 'var(--green)', color: '#fff', padding: '10px 12px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, opacity: mergeBusy ? 0.7 : 1 }}
            >
              {mergeBusy ? 'กำลังรวมสต็อก…' : 'รวมสต็อก OPD+IPD เป็นยอดเดียวกัน (มีถามยืนยันอีกครั้ง)'}
            </button>
          )}
        </div>
      )}
      <label style={{ display: 'block', marginBottom: 9 }}>
        <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>ชั้นวาง substock (คลังย่อย)</span>
        <input
          value={v.binSub}
          onChange={(e) => set('binSub', sanitizeBin(e.target.value))}
          placeholder="เช่น A1 หรือ ชั้น-1 — ว่างไว้ถ้ายังไม่ได้กำหนด"
          disabled={v.noSubstock}
          style={{ ...inputStyle, textTransform: 'uppercase' as const, ...(v.noSubstock ? { background: 'var(--bg-subtle)', color: 'var(--muted)' } : {}) }}
        />
        <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.5, marginTop: 4 }}>รหัสชั้น/ตู้ในคลังย่อย substock — คนละรหัสกับชั้นวางหน้างานด้านบน (คนละห้อง คนละ QR) ใช้พิมพ์ฉลากชั้นวาง substock ในหน้าฉลาก QR ได้</div>
      </label>
      <div className="grid-2" style={{ marginBottom: 9 }}>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>par substock</span>
          <input value={v.parSub} onChange={(e) => set('parSub', digitsOnly(e.target.value))} inputMode="numeric" disabled={v.noSubstock} style={{ ...inputStyle, ...(v.noSubstock ? { background: 'var(--bg-subtle)', color: 'var(--muted)' } : {}) }} />
        </label>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>par หน้างาน (Max — เติมขึ้นถึงจุดนี้)</span>
          <input value={v.parFloor} onChange={(e) => set('parFloor', digitsOnly(e.target.value))} inputMode="numeric" style={inputStyle} />
        </label>
      </div>
      <label style={{ display: 'block', marginBottom: 9 }}>
        <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>จุดต่ำสุดต้องเติม (Min)</span>
        <input value={v.floorMin} onChange={(e) => set('floorMin', digitsOnly(e.target.value))} placeholder={'ว่างไว้ = ' + nf(floorMinOf({ parFloor: parseInt(v.parFloor, 10) || 0 } as Med)) + ' (30% ของ Max ปัดเป็นเลขลงตัว)'} inputMode="numeric" style={inputStyle} />
        <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.5, marginTop: 4 }}>ต่ำกว่าจุดนี้คือของจริงที่ต้องเติมตอนเช้า — คนละจุดกับ Max เพราะอัตราการใช้ OPD/IPD ไม่เท่ากัน แม้ยารหัสเดียวกันก็ตั้ง Min-Max ต่างกันได้ตามชั้นวางจริง</div>
      </label>
      <label style={{ display: 'block', marginBottom: 9 }}>
        <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>ตัวคูณกันชน (volatility) — ใช้ตอนคำนวณ "ค่าแนะนำ"</span>
        <input
          value={v.volatility}
          onChange={(e) => set('volatility', e.target.value.replace(/[^0-9.]/g, ''))}
          inputMode="decimal"
          style={inputStyle}
        />
        <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.5, marginTop: 4 }}>
          เวลากด "ใช้ค่าแนะนำ" ระบบคำนวณ Max = (การใช้เฉลี่ยต่อวัน) × (จำนวนวันสำรอง) × <b>ตัวเลขนี้</b> — ยิ่งสูง ยิ่งเผื่อของมากขึ้นสำหรับยาที่การใช้ไม่แน่นอน (ปกติ 1.00–1.40, ต่ำสุด 1.00 = ไม่เผื่อเลย)
        </div>
      </label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button onClick={() => set('had', !v.had)} className="chip" style={{ ...chip(v.had), flex: 1, textAlign: 'center' }}>{v.had ? '✓ ยา high alert' : 'ยา high alert?'}</button>
        <button onClick={() => set('noSubstock', !v.noSubstock)} className="chip" style={{ ...chip(v.noSubstock), flex: 1, textAlign: 'center' }}>{v.noSubstock ? '✓ ไม่มี substock' : 'ไม่มี substock?'}</button>
      </div>
      {v.noSubstock && (
        <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--amber-ink)', background: 'var(--amber-bg)', borderRadius: 9, padding: '8px 10px', marginTop: -6, marginBottom: 12 }}>
          เช่น ยาน้ำ/ยาพ่น — รับยาเข้าแล้วขึ้นหน้างานทันที ไม่ต้องเติมจาก substock อีกขั้น (par substock ปิดใช้งานให้อัตโนมัติ)
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onCancel} className="btn-outline" style={{ flex: 1, padding: 12, borderRadius: 10, fontSize: 13.5, minHeight: 46 }}>ยกเลิก</button>
        <button onClick={() => onSubmit(v)} disabled={!v.name.trim()} className="btn-primary" style={{ flex: 1, padding: 12, borderRadius: 10, fontSize: 13.5, fontWeight: 600, minHeight: 46, opacity: v.name.trim() ? 1 : 0.5 }}>{submitLabel}</button>
      </div>
    </div>
  );
}
