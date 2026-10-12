// Shared constants/helpers split out of ReportScreen.tsx so each report-tab component (and the
// container itself) can import from one place instead of duplicating them.
import type { ReportTab } from '../../types';

// "exec" leads the tab strip — a PTC/pharmacy-head reader opening this screen wants the
// headline picture first, not to have to find it after four operational tabs. "kpi" trails
// everything else — it's a distinct kind of report (historical trend over a chosen range, not
// "right now"), so it gets its own visual treatment (see isKpi below) the same way "insights"
// already does for "computed, not just filtered".
export const TABS: [ReportTab, string][] = [['exec', '📊 ภาพรวมผู้บริหาร'], ['aging', 'Stock aging'], ['category', 'แยกตามหมวดยา'], ['turn', 'Turnover'], ['insights', '🧠 วิเคราะห์อัตโนมัติ'], ['disc', 'Discrepancy log'], ['kpi', '📅 ตัวชี้วัดย้อนหลัง'], ['usage', '📈 สถิติการใช้ยา'], ['stockasof', '📜 ยอดคงคลังย้อนหลัง'], ['returns', '↩️ รายงานคืนยา']];
export const REPORT_NAMES: Record<ReportTab, string> = { exec: 'executive_summary.csv', aging: 'stock_aging.csv', category: 'stock_by_category.csv', turn: 'turnover.csv', disc: 'discrepancy_log.csv', insights: 'usage_insights.csv', kpi: 'kpi_metrics.csv', usage: 'usage_history.csv', stockasof: 'stock_as_of.csv', returns: 'drug_returns.csv' };
export const AGING_BUCKETS: [string, number, number, string][] = [
  ['หมดอายุแล้ว', -99999, 0, 'var(--red)'],
  ['เหลือ ≤ 30 วัน', 0, 30, 'var(--red)'],
  ['31–90 วัน', 30, 90, 'var(--amber)'],
  ['91–180 วัน', 90, 180, 'var(--muted)'],
  ['มากกว่า 180 วัน', 180, 99999, 'var(--green)'],
];
export const DISC_TYPES = ['adjust', 'return', 'damaged', 'expired', 'count', 'reconcile_hosxp'];
export const DISC_TYPE_LABEL: Record<string, string> = {
  adjust: 'ปรับยอด', return: 'คืนยา', damaged: 'ยาเสีย/ชำรุด', expired: 'หมดอายุ', count: 'นับสต็อก', reconcile_hosxp: 'นำเข้า HOSxP',
};

export const chip = (active: boolean) => ({ border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green)' : 'var(--bg-card)', color: active ? 'var(--ink-soft)' : 'var(--ink)' });

/** One headline number for the ภาพรวมผู้บริหาร tab — deliberately plainer than HomeScreen's
 * StatTile (no icon, no click target): this screen is meant to be scanned/printed as a report,
 * not tapped through as a dashboard. */
export function ExecStat({ label, value, note, tone }: { label: string; value: string; note?: string | undefined; tone?: string | undefined }) {
  return (
    <div className="card" style={{ padding: '13px 13px 12px' }}>
      <div style={{ fontSize: 19, fontWeight: 800, lineHeight: 1.15, color: tone || 'var(--ink)', letterSpacing: '-.01em' }}>{value}</div>
      <div className="muted" style={{ fontSize: 11, marginTop: 5, lineHeight: 1.4 }}>{label}</div>
      {note && <div className="muted" style={{ fontSize: 10.5, marginTop: 1, lineHeight: 1.4 }}>{note}</div>}
    </div>
  );
}
