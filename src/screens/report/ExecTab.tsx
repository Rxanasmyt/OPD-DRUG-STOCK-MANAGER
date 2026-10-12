import { nf } from '../../utils/format';
import type { Med, MedId } from '../../types';
import { ExecStat } from './shared';

export function ExecTab({
  execTotalValue, execHealthyPct, execCritical, execWarn, riskValue, expiryWarnDays, execTxsThisMonth,
  medCount, execByValue, execByUsage, goSubstockCardFor,
}: {
  execTotalValue: number;
  execHealthyPct: number;
  execCritical: number;
  execWarn: number;
  riskValue: number;
  expiryWarnDays: number;
  execTxsThisMonth: number;
  medCount: number;
  execByValue: { m: Med; oh: number; value: number }[];
  execByUsage: Med[];
  goSubstockCardFor: (id: MedId) => void;
}) {
  return (
    <>
      <div className="grid-2 tablet-4" style={{ marginBottom: 16 }}>
        <ExecStat label="มูลค่าคงคลังรวม" value={nf(Math.round(execTotalValue)) + ' บาท'} />
        <ExecStat label="สุขภาพคลังยาโดยรวม" value={execHealthyPct + '% ปกติ'} note={`วิกฤต ${nf(execCritical)} · เริ่มต่ำ ${nf(execWarn)}`} tone={execHealthyPct >= 80 ? 'var(--green)' : execHealthyPct >= 50 ? 'var(--amber)' : 'var(--red)'} />
        <ExecStat label={`มูลค่าเสี่ยงหมดอายุ ≤ ${expiryWarnDays} วัน`} value={nf(Math.round(riskValue)) + ' บาท'} tone={riskValue > 0 ? 'var(--amber)' : 'var(--green)'} />
        <ExecStat label="ธุรกรรมใน 30 วันล่าสุด" value={nf(execTxsThisMonth) + ' รายการ'} note={nf(medCount) + ' รายการยา active'} />
      </div>

      <div className="section-eyebrow" style={{ margin: '0 2px 8px' }}>10 อันดับมูลค่าคงคลังสูงสุด</div>
      <div className="card stagger" style={{ overflow: 'hidden', marginBottom: 18 }}>
        {execByValue.map((r) => (
          <button key={r.m.id} onClick={() => goSubstockCardFor(r.m.id)} className="row-interactive" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, width: '100%', border: 0, background: 'transparent', textAlign: 'left', padding: '10px 13px', borderBottom: '1px solid var(--border-soft)', fontSize: 13 }}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.m.name}</span>
            <span style={{ flex: 'none', fontWeight: 700 }}>{nf(Math.round(r.value))} บาท</span>
          </button>
        ))}
        {execByValue.length === 0 && <div style={{ padding: 18, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>ยังไม่มีข้อมูล</div>}
      </div>

      <div className="section-eyebrow" style={{ margin: '0 2px 8px' }}>10 อันดับใช้เร็วที่สุด (จ่าย 30 วัน)</div>
      <div className="card stagger" style={{ overflow: 'hidden' }}>
        {execByUsage.map((m) => (
          <button key={m.id} onClick={() => goSubstockCardFor(m.id)} className="row-interactive" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, width: '100%', border: 0, background: 'transparent', textAlign: 'left', padding: '10px 13px', borderBottom: '1px solid var(--border-soft)', fontSize: 13 }}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
            <span style={{ flex: 'none', fontWeight: 700 }}>{nf(m.used30)} {m.unit}</span>
          </button>
        ))}
        {execByUsage.length === 0 && <div style={{ padding: 18, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>ยังไม่มีข้อมูลการใช้ยา</div>}
      </div>
    </>
  );
}
