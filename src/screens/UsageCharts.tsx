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
            <Line type="monotone" dataKey="value" name="มูลค่า (บาท)" stroke="var(--green)" strokeWidth={2} dot={{ r: 3 }} />
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
              tickFormatter={(v: string) => categoryLabel(v)}
            />
            <Tooltip
              formatter={(v) => nf(Math.round(Number(v))) + ' บาท'}
              labelFormatter={(v) => categoryLabel(String(v))}
              contentStyle={{ fontSize: 12, borderRadius: 9, border: '1px solid var(--border)' }}
            />
            <Bar dataKey="value" name="มูลค่า (บาท)" fill="var(--green)" radius={4} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
