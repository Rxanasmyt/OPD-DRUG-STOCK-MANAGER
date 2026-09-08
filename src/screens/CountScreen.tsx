import { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { nf } from '../utils/format';
import { SearchInput } from '../components/SearchInput';
import { categoryOf } from '../store/selectors';
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

export default function CountScreen() {
  const { state, setCountInput, commitCount, commitAllCounts } = useApp();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('stale');
  const [scope, setScope] = useState<Scope>('all');
  const [catTab, setCatTab] = useState<'all' | string>('all');

  const active = useMemo(() => state.meds.filter((m) => m.active), [state.meds]);

  // Counts for the category chips are computed over every active med, not the currently
  // filtered slice — the chip's number has to mean "how many drugs are in this group",
  // otherwise tapping through the chips shows numbers that shift under you as you filter.
  const catCounts = useMemo(() => {
    const c: Record<string, number> = {};
    active.forEach((m) => { const k = categoryOf(m); c[k] = (c[k] || 0) + 1; });
    return c;
  }, [active]);

  const typedIds = useMemo(
    () => Object.keys(state.countInputs).filter((id) => state.countInputs[id] !== '' && !isNaN(parseInt(state.countInputs[id], 10))),
    [state.countInputs],
  );
  const typedSet = useMemo(() => new Set(typedIds), [typedIds]);

  // Variance preview for the batch-save button — how many of the typed rows actually differ
  // from what the system thinks, computed before committing anything, so nobody commits 30
  // rows without knowing whether they're about to move stock or just confirm it.
  const typedDiffCount = useMemo(() => {
    let n = 0;
    typedIds.forEach((id) => {
      const m = active.find((x) => x.id === id);
      if (m && parseInt(state.countInputs[id], 10) !== m.floor) n++;
    });
    return n;
  }, [typedIds, active, state.countInputs]);

  const staleness = (m: Med) => (m.lastCountTs ? Date.now() - m.lastCountTs : Number.MAX_SAFE_INTEGER);

  const meds = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return active
      .filter((m) => !needle || m.name.toLowerCase().indexOf(needle) >= 0)
      .filter((m) => catTab === 'all' || categoryOf(m) === catTab)
      .filter((m) => scope === 'all' || (scope === 'never' ? !m.lastCountTs : typedSet.has(m.id)))
      .sort((a, b) => (sort === 'name'
        ? a.name.localeCompare(b.name, 'th')
        // Never-counted first (MAX_SAFE_INTEGER staleness), then oldest count first; ties
        // broken by name so the order is stable rather than dependent on array order.
        : staleness(b) - staleness(a) || a.name.localeCompare(b.name, 'th')))
      .slice(0, 150);
  }, [active, q, catTab, scope, sort, typedSet]);

  const countedEver = useMemo(() => active.filter((m) => !!m.lastCountTs).length, [active]);
  const countedRecently = useMemo(() => active.filter((m) => m.lastCountTs && Date.now() - m.lastCountTs < 30 * DAY).length, [active]);
  const chip = (on: boolean) => ({ border: on ? '1px solid var(--green)' : '1px solid var(--border)', background: on ? 'var(--green)' : 'var(--bg-card)', color: on ? '#fff' : 'var(--ink)' });

  return (
    <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
      <div style={{ background: 'var(--green-tint)', borderRadius: 12, padding: '12px 13px', fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
        ฟังก์ชันเสริม — ใช้เมื่อสงสัยว่ายอดคลาดเคลื่อนมาก หรือเมื่อมีกำลังคนพอ ไม่จำเป็นต้องทำเป็นประจำ ("นำเข้า HOSxP" ในเมนูหลักเป็นวิธีหลักที่ใช้เวลาน้อยกว่า) นับของจริงแล้วกรอก ระบบจะแก้ยอดให้ตรงและบันทึกส่วนต่างลง discrepancy log ให้อัตโนมัติ
      </div>

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
          onClick={commitAllCounts}
          disabled={!!state.busy['countAll']}
          style={{ width: '100%', border: 0, background: 'var(--green)', color: '#fff', padding: '12px 14px', borderRadius: 11, fontSize: 13.5, fontWeight: 700, minHeight: 48, marginBottom: 12, opacity: state.busy['countAll'] ? 0.7 : 1 }}
        >
          {state.busy['countAll']
            ? 'กำลังบันทึก…'
            : `บันทึกที่กรอกไว้ทั้งหมด (${nf(typedIds.length)} รายการ` + (typedDiffCount > 0 ? ` · มีส่วนต่าง ${nf(typedDiffCount)})` : ' · ตรงกับระบบทุกรายการ)')}
        </button>
      )}

      <div className="card stagger" style={{ overflow: 'hidden' }}>
        {meds.map((m) => {
          const typed = state.countInputs[m.id] ?? '';
          const parsed = parseInt(typed, 10);
          const has = typed !== '' && !isNaN(parsed);
          const delta = has ? parsed - m.floor : 0;
          // Bug fix: m.lastCountTs is unset for any med that's never had this optional count
          // committed (the common case — this screen is explicitly "ไม่จำเป็นต้องทำเป็นประจำ").
          // Date.now() - undefined is NaN, which used to render literally as "นับล่าสุด NaN
          // วันก่อน" for every such drug — a real, visible glitch, not a hypothetical one.
          const daysSince = m.lastCountTs ? Math.floor((Date.now() - m.lastCountTs) / DAY) : null;
          const stale = daysSince === null || daysSince >= 90;
          return (
            <div key={m.id} style={{ padding: '11px 13px', borderBottom: '1px solid var(--border-soft)', background: has ? 'var(--green-tint)' : undefined }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 }}>{m.name}</div>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                    ระบบคำนวณ {nf(m.floor)} {m.unit} · <span style={stale ? { color: 'var(--amber-ink)', fontWeight: 700 } : undefined}>นับล่าสุด {daysSince === null ? 'ยังไม่เคยนับ' : daysSince <= 0 ? 'วันนี้' : daysSince + ' วันก่อน'}</span>
                  </div>
                  {has && delta !== 0 && (
                    <div style={{ fontSize: 11.5, marginTop: 2, fontWeight: 600, color: delta < 0 ? 'var(--red)' : 'var(--amber)' }}>
                      {delta < 0 ? 'น้อยกว่าระบบ ' + nf(Math.abs(delta)) + ' ' + m.unit + ' (คาดว่าจ่ายผ่าน HOSxP)' : 'มากกว่าระบบ ' + nf(delta) + ' ' + m.unit}
                    </div>
                  )}
                  {has && delta === 0 && (
                    <div style={{ fontSize: 11.5, marginTop: 2, fontWeight: 600, color: 'var(--green)' }}>ตรงกับระบบ</div>
                  )}
                </div>
                <input
                  value={typed}
                  onChange={(e) => setCountInput(m.id, e.target.value)}
                  inputMode="numeric"
                  aria-label={'จำนวนที่นับได้ ' + m.name}
                  placeholder="นับได้"
                  style={{ width: 78, flex: 'none', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 6px', fontSize: 14, fontWeight: 600, textAlign: 'center', minHeight: 42 }}
                />
                <button
                  disabled={!has || !!state.busy[`count:${m.id}`]}
                  onClick={() => commitCount(m.id)}
                  style={{ flex: 'none', border: 0, background: has ? 'var(--green)' : 'var(--border-strong)', color: '#fff', padding: '9px 12px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, minHeight: 42, opacity: state.busy[`count:${m.id}`] ? 0.7 : 1 }}
                >
                  {state.busy[`count:${m.id}`] ? '…' : 'บันทึก'}
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
