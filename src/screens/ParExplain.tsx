// "ทำไมได้เลขนี้" — shows, for ONE med, every number suggestPar() used to arrive at its suggested
// Max / Min / par substock (parBreakdown — the same computation, not a copy), next to what's set
// now, plus an expiry-risk read the formula itself does NOT use. For the pharmacist to judge, not to act.
import { useApp } from '../store/AppContext';
import { parBreakdown, effectiveSubCoverDays, floorMinOf, subQty, daysOfStockLeft, daysUntil } from '../store/selectors';
import { nf } from '../utils/format';
import type { Med } from '../types';

const f1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('th-TH');

export function ParExplain({ med }: { med: Med }) {
  const { state } = useApp();
  const b = parBreakdown(med, state.parFloorCoverDays, effectiveSubCoverDays(state.parSubCoverDays, state.effectiveLeadTimeDays));
  const row = (label: string, value: React.ReactNode, note?: React.ReactNode) => (
    <div style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-soft)', fontSize: 12, lineHeight: 1.5 }}>
      <div className="muted" style={{ flex: '0 0 38%' }}>{label}</div>
      <div style={{ flex: 1 }}><b>{value}</b>{note ? <div className="muted" style={{ fontSize: 11 }}>{note}</div> : null}</div>
    </div>
  );

  // Expiry read — informational only (the formula has no expiry ceiling).
  const lots = state.lots.filter((l) => l.medId === med.id && l.qty > 0 && l.exp != null);
  const nearestExpDays = lots.length ? Math.min(...lots.map((l) => daysUntil(l.exp as number))) : null;
  const daysLeft = daysOfStockLeft(state, med);

  return (
    <details className="card" style={{ padding: '8px 12px', marginBottom: 9 }} data-testid="par-explain">
      <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 700, minHeight: 36, display: 'flex', alignItems: 'center' }}>🔍 ทำไมได้เลขนี้ (ที่มาของค่าแนะนำ Min / Max / par)</summary>
      {!b ? (
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.6, padding: '6px 0' }}>ยานี้ยังไม่มียอดใช้ใน 30 วัน — ระบบจึงไม่แนะนำ par (ไม่เดาจากข้อมูลที่ไม่มี) ตัวเลขที่ตั้งไว้เป็นค่าที่คนตั้งเอง</div>
      ) : (
        <div>
          {row('1) ยอดใช้', `เดือนล่าสุด ${nf(b.used30)} · เดือนก่อน ${b.usedPrev30 ? nf(b.usedPrev30) : '—'} ${med.unit}`,
            b.monthlyRule === 'single' ? 'มีข้อมูลเดือนเดียว จึงใช้เดือนล่าสุดอย่างเดียว'
              : b.monthlyRule === 'blend' ? 'ถ่วง 70% เดือนล่าสุด + 30% เดือนก่อน (ตามทันเมื่อใช้เพิ่มขึ้น)'
                : 'เดือนล่าสุดต่ำกว่าเดือนก่อน จึงใช้ค่าเฉลี่ยสองเดือน ไม่ให้ par หดตามเดือนที่เงียบ')}
          {row('2) อัตราใช้ต่อวัน', `${f1(b.daily)} ${med.unit}/วันทำการ`,
            <>หารยอดด้วย ~19.95 วันทำการใน 30 วัน (หักวันหยุดราชการ){b.cappedByP90 ? <> · <span style={{ color: 'var(--amber-ink)' }}>ถูกตัดที่ค่าวันใช้สูงสุดแบบตัดค่าผิดปกติ (P90 = {nf(b.p90 ?? 0)}) เพราะยอดเฉลี่ยมีวันผิดปกติปนอยู่</span></> : null}</>)}
          {row('3) วันที่ต้องครอบคลุม', `ชั้นหน้างาน ${b.floorDays} วัน · substock ${b.subDays} วัน`,
            b.hasSubstock ? 'ชั้นหน้างานเติมจาก substock ได้เร็ว จึงใช้รอบสั้น' : 'ยานี้ไม่มี substock — ชั้นหน้างานต้องรอด จนกว่าของจากคลังใหญ่จะเข้า จึงใช้รอบยาว')}
          {row('4) ตัวคูณความเสี่ยง', `ผันผวน ×${f1(b.volatility.effective)} · วันในสัปดาห์ ×${f1(b.weekdayFactor)} · high alert ×${f1(b.criticalityFactor)} · เคยขาดบ่อย ×${f1(b.stockoutBoost)}`,
            <>ผันผวน = ค่าที่ใหญ่กว่าระหว่างที่ตั้งเอง ({f1(b.volatility.manual)}) กับที่คำนวณจากการใช้จริง ({b.volatility.auto != null ? f1(b.volatility.auto) : 'ยังไม่มีข้อมูล'}) · ตัวคูณวันในสัปดาห์/high alert ใช้กับชั้นหน้างานเท่านั้น</>)}
          {row('5) Max (par หน้างาน)', `${nf(b.floor)} ${med.unit}`,
            b.floorDrivenBy === 'peak'
              ? <>มาจากค่าวันใช้สูงสุด ({nf(b.peakFloor)}) ซึ่งสูงกว่าค่าจากอัตราเฉลี่ย ({nf(b.avgFloor)}) — ยานี้ใช้เป็นก้อนใหญ่เป็นครั้งคราว</>
              : <>มาจากอัตราเฉลี่ย ({nf(b.avgFloor)}) สูงกว่าค่าวันใช้สูงสุด ({nf(b.peakFloor)})</>)}
          {row('6) Min (จุดเติม)', `${nf(b.min)} ${med.unit}`,
            b.minBy === 'usage' ? 'คำนวณจากอัตราใช้ × ครึ่งหนึ่งของวันที่ครอบคลุม' : 'ครึ่งหนึ่งของ Max (ยาที่ Max มาจากวันใช้สูงสุด/ค่าเฉลี่ยให้ Min สูงกว่า Max)')}
          {b.hasSubstock && row('7) par substock', `${nf(b.sub)} ${med.unit}`,
            b.subDrivenBy === 'floor' ? 'ไม่ต่ำกว่า par หน้างาน (เติมชั้นได้อย่างน้อยหนึ่งรอบ)' : b.subDrivenBy === 'peak' ? 'มาจากค่าวันใช้สูงสุด' : `จากอัตราเฉลี่ยแบบวันปฏิทิน × ${b.subDays} วัน × ตัวคูณผันผวน/เคยขาดบ่อย`)}
          <div style={{ fontSize: 12, fontWeight: 700, margin: '10px 0 4px' }}>เทียบกับที่ตั้งอยู่ตอนนี้</div>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead><tr className="muted"><th style={{ textAlign: 'left' }}> </th><th>ตั้งอยู่</th><th>ค่าแนะนำ</th><th>ต่าง</th></tr></thead>
            <tbody>
              {([['Max', med.parFloor, b.floor], ['Min', floorMinOf(med), b.min], ...(b.hasSubstock ? [['par substock', med.parSub, b.sub]] : [])] as [string, number, number][]).map(([lab, cur, sug]) => {
                const diff = sug - cur; const pct = cur > 0 ? Math.round((diff / cur) * 100) : null;
                return (
                  <tr key={lab} style={{ textAlign: 'center' }}>
                    <td style={{ textAlign: 'left' }}>{lab}</td><td>{nf(cur)}</td><td>{nf(sug)}</td>
                    <td style={{ color: Math.abs(pct ?? 100) >= 40 ? 'var(--amber-ink)' : 'var(--muted)', fontWeight: Math.abs(pct ?? 100) >= 40 ? 700 : 400 }}>{diff > 0 ? '+' : ''}{nf(diff)}{pct !== null ? ' (' + (pct > 0 ? '+' : '') + pct + '%)' : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize: 12, fontWeight: 700, margin: '10px 0 4px' }}>ความเสี่ยงหมดอายุ (ข้อมูลประกอบ — สูตรข้างบนไม่ได้ใช้ตัวนี้)</div>
      <div style={{ fontSize: 11.5, lineHeight: 1.6 }}>
        {nearestExpDays === null ? <span className="muted">ไม่มีล็อตที่ระบุวันหมดอายุ</span> : (
          <>ล็อตที่หมดอายุเร็วที่สุดอีก <b>{nf(nearestExpDays)}</b> วัน{daysLeft !== null ? <> · ยอดรวม (หน้างาน {nf(med.floor)} + substock {nf(subQty(state, med.id))}) ใช้ได้ประมาณ <b>{nf(daysLeft)}</b> วัน</> : null}
            {daysLeft !== null && nearestExpDays >= 0 && daysLeft > nearestExpDays ? <div style={{ color: 'var(--red)', background: 'var(--red-bg)', borderRadius: 8, padding: '6px 8px', marginTop: 4 }}>⚠ ของที่มีอยู่ใช้ไม่หมดก่อนหมดอายุ — พิจารณาลดการเบิกเพิ่ม/ใช้ล็อตเก่าก่อน และอย่าตั้ง par สูงขึ้น</div> : null}</>
        )}
      </div>
      <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.5, marginTop: 8 }}>ตัวเลขนี้เป็นค่าแนะนำจากสถิติเท่านั้น — ไม่ได้รวมความจุชั้นวางและเพดานวันหมดอายุ เภสัชกรเป็นผู้ตัดสินใจ (ดูผลทดสอบย้อนหลังได้ที่ รายงาน → ทดสอบ Min/Max ย้อนหลัง)</div>
    </details>
  );
}
