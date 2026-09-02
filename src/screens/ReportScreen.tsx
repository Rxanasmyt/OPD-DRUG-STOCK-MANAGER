import { useApp } from '../store/AppContext';
import { subQty, daysUntil, wardOf } from '../store/selectors';
import { nf, thDate } from '../utils/format';
import type { ReportTab, Ward } from '../types';

const TABS: [ReportTab, string][] = [['aging', 'Stock aging'], ['turn', 'Turnover'], ['disc', 'Discrepancy log']];
const REPORT_NAMES: Record<ReportTab, string> = { aging: 'stock_aging.csv', turn: 'turnover.csv', disc: 'discrepancy_log.csv' };
const WARD_COLOR: Record<Ward, string> = { opd: 'var(--green)', ipd: 'var(--ipd)' };
const AGING_BUCKETS: [string, number, number, string][] = [
  ['หมดอายุแล้ว', -99999, 0, 'var(--red)'],
  ['เหลือ ≤ 30 วัน', 0, 30, 'var(--red)'],
  ['31–90 วัน', 30, 90, 'var(--amber)'],
  ['91–180 วัน', 90, 180, 'var(--muted)'],
  ['มากกว่า 180 วัน', 180, 99999, 'var(--green)'],
];
const DISC_TYPES = ['adjust', 'return', 'damaged', 'expired', 'count', 'reconcile_hosxp'];

