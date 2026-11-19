// Report picker: replaces the old 11-chip horizontally-scrolling strip (only ~3 chips visible on a
// phone, the rest hidden off-screen with no grouping). Every report is now visible at once,
// grouped into four colour-coded categories, each tile carrying an icon + one-line description.
// Every tile keeps its original label as its accessible name (aria-label) so assistive tech and
// the existing tests address reports exactly as before.
import type { ReportTab } from '../../types';
import { TABS } from './shared';

type Cat = { id: string; title: string; hint: string; c1: string; c2: string; tabs: ReportTab[] };

export const REPORT_CATEGORIES: Cat[] = [
  { id: 'overview', title: 'ภาพรวม', hint: 'สรุปสำหรับผู้บริหาร / PTC', c1: '#2563eb', c2: '#1d4ed8', tabs: ['exec'] },
  { id: 'stock', title: 'สต็อก & วันหมดอายุ', hint: 'ยอดคงคลัง มูลค่า ความเสี่ยงหมดอายุ', c1: '#0b9490', c2: '#0a7f7b', tabs: ['aging', 'category', 'turn', 'stockasof'] },
  { id: 'usage', title: 'การใช้ยา & การเติม', hint: 'อัตราใช้ แนวโน้ม การเติมหน้างาน', c1: '#7c3aed', c2: '#5b3fd6', tabs: ['usage', 'replenish', 'insights'] },
  { id: 'audit', title: 'ตรวจสอบ & ย้อนหลัง', hint: 'ความคลาดเคลื่อน การคืนยา ตัวชี้วัดรายวัน', c1: '#d1850f', c2: '#b45309', tabs: ['disc', 'returns', 'kpi'] },
];

const TAB_INFO: Record<ReportTab, { icon: string; desc: string }> = {
  exec: { icon: '📊', desc: 'มูลค่ารวม สุขภาพสต็อก ยาเสี่ยงสูง' },
  aging: { icon: '⏳', desc: 'ล็อตแยกตามระยะเวลาก่อนหมดอายุ' },
  category: { icon: '🗂️', desc: 'มูลค่า/ความเสี่ยงแยกหมวดยา' },
  turn: { icon: '🔁', desc: 'อัตราหมุนเวียนของยาแต่ละตัว' },
  stockasof: { icon: '📜', desc: 'ยอดคงคลัง ณ วันที่เลือก' },
  usage: { icon: '📈', desc: 'ยาที่ใช้มากสุด รายเดือน/หมวด' },
  replenish: { icon: '🔄', desc: 'ยาที่เติมหน้างานบ่อย/มาก' },
  insights: { icon: '🧠', desc: 'ใช้ผิดปกติ ขาดบ่อย lead time' },
  disc: { icon: '⚠️', desc: 'ปรับยอด ยาเสีย หมดอายุ นับไม่ตรง' },
  returns: { icon: '↩️', desc: 'ยาที่ผู้ป่วยคืน / ADR' },
  kpi: { icon: '📅', desc: 'ตัวชี้วัดรายวันตามช่วงวันที่' },
};

export function ReportPicker({ active, onSelect }: { active: ReportTab; onSelect: (t: ReportTab) => void }) {
  const label = (t: ReportTab) => TABS.find(([k]) => k === t)?.[1] ?? t;
  // Strip the leading emoji from the visible title (the tile shows its own icon); aria-label
  // keeps the full original label.
  const plain = (s: string) => s.replace(/^[^\p{L}\p{N}]+/u, '').trim() || s;
  return (
    <div className="rpt-picker" data-testid="report-picker">
      {REPORT_CATEGORIES.map((cat) => {
        const hasActive = cat.tabs.includes(active);
        return (
          <section key={cat.id} className="rpt-cat" data-active={hasActive ? 'true' : 'false'} style={{ ['--c1' as string]: cat.c1, ['--c2' as string]: cat.c2 }}>
            <div className="rpt-cat-head">
              <span className="rpt-cat-dot" />
              <span className="rpt-cat-title">{cat.title}</span>
              <span className="rpt-cat-hint">{cat.hint}</span>
            </div>
            <div className="rpt-tiles">
              {cat.tabs.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-label={label(t)}
                  aria-pressed={active === t}
                  className={'rpt-tile' + (active === t ? ' on' : '')}
                  onClick={() => onSelect(t)}
                >
                  <span className="rpt-tile-ic" aria-hidden="true">{TAB_INFO[t].icon}</span>
                  <span className="rpt-tile-tx" aria-hidden="true">
                    <b>{plain(label(t))}</b>
                    <small>{TAB_INFO[t].desc}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
