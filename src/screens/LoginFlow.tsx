// Animated one-glance map of how drugs and records move through the pharmacy, shown on the login page.
// Each node opens the matching section of the full manual (UserManual). Wording follows the real tab names.
import { TAB } from '../navLabels';

export interface FlowNode { id: string; icon: string; title: string; sub: string; section: string }
export interface FlowLink { label: string; tab: string; dir: 'down' | 'up'; note?: string }

export const FLOW_NODES: FlowNode[] = [
  { id: 'wh', icon: '🏢', title: 'คลังยาใหญ่', sub: 'เบิกทุก 2 สัปดาห์ (สัปดาห์ที่ 1 และ 3)', section: 'receive' },
  { id: 'sub', icon: '📦', title: 'substock', sub: 'คลังย่อยของห้องยา', section: 'receive' },
  { id: 'floor', icon: '💊', title: 'ชั้นวางหน้างาน OPD / IPD', sub: 'ยอดที่ใช้จ่ายยาจริง', section: 'transfer' },
  { id: 'pt', icon: '🧑‍⚕️', title: 'ผู้ป่วย', sub: 'จ่ายยาในระบบ HOSxP', section: 'hosxp' },
];

export const FLOW_LINKS: FlowLink[] = [
  { label: 'รับเข้า', tab: `แท็บ “${TAB.receive}”`, dir: 'down', note: 'ใส่ Lot + วันหมดอายุ (ถ่ายรูปฉลากได้)' },
  { label: 'เติมหน้างาน', tab: `แท็บ “${TAB.transfer}”`, dir: 'down', note: 'FEFO — หมดอายุก่อน ออกก่อน' },
  { label: 'ตัดยอดตาม HOSxP', tab: `แท็บ “${TAB.reconcile}”`, dir: 'down', note: 'ทุกเช้า ตัดตามที่จ่ายจริงของเมื่อวาน' },
];

export default function LoginFlow({ onOpen }: { onOpen: (section: string) => void }) {
  return (
    <section className="lf-card" aria-labelledby="lf-title" data-testid="login-flow">
      <div className="lg-head">
        <span className="lg-head-icon" aria-hidden="true">🗺️</span>
        <div>
          <h2 id="lf-title" className="lg-title">ภาพรวมการไหลของยา</h2>
          <div className="lg-sub">แตะแต่ละจุดเพื่ออ่านวิธีทำในคู่มือ</div>
        </div>
      </div>
      <div className="lf-chain">
        {FLOW_NODES.map((n, i) => (
          <div key={n.id}>
            <button type="button" className="lf-node" data-testid={'flow-node-' + n.id} onClick={() => onOpen(n.section)} style={{ animationDelay: i * 120 + 'ms' }}>
              <span className="lf-ico" aria-hidden="true">{n.icon}</span>
              <span className="lf-txt"><b>{n.title}</b><small>{n.sub}</small></span>
              <span className="lf-go" aria-hidden="true">›</span>
            </button>
            {i < FLOW_LINKS.length && (
              <div className="lf-link" data-testid={'flow-link-' + i}>
                <div className="lf-rail" aria-hidden="true"><i /><i /><i /></div>
                <div className="lf-link-txt"><b>{FLOW_LINKS[i].label}</b><span>{FLOW_LINKS[i].tab}</span>{FLOW_LINKS[i].note && <em>{FLOW_LINKS[i].note}</em>}</div>
              </div>
            )}
          </div>
        ))}
      </div>
      <button type="button" className="lf-return" data-testid="flow-return" onClick={() => onOpen('adjust')}>
        <span aria-hidden="true">↩️</span>
        <span className="lf-return-txt"><b>ยาที่ผู้ป่วยคืน</b> กลับเข้าชั้นวาง — เวรบ่าย ลงใน <b>เพิ่มเติม → ปรับยอด / คืนยา</b></span>
        <span className="lf-go" aria-hidden="true">›</span>
      </button>
      <div className="lf-audit"><span aria-hidden="true">📜</span> ทุกขั้นตอนบันทึกลง Audit log — ตรวจย้อนหลังได้ว่าใครทำอะไรเมื่อไร</div>
    </section>
  );
}
