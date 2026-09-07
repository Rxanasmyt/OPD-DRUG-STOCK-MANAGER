import { useApp } from '../store/AppContext';
import { useState } from 'react';
import { subQty, daysUntil, usageAnomalies, daysOfStockLeft } from '../store/selectors';
import { nf, thDate } from '../utils/format';
import type { ReportTab } from '../types';
import { EmptyState } from '../components/EmptyState';
import { SearchInput } from '../components/SearchInput';

const TABS: [ReportTab, string][] = [['aging', 'Stock aging'], ['turn', 'Turnover'], ['insights', '🧠 วิเคราะห์อัตโนมัติ'], ['disc', 'Discrepancy log']];
const REPORT_NAMES: Record<ReportTab, string> = { aging: 'stock_aging.csv', turn: 'turnover.csv', disc: 'discrepancy_log.csv', insights: 'usage_insights.csv' };
const AGING_BUCKETS: [string, number, number, string][] = [
  ['หมดอายุแล้ว', -99999, 0, 'var(--red)'],
  ['เหลือ ≤ 30 วัน', 0, 30, 'var(--red)'],
  ['31–90 วัน', 30, 90, 'var(--amber)'],
  ['91–180 วัน', 90, 180, 'var(--muted)'],
  ['มากกว่า 180 วัน', 180, 99999, 'var(--green)'],
];
const DISC_TYPES = ['adjust', 'return', 'damaged', 'expired', 'count', 'reconcile_hosxp'];
const DISC_TYPE_LABEL: Record<string, string> = {
  adjust: 'ปรับยอด', return: 'คืนยา', damaged: 'ยาเสีย/ชำรุด', expired: 'หมดอายุ', count: 'นับสต็อก', reconcile_hosxp: 'นำเข้า HOSxP',
};

