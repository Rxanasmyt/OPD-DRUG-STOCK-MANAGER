import { lazy, Suspense } from 'react';
import { useApp } from './store/AppContext';
import LoginScreen from './screens/LoginScreen';
import HomeScreen from './screens/HomeScreen';
import TransferScreen from './screens/TransferScreen';
import TConfirmScreen from './screens/TConfirmScreen';
import DoneScreen from './screens/DoneScreen';
import ReceiveScreen from './screens/ReceiveScreen';
import MoreScreen from './screens/MoreScreen';
import Toast from './components/Toast';
import type { Screen } from './types';

// Code-split the screens that aren't part of the hot day-to-day path (settings, admin,
// reports, labels/QR, reconcile, count, adjust) — these pull in extra weight (qrcode, jsqr
// for the labels screen especially) that shouldn't sit in the initial bundle a phone has to
// download and parse before it can even show the login/home screen.
const AdjustScreen = lazy(() => import('./screens/AdjustScreen'));
const ReportScreen = lazy(() => import('./screens/ReportScreen'));
const LabelsScreen = lazy(() => import('./screens/LabelsScreen'));
const SettingsScreen = lazy(() => import('./screens/SettingsScreen'));
const CountScreen = lazy(() => import('./screens/CountScreen'));
const ReconcileScreen = lazy(() => import('./screens/ReconcileScreen'));
const AdminScreen = lazy(() => import('./screens/AdminScreen'));
const MedsScreen = lazy(() => import('./screens/MedsScreen'));
const WardMoveScreen = lazy(() => import('./screens/WardMoveScreen'));
const SubstockCardScreen = lazy(() => import('./screens/SubstockCardScreen'));
// jsqr (camera decode) only matters once someone actually opens the scanner
const QrModal = lazy(() => import('./components/QrModal'));

const TITLES: Record<Screen, [string, string]> = {
  login: ['', ''],
  home: ['ห้องยา OPD', ''],
  transfer: ['เติมหน้างาน', 'substock → ชั้นจ่ายยา'],
  tconfirm: ['ตรวจสอบก่อนยืนยัน', 'FEFO'],
  done: ['สำเร็จ', 'บันทึกลง audit trail แล้ว'],
  receive: ['รับยาเข้า substock', 'ใบเบิกจากคลังยาใหญ่'],
  adjust: ['ปรับยอด / คืนยา / ยาเสีย', 'ทุกรายการต้องระบุเหตุผล'],
  report: ['รายงาน', 'สำหรับ PTC / CQI'],
  labels: ['ระบบฉลาก QR', 'ตัวยา · lot · ชั้นวาง'],
  settings: ['ตั้งค่า', 'par level และเกณฑ์แจ้งเตือน'],
  more: ['เพิ่มเติม', ''],
  count: ['นับสต็อกหน้างาน (เสริม)', 'ใช้เมื่อสงสัยยอดคลาดเคลื่อน'],
  reconcile: ['นำเข้าจาก HOSxP', 'ตัดยอดตามที่จ่ายจริง'],
  admin: ['จัดการผู้ใช้งาน', 'Audit log ทั้งระบบ'],
  meds: ['จัดการรายการยา', 'เพิ่ม / ปิดใช้งาน / ลบ'],
  wardmove: ['ย้ายยาระหว่างชั้นวาง', 'เช่น ลิ้นชักฉีดยา IPD → stat OPD'],
  substockcard: ['บัตรสต็อก substock', 'รับ-จ่าย-คงเหลือ real-time'],
};

const CAN_BACK: Screen[] = ['tconfirm', 'adjust', 'report', 'labels', 'settings', 'count', 'reconcile', 'admin', 'meds', 'wardmove', 'substockcard'];
const NAV_DEF: [Screen, string, string][] = [
  ['home', 'หน้าหลัก', '▤'],
  ['transfer', 'เติมหน้างาน', '⇄'],
  ['reconcile', 'นำเข้า HOSxP', '⇩'],
  ['receive', 'รับเข้า', '⬓'],
  ['more', 'เพิ่มเติม', '≡'],
];

