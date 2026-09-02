import { useApp } from '../store/AppContext';
import { daysUntil, wardOf } from '../store/selectors';
import { thDate } from '../utils/format';
import { QrCode } from '../components/QrCode';
import { encodeQr } from '../utils/qr';
import { shortLabelName, titleSizeStep } from '../utils/labelName';

// On-screen px per titleSizeStep() — mirrors print.ts's pt scale so the preview shows what
// will actually print (just in px instead of pt, and one notch smaller since the strip is
// stretched full mobile-width here vs a fixed 100mm print card).
const TITLE_PX_BY_STEP = [17, 16, 14.5, 13, 11.5, 10.5];
import { LOCS } from '../data/locations';
import type { LabelType, Ward } from '../types';

const TABS: [LabelType, string][] = [['med', 'ฉลากตัวยา'], ['lot', 'ฉลาก lot'], ['loc', 'ฉลากชั้นวาง']];
const WARD_COLOR: Record<Ward, string> = { opd: 'var(--green)', ipd: 'var(--ipd)' };

export default function LabelsScreen() {
  const { state, setLabelType, setWardFilter, printLabels, warn } = useApp();
  const meds = state.meds.filter((m) => m.active && (state.wardFilter === 'all' || wardOf(m) === state.wardFilter));
  const chip = (active: boolean) => ({ border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green)' : 'var(--bg-card)', color: active ? '#fff' : 'var(--ink)' });

  const medIds = new Set(meds.map((m) => m.id));
  const wardLots = state.lots.filter((l) => medIds.has(l.medId));
  const rows = state.labelType === 'med'
    ? meds.slice(0, 8).map((m) => ({ code: m.code, bin: m.bin, payload: encodeQr('med', m.code), title: shortLabelName(m.name), sub: 'หน่วย ' + m.unit + ' · ชั้น ' + m.bin, tag: m.had ? 'HIGH ALERT' : '', tagColor: 'var(--had)' }))
    : state.labelType === 'lot'
    ? wardLots.slice(0, 8).map((l) => {
        const m = meds.find((x) => x.id === l.medId);
        return { code: l.code, bin: undefined as string | undefined, payload: encodeQr('lot', l.code), title: m ? m.name : '—', sub: 'lot ' + l.lotNo + ' · exp ' + thDate(l.exp), tag: daysUntil(l.exp) < warn() ? 'ใกล้หมดอายุ' : '', tagColor: 'var(--amber)' };
      })
    : LOCS.map((b) => ({ code: 'LOC-' + b, bin: undefined as string | undefined, payload: encodeQr('loc', 'LOC-' + b), title: 'ชั้นจ่ายยา ' + b, sub: 'หน้างาน OPD · สแกนเพื่อเปิดรายการในชั้นนี้', tag: '', tagColor: 'var(--muted)' }));

  const labelCount = state.labelType === 'loc' ? LOCS.length : state.labelType === 'lot' ? wardLots.length : meds.length;

  return (
    <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>ยังไม่มี QR ติดที่ยาและชั้นวาง — เริ่มจากพิมพ์ฉลาก 3 ชนิดนี้ รหัสถูกสร้างจาก master data โดยตรง เป็น QR จริงที่กล้องมือถือ/แท็บเล็ตสแกนได้ทันทีหลังติด</div>
      <div style={{ display: 'flex', gap: 7, marginBottom: 9 }}>
        {TABS.map(([t, label]) => (
          <button key={t} className="chip" style={{ ...chip(state.labelType === t), flex: 1, textAlign: 'center', minHeight: 42 }} onClick={() => setLabelType(t)}>{label}</button>
        ))}
      </div>
      {state.labelType !== 'loc' && (
        <div style={{ display: 'flex', gap: 2, background: 'var(--border-soft)', padding: 3, borderRadius: 11, marginBottom: 13 }}>
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
      )}
      {state.labelType === 'med' ? (
        <div style={{ marginBottom: 14 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ background: '#fff', border: '1px solid #999', borderRadius: 8, marginBottom: 7, display: 'flex', alignItems: 'stretch', height: 64, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,.04)' }}>
              <div style={{ flex: 'none', width: 34, background: '#f5c518', color: '#1a1a1a', fontWeight: 800, fontSize: 12.5, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', lineHeight: 1.1, borderRight: '1px solid #d9ac00' }}>{r.bin}</div>
              <div style={{ flex: 'none', padding: '0 9px', display: 'flex', alignItems: 'center' }}><QrCode value={r.payload} size={46} /></div>
              <div style={{ minWidth: 0, padding: '4px 10px', display: 'flex', flexDirection: 'column', justifyContent: 'center', borderLeft: '1px solid #e5e5e0' }}>
                <div style={{ fontSize: TITLE_PX_BY_STEP[titleSizeStep(r.title)], fontWeight: 800, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#14231a' }}>{r.title}</div>
                {r.tag && <div style={{ fontSize: 10.5, color: r.tagColor, fontWeight: 700, marginTop: 2 }}>{r.tag}</div>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid-2 tablet-2" style={{ marginBottom: 14, gridTemplateColumns: 'repeat(2,1fr)' }}>
          {rows.map((r, i) => (
            <div key={i} style={{ background: '#fff', border: '1px solid #cfd1c8', borderRadius: 8, padding: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ flex: 'none' }}><QrCode value={r.payload} size={52} /></div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 9.5, letterSpacing: '.08em', color: 'var(--muted)', fontWeight: 600 }}>{r.code}</div>
                <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.25, marginTop: 2 }}>{r.title}</div>
                <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>{r.sub}</div>
                {r.tag && <div style={{ fontSize: 10, color: r.tagColor, fontWeight: 700, marginTop: 2 }}>{r.tag}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
      <button onClick={printLabels} className="btn-primary" style={{ width: '100%', padding: 15, borderRadius: 11, fontSize: 15, minHeight: 52 }}>พิมพ์ฉลากทั้งชุด ({labelCount} ดวง · A4 กระดาษสติกเกอร์)</button>
      <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, marginTop: 11 }}>
        พิมพ์ลงกระดาษ A4 แล้วตัดติดหน้ายา/lot/ชั้นวางได้เลย — QR แต่ละดวงสแกนด้วยกล้องมือถือหรือแท็บเล็ตผ่านปุ่ม ▣ ในหน้ารับเข้า/เติมหน้างานได้ทันที
        {state.labelType === 'med' && <> ฉลากตัวยาพิมพ์ที่ขนาดจริง 2×10 ซม. ต่อดวง — 1 แผ่น A4 จุ 28 ดวงพอดี (2 คอลัมน์ × 14 แถว)</>}
      </div>
    </div>
  );
}
