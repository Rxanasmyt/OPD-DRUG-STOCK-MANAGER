// "ใช้งานแอพนี้อย่างไร" — the daily flow of the pharmacy, shown on the login screen so everyone sees it before
// every sign-in. Wording mirrors the real bottom-nav tab names (App.tsx NAV_DEF) so "tap here" is literal.

import { TAB } from '../navLabels';

export interface GuideStep { when: string; icon: string; title: string; where: string; desc: string }

export const DAILY_STEPS: GuideStep[] = [
  { when: 'เช้า', icon: '🔃', title: 'ตัดยอดหน้างานด้วยไฟล์ HOSxP', where: `แท็บ "${TAB.reconcile}"`, desc: 'แนบไฟล์ของเมื่อวาน → แก้รายการที่แอพแจ้ง → ตรวจสรุป → กดตัดยอด (ผิดไฟล์ กด "ลบไฟล์" แนบใหม่ได้)' },
  { when: 'หลังตัดยอด', icon: '🔄', title: 'เบิกยาจาก substock เข้าชั้นวางหน้า\u2060งาน', where: `แท็บ "${TAB.transfer}"`, desc: 'สแกน QR หรือค้นหายา ระบุจำนวนที่เติม แอพเลือก lot ที่หมดอายุก่อนให้ (FEFO)' },
  { when: 'เวรบ่าย', icon: '↩️', title: 'ลงข้อมูลยาที่ผู้ป่วยคืน แล้วนำยาเติมเข้าชั้นวาง', where: `แท็บ "${TAB.more}" → "ปรับยอด / คืนยา"`, desc: 'บันทึกรายการคืนของวันนี้ทุกครั้งพร้อมเหตุผล ยอดบนหน้างานจะตรงกับของจริง' },
];

export const PERIODIC_STEP: GuideStep = {
  when: 'สัปดาห์ที่ 1 และ 3 ของเดือน', icon: '📦', title: 'เบิกยาจากคลังยา เติมเข้า substock', where: `แท็บ "${TAB.receive}"`,
  desc: 'สแกนหรือค้นหายาตามใบเบิก ใส่จำนวน (และ lot / วันหมดอายุถ้ามี) แล้วเพิ่มลงใบรับ',
};


export default function LoginGuide() {
  return (
    <section className="lg-card" aria-labelledby="lg-title" data-testid="login-guide">
      <div className="lg-head">
        <span className="lg-head-icon" aria-hidden="true">🧭</span>
        <div>
          <h2 id="lg-title" className="lg-title">ใช้งานแอพนี้อย่างไร</h2>
          <div className="lg-sub">งานประจำวันของห้องยา — ทำตามลำดับนี้ได้เลย</div>
        </div>
      </div>

      <ol className="lg-steps">
        {DAILY_STEPS.map((s, i) => (
          <li key={s.title} className="lg-step" style={{ animationDelay: 150 + i * 110 + 'ms' }}>
            <div className="lg-dot" aria-hidden="true">{i + 1}</div>
            <div className="lg-body">
              <div className="lg-when">{s.when}</div>
              <div className="lg-step-title"><span aria-hidden="true">{s.icon}</span> {s.title}</div>
              <div className="lg-where">กดที่: {s.where}</div>
              <div className="lg-desc">{s.desc}</div>
            </div>
          </li>
        ))}
      </ol>

      <div className="lg-periodic" data-testid="login-guide-periodic" style={{ animationDelay: '520ms' }}>
        <div className="lg-when lg-when--periodic">🗓 ทุก 2 สัปดาห์ · {PERIODIC_STEP.when}</div>
        <div className="lg-step-title"><span aria-hidden="true">{PERIODIC_STEP.icon}</span> {PERIODIC_STEP.title}</div>
        <div className="lg-where">กดที่: {PERIODIC_STEP.where}</div>
        <div className="lg-desc">{PERIODIC_STEP.desc}</div>
      </div>
    </section>
  );
}
