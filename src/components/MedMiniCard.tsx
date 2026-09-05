import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';
import { nf, thDate } from '../utils/format';

// Same type→icon/label map as SubstockCardScreen.tsx (kept in sync there) — รับจากคลังใหญ่ /
// เติมหน้างาน / ตัดหมดอายุ are the only three tx types that ever touch substock.
const TYPE_META: Record<string, { icon: string; label: string }> = {
  receive_from_central: { icon: '📥', label: 'รับจากคลังใหญ่' },
  transfer_to_floor: { icon: '🚚', label: 'เติมหน้างาน' },
  expired: { icon: '🗑️', label: 'ตัดหมดอายุ' },
};

/**
 * Compact "เคลื่อนไหวล่าสุด" panel — the last few substock movements plus a link to the full
 * บัตรสต็อก, dropped straight into the รับเข้า/เติมหน้างาน workflow. The point: someone mid-task
 * (about to receive or transfer a drug) can see its real recent history — was it just topped
 * up? has it been sitting untouched? — without leaving the form they're filling in (which
 * would abandon whatever they'd already typed) or hunting the drug down separately in
 * บัตรสต็อก afterward.
 *
 * Fetches its own ledger tail lazily on mount and fails soft — a fetch error (offline, etc.)
 * here shows nothing rather than an error banner, and NEVER blocks or interferes with the
 * receive/transfer action it's sitting inside. This is read-only decoration, not a dependency
 * of the surrounding workflow.
 */
export function MedMiniCard({ medId, unit, tailCount = 4 }: { medId: string; unit: string; tailCount?: number }) {
  const { fetchSubstockLedger, goSubstockCardFor } = useApp();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tail, setTail] = useState<{ ts: number; type: string; qty: number; balance: number }[]>([]);

  // fetchSubstockLedger is recreated on every realtime meds snapshot (its useCallback depends
  // on state.meds, which gets a brand-new array identity on every sync regardless of whether
  // THIS drug changed — normal in a busy pharmacy with several terminals active at once). A
  // ref sidesteps that: the effect below only re-runs when the drug being shown actually
  // changes, not on every unrelated stock update happening anywhere else in the building —
  // otherwise this panel would flicker/reload constantly while someone's mid-transaction.
  const fetchRef = useRef(fetchSubstockLedger);
  fetchRef.current = fetchSubstockLedger;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    setTail([]);
    fetchRef.current(medId)
      .then((rows) => { if (alive) setTail(rows.slice(-tailCount).reverse()); })
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medId, tailCount]);

  if (loading) {
    return <div className="muted" style={{ fontSize: 11.5, padding: '7px 2px' }}>กำลังโหลดประวัติล่าสุด…</div>;
  }
  // Fail soft — offline or a slow connection shouldn't block or clutter the receive/transfer
  // form with an error the person didn't ask about; the full บัตรสต็อก screen already surfaces
  // a proper retry-able error message for when someone actually goes looking for history.
  if (failed) return null;
  if (tail.length === 0) {
    return <div className="muted" style={{ fontSize: 11.5, padding: '7px 2px' }}>ยานี้ยังไม่มีประวัติ substock</div>;
  }

  return (
    <div style={{ marginTop: 2 }}>
      <div className="muted" style={{ fontSize: 10.5, fontWeight: 700, margin: '2px 2px 5px' }}>เคลื่อนไหวล่าสุด</div>
      <div style={{ border: '1px solid var(--border-soft)', borderRadius: 8, overflow: 'hidden' }}>
        {tail.map((r, i) => {
          const meta = TYPE_META[r.type];
          return (
            <div
              key={i}
              title={meta ? meta.label : r.type}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 9px', borderBottom: i < tail.length - 1 ? '1px solid var(--border-soft)' : 0, fontSize: 11.5 }}
            >
              <span style={{ flex: 'none', fontSize: 12 }}>{meta ? meta.icon : '•'}</span>
              <span className="muted" style={{ flex: 'none', width: 52 }}>{thDate(r.ts)}</span>
              <span style={{ flex: 1, fontWeight: 700, color: r.qty > 0 ? 'var(--green)' : 'var(--red)' }}>{r.qty > 0 ? '+' : ''}{nf(r.qty)} {unit}</span>
              <span className="muted" style={{ flex: 'none' }}>เหลือ {nf(r.balance)}</span>
            </div>
          );
        })}
      </div>
      <button
        onClick={() => goSubstockCardFor(medId)}
        style={{ border: 0, background: 'transparent', color: 'var(--green)', fontSize: 11, fontWeight: 700, padding: '7px 2px 0', minHeight: 30 }}
      >
        ดูบัตรสต็อกเต็ม →
      </button>
    </div>
  );
}