export default function App() {
  const { state, roleLabel, go, back, theme, toggleTheme } = useApp();

  if (state.authStatus !== 'signedIn') {
    return <LoginScreen />;
  }

  if (!state.dbReady) {
    return (
      <div className="app-shell" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div className="muted" style={{ fontSize: 13 }}>กำลังโหลดข้อมูล…</div>
      </div>
    );
  }

  const [title, sub] = TITLES[state.screen];
  const headerSub = state.screen === 'home' ? 'รพ.กรงปินัง · ' + roleLabel() : state.screen === 'more' ? roleLabel() : sub;
  const canBack = CAN_BACK.includes(state.screen);

  return (
    <div className="app-shell">
      <header style={{ background: 'linear-gradient(155deg, #1c6338 0%, var(--green) 55%, var(--green-dark) 100%)', color: 'var(--ink-soft)', padding: 'calc(env(safe-area-inset-top, 0px) + 12px) 16px 13px', display: 'flex', alignItems: 'center', gap: 10, flex: 'none', boxShadow: '0 4px 14px -6px rgba(14,58,32,.5)', position: 'relative', overflow: 'hidden', zIndex: 3 }}>
        <div className="mesh-bg" aria-hidden="true" />
        {canBack && (
          <button onClick={back} style={{ position: 'relative', border: 0, background: 'rgba(255,255,255,.14)', color: 'var(--ink-soft)', width: 32, height: 32, borderRadius: 9, fontSize: 16, flex: 'none' }}>←</button>
        )}
        <div key={state.screen} style={{ position: 'relative', minWidth: 0, flex: 1, animation: 'fade .22s var(--ease-out)' }}>
          <div style={{ fontSize: 16.5, fontWeight: 600, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
          <div style={{ fontSize: 11.5, opacity: 0.65, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{headerSub}</div>
        </div>
        <button
          onClick={toggleTheme}
          className="theme-toggle press-spring"
          style={{ position: 'relative' }}
          title={theme === 'dark' ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด'}
        >
          <span key={theme} className="icon" style={{ transform: theme === 'dark' ? 'rotate(0deg)' : 'rotate(180deg)' }}>{theme === 'dark' ? '☾' : '☀'}</span>
        </button>
        <div
          title={state.online ? 'เชื่อมต่ออินเทอร์เน็ตอยู่' : 'ออฟไลน์ — การเปลี่ยนแปลงจะ sync เมื่อกลับมาออนไลน์'}
          style={{ position: 'relative', border: 0, background: state.online ? 'rgba(255,255,255,.14)' : 'var(--amber-bg)', color: state.online ? 'var(--ink-soft)' : 'var(--amber-ink)', padding: '6px 9px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: state.online ? '#5adc8c' : 'var(--amber)', display: 'inline-block', animation: state.online ? 'glowPulse 2.4s infinite' : 'none' }} />
          {state.online ? 'ออนไลน์' : 'ออฟไลน์'}
        </div>
      </header>

      {!state.online && (
        <div style={{ flex: 'none', background: 'var(--amber-bg)', borderBottom: '1px solid var(--amber-border)', color: 'var(--amber-ink)', padding: '8px 16px', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 8, animation: 'fade .22s var(--ease-out)' }}>
          <span style={{ animation: 'pulse 1.6s infinite' }}>◍</span>
          <span>ออฟไลน์ — การเปลี่ยนแปลงจะบันทึกอัตโนมัติเมื่อกลับมาออนไลน์</span>
        </div>
      )}

      <main style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <Suspense fallback={<ScreenLoading />}>
          <Screens screen={state.screen} />
        </Suspense>
      </main>

      <nav className="nav-float" style={{ flex: 'none', display: 'flex', background: 'var(--glass-bg)', backdropFilter: 'blur(18px) saturate(1.6)', WebkitBackdropFilter: 'blur(18px) saturate(1.6)', border: '1px solid var(--border)', position: 'relative', zIndex: 3 }}>
        <span
          className="nav-pill"
          aria-hidden="true"
          style={{ left: `calc(${NAV_DEF.findIndex(([s]) => s === state.screen) * 100 / NAV_DEF.length}% + 6px)`, width: `calc(${100 / NAV_DEF.length}% - 12px)` }}
        />
        {NAV_DEF.map(([s, label, icon]) => {
          const active = state.screen === s;
          // A pending receive is real, actionable work sitting on someone's desk — pharm/admin
          // need to notice it without hunting for it, so badge the "รับเข้า" tab with a live
          // count from the same subscription the receive screen's own list uses.
          const badge = s === 'receive' && state.role !== 'tech' ? state.pending : 0;
          return (
            <button
              key={s}
              onClick={() => go(s)}
              style={{ flex: 1, border: 0, background: 'transparent', padding: '9px 2px 10px', minHeight: 62, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, position: 'relative', zIndex: 1 }}
            >
              <span style={{ position: 'relative', fontSize: 18, lineHeight: 1, color: active ? 'var(--green)' : '#8b9186', transform: active ? 'translateY(-1px) scale(1.1)' : 'none', transition: 'transform var(--dur-slow) var(--ease-spring), color var(--dur) var(--ease)' }}>
                {icon}
                {badge > 0 && (
                  <span style={{ position: 'absolute', top: -5, right: -9, minWidth: 15, height: 15, padding: '0 3px', borderRadius: 8, background: 'var(--amber)', color: '#1a1a1a', fontSize: 9.5, fontWeight: 800, lineHeight: '15px', textAlign: 'center' }}>{badge}</span>
                )}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: active ? 'var(--green)' : '#8b9186', whiteSpace: 'nowrap' }}>{label}</span>
            </button>
          );
        })}
      </nav>

      <Suspense fallback={null}>
        <QrModal />
      </Suspense>
      <Toast />
    </div>
  );
}

function ScreenLoading() {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', animation: 'fade .15s' }}>
      <div className="muted" style={{ fontSize: 12.5 }}>กำลังโหลด…</div>
    </div>
  );
}

function Screens({ screen }: { screen: Screen }) {
  switch (screen) {
    case 'home': return <HomeScreen />;
    case 'transfer': return <TransferScreen />;
    case 'tconfirm': return <TConfirmScreen />;
    case 'done': return <DoneScreen />;
    case 'receive': return <ReceiveScreen />;
    case 'adjust': return <AdjustScreen />;
    case 'report': return <ReportScreen />;
    case 'labels': return <LabelsScreen />;
    case 'settings': return <SettingsScreen />;
    case 'count': return <CountScreen />;
    case 'reconcile': return <ReconcileScreen />;
    case 'admin': return <AdminScreen />;
    case 'meds': return <MedsScreen />;
    case 'wardmove': return <WardMoveScreen />;
    case 'substockcard': return <SubstockCardScreen />;
    case 'more': return <MoreScreen />;
    default: return null;
  }
}