export default function ReportScreen() {
  const { state, setReportTab, exportReportCsv, exportAllReports, goSubstockCardFor } = useApp();
  // Discrepancy log had no way to narrow it down — always the same fixed most-recent-30 slice
  // of state.txs, with no type filter and no way to find one specific drug's history, unlike
  // AdminScreen's audit log right next door which has both. Same underlying data (the live
  // txs feed), same treatment now: a type filter and a name search, both client-side since
  // state.txs is already the same capped-300 realtime cache AdminScreen reads from.
  const [discFilter, setDiscFilter] = useState<string>('all');
  const [discSearch, setDiscSearch] = useState('');
  // OPD/IPD ward tabs removed — reports always cover the whole formulary.
  const meds = state.meds.filter((m) => m.active);
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
      // A drug with no recorded usage (used30 === 0) divides to Infinity/NaN here — already
      // shown as "—" rather than a broken number, but the tone below used to fall through to
      // the same green as a genuinely healthy days-on-hand, falsely reading as "plenty of
      // stock" for a metric that's actually undefined for this drug.
      const tone = !isFinite(doh) ? 'var(--muted)' : doh < 14 ? 'var(--red)' : doh > 120 ? 'var(--amber)' : 'var(--green)';
      return { id: m.id, name: m.name, used: nf(m.used30), doh: isFinite(doh) ? nf(doh) : '—', tone };
    });

  const discQ = discSearch.trim().toLowerCase();
  const discRows = state.txs
    .filter((x) => DISC_TYPES.indexOf(x.type) >= 0)
    .filter((x) => discFilter === 'all' || x.type === discFilter)
    .filter((x) => !discQ || x.name.toLowerCase().indexOf(discQ) >= 0)
    .slice(0, 60);

  // "🧠 วิเคราะห์อัตโนมัติ" — real numbers computed on-device from usage data already synced
  // (used30/usedPrev30 from recomputeUsageStats/commitUsageImport), not a call to any AI
  // service — this app is a static site with no backend to hold an API key safely, so an
  // actual LLM call from here would mean shipping that key in public client code. Two useful
  // things fall straight out of data already on hand: which drugs' usage swung sharply enough
  // to need attention, and which are projected to run out soonest at their current pace.
  const anomalies = usageAnomalies(meds);
  const stockoutRows = meds
    .map((m) => ({ m, days: daysOfStockLeft(state, m) }))
    .filter((x): x is { m: (typeof meds)[number]; days: number } => x.days !== null && x.days <= 21)
    .sort((a, b) => a.days - b.days)
    .slice(0, 20);

  return (
    <div style={{ animation: 'fade .18s' }}>
      <div style={{ padding: '12px 14px 10px', position: 'sticky', top: 0, zIndex: 2 }} className="sticky-bar">
        <div style={{ display: 'flex', gap: 7, overflowX: 'auto', marginBottom: 9 }}>
          {TABS.map(([t, label]) => {
            const isAi = t === 'insights';
            const active = state.reportTab === t;
            // The insights tab gets its own violet/cyan treatment (see .ai-* in styles.css)
            // instead of the plain green chip every other tab uses — it's the one tab
            // computing something (anomaly detection, a forecast) rather than just
            // filtering/displaying stored numbers, and the visual says so at a glance.
            return (
              <button
                key={t}
                className={'chip' + (isAi && active ? ' ai-glow' : '')}
                style={isAi
                  ? active
                    ? { minHeight: 38, border: 0, background: 'linear-gradient(90deg, var(--ai-1), var(--ai-2))', color: '#fff', fontWeight: 700 }
                    : { minHeight: 38, border: '1px solid var(--ai-1)', background: 'var(--bg-card)', color: 'var(--ai-1)' }
                  : { ...chip(active), minHeight: 38 }}
                onClick={() => setReportTab(t)}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ padding: '12px 14px 24px' }}>
        <button
          onClick={exportAllReports}
          disabled={!!state.busy['exportAll']}
          className="btn-primary"
          style={{ width: '100%', padding: 13, borderRadius: 11, fontSize: 14, fontWeight: 700, minHeight: 48, marginBottom: 8, opacity: state.busy['exportAll'] ? 0.7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          {state.busy['exportAll'] ? 'กำลังรวบรวมข้อมูล…' : '📦 ดาวน์โหลดข้อมูลทั้งหมด (.xlsx ไฟล์เดียว)'}
        </button>
        <div className="muted" style={{ fontSize: 11, textAlign: 'center', marginBottom: 10, lineHeight: 1.5 }}>
          รวมทุกอย่างในแอพเป็นไฟล์เดียว คนละ sheet: รายงานสำเร็จรูปทั้ง 4 ชุด · ธุรกรรมทุกประเภททั้งหมด
          (ไม่ใช่แค่ discrepancy) · audit log เต็ม · ใบรับที่รออนุมัติ · รายชื่อผู้ใช้ (เฉพาะ Admin) ·
          ยาทั้งฟอร์มูลารี่ · lot ปัจจุบัน
        </div>
        <button onClick={exportReportCsv} className="btn-outline" style={{ width: '100%', padding: 12, borderRadius: 11, fontSize: 13, fontWeight: 600, minHeight: 44, marginBottom: 12 }}>
          ↓ Export CSV เฉพาะแท็บนี้ — {REPORT_NAMES[state.reportTab]}
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
              <button
                key={i}
                onClick={() => goSubstockCardFor(t.id)}
                className="row-interactive"
                title="ดูบัตรสต็อกยานี้"
                style={{ display: 'flex', width: '100%', border: 0, background: 'transparent', textAlign: 'left', padding: '10px 13px', borderBottom: '1px solid var(--border-soft)', alignItems: 'center' }}
              >
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ink)' }}>{t.name}</span>
                <span style={{ width: 64, textAlign: 'right', flex: 'none', fontSize: 13, color: 'var(--ink)' }}>{t.used}</span>
                <span style={{ width: 52, textAlign: 'right', flex: 'none', fontSize: 13, fontWeight: 600, color: t.tone }}>{t.doh}</span>
              </button>
            ))}
          </div>
        )}

        {state.reportTab === 'insights' && (
          <>
            <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, padding: '0 2px', marginBottom: 13 }}>
              คำนวณจากสถิติการใช้ยาที่มีอยู่แล้วในระบบโดยตรง (ไม่ได้เรียกใช้ AI ภายนอกใดๆ — แอพนี้
              เป็น static site ไม่มีเซิร์ฟเวอร์ที่จะเก็บกุญแจ API ได้อย่างปลอดภัย) อัปเดตอัตราการใช้
              ให้ล่าสุดก่อนที่หน้า "ตั้งค่า" เพื่อให้ผลตรงกับความจริงที่สุด
            </div>

            <div style={{ fontSize: 13, margin: '0 2px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="ai-text" style={{ fontWeight: 800 }}>📊 การใช้ยาผิดปกติ</span>
              {anomalies.length > 0 && <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>({anomalies.length} รายการ)</span>}
            </div>
            <div className="card stagger" style={{ overflow: 'hidden', marginBottom: 16 }}>
              {anomalies.slice(0, 20).map((a, i) => (
                <button
                  key={i}
                  onClick={() => goSubstockCardFor(a.med.id)}
                  className="row-interactive"
                  title="ดูบัตรสต็อกยานี้"
                  style={{ display: 'block', width: '100%', border: 0, background: 'transparent', textAlign: 'left', padding: '10px 13px', borderBottom: '1px solid var(--border-soft)' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0, color: 'var(--ink)' }}>{a.med.name}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: a.direction === 'up' ? 'var(--red)' : 'var(--amber-ink)', flex: 'none' }}>
                      {a.direction === 'up' ? '📈 +' : '📉 '}{Math.round(a.changePct * 100)}%
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                    30 วันล่าสุด {nf(a.med.used30)} {a.med.unit} · ก่อนหน้า {nf(a.med.usedPrev30)} {a.med.unit}
                    {a.direction === 'up' ? ' — ลองพิจารณาปรับ par ขึ้นก่อนของจะไม่พอ' : ' — par ปัจจุบันอาจสูงเกินความจำเป็นแล้ว'}
                  </div>
                </button>
              ))}
              {anomalies.length === 0 && (
                <EmptyState icon="📊" title="ไม่พบการใช้ยาที่ผิดปกติ" sub="อัตราการใช้ 30 วันล่าสุดของทุกรายการยังใกล้เคียงกับช่วงก่อนหน้า" />
              )}
            </div>

            <div style={{ fontSize: 13, margin: '0 2px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="ai-text" style={{ fontWeight: 800 }}>⏳ คาดว่าจะหมดใน 21 วัน</span>
              {stockoutRows.length > 0 && <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>({stockoutRows.length} รายการ)</span>}
            </div>
            <div className="card stagger" style={{ overflow: 'hidden' }}>
              {stockoutRows.map(({ m, days }, i) => (
                <button
                  key={i}
                  onClick={() => goSubstockCardFor(m.id)}
                  className="row-interactive"
                  title="ดูบัตรสต็อกยานี้"
                  style={{ display: 'flex', width: '100%', border: 0, background: 'transparent', textAlign: 'left', justifyContent: 'space-between', gap: 10, padding: '10px 13px', borderBottom: '1px solid var(--border-soft)', alignItems: 'center' }}
                >
                  <span style={{ fontSize: 13, minWidth: 0, color: 'var(--ink)' }}>{m.name}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: days <= 7 ? 'var(--red)' : 'var(--amber-ink)', flex: 'none' }}>~{days} วัน</span>
                </button>
              ))}
              {stockoutRows.length === 0 && (
                <EmptyState icon="✅" title="ไม่มีรายการที่จะหมดใน 21 วันข้างหน้า" sub="คำนวณจากอัตราการใช้ปัจจุบันกับยอดคงเหลือรวม (หน้างาน + substock)" />
              )}
            </div>
          </>
        )}

        {state.reportTab === 'disc' && (
          <>
            <SearchInput value={discSearch} onChange={setDiscSearch} placeholder="ค้นหาชื่อยาในประวัตินี้" style={{ marginBottom: 9 }} />
            <div style={{ display: 'flex', gap: 7, marginBottom: 11, overflowX: 'auto', paddingBottom: 2 }}>
              <button className="chip" style={chip(discFilter === 'all')} onClick={() => setDiscFilter('all')}>ทั้งหมด</button>
              {DISC_TYPES.map((t) => (
                <button key={t} className="chip" style={chip(discFilter === t)} onClick={() => setDiscFilter(t)}>{DISC_TYPE_LABEL[t]}</button>
              ))}
            </div>
            <div className="card stagger" style={{ overflow: 'hidden' }}>
              {discRows.map((x) => {
                const Row: 'button' | 'div' = x.medId ? 'button' : 'div';
                return (
                  <Row
                    key={x.id}
                    {...(x.medId ? { onClick: () => goSubstockCardFor(x.medId!), className: 'row-interactive', title: 'ดูบัตรสต็อกยานี้' } : {})}
                    style={{ display: 'block', width: '100%', border: 0, background: 'transparent', textAlign: 'left', padding: '11px 13px', borderBottom: '1px solid var(--border-soft)' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, minWidth: 0, color: 'var(--ink)' }}>{x.name}</span>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: x.qty < 0 ? 'var(--red)' : 'var(--green)', flex: 'none' }}>{(x.qty > 0 ? '+' : '') + nf(x.qty) + ' ' + x.unit}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 3, lineHeight: 1.45 }}>{thDate(x.ts)} · {x.by} · {x.loc === 'floor' ? 'หน้างาน' : 'substock'}</div>
                    <div style={{ fontSize: 12, marginTop: 3, color: 'var(--ink)' }}>เหตุผล: {(x.reason || '—') + (x.note && x.note !== '—' ? ' — ' + x.note : '')}</div>
                  </Row>
                );
              })}
              {discRows.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>ไม่พบรายการที่ตรงกับตัวกรอง</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
