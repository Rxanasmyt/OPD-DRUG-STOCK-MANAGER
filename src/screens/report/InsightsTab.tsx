import { nf } from '../../utils/format';
import type { Med, MedId } from '../../types';
import { asMedId } from '../../types';
import { categoryLabel } from '../../data/categories';
import { EmptyState } from '../../components/EmptyState';
import type {
  UsageAnomaly, LeadTimeTrend, RecurringStockout, FrequentFloorRefill, ParAdjustmentOutcome, CategoryDiscAgg, AdrReturnAgg,
} from '../../store/selectors';
import { DISC_TYPE_LABEL } from './shared';

export function InsightsTab({
  anomalies, stockoutRows, leadTime, stockoutStreaks, frequentRefills, parOutcomes, parOutcomesVolatile, parOutcomesStable,
  discByCategoryTotal, discByCategory, repeatAdr, goSubstockCardFor,
}: {
  anomalies: UsageAnomaly[];
  stockoutRows: { m: Med; days: number }[];
  leadTime: LeadTimeTrend | null;
  stockoutStreaks: RecurringStockout[];
  frequentRefills: FrequentFloorRefill[];
  parOutcomes: ParAdjustmentOutcome[];
  parOutcomesVolatile: ParAdjustmentOutcome[];
  parOutcomesStable: ParAdjustmentOutcome[];
  discByCategoryTotal: number;
  discByCategory: CategoryDiscAgg[];
  repeatAdr: AdrReturnAgg[];
  goSubstockCardFor: (id: MedId) => void;
}) {
  return (
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

      {leadTime?.degraded && (
        <>
          <div style={{ fontSize: 13, margin: '16px 2px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="ai-text" style={{ fontWeight: 800 }}>⏱ เวลารอเบิกยาช้าลงผิดปกติ</span>
          </div>
          <div className="card" style={{ padding: '12px 13px', fontSize: 12.5, lineHeight: 1.6 }}>
            7 วันล่าสุด เฉลี่ย <strong>{leadTime.recentAvgHours.toFixed(1)} ชม.</strong> ต่อครั้ง —
            ช้าขึ้น {Math.round(leadTime.changePct * 100)}% จากช่วงก่อนหน้า (เฉลี่ย {leadTime.priorAvgHours.toFixed(1)} ชม.)
            <div className="muted" style={{ marginTop: 4 }}>ควรตรวจสอบว่าขั้นอนุมัติเบิกมีคอขวดอยู่ที่ไหน ก่อนที่จะกระทบรอบเติมยาจริง</div>
          </div>
        </>
      )}

      {stockoutStreaks.length > 0 && (
        <>
          <div style={{ fontSize: 13, margin: '16px 2px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="ai-text" style={{ fontWeight: 800 }}>🔁 ขาดสต็อกจริงซ้ำๆ</span>
            <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>({stockoutStreaks.length} รายการ)</span>
          </div>
          <div className="card stagger" style={{ overflow: 'hidden' }}>
            {stockoutStreaks.slice(0, 20).map((s) => (
              <button
                key={s.med.id}
                onClick={() => goSubstockCardFor(s.med.id)}
                className="row-interactive"
                title="ดูบัตรสต็อกยานี้"
                style={{ display: 'flex', width: '100%', border: 0, background: 'transparent', textAlign: 'left', justifyContent: 'space-between', gap: 10, padding: '10px 13px', borderBottom: '1px solid var(--border-soft)', alignItems: 'center' }}
              >
                <span style={{ fontSize: 13, minWidth: 0, color: 'var(--ink)' }}>{s.med.name}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--red)', flex: 'none' }}>ขาด {s.dayCount}/{s.totalDays} วัน</span>
              </button>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11, lineHeight: 1.6, padding: '6px 2px 0' }}>
            ขาดจริง (floor = 0 ขณะมีการใช้จริง) ตั้งแต่ 3+ วันขึ้นไปในช่วง 30 วันที่ผ่านมา — par หรือรอบเติมของตัวนี้อาจตามไม่ทันการใช้จริง ไม่ใช่เรื่องบังเอิญครั้งเดียว
          </div>
        </>
      )}

      {/* Real-world request: "ความถี่การเติมหน้างานต่อยา" — transferredQty on the kpi tab
          is one mixed-unit total across every drug, so a drug refilled constantly in small
          amounts looks the same as one refilled once in bulk. Flags a drug refilled on
          average more than once every two days — a real signal its floor par is set too
          low for how fast it's actually drawn down. */}
      {frequentRefills.length > 0 && (
        <>
          <div style={{ fontSize: 13, margin: '16px 2px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="ai-text" style={{ fontWeight: 800 }}>🔄 เติมหน้างานบ่อยผิดปกติ</span>
            <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>({frequentRefills.length} รายการ)</span>
          </div>
          <div className="card stagger" style={{ overflow: 'hidden' }}>
            {frequentRefills.slice(0, 20).map((f) => (
              <button
                key={f.med.id}
                onClick={() => goSubstockCardFor(f.med.id)}
                className="row-interactive"
                title="ดูบัตรสต็อกยานี้"
                style={{ display: 'flex', width: '100%', border: 0, background: 'transparent', textAlign: 'left', justifyContent: 'space-between', gap: 10, padding: '10px 13px', borderBottom: '1px solid var(--border-soft)', alignItems: 'center' }}
              >
                <span style={{ fontSize: 13, minWidth: 0, color: 'var(--ink)' }}>{f.med.name}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber)', flex: 'none' }}>เติม {nf(f.eventCount)} ครั้ง/{f.totalDays} วัน</span>
              </button>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11, lineHeight: 1.6, padding: '6px 2px 0' }}>
            เฉลี่ยเติมหน้างานมากกว่า 1 ครั้งทุกๆ 2 วันในช่วง 30 วันที่ผ่านมา — ลองพิจารณาปรับ par หน้างานของยาเหล่านี้ให้สูงขึ้น เพื่อลดรอบการเติมที่บ่อยเกินจำเป็น
          </div>
        </>
      )}

      {parOutcomes.length > 0 && (
        <>
          <div style={{ fontSize: 13, margin: '16px 2px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="ai-text" style={{ fontWeight: 800 }}>📐 ผลลัพธ์หลังปรับ par</span>
            {parOutcomesVolatile.length > 0 && <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>({parOutcomesVolatile.length} รายการยังผันผวน)</span>}
          </div>
          <div className="card stagger" style={{ overflow: 'hidden' }}>
            {parOutcomesVolatile.map((o) => (
              <button
                key={o.record.medId}
                onClick={() => goSubstockCardFor(asMedId(o.record.medId))}
                className="row-interactive"
                title="ดูบัตรสต็อกยานี้"
                style={{ display: 'block', width: '100%', border: 0, background: 'transparent', textAlign: 'left', padding: '10px 13px', borderBottom: '1px solid var(--border-soft)' }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{o.record.medName}</div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                  ปรับไปเมื่อ {o.daysSinceAdjust} วันก่อน (หน้างาน {nf(o.record.beforeFloor)}→{nf(o.record.afterFloor)}) — การใช้จริงตอนนี้ยังผันผวน ≥40% ควรทบทวนอีกครั้ง
                </div>
              </button>
            ))}
            {parOutcomesVolatile.length === 0 && (
              <EmptyState icon="✅" title="ทุกรายการที่ปรับไปแล้วนิ่งดี" sub={nf(parOutcomesStable.length) + ' รายการ (จากที่ครบ 14 วันแล้ว) ไม่พบความผันผวนซ้ำหลังปรับ'} />
            )}
          </div>
          {parOutcomesVolatile.length > 0 && (
            <div className="muted" style={{ fontSize: 11, lineHeight: 1.6, padding: '6px 2px 0' }}>
              นิ่งดีแล้ว {nf(parOutcomesStable.length)} รายการ — เฉพาะรายการที่ปรับมาแล้วอย่างน้อย 14 วัน เทียบ used30/usedPrev30 ปัจจุบันเท่านั้น (ย้อนหลัง 60 วัน)
            </div>
          )}
        </>
      )}

      {/* Real-world request: "หมวดไหนเสียบ่อยผิดปกติ (อาจบ่งชี้ปัญหา process ไม่ใช่แค่
          สุ่ม)" — the Discrepancy log already lists every adjust/return/damaged/expired/
          count/reconcile_hosxp row one at a time, but nothing summed them up by drug
          category to surface a pattern a reader skimming one row at a time would never
          notice. Gated at 3+ total so a near-empty system doesn't show a hollow "top
          category" off one or two incidents. */}
      {discByCategoryTotal >= 3 && (
        <>
          <div style={{ fontSize: 13, margin: '16px 2px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="ai-text" style={{ fontWeight: 800 }}>📦 หมวดยาที่มีรายการผิดปกติบ่อย</span>
          </div>
          <div className="card stagger" style={{ overflow: 'hidden' }}>
            {discByCategory.slice(0, 5).map((c) => {
              const typeLabel = Object.entries(c.byType)
                .sort((a, b) => b[1] - a[1])
                .map(([t, n]) => DISC_TYPE_LABEL[t] + ' ' + n)
                .join(', ');
              const share = Math.round((c.count / discByCategoryTotal) * 100);
              return (
                <div key={c.category} style={{ padding: '10px 13px', borderBottom: '1px solid var(--border-soft)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', minWidth: 0 }}>{categoryLabel(c.category)}</span>
                    {/* Same 40% threshold usageAnomalies already uses elsewhere on this
                        tab for "sharply enough to flag" — one category eating that much of
                        all recent discrepancies is a real signal, not noise. */}
                    <span style={{ fontSize: 13, fontWeight: 700, color: share >= 40 ? 'var(--red)' : 'var(--ink)', flex: 'none' }}>{nf(c.count)} ครั้ง ({share}%)</span>
                  </div>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>{typeLabel}</div>
                </div>
              );
            })}
          </div>
          <div className="muted" style={{ fontSize: 11, lineHeight: 1.6, padding: '6px 2px 0' }}>
            นับจากรายการปรับยอด/คืนยา/ยาเสีย/หมดอายุ/นับสต็อก/นำเข้า HOSxP ล่าสุดในระบบ {nf(discByCategoryTotal)} รายการ
          </div>
        </>
      )}

      {/* Real-world request: ADR/side-effect reason was already captured on every
          return-type transaction (AdjustScreen's reason picker) but never surfaced
          anywhere — one return tagged this way can be a single patient's one-off
          reaction, nothing to act on; the SAME drug tagged 2+ times is a real signal a
          pharmacist should see, which the flat "returns" tab's per-row reason text would
          never make visible on its own. */}
      {repeatAdr.length > 0 && (
        <>
          <div style={{ fontSize: 13, margin: '16px 2px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="ai-text" style={{ fontWeight: 800 }}>🩺 ยาที่มีรายงานแพ้ยา/ผลข้างเคียงซ้ำ</span>
          </div>
          <div className="card stagger" style={{ overflow: 'hidden' }}>
            {repeatAdr.slice(0, 5).map((a) => (
              <button
                key={a.medId}
                onClick={() => goSubstockCardFor(asMedId(a.medId))}
                className="row-interactive"
                title="ดูบัตรสต็อกยานี้"
                style={{ display: 'flex', width: '100%', border: 0, background: 'transparent', textAlign: 'left', justifyContent: 'space-between', gap: 10, padding: '10px 13px', borderBottom: '1px solid var(--border-soft)', alignItems: 'center' }}
              >
                <span style={{ fontSize: 13, minWidth: 0, color: 'var(--ink)' }}>{a.medName}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--red)', flex: 'none' }}>คืน {nf(a.count)} ครั้ง</span>
              </button>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11, lineHeight: 1.6, padding: '6px 2px 0' }}>
            นับจากรายการคืนยาล่าสุดในระบบที่ระบุเหตุผล "แพ้ยา/ผลข้างเคียงการรักษา" ตั้งแต่ 2 ครั้งขึ้นไปของยาตัวเดียวกัน — ควรทบทวนว่าเป็นปัญหาของรุ่นผลิต/ล็อต หรือตัวยาเอง
          </div>
        </>
      )}
    </>
  );
}
