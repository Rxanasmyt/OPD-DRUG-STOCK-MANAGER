// Split out from ReportScreen.tsx's "📈 สถิติการใช้ยา" tab for one reason: recharts is a ~250KB+
// dependency that NOTHING else in this app needs, and ReportScreen is a core nav screen opened
// far more often than this one tab inside it. Bundling recharts straight into ReportScreen's own
// chunk would make every pharmacist loading "รายงาน" download it, even if they never touch the
// usage tab. Lazy-loaded (see ReportScreen.tsx's `lazy(() => import('./UsageCharts'))`) the same
// way App.tsx already lazy-loads whole screens, and the same "only pull in a heavy lib when the
// feature using it actually runs" principle exportAllReports already applies to `xlsx`.
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line } from 'recharts';
import { nf } from '../utils/format';
import { categoryLabel } from '../data/categories';
import type { MonthUsageAgg, CategoryUsageAgg } from '../store/selectors';

// Bug fix (real-device UX audit, Report tab): recharts' default category-axis tick is a single
// <text> with no word-wrap and no built-in truncation — a label longer than the axis's given
// `width` just overflows past it and gets clipped by the chart's own edge. Since a Y-axis tick's
// text-anchor sits at its RIGHT edge (growing leftward), what gets clipped is the START of the
// label, not the end — e.g. "ยาเบาหวาน/ต่อมไร้ท่อ/ไขมันในเลือด" rendered as "หวาน/ต่อมไร้ท่อ/
// ไขมันในเลือด", silently dropping which drug class "เบา-" even was. Several of this app's real
// category labels (data/categories.ts) are long enough to hit this — not a one-off. Truncating
// here with an ellipsis guarantees it never overflows regardless of label length; the full,
// untruncated name is still available on tap/hover via the Tooltip's own labelFormatter below.
export function truncateLabel(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export default function UsageCharts({ monthRows, categoryRows }: { monthRows: MonthUsageAgg[]; categoryRows: CategoryUsageAgg[] }) {
  return (
    <>
      <div className="muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.03em', margin: '0 2px 8px', textTransform: 'uppercase' }}>แนวโน้มมูลค่าการใช้ยารายเดือน</div>
      <div className="card" style={{ padding: '13px 6px 6px', marginBottom: 16 }}>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={monthRows} margin={{ top: 4, right: 14, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="var(--border-soft)" vertical={false} />
            <XAxis dataKey="monthKey" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={(v: string) => v.slice(5)} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} width={48} tickFormatter={(v: number) => nf(v)} />
            <Tooltip
              formatter={(v) => nf(Math.round(Number(v))) + ' บาท'}
              labelFormatter={(v) => 'เดือน ' + String(v)}
              contentStyle={{ fontSize: 12, borderRadius: 9, border: '1px solid var(--border)' }}
            />
            {/* isAnimationActive=false — recharts' default ~1.5s "grow from zero" entrance
                animation is far slower than the rest of this app's motion language (every other
                transition here runs 120–320ms, see --dur-fast/--dur-slow in styles.css), and it
                replays on every data refetch, not just first paint. Reading the real trend
                immediately beats a decorative draw-in for a report a pharmacist opens to check
                a number, not to watch a chart animate. */}
            <Line type="monotone" dataKey="value" name="มูลค่า (บาท)" stroke="var(--green)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.03em', margin: '0 2px 8px', textTransform: 'uppercase' }}>มูลค่าการใช้ยาแยกตามหมวด — ใช้ยากลุ่มไหนเยอะ</div>
      <div className="card" style={{ padding: '13px 6px 6px', marginBottom: 16 }}>
        <ResponsiveContainer width="100%" height={Math.max(160, categoryRows.length * 28)}>
          <BarChart data={categoryRows} layout="vertical" margin={{ top: 4, right: 14, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="var(--border-soft)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={(v: number) => nf(v)} />
            <YAxis
              type="category" dataKey="category" width={150}
              tick={{ fontSize: 10.5, fill: 'var(--ink)' }}
              tickFormatter={(v: string) => truncateLabel(categoryLabel(v), 16)}
            />
            <Tooltip
              formatter={(v) => nf(Math.round(Number(v))) + ' บาท'}
              labelFormatter={(v) => categoryLabel(String(v))}
              contentStyle={{ fontSize: 12, borderRadius: 9, border: '1px solid var(--border)' }}
            />
            <Bar dataKey="value" name="มูลค่า (บาท)" fill="var(--green)" radius={4} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
