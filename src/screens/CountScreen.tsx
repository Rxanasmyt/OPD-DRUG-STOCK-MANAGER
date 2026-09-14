import { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { nf } from '../utils/format';
import { SearchInput } from '../components/SearchInput';
import { categoryOf, subQty, usesSubstock } from '../store/selectors';
import { DRUG_CATEGORIES } from '../data/categories';
import { EmptyState } from '../components/EmptyState';
import type { Med } from '../types';

const DAY = 86400000;

/** How the list is ordered. 'stale' (default) is what makes a real cycle count practical:
 * a 600-item formulary can't be counted in one go, so the drugs nobody has verified in the
 * longest — and the ones never counted at all — have to float to the top on their own instead
 * of being hunted for by name. 'name' is the old alphabetical behavior, kept for when someone
 * is working down a physical shelf list. */
type Sort = 'stale' | 'name';
/** Extra narrowing on top of search/category — 'typed' is for reviewing what's about to be
 * committed (the batch-save preview), 'never' for "which drugs have never been counted at all". */
type Scope = 'all' | 'never' | 'typed';
/** Which quantity is being counted — the shelf (floor) or the back-room substock. They're
 * tracked completely differently under the hood (floor is one plain number on the med, substock
 * is the sum of real lots — see subQty() in selectors.ts), so nearly everything on this screen
 * (the system-calculated number shown, which input map is read/written, which staleness clock,
 * which commit function) has to branch on this instead of being one shared code path. */
type Loc = 'floor' | 'sub';

export default function CountScreen() {
  const { state, setCountInput, commitCount, commitAllCounts, setSubCountInput, commitSubCount, commitAllSubCounts } = useApp();
  const [loc, setLoc] = useState<Loc>('floor');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('stale');
  const [scope, setScope] = useState<Scope>('all');
  const [catTab, setCatTab] = useState<'all' | string>('all');

  // Substock counting only makes sense for a med that actually keeps a separate substock at
  // all — a noSubstock med (see usesSubstock()) goes straight from the central warehouse to
  // the shelf and has no lots to count in the first place.
  const active = useMemo(() => state.meds.filter((m) => m.active && (loc === 'floor' || usesSubstock(m))), [state.meds, loc]);

  const countInputs = loc === 'floor' ? state.countInputs : state.subCountInputs;
  const setInput = loc === 'floor' ? setCountInput : setSubCountInput;
  const commitOne = loc === 'floor' ? commitCount : commitSubCount;
  const commitAll = loc === 'floor' ? commitAllCounts : commitAllSubCounts;
  const allBusyKey = loc === 'floor' ? 'countAll' : 'subCountAll';
  const oneBusyKey = (id: string) => (loc === 'floor' ? 'count:' : 'subCount:') + id;
  const systemQtyOf = (m: Med) => (loc === 'floor' ? m.floor : subQty(state, m.id));
  const lastTsOf = (m: Med) => (loc === 'floor' ? m.lastCountTs : m.lastSubCountTs);

  // Counts for the category chips are computed over every eligible med, not the currently
  // filtered slice — the chip's number has to mean "how many drugs are in this group",
  // otherwise tapping through the chips shows numbers that shift under you as you filter.
  const catCounts = useMemo(() => {
    const c: Record<string, number> = {};
    active.forEach((m) => { const k = categoryOf(m); c[k] = (c[k] || 0) + 1; });
    return c;
  }, [active]);

  const typedIds = useMemo(
    () => Object.keys(countInputs).filter((id) => countInputs[id] !== '' && !isNaN(parseInt(countInputs[id], 10)) && active.some((m) => m.id === id)),
    [countInputs, active],
  );
  const typedSet = useMemo(() => new Set(typedIds), [typedIds]);

  // Variance preview for the batch-save button — how many of the typed rows actually differ
  // from what the system thinks, computed before committing anything, so nobody commits 30
  // rows without knowing whether they're about to move stock or just confirm it.
  const typedDiffCount = useMemo(() => {
    let n = 0;
    typedIds.forEach((id) => {
      const m = active.find((x) => x.id === id);
      if (m && parseInt(countInputs[id], 10) !== systemQtyOf(m)) n++;
    });
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typedIds, active, countInputs, loc]);

  const staleness = (m: Med) => { const ts = lastTsOf(m); return ts ? Date.now() - ts : Number.MAX_SAFE_INTEGER; };

  const meds = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return active
      .filter((m) => !needle || m.name.toLowerCase().indexOf(needle) >= 0)
      .filter((m) => catTab === 'all' || categoryOf(m) === catTab)
      .filter((m) => scope === 'all' || (scope === 'never' ? !lastTsOf(m) : typedSet.has(m.id)))
      .sort((a, b) => (sort === 'name'
        ? a.name.localeCompare(b.name, 'th')
        // Never-counted first (MAX_SAFE_INTEGER staleness), then oldest count first; ties
        // broken by name so the order is stable rather than dependent on array order.
        : staleness(b) - staleness(a) || a.name.localeCompare(b.name, 'th')))
      .slice(0, 150);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, q, catTab, scope, sort, typedSet, loc]);

  const countedEver = useMemo(() => active.filter((m) => !!lastTsOf(m)).length, [active, loc]); // eslint-disable-line react-hooks/exhaustive-deps
  const countedRecently = useMemo(() => active.filter((m) => { const ts = lastTsOf(m); return ts && Date.now() - ts < 30 * DAY; }).length, [active, loc]); // eslint-disable-line react-hooks/exhaustive-deps
  const chip = (on: boolean) => ({ border: on ? '1px solid var(--green)' : '1px solid var(--border)', background: on ? 'var(--green)' : 'var(--bg-card)', color: on ? '#fff' : 'var(--ink)' });

  return (
    <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
      <div style={{ display: 'flex', gap: 7, marginBottom: 10 }}>
        <button className="chip" style={{ ...chip(loc === 'floor'), flex: 1, minHeight: 40 }} onClick={() => setLoc('floor')}>นับหน้างาน (floor)</button>
        <button className="chip" style={{ ...chip(loc === 'sub'), flex: 1, minHeight: 40 }} onClick={() => setLoc('sub')}>นับ substock</button>
      </div>

      {loc === 'floor' ? (
        <div style={{ background: 'var(--green-tint)', borderRadius: 12, padding: '12px 13px', fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
          ฟังก์ชันเสริม — ใช้เมื่อสงสัยว่ายอดคลาดเคลื่อนมาก หรือเมื่อมีกำลังคนพอ ไม่จำเป็นต้องทำเป็นประจำ ("นำเข้า HOSxP" ในเมนูหลักเป็นวิธีหลักที่ใช้เวลาน้อยกว่า) นับของจริงแล้วกรอก ระบบจะแก้ยอดให้ตรงและบันทึกส่วนต่างลง discrepancy log ให้อัตโนมัติ
        </div>
      ) : (
        <div style={{ background: 'var(--amber-bg)', borderRadius: 12, padding: '12px 13px', fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
          นับของจริงในคลังย่อย substock (ไม่ใช่บนชั้นหน้างาน) ระบบจะเทียบกับผลรวม lot ที่มีอยู่ — ถ้านับได้{'น้อยกว่า'}จะตัดออกจาก lot ที่ใกล้หมดอายุที่สุดก่อน ถ้านับได้{'มากกว่า'}จะลงเป็น lot ใหม่แบบ "ปรับยอด" (ยังไม่ทราบวันหมดอายุจริง จนกว่าจะแก้ไข) — เหมาะมากสำหรับตั้งยอดเริ่มต้นตอนเปลี่ยนจากกระดาษมาเป็นแอพ
        </div>
      )}

      {/* Coverage bar — a cycle count is a long-running job, not a one-sitting task, so the
          screen has to answer "how far through the formulary are we?" without anyone tallying
          it by hand. 30 วัน is the same window used for the usage stats elsewhere in the app. */}
      <div className="card" style={{ padding: '11px 13px', marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 7, gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>ความคืบหน้าการนับ</span>
          <span className="muted" style={{ fontSize: 11.5 }}>นับใน 30 วันล่าสุด {nf(countedRecently)} / {nf(active.length)} รายการ</span>
        </div>
        <div className="bar-track" style={{ height: 6, background: 'var(--border-soft)', borderRadius: 3 }}>
          <div className="bar-fill" style={{ height: '100%', width: Math.max(2, Math.round((countedRecently / Math.max(1, active.length)) * 100)) + '%', background: 'var(--green)', borderRadius: 3 }} />
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
          เคยนับอย่างน้อยครั้งหนึ่งแล้ว {nf(countedEver)} รายการ · ยังไม่เคยนับเลย {nf(active.length - countedEver)} รายการ
        </div>
      </div>

      <SearchInput value={q} onChange={setQ} placeholder="ค้นหาชื่อยา" style={{ marginBottom: 9 }} />

      <div style={{ display: 'flex', gap: 7, marginBottom: 8, overflowX: 'auto', paddingBottom: 2 }}>
        <button className="chip" style={{ ...chip(sort === 'stale'), flex: 'none' }} onClick={() => setSort('stale')}>เรียงตามที่ค้างนานสุด</button>
        <button className="chip" style={{ ...chip(sort === 'name'), flex: 'none' }} onClick={() => setSort('name')}>เรียงตามชื่อยา</button>
      </div>
      <div style={{ display: 'flex', gap: 7, marginBottom: 8, overflowX: 'auto', paddingBottom: 2 }}>
        <button className="chip" style={{ ...chip(scope === 'all'), flex: 'none' }} onClick={() => setScope('all')}>ทั้งหมด</button>
        <button className="chip" style={{ ...chip(scope === 'never'), flex: 'none' }} onClick={() => setScope('never')}>ยังไม่เคยนับ ({nf(active.length - countedEver)})</button>
        <button className="chip" style={{ ...chip(scope === 'typed'), flex: 'none' }} onClick={() => setScope('typed')}>ที่กรอกไว้ ({nf(typedIds.length)})</button>
      </div>
      <div style={{ display: 'flex', gap: 7, marginBottom: 10, overflowX: 'auto', paddingBottom: 2 }}>
        <button className="chip" style={{ ...chip(catTab === 'all'), flex: 'none' }} onClick={() => setCatTab('all')}>ทุกหมวด</button>
        {DRUG_CATEGORIES.map((c) => catCounts[c.id] ? (
          <button key={c.id} className="chip" style={{ ...chip(catTab === c.id), flex: 'none' }} onClick={() => setCatTab(c.id)}>{c.label} ({catCounts[c.id]})</button>
        ) : null)}
      </div>

      {typedIds.length > 0 && (
        <button
          onClick={commitAll}
          disabled={!!state.busy[allBusyKey]}
          style={{ width: '100%', border: 0, background: 'var(--green)', color: '#fff', padding: '12px 14px', borderRadius: 11, fontSize: 13.5, fontWeight: 700, minHeight: 48, marginBottom: 12, opacity: state.busy[allBusyKey] ? 0.7 : 1 }}
        >
          {state.busy[allBusyKey]
            ? 'กำลังบันทึก…'
            : `บันทึกที่กรอกไว้ทั้งหมด (${nf(typedIds.length)} รายการ` + (typedDiffCount > 0 ? ` · มีส่วนต่าง ${nf(typedDiffCount)})` : ' · ตรงกับระบบทุกรายการ)')}
        </button>
      )}

      <div className="card stagger" style={{ overflow: 'hidden' }}>
        {meds.map((m) => {
          const typed = countInputs[m.id] ?? '';
          const parsed = parseInt(typed, 10);
          const has = typed !== '' && !isNaN(parsed);
          const sysQty = systemQtyOf(m);
          const delta = has ? parsed - sysQty : 0;
          // Bug fix: lastCountTs/lastSubCountTs is unset for any med that's never had this
          // optional count committed (the common case — this screen is explicitly "ไม่จำเป็น
          // ต้องทำเป็นประจำ"). Date.now() - undefined is NaN, which used to render literally as
          // "นับล่าสุด NaN วันก่อน" for every such drug — a real, visible glitch, not a
          // hypothetical one.
          const ts = lastTsOf(m);
          const daysSince = ts ? Math.floor((Date.now() - ts) / DAY) : null;
          const stale = daysSince === null || daysSince >= 90;
          return (
            <div key={m.id} style={{ padding: '11px 13px', borderBottom: '1px solid var(--border-soft)', background: has ? 'var(--green-tint)' : undefined }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 }}>{m.name}</div>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                    ระบบคำนวณ {nf(sysQty)} {m.unit} · <span style={stale ? { color: 'var(--amber-ink)', fontWeight: 700 } : undefined}>นับล่าสุด {daysSince === null ? 'ยังไม่เคยนับ' : daysSince <= 0 ? 'วันนี้' : daysSince + ' วันก่อน'}</span>
                  </div>
                  {has && delta !== 0 && (
                    <div style={{ fontSize: 11.5, marginTop: 2, fontWeight: 600, color: delta < 0 ? 'var(--red)' : 'var(--amber)' }}>
                      {delta < 0
                        ? 'น้อยกว่าระบบ ' + nf(Math.abs(delta)) + ' ' + m.unit + (loc === 'floor' ? ' (คาดว่าจ่ายผ่าน HOSxP)' : ' (จะตัดจาก lot ใกล้หมดอายุที่สุดก่อน)')
                        : 'มากกว่าระบบ ' + nf(delta) + ' ' + m.unit + (loc === 'sub' ? ' (จะลงเป็น lot ปรับยอด)' : '')}
                    </div>
                  )}
                  {has && delta === 0 && (
                    <div style={{ fontSize: 11.5, marginTop: 2, fontWeight: 600, color: 'var(--green)' }}>ตรงกับระบบ</div>
                  )}
                </div>
                <input
                  value={typed}
                  onChange={(e) => setInput(m.id, e.target.value)}
                  inputMode="numeric"
                  aria-label={'จำนวนที่นับได้ ' + m.name}
                  placeholder="นับได้"
                  // Bug fix (mobile fit): under 16px, iOS Safari zooms the whole page in the
                  // moment this field is focused — a real problem on a screen meant for
                  // walking the shelf and typing a count into row after row quickly.
                  style={{ width: 78, flex: 'none', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 6px', fontSize: 16, fontWeight: 600, textAlign: 'center', minHeight: 42 }}
                />
                <button
                  disabled={!has || !!state.busy[oneBusyKey(m.id)]}
                  onClick={() => commitOne(m.id)}
                  style={{ flex: 'none', border: 0, background: has ? 'var(--green)' : 'var(--border-strong)', color: '#fff', padding: '9px 12px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, minHeight: 42, opacity: state.busy[oneBusyKey(m.id)] ? 0.7 : 1 }}
                >
                  {state.busy[oneBusyKey(m.id)] ? '…' : 'บันทึก'}
                </button>
              </div>
            </div>
          );
        })}
        {meds.length === 0 && <EmptyState icon="🔢" title="ไม่พบยาตามเงื่อนไขนี้" sub="ลองเปลี่ยนคำค้นหา หมวดกลุ่มยา หรือตัวกรองด้านบน" />}
      </div>
      {meds.length >= 150 && <div className="muted" style={{ fontSize: 11.5, textAlign: 'center', marginTop: 10 }}>แสดง 150 รายการแรกตามลำดับที่เลือก — ค้นหาหรือกรองเพิ่มเพื่อดูรายการอื่น</div>}
    </div>
  );
}
