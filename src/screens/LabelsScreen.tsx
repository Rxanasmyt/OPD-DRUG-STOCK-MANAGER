import { useApp } from '../store/AppContext';
import { daysUntil } from '../store/selectors';
import { thDate } from '../utils/format';
import { QrCode } from '../components/QrCode';
import type { LabelType } from '../types';

const LOCS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2'];
const TABS: [LabelType, string][] = [['med', 'ฉลากตัวยา'], ['lot', 'ฉลาก lot'], ['loc', 'ฉลากชั้นวาง']];

export default function LabelsScreen() {
  const { state, setLabelType, printLabels, warn } = useApp();
  const meds = state.meds.filter((m) => m.active);
  const chip = (active: boolean) => ({ border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green)' : '#fff', color: active ? '#fff' : 'var(--ink)' });

  const rows = state.labelType === 'med'
    ? meds.slice(0, 8).map((m) => ({ code: m.code, title: m.name, sub: 'หน่วย ' + m.unit + ' · ชั้น ' + m.bin, tag: m.had ? 'HIGH ALERT' : '', tagColor: 'var(--had)' }))
    : state.labelType === 'lot'
    ? state.lots.slice(0, 8).map((l) => {
        const m = meds.find((x) => x.id === l.medId);
        return { code: l.code, title: m ? m.name : '—', sub: 'lot ' + l.lotNo + ' · exp ' + thDate(l.exp), tag: daysUntil(l.exp) < warn() ? 'ใกล้หมดอายุ' : '', tagColor: 'var(--amber)' };
      })
    : LOCS.map((b) => ({ code: 'LOC-' + b, title: 'ชั้นจ่ายยา ' + b, sub: 'หน้างาน OPD · สแกนเพื่อเปิดรายการในชั้นนี้', tag: '', tagColor: 'var(--muted)' }));

  const labelCount = state.labelType === 'loc' ? 8 : state.labelType === 'lot' ? state.lots.length : meds.length;
  const payloadSample = state.labelType === 'med' ? '{"t":"med","id":"MED-0035"}' : state.labelType === 'lot' ? '{"t":"lot","id":"LOT-035-1"}' : '{"t":"loc","id":"LOC-A1"}';

  return (
    <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>ยังไม่มี QR ติดที่ยาและชั้นวาง — เริ่มจากพิมพ์ฉลาก 3 ชนิดนี้ รหัสถูกสร้างจาก master data โดยตรง จึงสแกนได้ทันทีหลังติด</div>
      <div style={{ display: 'flex', gap: 7, marginBottom: 13 }}>
        {TABS.map(([t, label]) => (
          <button key={t} className="chip" style={{ ...chip(state.labelType === t), flex: 1, textAlign: 'center', minHeight: 42 }} onClick={() => setLabelType(t)}>{label}</button>
        ))}
      </div>
      <div className="grid-2 tablet-2" style={{ marginBottom: 14, gridTemplateColumns: 'repeat(2,1fr)' }}>
        {rows.map((r, i) => (
          <div key={i} style={{ background: '#fff', border: '1px solid #cfd1c8', borderRadius: 8, padding: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ flex: 'none' }}><QrCode value={r.code} size={52} /></div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 9.5, letterSpacing: '.08em', color: 'var(--muted)', fontWeight: 600 }}>{r.code}</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.25, marginTop: 2 }}>{r.title}</div>
              <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>{r.sub}</div>
              {r.tag && <div style={{ fontSize: 10, color: r.tagColor, fontWeight: 700, marginTop: 2 }}>{r.tag}</div>}
            </div>
          </div>
        ))}
      </div>
      <button onClick={printLabels} className="btn-primary" style={{ width: '100%', padding: 15, borderRadius: 11, fontSize: 15, minHeight: 52 }}>พิมพ์ฉลากทั้งชุด ({labelCount} ดวง · A4 กระดาษสติกเกอร์)</button>
      <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, marginTop: 11 }}>ภาพ QR ในเดโมเป็นลายตัวอย่าง — ระบบจริงสร้างจาก payload <b>{payloadSample}</b> และอ่านด้วย html5-qrcode บนกล้องแท็บเล็ต</div>
    </div>
  );
}
