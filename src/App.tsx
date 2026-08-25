import { useApp } from './store/AppContext';
import LoginScreen from './screens/LoginScreen';
import HomeScreen from './screens/HomeScreen';
import TransferScreen from './screens/TransferScreen';
import TConfirmScreen from './screens/TConfirmScreen';
import DoneScreen from './screens/DoneScreen';
import ReceiveScreen from './screens/ReceiveScreen';
import AdjustScreen from './screens/AdjustScreen';
import ReportScreen from './screens/ReportScreen';
import LabelsScreen from './screens/LabelsScreen';
import SettingsScreen from './screens/SettingsScreen';
import CountScreen from './screens/CountScreen';
import ReconcileScreen from './screens/ReconcileScreen';
import AdminScreen from './screens/AdminScreen';
import MoreScreen from './screens/MoreScreen';
import QrModal from './components/QrModal';
import Toast from './components/Toast';
import type { Screen } from './types';

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
};

const CAN_BACK: Screen[] = ['tconfirm', 'adjust', 'report', 'labels', 'settings', 'count', 'reconcile', 'admin'];
const NAV_DEF: [Screen, string, string][] = [
  ['home', 'หน้าหลัก', '▤'],
  ['transfer', 'เติมหน้างาน', '⇄'],
  ['reconcile', 'นำเข้า HOSxP', '⇩'],
  ['receive', 'รับเข้า', '⬓'],
  ['more', 'เพิ่มเติม', '≡'],
];

export default function App() {
  const { state, roleLabel, go, back, setOnline } = useApp();

  if (state.screen === 'login' || !state.role) {
    return <LoginScreen />;
  }

  const [title, sub] = TITLES[state.screen];
  const headerSub = state.screen === 'home' ? 'รพ.กรงปินัง · ' + roleLabel() : state.screen === 'more' ? state.role : sub;
  const canBack = CAN_BACK.includes(state.screen);

  return (
    <div className="app-shell">
      <header style={{ background: 'var(--green)', color: 'var(--ink-soft)', padding: '12px 16px 13px', display: 'flex', alignItems: 'center', gap: 10, flex: 'none', boxShadow: '0 4px 14px -6px rgba(14,58,32,.5)', position: 'relative', zIndex: 3 }}>
        {canBack && (
          <button onClick={back} style={{ border: 0, background: 'rgba(255,255,255,.14)', color: 'var(--ink-soft)', width: 32, height: 32, borderRadius: 9, fontSize: 16, flex: 'none' }}>←</button>
        )}
        <div key={state.screen} style={{ minWidth: 0, flex: 1, animation: 'fade .22s var(--ease-out)' }}>
          <div style={{ fontSize: 16.5, fontWeight: 600, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
          <div style={{ fontSize: 11.5, opacity: 0.65, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{headerSub}</div>
        </div>
        <button
          onClick={setOnline}
          style={{ border: 0, background: state.online ? 'rgba(255,255,255,.14)' : 'var(--amber-bg)', color: state.online ? 'var(--ink-soft)' : 'var(--amber-ink)', padding: '6px 9px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: state.online ? '#5adc8c' : 'var(--amber)', display: 'inline-block', transition: 'background-color var(--dur) var(--ease)' }} />
          {state.online ? 'sync แล้ว' : 'ค้าง ' + state.pending}
        </button>
      </header>

      {!state.online && state.pending > 0 && (
        <div style={{ flex: 'none', background: 'var(--amber-bg)', borderBottom: '1px solid #f0dfbc', color: 'var(--amber-ink)', padding: '8px 16px', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 8, animation: 'fade .22s var(--ease-out)' }}>
          <span style={{ animation: 'pulse 1.6s infinite' }}>◍</span>
          <span>ออฟไลน์ — มี {state.pending.toLocaleString('en-US')} รายการรอ sync เมื่อกลับมาออนไลน์</span>
        </div>
      )}

      <main style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <Screens screen={state.screen} />
      </main>

      <nav style={{ flex: 'none', display: 'flex', background: '#fff', borderTop: '1px solid var(--border)', boxShadow: '0 -4px 14px -8px rgba(18,33,26,.15)', position: 'relative', zIndex: 3 }}>
        {NAV_DEF.map(([s, label, icon]) => {
          const active = state.screen === s;
          return (
            <button
              key={s}
              onClick={() => go(s)}
              style={{ flex: 1, border: 0, background: 'transparent', padding: '9px 2px 10px', minHeight: 66, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, position: 'relative' }}
            >
              <span style={{ fontSize: 18, lineHeight: 1, color: active ? 'var(--green)' : '#8b9186', transform: active ? 'translateY(-1px) scale(1.08)' : 'none', transition: 'transform var(--dur) var(--ease-out), color var(--dur) var(--ease)' }}>{icon}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: active ? 'var(--green)' : '#8b9186', whiteSpace: 'nowrap' }}>{label}</span>
              <span style={{ position: 'absolute', top: 0, left: '50%', width: active ? '56%' : 0, height: 2.5, background: 'var(--green)', borderRadius: '0 0 3px 3px', transform: 'translateX(-50%)', transition: 'width var(--dur) var(--ease-out)' }} />
            </button>
          );
        })}
      </nav>

      <QrModal />
      <Toast />
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
    case 'more': return <MoreScreen />;
    default: return null;
  }
}
