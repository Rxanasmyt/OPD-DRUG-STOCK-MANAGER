// "รายงานคืนยาเดือน… พร้อมแล้ว" — shown on the HOME screen from the 1st of a month until this device has opened the previous
// month's returns report (from this banner, the LINE link, or the "เดือนที่แล้ว" chip). Per device (localStorage), no server data.
import { useState } from 'react';
import { useApp } from '../store/AppContext';
import { getSeenReturnsMonth, markReturnsMonthSeen, stashReturnsDeepLink } from '../utils/deepLink';
import { monthLabelTh, previousMonth } from '../utils/returnsSummary';

export default function ReturnsReportBanner() {
  const { state, go, setReportTab } = useApp();
  const [, bump] = useState(0);
  if (state.authStatus !== 'signedIn' || state.screen !== 'home') return null;
  const month = previousMonth(Date.now());
  if (getSeenReturnsMonth() >= month) return null;
  const open = () => {
    markReturnsMonthSeen(month);
    stashReturnsDeepLink({ month, view: 'all' });
    setReportTab('returns');
    go('report');
    bump((n) => n + 1);
  };
  return (
    <div className="rr-banner" data-level="info" role="status" data-testid="returns-report-banner">
      <span className="rr-ico" aria-hidden="true">📊</span>
      <div className="rr-txt">
        <b>รายงานคืนยาเดือน{monthLabelTh(month)} พร้อมแล้ว</b>
        <span>ภาพรวม แนวโน้ม แยกตามหมวดยาและเหตุผลการคืน — กดเพื่อดู</span>
      </div>
      <button type="button" className="rr-go" onClick={open}>ดูรายงาน ›</button>
    </div>
  );
}
