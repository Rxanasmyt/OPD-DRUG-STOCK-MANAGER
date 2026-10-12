import type { MedId } from '../../types';
import { severityIcon } from '../../components/Qty';

export function TurnTab({
  turnRows, goSubstockCardFor,
}: {
  turnRows: { id: MedId; name: string; used: string; doh: string; tone: string }[];
  goSubstockCardFor: (id: MedId) => void;
}) {
  return (
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
          {/* Bug fix (accessibility): this cell used to be a bare color-coded number with
              nothing else distinguishing "วิกฤต" from "ปกติ" — the same color-only signal
              Qty.tsx's own severityIcon() was added to close everywhere else, just not
              applied here since this table renders the tone inline instead of via <Qty>. */}
          <span style={{ width: 52, textAlign: 'right', flex: 'none', fontSize: 13, fontWeight: 600, color: t.tone }}>
            {severityIcon(t.tone) && <span aria-hidden="true" style={{ marginRight: 2 }}>{severityIcon(t.tone)}</span>}
            {t.doh}
          </span>
        </button>
      ))}
    </div>
  );
}