export default function ReportScreen() {
  const { state, setReportTab, setWardFilter, exportReportCsv } = useApp();
  const meds = state.meds.filter((m) => m.active && (state.wardFilter === 'all' || wardOf(m) === state.wardFilter));
  const chip = (active: boolean) => ({ border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green)' : 'var(--bg-card)', color: active ? '#fff' : 'var(--ink)' });

  const medIds = new Set(meds.map((m) => m.id));
  const wardLots = state.lots.filter((l) => medIds.has(l.medId));
  const buckets = AGING_BUCKETS.map(([label, lo, hi, fg]) => {
    const ls = wardLots.filter((l) => l.qty > 0 && daysUntil(l.exp) > lo && daysUntil(l.exp) <= hi);
    const value = ls.reduce((s, l) => s + l.qty * (meds.find((m) => m.id === l.medId)?.price || 0), 0);
    return { label, fg, lots: ls.length, value };
  });
  const maxVal = Math.max(1, ...buckets.map((b) => b.value));
  const riskValue = buckets[0].value + buckets[1].value + buckets[2].value;

  const turnRate = (m: (typeof meds)[number]) => m.used30 / Math.max(1, m.parFloor);
  const turnRows = meds
    .slice()
    .sort((a, b) => turnRate(b) - turnRate(a))
    .slice(0, 30)
    .map((m) => {
      const onHand = m.floor + subQty(state, m.id);
      const doh = Math.round(onHand / (m.used30 / 30));
      return { name: m.name, used: nf(m.used30), doh: isFinite(doh) ? nf(doh) : '—', tone: doh < 14 ? 'var(--red)' : doh > 120 ? 'var(--amber)' : 'var(--green)' };
    });

  // txs now carry medId going forward (see Tx type) — trust that for ward-scoping when
  // present. A row from before medId existed falls back to matching by name, but only when
  // that name is unambiguous for this ward filter; a name shared with a med in the other
  // ward (OPD and IPD copies of the same drug deliberately can share a name) is excluded
  // rather than risking pulling in the wrong ward's history.
  const wardNames = new Set(meds.map((m) => m.name));
  const otherWardNames = new Set(state.meds.filter((m) => state.wardFilter !== 'all' && wardOf(m) !== state.wardFilter).map((m) => m.name));
  const discRows = state.txs.filter((x) => {
    if (DISC_TYPES.indexOf(x.type) < 0) return false;
    if (state.wardFilter === 'all') return true;
    if (x.medId) return medIds.has(x.medId);
    return wardNames.has(x.name) && !otherWardNames.has(x.name);
  }).slice(0, 30);

  return (
    <div style={{ animation: 'fade .18s' }}>
      <div style={{ padding: '12px 14px 10px', position: 'sticky', top: 0, zIndex: 2 }} className="sticky-bar">
        <div style={{ display: 'flex', gap: 7, overflowX: 'auto', marginBottom: 9 }}>
          {TABS.map(([t, label]) => (
            <button key={t} className="chip" style={{ ...chip(state.reportTab === t), minHeight: 38 }} onClick={() => setReportTab(t)}>{label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 2, background: 'var(--border-soft)', padding: 3, borderRadius: 11 }}>
          {(['all', 'opd', 'ipd'] as const).map((w) => {
            const active = state.wardFilter === w;
            const tone = w === 'opd' ? WARD_COLOR.opd : w === 'ipd' ? WARD_COLOR.ipd : 'var(--ink)';
            return (
              <button
                key={w}
                onClick={() => setWardFilter(w)}
                style={{ flex: 1, border: 0, background: active ? 'var(--bg-card)' : 'transparent', color: active ? tone : 'var(--muted)', padding: '9px 0', borderRadius: 8, fontSize: 13, fontWeight: 600, boxShadow: active ? 'var(--shadow-xs)' : 'none', transition: 'background var(--dur) var(--ease), color var(--dur) var(--ease)' }}
              >
                {w === 'all' ? 'ทุกหอผู้ป่วย' : w === 'opd' ? 'OPD' : 'IPD'}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ padding: '12px 14px 24px' }}>
        <button onClick={exportReportCsv} className="btn-outline" style={{ width: '100%', padding: 12, borderRadius: 11, fontSize: 14, fontWeight: 600, minHeight: 46, marginBottom: 12 }}>
          ↓ Export CSV — {REPORT_NAMES[state.reportTab]}
        </button>

        {state.reportTab === 'aging' && (
          <>
            <div className="card stagger" style={{ overflow: 'hidden', marginBottom: 14 }}>
              {buckets.map((b) => (
                <div key={b.label} style={{ padding: '11px 13px', borderBottom: '1px solid var(--border-soft)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: b.fg }}>{b.label}</span>
                    <span className="muted" style={{ fontSize: 13, flex: 'none' }}>{b.lots} lot · {nf(b.value)} บาท</span>
                  </div>
                  <div className="bar-track" style={{ height: 6, background: 'var(--border-soft)', borderRadius: 3, marginTop: 7 }}>
                    <div className="bar-fill" style={{ height: '100%', width: Math.max(2, Math.round((b.value / maxVal) * 100)) + '%', background: b.fg, borderRadius: 3 }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, padding: '0 2px' }}>
              มูลค่าที่เสี่ยงหมดอายุใน 90 วัน <b style={{ color: 'var(--amber-ink)' }}>{nf(riskValue)} บาท</b> — ใช้ประกอบรายงาน PTC เรื่องการบริหารยาใกล้หมดอายุ
            </div>
          </>
        )}

        {state.reportTab === 'turn' && (
          <div className="card stagger" style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex', padding: '9px 13px', background: 'var(--bg-subtle)', fontSize: 11.5, color: 'var(--muted)', fontWeight: 600 }}>
              <span style={{ flex: 1 }}>รายการยา</span><span style={{ width: 64, textAlign: 'right', flex: 'none' }}>จ่าย 30 วัน</span><span style={{ width: 52, textAlign: 'right', flex: 'none' }}>วันคงคลัง</span>
            </div>
            {turnRows.map((t, i) => (
              <div key={i} style={{ display: 'flex', padding: '10px 13px', borderBottom: '1px solid var(--border-soft)', alignItems: 'center' }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>{t.name}</span>
                <span style={{ width: 64, textAlign: 'right', flex: 'none', fontSize: 13 }}>{t.used}</span>
                <span style={{ width: 52, textAlign: 'right', flex: 'none', fontSize: 13, fontWeight: 600, color: t.tone }}>{t.doh}</span>
              </div>
            ))}
          </div>
        )}

        {state.reportTab === 'disc' && (
          <div className="card stagger" style={{ overflow: 'hidden' }}>
            {discRows.map((x) => (
              <div key={x.id} style={{ padding: '11px 13px', borderBottom: '1px solid var(--border-soft)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, minWidth: 0 }}>{x.name}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: x.qty < 0 ? 'var(--red)' : 'var(--green)', flex: 'none' }}>{(x.qty > 0 ? '+' : '') + nf(x.qty) + ' ' + x.unit}</span>
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 3, lineHeight: 1.45 }}>{thDate(x.ts)} · {x.by} · {x.loc === 'floor' ? 'หน้างาน' : 'substock'}</div>
                <div style={{ fontSize: 12, marginTop: 3 }}>เหตุผล: {(x.reason || '—') + (x.note && x.note !== '—' ? ' — ' + x.note : '')}</div>
              </div>
            ))}
            {discRows.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>ยังไม่มีรายการ</div>}
          </div>
        )}
      </div>
    </div>
  );
}
