import { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { toneFor, usesSubstock, floorMinOf, isUrgentLow, categoryOf, binDisplayAll } from '../store/selectors';
import { nf, thDate, digitsOnly } from '../utils/format';
import { medColor } from '../utils/color';
import { MedDot } from '../components/MedDot';
import { Qty, DeficitBadge } from '../components/Qty';
import { MedMiniCard } from '../components/MedMiniCard';
import { EmptyState } from '../components/EmptyState';
import { StepIndicator, TRANSFER_STEPS } from '../components/StepIndicator';
import { SearchInput } from '../components/SearchInput';
import { DRUG_CATEGORIES } from '../data/categories';

// Informational only — never filters or hides anything, just a heads-up. Which OPD clinics run
// which weekday (จันทร์–ศุกร์ only — the hospital's real weekly schedule) drives which drug
// groups tend to move faster than usual that specific day, on top of "ตรวจทั่วไป"/symptomatic
// use that happens every day regardless. Keyed by Date.getDay() (0=อาทิตย์…6=เสาร์); no entry
// for 0/6 since there's no special weekday clinic to call out then.
const WEEKDAY_CLINICS: Record<number, string> = {
  1: 'จันทร์: COPD / หอบหืด, TB, ANC',
  2: 'อังคาร: เบาหวาน',
  3: 'พุธ: ไตเรื้อรัง (CKD), ANC',
  4: 'พฤหัสบดี: ความดันโลหิตสูง',
  5: 'ศุกร์: Warfarin, หัวใจ/หลอดเลือด, จิตเวช',
};

export default function TransferScreen() {
  const { state, sub, fefo, setSearch, setFilter, bump, setCartQty, fillAll, fillUrgent, clearCart, printPickList, printTodayReplenishList, printUrgentReplenishList, go, openScanSearch } = useApp();
  // Only one row's "เคลื่อนไหวล่าสุด" panel expanded at a time (opt-in, not automatic) — the
  // list can render up to 60 rows, and MedMiniCard fetches a real Firestore query per drug, so
  // expanding all of them at once would fire dozens of queries for a screen someone's trying
  // to move through quickly. One at a time keeps it fast and never surprises with a slow
  // screen after a search or filter change.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // หมวดกลุ่มยา — ตัวกรองแยกต่างหากจากตัวกรอง low/all/had ด้านบน (คนละมิติกัน ใช้ร่วมกันได้):
  // กลุ่มที่จ่ายออกทุกวัน (ยาแก้ปวด/ปฏิชีวนะ) ไล่ดูรวดเดียวได้ ส่วนกลุ่มที่ใช้นาน ๆ ครั้ง (ยาฉุกเฉิน)
  // ก็กรองดูเฉพาะกลุ่มนั้นได้โดยไม่ต้องไล่สายตาผ่านรายการทั้งหมดทุกเช้า. Local view state, not
  // global AppContext state — same pattern as MedsScreen's wardTab, a pure display filter with
  // nothing else in the app needing to read it.
  const [catTab, setCatTab] = useState<'all' | string>('all');
  // How the list is ordered. 'need' (default) keeps the original behavior — emptiest shelves
  // relative to their own Max first, so the most urgent refills are always on top. 'bin' walks
  // the list in shelf-code order instead, which is what someone actually pushing a cart down
  // the aisle wants: one pass past each shelf rather than criss-crossing the room in urgency
  // order. 'name' is for when someone is looking up a specific drug in a familiar list.
  const [sort, setSort] = useState<'need' | 'bin' | 'name'>('need');
  // Collapsible, not persisted — a fresh "should I check today's clinics" nudge each time this
  // screen is opened (resets when the app is reopened/refreshed, which happens naturally at
  // least once a day on a shared phone) rather than a one-time-ever dismissal that would go
  // stale and stop being useful within a week.
  const [showClinicInfo, setShowClinicInfo] = useState(true);
  const todayClinics = WEEKDAY_CLINICS[new Date().getDay()];
  // Friday-only nudge, separate from the clinic-info banner above (this one is actionable, not
  // just FYI) — the shelf isn't topped up again until Monday, so whatever's left after Friday's
  // fill has to survive a real 3-day gap (Fri+Sat+Sun). Filling only up to Min on Friday (the
  // everyday habit the rest of the week) leaves a shelf just barely above its weekday reorder
  // point to somehow last three days with nobody there to top it up if it runs low — filling all
  // the way to Max specifically on Friday is what actually closes that gap.
  const [showFridayNudge, setShowFridayNudge] = useState(true);
  const isFriday = new Date().getDay() === 5;
  // noSubstock meds (liquids/sprays — received straight to the shelf, see ReceiveScreen)
  // have nothing to transfer from; showing them here with permanently-stuck-at-0 +/- buttons
  // would just be confusing clutter, not a real "เติมหน้างาน" candidate.
  // OPD/IPD ward tabs removed — one combined list (wardFilter stays 'all').
  const meds = state.meds.filter((m) => m.active && usesSubstock(m));
  const low = meds.filter((m) => m.floor < floorMinOf(m));
  // Subset of `low` already at/below half of Min — see isUrgentLow()'s doc comment
  // (selectors.ts) for why this exists: a short-staffed day needs a way to do just the
  // can't-wait items without either doing everything below Min or guessing which ones matter.
  const urgent = meds.filter(isUrgentLow);
  const q = state.search.trim().toLowerCase();
  const filteredByStatus = meds.filter((m) => {
    if (q && m.name.toLowerCase().indexOf(q) < 0) return false;
    if (state.filter === 'low') return m.floor < floorMinOf(m);
    if (state.filter === 'urgent') return isUrgentLow(m);
    if (state.filter === 'had') return m.had;
    return true;
  });
  // Counts per category under the low/all/had + search filter above but BEFORE the category
  // tab itself narrows anything — same reasoning as MedsScreen's catCounts: seeing "ยาแก้ปวด…
  // (18)" next to "ยาฉุกเฉิน… (2)" is what makes a high-volume vs. low-volume group visible at
  // a glance, before even tapping a chip.
  const catCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredByStatus.forEach((m) => { const c = categoryOf(m); counts[c] = (counts[c] || 0) + 1; });
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meds, state.filter, q]);
  const filtered = filteredByStatus
    .filter((m) => catTab === 'all' || categoryOf(m) === catTab)
    // Bug fix: a brand-new med with parFloor still 0 (Max not set yet) made this divide by
    // zero — 0/0 is NaN, and a sort comparator that ever returns NaN breaks the sort's
    // ordering guarantee for the WHOLE list, not just that one row (V8 doesn't handle NaN
    // comparisons predictably). Math.max(1, ...) matches the same guard toneFor() already
    // uses for this exact ratio elsewhere.
    .sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'th');
      if (sort === 'bin') {
        // Blank shelf codes sort last rather than first — an unassigned bin is not "shelf A",
        // it's "nobody has told the app where this lives yet", and floating those to the top
        // of a walking route would be actively wrong.
        const ab = binDisplayAll(a);
        const bb = binDisplayAll(b);
        if (!ab !== !bb) return ab ? -1 : 1;
        return ab.localeCompare(bb, 'en') || a.name.localeCompare(b.name, 'th');
      }
      return a.floor / Math.max(1, a.parFloor) - b.floor / Math.max(1, b.parFloor);
    });

  const cartIds = Object.keys(state.cart);
  const chip = (active: boolean) => ({ border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green)' : 'var(--bg-card)', color: active ? '#fff' : 'var(--ink)' });

  return (
    <div style={{ animation: 'fade .18s' }}>
      <StepIndicator steps={TRANSFER_STEPS} current={0} />
      {/* เตือนเฉยๆ ไม่กรอง/ไม่ซ่อนอะไร — คลินิกวันนี้อาจทำให้ยากลุ่มนี้ใช้เร็วกว่าปกติ เผื่อดูก่อน
          รายการอื่นที่เหลือ ("ตรวจทั่วไป" ใช้ยาแทบทุกหมวดอยู่แล้วทุกวัน ไม่ต้องระบุแยก) */}
      {todayClinics && showClinicInfo && (
        <div style={{ margin: '10px 14px 0', padding: '9px 12px', background: 'var(--bg-subtle)', border: '1px solid var(--border-soft)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
          <span style={{ flex: 'none', fontSize: 14 }}>📅</span>
          <span className="muted" style={{ flex: 1, lineHeight: 1.4 }}>คลินิกวันนี้ — {todayClinics} · ยากลุ่มนี้อาจใช้เร็วกว่าปกติ</span>
          <button onClick={() => setShowClinicInfo(false)} aria-label="ปิดข้อความนี้" style={{ flex: 'none', border: 0, background: 'transparent', color: 'var(--muted)', fontSize: 15, padding: '2px 4px', lineHeight: 1 }}>✕</button>
        </div>
      )}
      {/* Actionable (not just FYI) — เฉพาะวันศุกร์: เสาร์-อาทิตย์ไม่มีเติมหน้างาน ของที่เติมวันนี้
          ต้องอยู่ได้ถึงเช้าวันจันทร์ เติมแค่ถึง Min แบบวันธรรมดาทั่วไปไม่พอ */}
      {isFriday && showFridayNudge && (
        <div style={{ margin: '10px 14px 0', padding: '9px 12px', background: 'var(--amber-bg)', border: '1px solid var(--amber)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
          <span style={{ flex: 'none', fontSize: 14 }}>⚠️</span>
          <span style={{ flex: 1, lineHeight: 1.4, color: 'var(--amber-ink)' }}>วันนี้ศุกร์ — เสาร์-อาทิตย์ไม่มีเติมหน้างาน แนะนำเติมให้เต็ม Max แทนแค่ถึง Min เผื่อของอยู่ได้ถึงวันจันทร์</span>
          <button onClick={() => setShowFridayNudge(false)} aria-label="ปิดข้อความนี้" style={{ flex: 'none', border: 0, background: 'transparent', color: 'var(--amber-ink)', fontSize: 15, padding: '2px 4px', lineHeight: 1 }}>✕</button>
        </div>
      )}
      <div style={{ padding: '12px 14px 10px' }} className="sticky-bar">
        <div style={{ display: 'flex', gap: 8 }}>
          <SearchInput
            value={state.search}
            onChange={setSearch}
            placeholder="ค้นหาชื่อยา / สแกน QR"
            style={{ flex: 1, minWidth: 0 }}
          />
          <button onClick={() => openScanSearch('transfer')} title="สแกน QR เติมหน้างาน" aria-label="สแกน QR เติมหน้างาน" style={{ border: '1px solid var(--green)', background: 'var(--green-tint)', color: 'var(--green)', borderRadius: 10, width: 46, minHeight: 44, fontSize: 17, flex: 'none' }}>▣</button>
        </div>
        <div style={{ display: 'flex', gap: 7, marginTop: 9, overflowX: 'auto', paddingBottom: 2 }}>
          {/* "เร่งด่วนวันนี้" — ต่ำกว่าครึ่งหนึ่งของ Min เท่านั้น (isUrgentLow) — วันที่กำลังคนน้อย
              กดดูแค่กลุ่มนี้ก่อนได้ ไม่ต้องเติมทุกอย่างที่ต่ำกว่า Min ในครั้งเดียว */}
          <button className="chip" style={{ ...chip(state.filter === 'urgent'), ...(state.filter === 'urgent' ? { background: 'var(--red)', borderColor: 'var(--red)' } : { color: urgent.length ? 'var(--red)' : undefined, borderColor: urgent.length ? 'var(--red)' : undefined }) }} onClick={() => setFilter('urgent')}>🔴 เร่งด่วนวันนี้ ({urgent.length})</button>
          <button className="chip" style={chip(state.filter === 'low')} onClick={() => setFilter('low')}>ต่ำกว่า Min ({low.length})</button>
          <button className="chip" style={chip(state.filter === 'all')} onClick={() => setFilter('all')}>ทั้งหมด</button>
          <button className="chip" style={chip(state.filter === 'had')} onClick={() => setFilter('had')}>High alert</button>
          {urgent.length > 0 && (
            <button className="chip" style={{ border: '1px dashed var(--red)', background: 'transparent', color: 'var(--red)' }} onClick={fillUrgent} title="เติมเฉพาะรายการที่ต่ำกว่าครึ่งหนึ่งของ Min — ที่เหลือรอได้ ไม่ต้องเติมทีละเยอะๆ">เติมเฉพาะเร่งด่วนวันนี้</button>
          )}
          <button className="chip" style={{ border: '1px dashed var(--green)', background: 'transparent', color: 'var(--green)' }} onClick={fillAll}>เติมตาม par ทั้งหมด</button>
          {/* พิมพ์เฉพาะเร่งด่วนวันนี้ — สำหรับส่งให้คนอื่นช่วยเดินเติมแค่ส่วนวิกฤต โดยไม่ต้อง
              เปิดแอพ/ถือโทรศัพท์เอง เห็นแค่กระดาษก็เดินเติมได้เลย */}
          {urgent.length > 0 && (
            <button
              className="chip"
              style={{ border: '1px solid var(--red)', background: 'var(--red-bg)', color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 5 }}
              onClick={printUrgentReplenishList}
              title="พิมพ์เฉพาะรายการเร่งด่วน (ต่ำกว่าครึ่งหนึ่งของ Min) — ไม่กระทบตะกร้า"
            >
              🖨 พิมพ์เฉพาะเร่งด่วนวันนี้ ({urgent.length})
            </button>
          )}
          <button
            className="chip"
            style={{ border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 5 }}
            onClick={printTodayReplenishList}
            title="พิมพ์รายการที่ต้องเติมวันนี้ให้ถึง par — ไม่กระทบตะกร้า"
          >
            🖨 พิมพ์ใบเติมหน้างานวันนี้{low.length > 0 ? ' (' + low.length + ')' : ''}
          </button>
        </div>
        {/* หมวดกลุ่มยา — คนละมิติกับตัวกรอง low/all/had ด้านบน ใช้ร่วมกันได้ ให้เลือกดูเฉพาะกลุ่มที่
            จ่ายออกเยอะทุกวันแยกจากกลุ่มที่ใช้นาน ๆ ครั้งได้ ไม่ต้องไล่สายตาผ่านทั้งฟอร์มมิวลารี */}
        <div style={{ display: 'flex', gap: 7, marginTop: 8, overflowX: 'auto', paddingBottom: 2 }}>
          <button className="chip" style={chip(catTab === 'all')} onClick={() => setCatTab('all')}>ทุกหมวด</button>
          {DRUG_CATEGORIES.map((c) => catCounts[c.id] ? (
            <button key={c.id} className="chip" style={chip(catTab === c.id)} onClick={() => setCatTab(c.id)}>{c.label} ({catCounts[c.id]})</button>
          ) : null)}
        </div>
        {/* ลำดับการแสดง — "ตามชั้นวาง" คือลำดับสำหรับเดินหยิบของจริงรอบเดียวจบ ไม่ต้องเดินย้อนไปมา */}
        <div style={{ display: 'flex', gap: 7, marginTop: 8, overflowX: 'auto', paddingBottom: 2 }}>
          <span className="muted" style={{ fontSize: 11, flex: 'none', alignSelf: 'center', paddingRight: 2 }}>เรียง:</span>
          <button className="chip" style={chip(sort === 'need')} onClick={() => setSort('need')}>ขาดมากสุดก่อน</button>
          <button className="chip" style={chip(sort === 'bin')} onClick={() => setSort('bin')}>ตามชั้นวาง</button>
          <button className="chip" style={chip(sort === 'name')} onClick={() => setSort('name')}>ตามชื่อยา</button>
        </div>
      </div>

      <div style={{ padding: '10px 14px 96px' }}>
        {filtered.slice(0, 60).map((m, i) => {
          const f = fefo(m.id);
          const inCart = !!state.cart[m.id];
          return (
            <div
              key={m.id}
              className="card"
              style={{
                padding: '11px 12px 11px 14px', marginBottom: 8, borderColor: inCart ? 'var(--green)' : 'var(--border)',
                borderLeft: '4px solid ' + medColor(m.code), animation: 'pop .22s var(--ease-out) both', animationDelay: Math.min(i, 10) * 18 + 'ms',
              }}
            >
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 7 }}>
                    <MedDot code={m.code} />
                    <span>{m.name}</span>
                    {m.had && <span style={{ color: 'var(--had)', fontSize: 11, fontWeight: 700 }}>HAD</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                    หน้างาน <Qty value={m.floor} unit={m.unit} tone={toneFor(m)} size={12.5} /> · Min {nf(floorMinOf(m))} / Max {nf(m.parFloor)} · substock {nf(sub(m.id))} / par {nf(m.parSub)} {m.unit}
                  </div>
                  {/* Same at-a-glance floor-vs-par bar HomeScreen's low-stock list already uses
                      — brought here too so the screen someone actually works from all day shows
                      the same clear picture, not just a line of numbers to parse. */}
                  <div className="bar-track" style={{ height: 4, background: 'var(--border-soft)', borderRadius: 2, marginTop: 5 }}>
                    <div className="bar-fill" style={{ height: '100%', width: Math.max(3, Math.min(100, Math.round((m.floor / Math.max(1, m.parFloor)) * 100))) + '%', background: toneFor(m), borderRadius: 2 }} />
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--green)', marginTop: 5 }}>
                    FEFO: lot {f ? f.lotNo : '—'} · exp {f ? thDate(f.exp) : 'ไม่มีของใน substock'}
                    {f && <span className="muted"> (เหลือ {nf(f.qty)})</span>}
                  </div>
                  <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <DeficitBadge amount={Math.max(0, m.parFloor - m.floor)} unit={m.unit} urgent={isUrgentLow(m)} />
                    <button
                      onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}
                      style={{ border: 0, background: 'transparent', color: 'var(--muted)', fontSize: 11, fontWeight: 600, padding: '2px 0' }}
                    >
                      {expandedId === m.id ? 'ซ่อนภาพรวม ▲' : 'ดูภาพรวม ▾'}
                    </button>
                  </div>
                  {expandedId === m.id && <MedMiniCard medId={m.id} unit={m.unit} />}
                </div>
                <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button onClick={() => bump(m.id, -1)} aria-label={'ลดจำนวน ' + m.name} className="press-spring" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)', width: 40, height: 40, borderRadius: 10, fontSize: 19, lineHeight: 1 }}>−</button>
                  <input
                    value={state.cart[m.id] || ''}
                    onChange={(e) => setCartQty(m.id, digitsOnly(e.target.value))}
                    inputMode="numeric"
                    aria-label={'จำนวน ' + m.name}
                    // Bug fix (mobile fit): under 16px, iOS Safari zooms the whole page in on
                    // focus — this is the highest-traffic numeric field on the busiest screen
                    // in the app (walking the shelf, bumping cart quantities item by item).
                    style={{ width: 62, height: 40, textAlign: 'center', border: '1px solid var(--border)', borderRadius: 10, fontSize: 16, fontWeight: 600 }}
                  />
                  <button onClick={() => bump(m.id, 1)} aria-label={'เพิ่มจำนวน ' + m.name} className="press-spring" style={{ border: '1px solid var(--green)', background: 'var(--green-tint)', color: 'var(--green)', width: 40, height: 40, borderRadius: 10, fontSize: 19, lineHeight: 1 }}>+</button>
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <EmptyState icon="💊" title="ไม่พบรายการยาที่ค้นหา" sub="ลองพิมพ์ชื่อยาแบบสั้นลง หรือเปลี่ยนตัวกรองด้านบน" />}
      </div>

      {cartIds.length > 0 && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 66, padding: '10px 14px', background: 'linear-gradient(to top, var(--bg-app) 60%, rgba(247,246,242,0))', display: 'flex', gap: 10, alignItems: 'center' }}>
          <div className="muted" style={{ fontSize: 12.5, flex: 1, lineHeight: 1.35 }}>
            {cartIds.length} รายการ · {nf(cartIds.reduce((s, id) => s + state.cart[id], 0))} หน่วย
            {cartIds.some((id) => meds.find((m) => m.id === id)?.had) && (
              <span style={{ display: 'block', color: 'var(--had)', fontWeight: 600 }}>มียา high alert — ต้องสแกน QR ยืนยัน</span>
            )}
          </div>
          <button onClick={clearCart} title="ล้างตะกร้าทั้งหมด" aria-label="ล้างตะกร้าทั้งหมด" style={{ flex: 'none', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--muted)', width: 50, height: 50, borderRadius: 12, fontSize: 18 }}>🗑</button>
          <button onClick={printPickList} title="พิมพ์ใบจัดยาเติมชั้น" aria-label="พิมพ์ใบจัดยาเติมชั้น" style={{ flex: 'none', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--ink)', width: 50, height: 50, borderRadius: 12, fontSize: 18 }}>🖨</button>
          <button onClick={() => go('tconfirm')} className="btn-primary" style={{ padding: '14px 22px', borderRadius: 12, fontSize: 15, fontWeight: 600, minHeight: 50, boxShadow: '0 6px 18px -6px rgba(23,85,47,.7)' }}>ตรวจสอบ →</button>
        </div>
      )}
    </div>
  );
}
