import { nf } from '../../utils/format';

export function AgingTab({
  buckets, maxVal, riskValue, expiryWarnDays,
}: {
  buckets: { label: string; fg: string; lots: number; value: number }[];
  maxVal: number;
  riskValue: number;
  expiryWarnDays: number;
}) {
  return (
    <>
      <div className="card stagger" style={{ overflow: 'hidden', marginBottom: 14 }}>
        {buckets.map((b) => (
          <div key={b.label} style={{ padding: '11px 13px', borderBottom: '1px solid var(--border-soft)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: b.fg }}>{b.label}</span>
              <span className="muted" style={{ fontSize: 13, flex: 'none' }}>{b.lots} lot · {nf(b.value)} บาท</span>
            </div>
            <div className="bar-track" style={{ height: 6, background: 'var(--border-soft)', borderRadius: 3, marginTop: 7 }}>
              <div className="bar-fill" style={{ height: '100%', transform: 'scaleX(' + Math.max(2, Math.round((b.value / maxVal) * 100)) / 100 + ')', background: b.fg, borderRadius: 3 }} />
            </div>
          </div>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, padding: '0 2px' }}>
        มูลค่าที่เสี่ยงหมดอายุใน {expiryWarnDays} วัน <b style={{ color: 'var(--amber-ink)' }}>{nf(riskValue)} บาท</b> — ใช้ประกอบรายงาน PTC เรื่องการบริหารยาใกล้หมดอายุ
      </div>
    </>
  );
}
