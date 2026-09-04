import { useApp } from '../store/AppContext';
import { toneFor, usesSubstock, floorMinOf } from '../store/selectors';
import { nf, thDate, digitsOnly } from '../utils/format';
import { medColor } from '../utils/color';
import { MedDot } from '../components/MedDot';
import { Qty, DeficitBadge } from '../components/Qty';

export default function TransferScreen() {
  const { state, sub, fefo, setSearch, setFilter, bump, setCartQty, fillAll, printPickList, printTodayReplenishList, go, openScanSearch } = useApp();
  // noSubstock meds (liquids/sprays — received straight to the shelf, see ReceiveScreen)
  // have nothing to transfer from; showing them here with permanently-stuck-at-0 +/- buttons
  // would just be confusing clutter, not a real "เติมหน้างาน" candidate.
  // OPD/IPD ward tabs removed — one combined list (wardFilter stays 'all').
  const meds = state.meds.filter((m) => m.active && usesSubstock(m));
  const low = meds.filter((m) => m.floor < floorMinOf(m));
  const q = state.search.trim().toLowerCase();
  const filtered = meds
    .filter((m) => {
      if (q && m.name.toLowerCase().indexOf(q) < 0) return false;
      if (state.filter === 'low') return m.floor < floorMinOf(m);
      if (state.filter === 'had') return m.had;
      return true;
    })
    .sort((a, b) => a.floor / a.parFloor - b.floor / b.parFloor);

  const cartIds = Object.keys(state.cart);
  const chip = (active: boolean) => ({ border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green)' : 'var(--bg-card)', color: active ? '#fff' : 'var(--ink)' });

  return (
    <div style={{ animation: 'fade .18s' }}>
      <div style={{ padding: '12px 14px 10px' }} className="sticky-bar">
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={state.search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อยา / สแกน QR"
            style={{ flex: 1, minWidth: 0, border: '1px solid var(--border)', background: 'var(--bg-card)', borderRadius: 10, padding: '11px 13px', fontSize: 14, minHeight: 44 }}
          />
          <button onClick={() => openScanSearch('transfer')} title="สแกน QR เติมหน้างาน" style={{ border: '1px solid var(--green)', background: 'var(--green-tint)', color: 'var(--green)', borderRadius: 10, width: 46, minHeight: 44, fontSize: 17, flex: 'none' }}>▣</button>
        </div>
        <div style={{ display: 'flex', gap: 7, marginTop: 9, overflowX: 'auto', paddingBottom: 2 }}>
          <button className="chip" style={chip(state.filter === 'low')} onClick={() => setFilter('low')}>ต่ำกว่า Min ({low.length})</button>
          <button className="chip" style={chip(state.filter === 'all')} onClick={() => setFilter('all')}>ทั้งหมด</button>
          <button className="chip" style={chip(state.filter === 'had')} onClick={() => setFilter('had')}>High alert</button>
          <button className="chip" style={{ border: '1px dashed var(--green)', background: 'transparent', color: 'var(--green)' }} onClick={fillAll}>เติมตาม par ทั้งหมด</button>
          <button
            className="chip"
            style={{ border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 5 }}
            onClick={printTodayReplenishList}
            title="พิมพ์รายการที่ต้องเติมวันนี้ให้ถึง par — ไม่กระทบตะกร้า"
          >
            🖨 พิมพ์ใบเติมหน้างานวันนี้{low.length > 0 ? ' (' + low.length + ')' : ''}
          </button>
        </div>
      </div>

      <div style={{ padding: '10px 14px 96px' }}>
        {filtered.slice(0, 60).map((m, i) => {
          const f = fefo(m.id);
          const inCart = !!state.cart[m.id];
          return (
            <div
              key={m.id}
              className="card"
              style={{
                padding: '11px 12px 11px 14px', marginBottom: 8, borderColor: inCart ? 'var(--green)' : 'var(--border)',
                borderLeft: '4px solid ' + medColor(m.code), animation: 'pop .22s var(--ease-out) both', animationDelay: Math.min(i, 10) * 18 + 'ms',
              }}
            >
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 7 }}>
                    <MedDot code={m.code} />
                    <span>{m.name}</span>
                    {m.had && <span style={{ color: 'var(--had)', fontSize: 11, fontWeight: 700 }}>HAD</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                    หน้างาน <Qty value={m.floor} unit={m.unit} tone={toneFor(m)} size={12.5} /> · Min {nf(floorMinOf(m))} / Max {nf(m.parFloor)} · substock {nf(sub(m.id))} {m.unit}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--green)', marginTop: 3 }}>
                    FEFO: lot {f ? f.lotNo : '—'} · exp {f ? thDate(f.exp) : 'ไม่มีของใน substock'}
                    {f && <span className="muted"> (เหลือ {nf(f.qty)})</span>}
                  </div>
                  <div style={{ marginTop: 5 }}>
                    <DeficitBadge amount={Math.max(0, m.parFloor - m.floor)} unit={m.unit} urgent={m.floor < floorMinOf(m) * 0.5} />
                  </div>
                </div>
                <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button onClick={() => bump(m.id, -1)} className="press-spring" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)', width: 40, height: 40, borderRadius: 10, fontSize: 19, lineHeight: 1 }}>−</button>
                  <input
                    value={state.cart[m.id] || ''}
                    onChange={(e) => setCartQty(m.id, digitsOnly(e.target.value))}
                    inputMode="numeric"
                    style={{ width: 62, height: 40, textAlign: 'center', border: '1px solid var(--border)', borderRadius: 10, fontSize: 15, fontWeight: 600 }}
                  />
                  <button onClick={() => bump(m.id, 1)} className="press-spring" style={{ border: '1px solid var(--green)', background: 'var(--green-tint)', color: 'var(--green)', width: 40, height: 40, borderRadius: 10, fontSize: 19, lineHeight: 1 }}>+</button>
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '36px 10px' }}>ไม่พบรายการยาที่ค้นหา</div>}
      </div>

      {cartIds.length > 0 && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 66, padding: '10px 14px', background: 'linear-gradient(to top, var(--bg-app) 60%, rgba(247,246,242,0))', display: 'flex', gap: 10, alignItems: 'center' }}>
          <div className="muted" style={{ fontSize: 12.5, flex: 1, lineHeight: 1.35 }}>
            {cartIds.length} รายการ · {nf(cartIds.reduce((s, id) => s + state.cart[id], 0))} หน่วย
            {cartIds.some((id) => meds.find((m) => m.id === id)?.had) && (
              <span style={{ display: 'block', color: 'var(--had)', fontWeight: 600 }}>มียา high alert — ต้องสแกน QR ยืนยัน</span>
            )}
          </div>
          <button onClick={printPickList} title="พิมพ์ใบจัดยาเติมชั้น" style={{ flex: 'none', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--ink)', width: 50, height: 50, borderRadius: 12, fontSize: 18 }}>🖨</button>
          <button onClick={() => go('tconfirm')} className="btn-primary" style={{ padding: '14px 22px', borderRadius: 12, fontSize: 15, fontWeight: 600, minHeight: 50, boxShadow: '0 6px 18px -6px rgba(23,85,47,.7)' }}>ตรวจสอบ →</button>
        </div>
      )}
    </div>
  );
}
