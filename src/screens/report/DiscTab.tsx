import { nf, thDate } from '../../utils/format';
import type { MedId, Tx } from '../../types';
import { asMedId } from '../../types';
import { SearchInput } from '../../components/SearchInput';
import { DISC_TYPES, DISC_TYPE_LABEL, chip } from './shared';

export function DiscTab({
  discSearch, setDiscSearch, discFilter, setDiscFilter, discRows, goSubstockCardFor,
}: {
  discSearch: string;
  setDiscSearch: (v: string) => void;
  discFilter: string;
  setDiscFilter: (v: string) => void;
  discRows: Tx[];
  goSubstockCardFor: (id: MedId) => void;
}) {
  return (
    <>
      <SearchInput value={discSearch} onChange={setDiscSearch} placeholder="ค้นหาชื่อยาในประวัตินี้" style={{ marginBottom: 9 }} />
      <div className="scroll-fade-x" style={{ display: 'flex', gap: 7, marginBottom: 11, overflowX: 'auto', paddingBottom: 2 }}>
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
              {...(x.medId ? { onClick: () => goSubstockCardFor(asMedId(x.medId!)), className: 'row-interactive', title: 'ดูบัตรสต็อกยานี้' } : {})}
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
  );
}
