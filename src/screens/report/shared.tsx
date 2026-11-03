// Shared constants/helpers split out of ReportScreen.tsx so each report-tab component (and the
// container itself) can import from one place instead of duplicating them.
import type { ReportTab } from '../../types';

// "exec" leads the tab strip — a PTC/pharmacy-head reader opening this screen wants the
// headline picture first, not to have to find it after four operational tabs. "kpi" trails
// everything else — it's a distinct kind of report (historical trend over a chosen range, not
// "right now"), so it gets its own visual treatment (see isKpi below) the same way "insights"
// already does for "computed, not just filtered".
export const TABS: [ReportTab, string][] = [['exec', '📊 ภาพรวมผู้บริหาร'], ['aging', 'Stock aging'], ['category', 'แยกตามหมวดยา'], ['turn', 'Turnover'], ['insights', '🧠 วิเคราะห์อัตโนมัติ'], ['disc', 'Discrepancy log'], ['kpi', '📅 ตัวชี้วัดย้อนหลัง'], ['usage', '📈 สถิติการใช้ยา'], ['stockasof', '📜 ยอดคงคลังย้อนหลัง'], ['returns', '↩️ รายงานคืนยา'], ['replenish', '🔄 เติมหน้างาน']];
export const REPORT_NAMES: Record<ReportTab, string> = { exec: 'executive_summary.csv', aging: 'stock_aging.csv', category: 'stock_by_category.csv', turn: 'turnover.csv', disc: 'discrepancy_log.csv', insights: 'usage_insights.csv', kpi: 'kpi_metrics.csv', usage: 'usage_history.csv', stockasof: 'stock_as_of.csv', returns: 'drug_returns.csv', replenish: 'floor_refills.csv' };
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

// Same tone→gradient mapping as HomeScreen's toneGradient() — kept as its own local copy (this
// module's own convention, see chip() above) rather than a shared import, since each screen's
// tone helper is tiny and screen-local by design in this codebase. "no tone" and explicit
// var(--green) both read as --grad-brand: a neutral figure isn't bad news, so it stays calm/
// on-brand instead of looking washed out next to the red/amber tiles beside it.
function toneGradient(tone?: string): string {
  if (tone === 'var(--red)') return 'var(--grad-red)';
  if (tone === 'var(--amber)') return 'var(--grad-amber)';
  return 'var(--grad-brand)';
}

/** One headline number for the ภาพรวมผู้บริหาร tab (and the other report tabs that share it) —
 * still no icon or click target (this screen is scanned as a report, not tapped through as a
 * dashboard), but now the same gradient-tile treatment as HomeScreen's StatTile for a consistent
 * look across the app. */
export function ExecStat({ label, value, note, tone }: { label: string; value: string; note?: string | undefined; tone?: string | undefined }) {
  return (
    <div className="card" style={{ border: 0, padding: '13px 13px 12px', background: toneGradient(tone) }}>
      <div style={{ fontSize: 19, fontWeight: 800, lineHeight: 1.15, color: '#fff', letterSpacing: '-.01em' }}>{value}</div>
      <div style={{ fontSize: 11, marginTop: 5, lineHeight: 1.4, color: 'rgba(255,255,255,.88)' }}>{label}</div>
      {note && <div style={{ fontSize: 10.5, marginTop: 1, lineHeight: 1.4, color: 'rgba(255,255,255,.72)' }}>{note}</div>}
    </div>
  );
}
