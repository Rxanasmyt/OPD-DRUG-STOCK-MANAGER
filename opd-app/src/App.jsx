import React, { useState, useEffect } from 'react';
import {
  AlertTriangle, CalendarDays, LayoutDashboard, PackagePlus, Pill, Search,
  ShieldAlert, ShieldCheck, Clock, Activity, ArrowRight, BellRing, List,
  Database, Upload, FileText, CheckCircle, XCircle, Trash2, Printer, Filter,
  Edit, Download, ChevronUp, ChevronDown, UploadCloud, History, Send, ScanLine,
  Menu, X, Smartphone, Lock, User, LogOut, Shield, Users, UserPlus,
  ShoppingCart, TrendingDown
} from 'lucide-react';

const CURRENT_DATE = new Date('2026-06-16');

const initialMeds = [
  { id: 1, name: 'Paracetamol 500mg', lot: 'L-2501', expDate: '2026-05-10', qty: 5000, shelf: 'A1', price: 1.5 },
  { id: 2, name: 'Amoxicillin 500mg', lot: 'L-2502', expDate: '2026-07-05', qty: 1200, shelf: 'B2', price: 2.5 },
  { id: 3, name: 'Amlodipine 5mg', lot: 'L-2503', expDate: '2026-08-20', qty: 3000, shelf: 'C1', price: 5.0 },
];

const hospitalMedsList = [
  "(HAD) Adenosine 3 mg/ml Vial", "(HAD) ADREnaline - PL 1 mg./ml. Amphule (1 ml.)",
  "(HAD) Amiodarone injection 150 mg/3ml Amphule", "(HAD) Dopamine - PL 25 mg./ml. Amphule (10 ml.)",
  "ยาแคปซูลเบญจกูลตราธงทอง 400 mg. แค็บซูล", "Paracetamol 500mg", "Amoxicillin 500mg"
];

const defaultUsers = [
  { id: 1, username: 'admin', password: 'admin1234', name: 'ภก.อนัส มะยีแต (Admin)', role: 'admin' },
  { id: 2, username: 'staff', password: 'staff1234', name: 'เจ้าหน้าที่ห้องยา (Staff)', role: 'staff' }
];

export default function App() {
  const [usersList, setUsersList] = useState(() => {
    const saved = localStorage.getItem('opd_users_list');
    return saved ? JSON.parse(saved) : defaultUsers;
  });
  const [currentUser, setCurrentUser] = useState(() => {
    const saved = localStorage.getItem('opd_current_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('opd_current_user'));

  const [activeTab, setActiveTab] = useState('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  const [meds, setMeds] = useState(() => {
    const saved = localStorage.getItem('opd_meds_data');
    return saved ? JSON.parse(saved) : initialMeds;
  });
  const [masterMeds, setMasterMeds] = useState(() => {
    const saved = localStorage.getItem('opd_master_meds');
    return saved ? JSON.parse(saved) : hospitalMedsList;
  });
  const [historyLogs, setHistoryLogs] = useState(() => {
    const saved = localStorage.getItem('opd_history_logs');
    return saved ? JSON.parse(saved) : [];
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [toast, setToast] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [deleteModal, setDeleteModal] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'expDate', direction: 'asc' });

  useEffect(() => { localStorage.setItem('opd_users_list', JSON.stringify(usersList)); }, [usersList]);
  useEffect(() => {
    if (currentUser) localStorage.setItem('opd_current_user', JSON.stringify(currentUser));
    else localStorage.removeItem('opd_current_user');
  }, [currentUser]);
  useEffect(() => { localStorage.setItem('opd_meds_data', JSON.stringify(meds)); }, [meds]);
  useEffect(() => { localStorage.setItem('opd_master_meds', JSON.stringify(masterMeds)); }, [masterMeds]);
  useEffect(() => { localStorage.setItem('opd_history_logs', JSON.stringify(historyLogs)); }, [historyLogs]);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallApp = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') setDeferredPrompt(null);
    } else showToast('เบราว์เซอร์ของคุณติดตั้งแอปไปแล้ว หรือไม่รองรับ', 'error');
  };

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const addHistoryLog = (actionType, detailStr) => {
    const newLog = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      action: actionType,
      detail: detailStr,
      user: currentUser ? currentUser.name : 'System'
    };
    setHistoryLogs(prev => [newLog, ...prev].slice(0, 100));
  };

  const getDaysToExpire = (expDateStr) => {
    const exp = new Date(expDateStr);
    return Math.ceil((exp - CURRENT_DATE) / (1000 * 60 * 60 * 24));
  };

  const getStatusInfo = (days) => {
    if (days < 0) return { id: 'expired', label: 'หมดอายุแล้ว', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', icon: <ShieldAlert className="w-4 h-4 mr-1.5" />, glow: 'shadow-[0_0_15px_rgba(239,68,68,0.3)]' };
    if (days <= 30) return { id: 'critical', label: 'เสี่ยงสูง (< 30 วัน)', bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', icon: <AlertTriangle className="w-4 h-4 mr-1.5" />, glow: 'shadow-[0_0_15px_rgba(249,115,22,0.3)]' };
    if (days <= 90) return { id: 'warning', label: 'เฝ้าระวัง (< 90 วัน)', bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200', icon: <Clock className="w-4 h-4 mr-1.5" />, glow: '' };
    return { id: 'safe', label: 'ปลอดภัย', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: <ShieldCheck className="w-4 h-4 mr-1.5" />, glow: '' };
  };

  const stats = {
    total: meds.length,
    expired: meds.filter(m => getDaysToExpire(m.expDate) < 0).length,
    critical: meds.filter(m => getDaysToExpire(m.expDate) >= 0 && getDaysToExpire(m.expDate) <= 30).length,
    warning: meds.filter(m => getDaysToExpire(m.expDate) > 30 && getDaysToExpire(m.expDate) <= 90).length,
    criticalValue: meds.filter(m => getDaysToExpire(m.expDate) >= 0 && getDaysToExpire(m.expDate) <= 30).reduce((sum, m) => sum + (m.qty * (m.price || 0)), 0),
    expiredValue: meds.filter(m => getDaysToExpire(m.expDate) < 0).reduce((sum, m) => sum + (m.qty * (m.price || 0)), 0),
  };

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const filteredMeds = meds.filter(med => {
    const matchSearch = med.name.toLowerCase().includes(searchTerm.toLowerCase()) || med.lot.toLowerCase().includes(searchTerm.toLowerCase());
    if (!matchSearch) return false;
    if (filterStatus === 'all') return true;
    return getStatusInfo(getDaysToExpire(med.expDate)).id === filterStatus;
  }).sort((a, b) => {
    if (sortConfig.key === 'name' || sortConfig.key === 'lot') {
      return sortConfig.direction === 'asc' ? a[sortConfig.key].localeCompare(b[sortConfig.key]) : b[sortConfig.key].localeCompare(a[sortConfig.key]);
    } else if (sortConfig.key === 'qty') {
      return sortConfig.direction === 'asc' ? a.qty - b.qty : b.qty - a.qty;
    } else {
      return sortConfig.direction === 'asc' ? new Date(a.expDate) - new Date(b.expDate) : new Date(b.expDate) - new Date(a.expDate);
    }
  });

  const handleDeleteConfirm = () => {
    if (deleteModal) {
      setMeds(meds.filter(m => m.id !== deleteModal.id));
      addHistoryLog('DELETE', `ลบรายการยา ${deleteModal.name} (Lot: ${deleteModal.lot}) จำนวน ${deleteModal.qty} ออกจากคลัง`);
      showToast(`ลบรายการ "${deleteModal.name}" สำเร็จ`, 'success');
      setDeleteModal(null);
    }
  };

  const handleEditSubmit = (e) => {
    e.preventDefault();
    setMeds(meds.map(m => m.id === editModal.id ? editModal : m));
    addHistoryLog('EDIT', `แก้ไขข้อมูลยา ${editModal.name} (Lot: ${editModal.lot})`);
    showToast(`แก้ไขข้อมูล "${editModal.name}" สำเร็จ`, 'success');
    setEditModal(null);
  };

  const exportToCSV = () => {
    const headers = ["ชื่อยา", "Lot Number", "วันหมดอายุ", "จำนวนคงเหลือ", "ชั้นวาง", "สถานะ"];
    const csvData = filteredMeds.map(med => {
      const days = getDaysToExpire(med.expDate);
      return [`"${med.name}"`, `"${med.lot}"`, `"${med.expDate}"`, med.qty, `"${med.shelf}"`, `"${getStatusInfo(days).label}"`].join(',');
    });
    const csvContent = [headers.join(','), ...csvData].join('\n');
    const blob = new Blob(["﻿" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `รายงานยาหมดอายุ_OPD_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addHistoryLog('EXPORT', `ส่งออกไฟล์รายงาน CSV (${filteredMeds.length} รายการ)`);
    showToast('ดาวน์โหลดไฟล์รายงาน CSV สำเร็จ', 'success');
  };

  const handlePrint = () => {
    addHistoryLog('PRINT', `สั่งพิมพ์รายงานตารางยา`);
    window.print();
  };

  const sendLineNotify = () => {
    const totalRisks = stats.expired + stats.critical;
    showToast(`ส่งแจ้งเตือน LINE: ยาเสี่ยงด่วน ${totalRisks} รายการ เรียบร้อยแล้ว`, 'success');
    addHistoryLog('NOTIFY', `ส่งสรุปรายงานเข้า LINE Group สำเร็จ (พบยาเสี่ยง ${totalRisks} รายการ)`);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCurrentUser(null);
    setActiveTab('dashboard');
  };

  const LoginScreen = () => {
    const [loginData, setLoginData] = useState({ username: '', password: '' });
    const [isLoading, setIsLoading] = useState(false);
    const [loginError, setLoginError] = useState('');

    const onSubmit = (e) => {
      e.preventDefault();
      setIsLoading(true);
      setLoginError('');
      setTimeout(() => {
        const user = usersList.find(u => u.username === loginData.username && u.password === loginData.password);
        if (user) {
          setCurrentUser(user);
          setIsAuthenticated(true);
          showToast(`ยินดีต้อนรับคุณ ${user.name}`, 'success');
          addHistoryLog('LOGIN', 'เข้าสู่ระบบ');
        } else {
          setLoginError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
        }
        setIsLoading(false);
      }, 800);
    };

    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0F172A] relative overflow-hidden selection:bg-emerald-500 selection:text-white">
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-emerald-500/20 rounded-full blur-[100px] pointer-events-none animate-pulse" />
        <div className="absolute bottom-1/4 -right-32 w-[500px] h-[500px] bg-blue-600/20 rounded-full blur-[120px] pointer-events-none" />
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 p-8 md:p-12 rounded-3xl w-full max-w-md mx-4 shadow-[0_8px_32px_rgba(0,0,0,0.3)] z-10 animate-fade-in-up">
          <div className="flex flex-col items-center mb-8">
            <div className="bg-gradient-to-br from-emerald-400 to-teal-600 p-4 rounded-2xl shadow-lg shadow-teal-500/30 mb-4">
              <Shield className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-white tracking-tight">MedSafe Portal</h1>
            <p className="text-emerald-400 text-sm mt-1">ระบบจัดการยาหมดอายุ รพ.กรงปินัง</p>
          </div>
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-300 ml-1">ชื่อผู้ใช้งาน (Username)</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none"><User className="w-5 h-5 text-slate-400" /></div>
                <input type="text" required value={loginData.username} onChange={e => setLoginData({...loginData, username: e.target.value})}
                  className="w-full pl-11 pr-4 py-3.5 bg-slate-900/50 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-white placeholder-slate-500 transition-all"
                  placeholder="กรอกชื่อผู้ใช้งาน..." />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-300 ml-1">รหัสผ่าน (Password)</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none"><Lock className="w-5 h-5 text-slate-400" /></div>
                <input type="password" required value={loginData.password} onChange={e => setLoginData({...loginData, password: e.target.value})}
                  className="w-full pl-11 pr-4 py-3.5 bg-slate-900/50 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-white placeholder-slate-500 transition-all"
                  placeholder="••••••••" />
              </div>
            </div>
            {loginError && (
              <div className="p-3 bg-red-500/10 border border-red-500/50 rounded-xl flex items-center gap-2 text-red-400 text-sm animate-shake">
                <AlertTriangle className="w-4 h-4 shrink-0" /> {loginError}
              </div>
            )}
            <button type="submit" disabled={isLoading}
              className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold py-3.5 px-6 rounded-xl shadow-lg shadow-emerald-500/25 active:scale-95 transition-all duration-300 flex items-center justify-center mt-2 disabled:opacity-70 disabled:cursor-not-allowed">
              {isLoading ? <Activity className="w-6 h-6 animate-spin" /> : 'เข้าสู่ระบบ'}
            </button>
          </form>
          <div className="mt-8 pt-6 border-t border-slate-700/50 text-center">
            <p className="text-xs text-slate-500 leading-relaxed">
              สงวนสิทธิ์การใช้งานสำหรับเจ้าหน้าที่โรงพยาบาลกรงปินังเท่านั้น<br/>
              หากลืมรหัสผ่าน กรุณาติดต่อผู้ดูแลระบบ (Admin)
            </p>
          </div>
        </div>
      </div>
    );
  };

  const Sidebar = () => (
    <>
      {isMobileMenuOpen && <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 md:hidden" onClick={() => setIsMobileMenuOpen(false)} />}
      <div className={`fixed inset-y-0 left-0 transform ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0 transition duration-300 ease-in-out z-50 md:z-10 w-72 bg-[#0F172A] text-white min-h-screen p-6 flex flex-col overflow-hidden no-print shadow-2xl md:shadow-none`}>
        <div className="absolute top-0 left-0 w-full h-64 bg-gradient-to-b from-emerald-600/20 to-transparent pointer-events-none" />
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-emerald-500/20 rounded-full blur-3xl pointer-events-none" />
        <button className="absolute top-4 right-4 md:hidden text-slate-400 hover:text-white" onClick={() => setIsMobileMenuOpen(false)}><X className="w-6 h-6" /></button>
        <div className="flex items-center gap-4 mb-8 mt-2 relative z-10">
          <div className="bg-gradient-to-br from-emerald-400 to-teal-600 p-2.5 rounded-2xl shadow-lg shadow-teal-500/30"><Pill className="w-7 h-7 text-white" /></div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-300">รพ.กรงปินัง</h1>
            <p className="text-[11px] text-emerald-400 font-medium tracking-wide mt-0.5">ระบบจัดการยาหมดอายุ</p>
          </div>
        </div>
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-4 mb-8 relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shadow-inner ${currentUser?.role === 'admin' ? 'bg-gradient-to-br from-purple-500 to-indigo-600' : 'bg-gradient-to-br from-blue-500 to-cyan-600'}`}>
              {currentUser?.name.charAt(0)}
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-bold text-white truncate max-w-[120px]">{currentUser?.name}</p>
              <p className="text-[10px] font-medium mt-0.5 px-2 py-0.5 rounded-full inline-block bg-slate-700/80 text-slate-300">
                {currentUser?.role === 'admin' ? '⭐ Admin' : '👤 Staff'}
              </p>
            </div>
          </div>
          <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded-xl transition-all" title="ออกจากระบบ"><LogOut className="w-5 h-5" /></button>
        </div>
        <nav className="flex-1 space-y-2.5 relative z-10 overflow-y-auto custom-scrollbar">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-2 mb-2">เมนูหลัก</p>
          {[
            { id: 'dashboard', icon: LayoutDashboard, label: 'ภาพรวม (Dashboard)' },
            { id: 'dispense', icon: ShoppingCart, label: 'เบิกจ่าย / ตัดสต๊อก (FEFO)' },
            { id: 'inventory', icon: CalendarDays, label: 'รายการยา / วันหมดอายุ' },
            { id: 'add', icon: PackagePlus, label: 'รับยาเข้าคลัง (สแกน)' },
            { id: 'history', icon: History, label: 'ประวัติการทำรายการ' }
          ].map(item => (
            <button key={item.id} onClick={() => { setActiveTab(item.id); setIsMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all duration-300 active:scale-95 ${activeTab === item.id ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25 md:translate-x-1' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}>
              <item.icon className={`w-5 h-5 ${activeTab === item.id ? 'text-white' : 'text-slate-400'}`} />
              <span className="font-medium text-sm">{item.label}</span>
            </button>
          ))}
          {currentUser?.role === 'admin' && (
            <div className="pt-4 mt-2">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-2 mb-2 flex items-center gap-1"><Shield className="w-3 h-3" /> ผู้ดูแลระบบ (Admin)</p>
              <button onClick={() => { setActiveTab('users'); setIsMobileMenuOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all duration-300 active:scale-95 mb-2 ${activeTab === 'users' ? 'bg-gradient-to-r from-purple-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/25 md:translate-x-1' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}>
                <Users className={`w-5 h-5 ${activeTab === 'users' ? 'text-white' : 'text-slate-400'}`} />
                <span className="font-medium text-sm">จัดการผู้ใช้งาน</span>
              </button>
              <button onClick={() => { setActiveTab('master'); setIsMobileMenuOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all duration-300 active:scale-95 ${activeTab === 'master' ? 'bg-gradient-to-r from-blue-500 to-cyan-600 text-white shadow-lg shadow-cyan-500/25 md:translate-x-1' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}>
                <Database className={`w-5 h-5 ${activeTab === 'master' ? 'text-white' : 'text-slate-400'}`} />
                <span className="font-medium text-sm">จัดการฐานข้อมูล (Master)</span>
              </button>
            </div>
          )}
          {deferredPrompt && (
            <div className="pt-4 mt-4 border-t border-slate-800">
              <button onClick={handleInstallApp} className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-800 border border-slate-700 hover:bg-slate-700 text-white rounded-xl font-bold shadow-md transition-all active:scale-95">
                <Smartphone className="w-4 h-4" /> ติดตั้งแอป (Install)
              </button>
            </div>
          )}
        </nav>
      </div>
    </>
  );

  const MobileHeader = () => (
    <div className="md:hidden bg-[#0F172A] text-white p-4 flex justify-between items-center sticky top-0 z-30 shadow-md">
      <div className="flex items-center gap-3">
        <div className="bg-emerald-500 p-1.5 rounded-lg"><Pill className="w-5 h-5 text-white" /></div>
        <h1 className="font-bold text-sm">รพ.กรงปินัง (OPD)</h1>
      </div>
      <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 bg-slate-800 rounded-lg text-slate-300 hover:text-white active:scale-95 transition-all"><Menu className="w-6 h-6" /></button>
    </div>
  );

  const Dashboard = () => (
    <div className="space-y-6 md:space-y-8 pb-8 animate-fade-in">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-slate-800 tracking-tight">ภาพรวมคลังยา</h2>
          <p className="text-slate-500 mt-1 text-sm md:text-base">ติดตามสถานะและวันหมดอายุแบบ Real-time</p>
        </div>
        <div className="flex flex-wrap gap-2 w-full lg:w-auto">
          <div className="bg-white px-3 md:px-4 py-2.5 rounded-xl shadow-sm border border-slate-100 flex items-center gap-2 text-xs md:text-sm font-medium text-slate-600 flex-1 lg:flex-none justify-center">
            <CalendarDays className="w-4 h-4 text-emerald-500" />
            {CURRENT_DATE.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })}
          </div>
          <button onClick={sendLineNotify} className="bg-[#00B900] hover:bg-[#009900] text-white px-3 md:px-4 py-2.5 rounded-xl shadow-md font-bold flex items-center justify-center gap-2 transition-all active:scale-95 text-xs md:text-sm flex-1 lg:flex-none">
            <Send className="w-4 h-4" /> แจ้งเตือน LINE
          </button>
        </div>
      </div>

      {(stats.expiredValue > 0 || stats.criticalValue > 0) && (
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-2xl md:rounded-3xl p-4 md:p-6 shadow-lg flex flex-col md:flex-row justify-between items-center gap-4 animate-fade-in-up">
          <div className="flex items-center gap-4">
            <div className="bg-white/10 p-3 rounded-2xl"><TrendingDown className="w-6 h-6 md:w-8 md:h-8 text-rose-400" /></div>
            <div>
              <p className="text-slate-400 text-xs md:text-sm font-medium">มูลค่าความสูญเสีย (ยาหมดอายุ & เสี่ยงสูง)</p>
              <p className="text-xl md:text-2xl font-bold text-white">฿{(stats.expiredValue + stats.criticalValue).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
            </div>
          </div>
          <div className="flex gap-4 text-sm w-full md:w-auto bg-white/5 p-3 rounded-xl">
            <div><span className="text-slate-400 block text-xs">หมดอายุแล้ว</span><span className="text-rose-400 font-bold">฿{stats.expiredValue.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
            <div className="w-px bg-slate-700"></div>
            <div><span className="text-slate-400 block text-xs">เสี่ยงสูง (&lt;30 วัน)</span><span className="text-orange-400 font-bold">฿{stats.criticalValue.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        {[
          { title: 'ยาทั้งหมด', count: stats.total, color: 'blue', icon: Pill, pct: 100 },
          { title: 'หมดอายุแล้ว!', count: stats.expired, color: 'red', icon: ShieldAlert, pct: (stats.expired/Math.max(stats.total,1))*100 },
          { title: 'เสี่ยงสูง (< 30)', count: stats.critical, color: 'orange', icon: AlertTriangle, pct: (stats.critical/Math.max(stats.total,1))*100 },
          { title: 'เฝ้าระวัง (< 90)', count: stats.warning, color: 'yellow', icon: Clock, pct: (stats.warning/Math.max(stats.total,1))*100 }
        ].map((card, i) => (
          <div key={i} className="group bg-white p-4 md:p-6 rounded-2xl md:rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100/60 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 relative overflow-hidden flex flex-col justify-between">
            <div className={`absolute top-0 right-0 w-16 h-16 md:w-24 md:h-24 bg-${card.color}-50 rounded-bl-full -z-10 transition-transform group-hover:scale-110`} />
            <div className="flex justify-between items-start mb-2 md:mb-4">
              <div className={`w-10 h-10 md:w-14 md:h-14 bg-gradient-to-br from-${card.color}-100 to-${card.color}-50 text-${card.color}-600 rounded-xl md:rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300`}>
                <card.icon className="w-5 h-5 md:w-7 md:h-7" />
              </div>
              {card.color === 'red' && card.count > 0 && <span className="flex h-2.5 w-2.5 md:h-3 md:w-3 relative"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2.5 w-2.5 md:h-3 md:w-3 bg-red-500"></span></span>}
            </div>
            <div>
              <p className="text-xs md:text-sm text-slate-500 font-medium mb-0.5 md:mb-1">{card.title}</p>
              <p className={`text-2xl md:text-4xl font-extrabold text-${card.color}-600`}>{card.count}</p>
            </div>
            <div className="w-full bg-slate-100 h-1.5 rounded-full mt-3 md:mt-4 overflow-hidden">
              <div className={`bg-${card.color}-500 h-full rounded-full transition-all duration-1000`} style={{ width: `${Math.min(card.pct, 100)}%` }}></div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl md:rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100/80 overflow-hidden">
        <div className="p-4 md:p-6 border-b border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-50/50">
          <h3 className="text-base md:text-lg font-bold text-slate-800 flex items-center gap-2.5">
            <div className="p-1.5 md:p-2 bg-orange-100 text-orange-600 rounded-lg"><BellRing className="w-4 h-4 md:w-5 md:h-5" /></div>
            จัดการด่วน (เสี่ยงสูง/หมดอายุ)
          </h3>
          <button onClick={() => {setActiveTab('inventory'); setFilterStatus('critical');}} className="text-emerald-600 hover:text-emerald-700 text-sm font-medium flex items-center gap-1 transition-colors group w-full sm:w-auto justify-end sm:justify-start">
            ดูทั้งหมด <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse min-w-[600px]">
            <thead>
              <tr className="bg-white border-b border-slate-100">
                <th className="px-4 py-3 md:px-6 md:py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">ชื่อยา</th>
                <th className="px-4 py-3 md:px-6 md:py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">วันหมดอายุ</th>
                <th className="px-4 py-3 md:px-6 md:py-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">คงเหลือ</th>
                <th className="px-4 py-3 md:px-6 md:py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {meds.filter(m => getDaysToExpire(m.expDate) <= 30).sort((a,b) => new Date(a.expDate) - new Date(b.expDate)).slice(0, 5).map((med) => {
                const days = getDaysToExpire(med.expDate);
                const status = getStatusInfo(days);
                return (
                  <tr key={med.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3 md:px-6 md:py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg md:rounded-xl bg-slate-100 flex items-center justify-center text-slate-500"><Pill className="w-4 h-4 md:w-5 md:h-5" /></div>
                        <div>
                          <p className="font-semibold text-slate-800 text-sm">{med.name}</p>
                          <p className="text-[10px] md:text-xs text-slate-400 mt-0.5">Lot: {med.lot} | ชั้นวาง: {med.shelf}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 md:px-6 md:py-4">
                      <p className="text-xs md:text-sm text-slate-800 font-medium">{new Date(med.expDate).toLocaleDateString('th-TH')}</p>
                      <p className={`text-[10px] md:text-xs mt-0.5 font-medium ${days < 0 ? 'text-red-500' : 'text-orange-500'}`}>{days < 0 ? `ผ่านมา ${Math.abs(days)} วัน` : `เหลือ ${days} วัน`}</p>
                    </td>
                    <td className="px-4 py-3 md:px-6 md:py-4 text-sm text-slate-800 font-bold text-right">{med.qty.toLocaleString()}</td>
                    <td className="px-4 py-3 md:px-6 md:py-4">
                      <span className={`inline-flex items-center px-2 py-1 md:px-3 md:py-1.5 rounded-lg md:rounded-xl text-[10px] md:text-xs font-bold border ${status.bg} ${status.text} ${status.border} ${status.glow} whitespace-nowrap`}>{status.icon} {status.label}</span>
                    </td>
                  </tr>
                )
              })}
              {meds.filter(m => getDaysToExpire(m.expDate) <= 30).length === 0 && (
                <tr><td colSpan="4" className="px-6 py-12 text-center text-slate-400 bg-slate-50/30">
                  <ShieldCheck className="w-10 h-10 mx-auto text-emerald-400 mb-3" />
                  <p className="font-medium text-slate-600">ยอดเยี่ยม!</p>
                  <p className="text-sm mt-1">ไม่มียาที่อยู่ในเกณฑ์หมดอายุหรือเฝ้าระวังด่วน</p>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const DispenseStock = () => {
    const [dispenseSearch, setDispenseSearch] = useState('');
    const [selectedMedGroup, setSelectedMedGroup] = useState(null);
    const [dispenseQty, setDispenseQty] = useState('');

    const searchResults = masterMeds.filter(m => dispenseSearch && m.toLowerCase().includes(dispenseSearch.toLowerCase())).slice(0, 5);

    const selectMedGroup = (medName) => {
      const availableLots = meds.filter(m => m.name === medName && m.qty > 0).sort((a, b) => new Date(a.expDate) - new Date(b.expDate));
      setSelectedMedGroup({ name: medName, lots: availableLots });
      setDispenseSearch('');
    };

    const handleDispense = (e, lotId, currentQty, lotName) => {
      e.preventDefault();
      const qtyToDeduct = parseInt(dispenseQty);
      if (qtyToDeduct > currentQty) return showToast('จำนวนเบิกจ่ายมากกว่าคงเหลือใน Lot นี้', 'error');
      setMeds(meds.map(m => m.id === lotId ? { ...m, qty: m.qty - qtyToDeduct } : m));
      addHistoryLog('EDIT', `เบิกจ่ายยา/ตัดสต๊อก ${selectedMedGroup.name} (Lot: ${lotName}) จำนวน ${qtyToDeduct}`);
      showToast(`ตัดสต๊อก ${qtyToDeduct} รายการสำเร็จ!`, 'success');
      setSelectedMedGroup({
        ...selectedMedGroup,
        lots: selectedMedGroup.lots.map(l => l.id === lotId ? { ...l, qty: l.qty - qtyToDeduct } : l)
      });
      setDispenseQty('');
    };

    return (
      <div className="max-w-4xl mx-auto animate-fade-in pb-8">
        <div className="bg-white rounded-2xl md:rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.06)] border border-slate-100/80 p-6 md:p-10 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-48 h-48 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-bl-full -z-10 opacity-70" />
          <div className="flex items-center gap-3 md:gap-4 mb-6 md:mb-8">
            <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-2.5 md:p-3.5 rounded-xl md:rounded-2xl shadow-lg shadow-indigo-500/20 text-white"><ShoppingCart className="w-6 h-6 md:w-7 md:h-7" /></div>
            <div>
              <h2 className="text-xl md:text-3xl font-bold text-slate-800 tracking-tight">เบิกจ่าย / ตัดสต๊อก</h2>
              <p className="text-slate-500 text-xs md:text-sm mt-0.5 md:mt-1">ระบบ FEFO: แนะนำให้จ่ายยา Lot ที่หมดอายุก่อนอัตโนมัติ</p>
            </div>
          </div>
          <div className="relative mb-8">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none"><Search className="w-5 h-5 text-slate-400" /></div>
            <input type="text" value={dispenseSearch} onChange={e => setDispenseSearch(e.target.value)}
              className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 text-slate-800 font-medium text-sm md:text-base"
              placeholder="พิมพ์ชื่อยาที่ต้องการเบิกจ่าย (เช่น Paracetamol)..." />
            {dispenseSearch && (
              <ul className="absolute z-20 w-full mt-2 bg-white border border-slate-100 rounded-xl shadow-xl overflow-hidden">
                {searchResults.map((sug, i) => (
                  <li key={i} onClick={() => selectMedGroup(sug)} className="px-5 py-3.5 hover:bg-blue-50 cursor-pointer text-slate-700 font-medium border-b border-slate-50 flex items-center gap-3 text-sm md:text-base"><Pill className="w-4 h-4 text-blue-400"/> {sug}</li>
                ))}
                {searchResults.length === 0 && <li className="px-5 py-3 text-slate-400 text-sm">ไม่พบรายชื่อยาในฐานข้อมูล</li>}
              </ul>
            )}
          </div>
          {selectedMedGroup && (
            <div className="animate-fade-in-up">
              <h3 className="text-base md:text-lg font-bold text-slate-800 mb-4 border-l-4 border-blue-500 pl-3">คลังยาของ: <span className="text-blue-600">{selectedMedGroup.name}</span></h3>
              {selectedMedGroup.lots.length > 0 ? (
                <div className="space-y-4">
                  {selectedMedGroup.lots.map((lot, idx) => {
                    const days = getDaysToExpire(lot.expDate);
                    return (
                      <div key={lot.id} className={`p-4 md:p-5 rounded-2xl border ${idx === 0 && lot.qty > 0 ? 'border-blue-400 bg-blue-50/30 shadow-md shadow-blue-500/10 relative overflow-hidden' : 'border-slate-200 bg-white opacity-60'}`}>
                        {idx === 0 && lot.qty > 0 && <div className="absolute top-0 right-0 bg-blue-500 text-white text-[10px] font-bold px-3 py-1 rounded-bl-lg">✨ FEFO จ่าย Lot นี้ก่อน</div>}
                        <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-mono font-bold text-slate-800 text-sm md:text-base">Lot: {lot.lot}</span>
                              <span className="text-[10px] md:text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">ชั้นวาง: {lot.shelf}</span>
                            </div>
                            <p className="text-xs md:text-sm text-slate-600">หมดอายุ: <span className={`font-semibold ${days < 30 ? 'text-red-500' : ''}`}>{new Date(lot.expDate).toLocaleDateString('th-TH')} (เหลือ {days} วัน)</span></p>
                            <p className="text-xs md:text-sm text-slate-600">คงเหลือ: <span className="font-bold text-slate-800 text-base md:text-lg">{lot.qty}</span></p>
                          </div>
                          <form onSubmit={(e) => handleDispense(e, lot.id, lot.qty, lot.lot)} className="flex items-center gap-2 w-full lg:w-auto">
                            <input type="number" min="1" max={lot.qty} required placeholder="จำนวน"
                              value={idx === 0 ? dispenseQty : ''} onChange={e => { if(idx === 0) setDispenseQty(e.target.value); }}
                              disabled={idx !== 0 || lot.qty === 0}
                              className="w-24 md:w-32 px-3 py-2 md:py-2.5 border border-slate-300 rounded-lg text-sm disabled:bg-slate-100" />
                            <button type="submit" disabled={idx !== 0 || lot.qty === 0} className="px-4 py-2 md:py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold rounded-lg text-xs md:text-sm transition-colors whitespace-nowrap active:scale-95">
                              ตัดสต๊อก
                            </button>
                          </form>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-center p-8 bg-slate-50 rounded-2xl border border-slate-200 text-slate-500 text-sm md:text-base">ไม่มียานี้ในสต๊อก (คงเหลือ 0)</div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const Inventory = () => (
    <div className="space-y-4 md:space-y-6 pb-8 animate-fade-in print-section">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-3 mb-2 border-slate-200 border-b md:border-b-0 pb-4 md:pb-0">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-slate-800 tracking-tight">รายการยาในคลัง</h2>
          <p className="text-slate-500 text-xs md:text-sm mt-1 no-print">ตรวจสอบ ค้นหา แก้ไข และปริ้นท์รายงาน</p>
        </div>
        <div className="flex flex-wrap gap-2 w-full lg:w-auto no-print">
          <div className="relative group flex-1 min-w-[200px]">
            <div className="absolute inset-y-0 left-0 pl-3 md:pl-4 flex items-center pointer-events-none"><Search className="w-4 h-4 text-slate-400 group-focus-within:text-emerald-500 transition-colors" /></div>
            <input type="text" placeholder="ค้นหาชื่อยา, Lot..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 md:pl-10 pr-4 py-2 md:py-2.5 w-full bg-white border border-slate-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all font-medium text-xs md:text-sm" />
          </div>
          <button onClick={exportToCSV} className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 md:px-4 py-2 md:py-2.5 rounded-xl font-medium flex items-center justify-center gap-2 transition-all active:scale-95 whitespace-nowrap text-xs md:text-sm flex-1 md:flex-none">
            <Download className="w-4 h-4" /> <span className="hidden sm:inline">ส่งออก</span> CSV
          </button>
          <button onClick={handlePrint} className="bg-slate-800 hover:bg-slate-700 text-white px-3 md:px-4 py-2 md:py-2.5 rounded-xl shadow-md font-medium flex items-center justify-center gap-2 transition-all active:scale-95 whitespace-nowrap text-xs md:text-sm flex-1 md:flex-none">
            <Printer className="w-4 h-4" /> พิมพ์
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 overflow-x-auto pb-2 custom-scrollbar no-print w-full">
        <Filter className="w-4 h-4 text-slate-400 mr-1 flex-shrink-0" />
        {[
          { id: 'all', label: `ทั้งหมด (${stats.total})`, color: 'bg-slate-100 text-slate-600 hover:bg-slate-200', active: 'bg-slate-800 text-white' },
          { id: 'expired', label: `หมดอายุ (${stats.expired})`, color: 'bg-red-50 text-red-600 hover:bg-red-100', active: 'bg-red-600 text-white shadow-lg shadow-red-500/30' },
          { id: 'critical', label: `เสี่ยงสูง (${stats.critical})`, color: 'bg-orange-50 text-orange-600 hover:bg-orange-100', active: 'bg-orange-500 text-white shadow-lg shadow-orange-500/30' },
          { id: 'warning', label: `เฝ้าระวัง (${stats.warning})`, color: 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100', active: 'bg-yellow-500 text-white shadow-lg shadow-yellow-500/30' },
          { id: 'safe', label: `ปลอดภัย`, color: 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100', active: 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30' }
        ].map(filter => (
          <button key={filter.id} onClick={() => setFilterStatus(filter.id)}
            className={`px-3 py-1.5 md:px-4 md:py-2 rounded-full text-[10px] md:text-xs font-bold whitespace-nowrap transition-all duration-300 active:scale-95 border border-transparent flex-shrink-0 ${filterStatus === filter.id ? filter.active : filter.color}`}>
            {filter.label}
          </button>
        ))}
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse min-w-[700px]">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 select-none">
                <th className="px-4 py-3 md:px-6 md:py-4 text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('name')}>
                  <div className="flex items-center gap-1">ชื่อยา / รายละเอียด {sortConfig.key === 'name' && (sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}</div>
                </th>
                <th className="px-4 py-3 md:px-6 md:py-4 text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('lot')}>
                  <div className="flex items-center gap-1">Lot No. {sortConfig.key === 'lot' && (sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}</div>
                </th>
                <th className="px-4 py-3 md:px-6 md:py-4 text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('expDate')}>
                  <div className="flex items-center gap-1">วันหมดอายุ {sortConfig.key === 'expDate' && (sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}</div>
                </th>
                <th className="px-4 py-3 md:px-6 md:py-4 text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-wider text-right cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('qty')}>
                  <div className="flex items-center justify-end gap-1">คงเหลือ {sortConfig.key === 'qty' && (sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}</div>
                </th>
                <th className="px-4 py-3 md:px-6 md:py-4 text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-wider">สถานะ</th>
                <th className="px-4 py-3 md:px-6 md:py-4 text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-wider text-center no-print">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredMeds.map((med, index) => {
                const days = getDaysToExpire(med.expDate);
                const status = getStatusInfo(days);
                return (
                  <tr key={med.id} className="hover:bg-slate-50 transition-colors group animate-fade-in-up" style={{ animationDelay: `${index * 20}ms` }}>
                    <td className="px-4 py-3 md:px-6 md:py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg md:rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 flex-shrink-0"><Pill className="w-4 h-4 md:w-5 md:h-5" /></div>
                        <div>
                          <p className="font-bold text-slate-800 text-xs md:text-sm whitespace-normal line-clamp-2">{med.name}</p>
                          <p className="text-[10px] md:text-xs text-slate-500 font-medium mt-0.5">Location: <span className="text-slate-700">{med.shelf}</span></p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 md:px-6 md:py-4 text-xs md:text-sm text-slate-600 font-mono font-medium">{med.lot}</td>
                    <td className="px-4 py-3 md:px-6 md:py-4">
                      <p className="text-xs md:text-sm font-semibold text-slate-800">{new Date(med.expDate).toLocaleDateString('th-TH')}</p>
                      <p className={`text-[10px] md:text-xs mt-1 font-medium ${days < 0 ? 'text-red-500' : days <= 30 ? 'text-orange-500' : 'text-slate-400'}`}>{days < 0 ? `(หมดอายุมาแล้ว ${Math.abs(days)} วัน)` : `(เหลือ ${days} วัน)`}</p>
                    </td>
                    <td className="px-4 py-3 md:px-6 md:py-4 text-xs md:text-sm text-slate-800 font-bold text-right">{med.qty.toLocaleString()}</td>
                    <td className="px-4 py-3 md:px-6 md:py-4">
                      <span className={`inline-flex items-center px-2 py-1 md:px-2.5 md:py-1 rounded-lg text-[10px] md:text-xs font-bold border ${status.bg} ${status.text} ${status.border} ${status.glow} whitespace-nowrap`}>{status.icon} {status.label}</span>
                    </td>
                    <td className="px-4 py-3 md:px-6 md:py-4 no-print text-center">
                      <div className="flex items-center justify-center gap-1 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setEditModal(med)} className="p-1.5 md:p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"><Edit className="w-4 h-4" /></button>
                        <button onClick={() => setDeleteModal(med)} className="p-1.5 md:p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filteredMeds.length === 0 && (
            <div className="p-12 text-center text-slate-500 bg-slate-50/50">
              <div className="w-12 h-12 md:w-16 md:h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4"><Search className="w-6 h-6 md:w-8 md:h-8 text-slate-300" /></div>
              <p className="text-base md:text-lg font-bold text-slate-600">ไม่พบข้อมูลที่ตรงกับเงื่อนไข</p>
              <p className="text-xs md:text-sm mt-1">ลองเปลี่ยนคำค้นหา หรือจัดเรียงคอลัมน์ใหม่</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const AddStock = () => {
    const [formData, setFormData] = useState({ name: '', lot: '', expDate: '', qty: '', shelf: '', price: '' });
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [filteredSuggestions, setFilteredSuggestions] = useState([]);

    const handleNameChange = (e) => {
      const userInput = e.target.value;
      setFormData({...formData, name: userInput});
      if (userInput) {
        setFilteredSuggestions(masterMeds.filter(med => med.toLowerCase().indexOf(userInput.toLowerCase()) > -1));
        setShowSuggestions(true);
      } else setShowSuggestions(false);
    };

    const handleSubmit = (e) => {
      e.preventDefault();
      setMeds([...meds, { id: Date.now(), ...formData, qty: parseInt(formData.qty), price: parseFloat(formData.price) || 0 }]);
      addHistoryLog('ADD', `เพิ่มรายการยาใหม่ ${formData.name} (Lot: ${formData.lot}) จำนวน ${formData.qty}`);
      setFormData({ name: '', lot: '', expDate: '', qty: '', shelf: '', price: '' });
      setActiveTab('inventory');
      showToast('บันทึกรายการยาเข้าคลังเรียบร้อยแล้ว', 'success');
    };

    const handleScanBarcode = () => {
      showToast('กำลังเชื่อมต่อเครื่องสแกนบาร์โค้ด...', 'success');
      setTimeout(() => {
        setFormData({ name: 'Amoxicillin 500mg', lot: 'BC-99021', expDate: '2026-10-15', qty: 500, shelf: 'A2', price: 2.5 });
        showToast('สแกนสำเร็จ! ดึงข้อมูลยาอัตโนมัติ', 'success');
      }, 1000);
    };

    return (
      <div className="max-w-3xl mx-auto animate-fade-in pb-8">
        <div className="bg-white rounded-2xl md:rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.06)] border border-slate-100/80 p-6 md:p-10 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-48 h-48 md:w-64 md:h-64 bg-gradient-to-br from-emerald-50 to-teal-50 rounded-bl-full -z-10 opacity-70" />
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 md:mb-8">
            <div className="flex items-center gap-3 md:gap-4">
              <div className="bg-gradient-to-br from-emerald-400 to-teal-500 p-2.5 md:p-3.5 rounded-xl md:rounded-2xl shadow-lg shadow-teal-500/20 text-white hover-pulse-glow transition-all"><PackagePlus className="w-6 h-6 md:w-7 md:h-7" /></div>
              <div>
                <h2 className="text-xl md:text-3xl font-bold text-slate-800 tracking-tight">รับยาเข้าคลัง</h2>
                <p className="text-slate-500 text-xs md:text-sm mt-0.5 md:mt-1">เพิ่มข้อมูล หรือสแกนบาร์โค้ด</p>
              </div>
            </div>
            <button onClick={handleScanBarcode} type="button" className="w-full md:w-auto bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-600 border border-slate-200 hover:border-emerald-200 px-4 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95 text-xs md:text-sm">
              <ScanLine className="w-4 h-4 md:w-5 md:h-5" /> สแกนบาร์โค้ด
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4 md:space-y-6 relative z-10">
            <div className="space-y-1 md:space-y-1.5 group relative">
              <label className="block text-xs md:text-sm font-bold text-slate-700">ชื่อยา (Medication Name)</label>
              <input required type="text" value={formData.name} onChange={handleNameChange} onFocus={() => formData.name && setShowSuggestions(true)} onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                className="w-full px-4 py-3 md:px-5 md:py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all text-slate-800 font-medium text-sm"
                placeholder="ค้นหารายชื่อยา..." autoComplete="off" />
              {showSuggestions && formData.name && (
                <ul className="absolute z-50 w-full mt-1 bg-white border border-slate-100 rounded-xl shadow-xl max-h-60 overflow-y-auto custom-scrollbar">
                  {filteredSuggestions.length > 0 ? filteredSuggestions.map((sug, i) => (
                    <li key={i} onClick={() => { setFormData({...formData, name: sug}); setShowSuggestions(false); }}
                      className="px-4 py-2.5 md:px-5 md:py-3 hover:bg-emerald-50 cursor-pointer text-slate-700 hover:text-emerald-700 transition-colors text-xs md:text-sm font-medium flex items-center gap-3 border-b border-slate-50 last:border-0">
                      <List className="w-3 h-3 md:w-4 md:h-4 text-emerald-400" /> {sug}
                    </li>
                  )) : <li className="px-4 py-3 text-slate-400 text-xs md:text-sm text-center">ไม่พบในฐานข้อมูล (จะบันทึกเป็นชื่อใหม่)</li>}
                </ul>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
              <div className="space-y-1 md:space-y-1.5"><label className="block text-xs md:text-sm font-bold text-slate-700">Lot Number</label><input required type="text" value={formData.lot} onChange={e => setFormData({...formData, lot: e.target.value})} className="w-full px-4 py-3 md:px-5 md:py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-slate-800 font-mono font-medium text-sm" /></div>
              <div className="space-y-1 md:space-y-1.5"><label className="block text-xs md:text-sm font-bold text-slate-700">วันหมดอายุ (EXP Date)</label><input required type="date" value={formData.expDate} onChange={e => setFormData({...formData, expDate: e.target.value})} className="w-full px-4 py-3 md:px-5 md:py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-slate-800 font-medium text-sm" /></div>
              <div className="space-y-1 md:space-y-1.5"><label className="block text-xs md:text-sm font-bold text-slate-700">จำนวนที่รับ (Qty)</label><input required type="number" min="1" value={formData.qty} onChange={e => setFormData({...formData, qty: e.target.value})} className="w-full px-4 py-3 md:px-5 md:py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-slate-800 font-medium text-sm" /></div>
              <div className="space-y-1 md:space-y-1.5"><label className="block text-xs md:text-sm font-bold text-slate-700">ชั้นวาง (Location)</label><input required type="text" value={formData.shelf} onChange={e => setFormData({...formData, shelf: e.target.value})} className="w-full px-4 py-3 md:px-5 md:py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-slate-800 font-medium text-sm" /></div>
              <div className="space-y-1 md:space-y-1.5 lg:col-span-2"><label className="block text-xs md:text-sm font-bold text-slate-700">ราคาต่อหน่วย (บาท) - ตัวเลือก</label><input type="number" step="0.01" min="0" value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} className="w-full px-4 py-3 md:px-5 md:py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-slate-800 font-medium text-sm" placeholder="เช่น 15.50" /></div>
            </div>
            <button type="submit" className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-3.5 md:py-4 px-6 rounded-xl shadow-[0_8px_20px_-6px_rgba(0,0,0,0.3)] hover:shadow-lg active:scale-95 hover-pulse-glow transition-all flex items-center justify-center gap-2 text-sm md:text-base">
              <PackagePlus className="w-5 h-5 md:w-6 md:h-6" /> บันทึกรายการยา
            </button>
          </form>
        </div>
      </div>
    );
  };

  const HistoryLog = () => (
    <div className="max-w-4xl mx-auto animate-fade-in pb-8">
      <div className="bg-white rounded-2xl md:rounded-3xl shadow-sm border border-slate-100 p-6 md:p-8 relative overflow-hidden">
        <div className="flex items-center gap-3 md:gap-4 mb-6 md:mb-8">
          <div className="bg-purple-100 text-purple-600 p-2.5 md:p-3.5 rounded-xl md:rounded-2xl"><History className="w-6 h-6 md:w-7 md:h-7" /></div>
          <div>
            <h2 className="text-xl md:text-3xl font-bold text-slate-800">ประวัติการทำรายการ</h2>
            <p className="text-slate-500 text-xs md:text-sm mt-0.5 md:mt-1">ตรวจสอบความเคลื่อนไหว ใครเป็นคนทำรายการ</p>
          </div>
        </div>
        <div className="relative border-l-2 border-slate-100 ml-3 md:ml-4 space-y-4 md:space-y-6 pb-4">
          {historyLogs.length === 0 ? (
            <div className="text-center text-slate-400 py-10 pl-4 md:pl-6 text-sm">ยังไม่มีประวัติการทำรายการในระบบ</div>
          ) : (
            historyLogs.map((log, i) => {
              let icon, colorClass;
              switch(log.action) {
                case 'ADD': icon = <PackagePlus className="w-3 h-3 md:w-4 md:h-4" />; colorClass = 'bg-emerald-100 text-emerald-600 border-emerald-200'; break;
                case 'DELETE': icon = <Trash2 className="w-3 h-3 md:w-4 md:h-4" />; colorClass = 'bg-red-100 text-red-600 border-red-200'; break;
                case 'EDIT': icon = <Edit className="w-3 h-3 md:w-4 md:h-4" />; colorClass = 'bg-blue-100 text-blue-600 border-blue-200'; break;
                case 'EXPORT': icon = <Download className="w-3 h-3 md:w-4 md:h-4" />; colorClass = 'bg-slate-100 text-slate-600 border-slate-200'; break;
                case 'PRINT': icon = <Printer className="w-3 h-3 md:w-4 md:h-4" />; colorClass = 'bg-slate-100 text-slate-600 border-slate-200'; break;
                case 'NOTIFY': icon = <Send className="w-3 h-3 md:w-4 md:h-4" />; colorClass = 'bg-green-100 text-green-600 border-green-200'; break;
                case 'LOGIN': icon = <Lock className="w-3 h-3 md:w-4 md:h-4" />; colorClass = 'bg-teal-100 text-teal-600 border-teal-200'; break;
                default: icon = <Activity className="w-3 h-3 md:w-4 md:h-4" />; colorClass = 'bg-slate-100 text-slate-600 border-slate-200';
              }
              return (
                <div key={log.id} className="relative pl-6 md:pl-8 animate-fade-in-up" style={{ animationDelay: `${i * 30}ms` }}>
                  <div className={`absolute -left-[13px] md:-left-[17px] top-1 md:top-1.5 w-6 h-6 md:w-8 md:h-8 rounded-full border-2 bg-white flex items-center justify-center shadow-sm z-10 ${colorClass}`}>{icon}</div>
                  <div className="bg-slate-50 rounded-lg md:rounded-xl p-3 md:p-4 border border-slate-100 hover:shadow-sm transition-shadow">
                    <p className="font-medium text-slate-800 text-xs md:text-sm">{log.detail}</p>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-[10px] md:text-xs text-slate-400 mt-1.5">
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(log.timestamp).toLocaleString('th-TH')}</span>
                      <span className="hidden sm:block">•</span>
                      <span className="flex items-center gap-1 font-semibold text-slate-500"><User className="w-3 h-3" /> โดย: {log.user}</span>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  );

  const MasterData = () => {
    const [isDragging, setIsDragging] = useState(false);
    const processFile = (file) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target.result;
        const lines = text.split('\n');
        const newMeds = [];
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
          if (cols.length >= 2) {
            let medName = cols[1].replace(/^"|"$/g, '').trim();
            if (medName) newMeds.push(medName);
          }
        }
        if (newMeds.length > 0) {
          setMasterMeds(newMeds);
          addHistoryLog('ADD', `นำเข้าฐานข้อมูลยา Master Data จำนวน ${newMeds.length} รายการ`);
          showToast(`นำเข้ารายชื่อยาสำเร็จ ${newMeds.length} รายการ`, 'success');
        } else showToast('ไม่พบข้อมูลยาในไฟล์ CSV', 'error');
      };
      reader.readAsText(file);
    };
    return (
      <div className="max-w-4xl mx-auto animate-fade-in pb-8">
        <div className="bg-white rounded-2xl md:rounded-3xl shadow-sm border border-slate-100 p-6 md:p-8 relative overflow-hidden">
          <div className="flex items-center gap-3 md:gap-4 mb-6 md:mb-8">
            <div className="bg-blue-100 text-blue-600 p-2.5 md:p-3.5 rounded-xl md:rounded-2xl"><Database className="w-6 h-6 md:w-7 md:h-7" /></div>
            <div>
              <h2 className="text-xl md:text-3xl font-bold text-slate-800">ฐานข้อมูลยา</h2>
              <p className="text-slate-500 text-xs md:text-sm mt-0.5 md:mt-1">อัปโหลดไฟล์ Report.csv ของ รพ.</p>
            </div>
          </div>
          <div onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={(e) => { e.preventDefault(); setIsDragging(false); processFile(e.dataTransfer.files[0]); }}
            className={`mb-6 md:mb-8 border-2 border-dashed rounded-xl md:rounded-2xl p-6 md:p-10 flex flex-col items-center justify-center transition-all duration-300 ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-slate-50 hover:bg-slate-100'}`}>
            <div className={`p-3 md:p-4 rounded-full mb-3 md:mb-4 transition-colors ${isDragging ? 'bg-blue-100 text-blue-600' : 'bg-white text-slate-400 shadow-sm'}`}><UploadCloud className="w-8 h-8 md:w-10 md:h-10" /></div>
            <p className="text-base md:text-lg font-bold text-slate-700 mb-1 md:mb-2 text-center">ลากไฟล์ CSV มาวางที่นี่</p>
            <p className="text-xs md:text-sm text-slate-500 mb-4 md:mb-6 text-center">หรือคลิกปุ่มด้านล่างเพื่อเลือกไฟล์จากเครื่อง</p>
            <input type="file" id="csvUpload" accept=".csv" className="hidden" onChange={(e) => processFile(e.target.files[0])} />
            <label htmlFor="csvUpload" className="cursor-pointer bg-slate-800 hover:bg-slate-700 text-white font-medium py-2 md:py-2.5 px-4 md:px-6 rounded-lg md:rounded-xl transition-all flex items-center gap-2 active:scale-95 shadow-md text-sm">
              <Upload className="w-4 h-4" /> เลือกไฟล์ CSV
            </label>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl md:rounded-2xl p-4 md:p-6 flex items-center gap-3 md:gap-4 mb-4 md:mb-6">
            <div className="bg-blue-500 text-white p-2.5 md:p-3 rounded-lg md:rounded-xl"><List className="w-5 h-5 md:w-6 md:h-6" /></div>
            <div><p className="text-xs md:text-sm font-bold text-slate-500">จำนวนยาทั้งหมดในระบบ</p><p className="text-2xl md:text-3xl font-extrabold text-slate-800">{masterMeds.length} <span className="text-xs md:text-sm font-normal text-slate-500">รายการ</span></p></div>
          </div>
          <div className="border border-slate-200 rounded-xl md:rounded-2xl overflow-hidden bg-white">
            <div className="px-4 py-3 md:px-6 md:py-4 border-b border-slate-100 bg-slate-50/50"><h3 className="font-bold text-slate-700 flex items-center gap-2 text-sm md:text-base"><FileText className="w-4 h-4 md:w-5 md:h-5" /> ตัวอย่างรายชื่อยา</h3></div>
            <div className="p-4 md:p-6 max-h-[300px] md:max-h-[400px] overflow-y-auto custom-scrollbar">
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 md:gap-y-3">
                {masterMeds.map((med, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs md:text-sm font-medium text-slate-600 border-b border-slate-50 pb-2">
                    <span className="text-slate-400 font-mono text-[10px] md:text-xs mt-0.5 min-w-[20px] md:min-w-[24px]">{idx + 1}.</span> {med}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const UsersManagement = () => {
    const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
    const [newUserForm, setNewUserForm] = useState({ username: '', password: '', name: '', role: 'staff' });

    const handleAddUser = (e) => {
      e.preventDefault();
      if (usersList.find(u => u.username === newUserForm.username)) {
        showToast('Username นี้มีในระบบแล้ว กรุณาใช้ชื่ออื่น', 'error');
        return;
      }
      setUsersList([...usersList, { id: Date.now(), ...newUserForm }]);
      addHistoryLog('ADD', `Admin เพิ่มผู้ใช้งานใหม่ชื่อ: ${newUserForm.name} สิทธิ์: ${newUserForm.role}`);
      showToast('เพิ่มผู้ใช้งานใหม่เรียบร้อยแล้ว', 'success');
      setIsAddUserModalOpen(false);
      setNewUserForm({ username: '', password: '', name: '', role: 'staff' });
    };

    const handleDeleteUser = (id, name) => {
      if (usersList.length <= 1) return showToast('ไม่สามารถลบผู้ใช้คนสุดท้ายได้', 'error');
      setUsersList(usersList.filter(u => u.id !== id));
      addHistoryLog('DELETE', `Admin ลบผู้ใช้งานชื่อ: ${name}`);
      showToast(`ลบผู้ใช้ ${name} แล้ว`, 'success');
    };

    return (
      <div className="max-w-5xl mx-auto animate-fade-in pb-8">
        <div className="bg-white rounded-2xl md:rounded-3xl shadow-sm border border-slate-100 p-6 md:p-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 md:gap-6 mb-6 md:mb-8">
            <div className="flex items-center gap-3 md:gap-4">
              <div className="bg-purple-100 text-purple-600 p-2.5 md:p-3.5 rounded-xl md:rounded-2xl"><Users className="w-6 h-6 md:w-7 md:h-7" /></div>
              <div>
                <h2 className="text-xl md:text-3xl font-bold text-slate-800">จัดการผู้ใช้งานระบบ</h2>
                <p className="text-slate-500 text-xs md:text-sm mt-0.5 md:mt-1">เพิ่มหรือลบ เจ้าหน้าที่และผู้ดูแลระบบ</p>
              </div>
            </div>
            <button onClick={() => setIsAddUserModalOpen(true)} className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2.5 rounded-xl font-medium flex items-center gap-2 transition-all active:scale-95 text-xs md:text-sm shadow-lg shadow-purple-500/30 hover-pulse-glow">
              <UserPlus className="w-4 h-4" /> เพิ่มผู้ใช้งาน
            </button>
          </div>
          <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-xl md:rounded-2xl">
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 md:px-6 md:py-4 text-xs font-bold text-slate-500">ชื่อ - นามสกุล</th>
                  <th className="px-4 py-3 md:px-6 md:py-4 text-xs font-bold text-slate-500">Username (สำหรับล็อกอิน)</th>
                  <th className="px-4 py-3 md:px-6 md:py-4 text-xs font-bold text-slate-500">ระดับสิทธิ์ (Role)</th>
                  <th className="px-4 py-3 md:px-6 md:py-4 text-xs font-bold text-slate-500 text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {usersList.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 md:px-6 md:py-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center font-bold text-white text-xs md:text-sm ${user.role === 'admin' ? 'bg-gradient-to-br from-purple-500 to-indigo-600' : 'bg-gradient-to-br from-blue-500 to-cyan-600'}`}>{user.name.charAt(0)}</div>
                        <p className="font-semibold text-slate-800 text-xs md:text-sm">{user.name}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 md:px-6 md:py-4 text-xs md:text-sm text-slate-600 font-mono bg-slate-50/50">{user.username}</td>
                    <td className="px-4 py-3 md:px-6 md:py-4">
                      <span className={`inline-flex items-center px-2 py-1 md:px-3 md:py-1 rounded-full text-[10px] md:text-xs font-bold ${user.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                        {user.role === 'admin' ? '⭐ Admin' : '👤 Staff'}
                      </span>
                    </td>
                    <td className="px-4 py-3 md:px-6 md:py-4 text-center">
                      <button onClick={() => handleDeleteUser(user.id, user.name)} disabled={user.username === 'admin'} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                        <Trash2 className="w-4 h-4 md:w-5 md:h-5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {isAddUserModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-fade-in p-4">
            <div className="glass-panel rounded-2xl md:rounded-3xl p-6 md:p-8 max-w-md w-full shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] animate-scale-in">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg md:text-xl font-bold text-slate-800 flex items-center gap-2"><UserPlus className="w-5 h-5 text-purple-500" /> เพิ่มผู้ใช้งานใหม่</h3>
                <button onClick={() => setIsAddUserModalOpen(false)} className="p-1.5 hover:bg-slate-200/50 rounded-full text-slate-400 transition-colors"><XCircle className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleAddUser} className="space-y-4 md:space-y-5">
                <div><label className="block text-xs md:text-sm font-bold text-slate-700 mb-1.5">ชื่อ - นามสกุล (Display Name)</label><input required type="text" value={newUserForm.name} onChange={e=>setNewUserForm({...newUserForm, name: e.target.value})} className="w-full px-4 py-3 bg-white/50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-purple-500/20 focus:border-purple-500 transition-all duration-300 text-sm shadow-sm" placeholder="เช่น ภก.ใจดี รักษ์โลก" /></div>
                <div><label className="block text-xs md:text-sm font-bold text-slate-700 mb-1.5">ชื่อสำหรับล็อกอิน (Username)</label><input required type="text" value={newUserForm.username} onChange={e=>setNewUserForm({...newUserForm, username: e.target.value.toLowerCase()})} className="w-full px-4 py-3 bg-white/50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-purple-500/20 focus:border-purple-500 transition-all duration-300 font-mono text-sm shadow-sm" placeholder="เช่น jaidee" /></div>
                <div><label className="block text-xs md:text-sm font-bold text-slate-700 mb-1.5">รหัสผ่าน (Password)</label><input required type="text" value={newUserForm.password} onChange={e=>setNewUserForm({...newUserForm, password: e.target.value})} className="w-full px-4 py-3 bg-white/50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-purple-500/20 focus:border-purple-500 transition-all duration-300 text-sm shadow-sm" placeholder="ตั้งรหัสผ่านให้ผู้ใช้งาน" /></div>
                <div>
                  <label className="block text-xs md:text-sm font-bold text-slate-700 mb-1.5">ระดับสิทธิ์</label>
                  <select value={newUserForm.role} onChange={e=>setNewUserForm({...newUserForm, role: e.target.value})} className="w-full px-4 py-3 bg-white/50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-purple-500/20 focus:border-purple-500 transition-all duration-300 text-sm font-bold shadow-sm">
                    <option value="staff">👤 เจ้าหน้าที่ทั่วไป (Staff)</option>
                    <option value="admin">⭐ ผู้ดูแลระบบ (Admin)</option>
                  </select>
                </div>
                <button type="submit" className="w-full mt-8 px-4 py-3.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl active:scale-95 shadow-[0_8px_20px_-6px_rgba(147,51,234,0.5)] transform hover:-translate-y-0.5 transition-all duration-300 text-sm md:text-base">บันทึกผู้ใช้ใหม่</button>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (!isAuthenticated) return <LoginScreen />;

  return (
    <>
      <style>{`
        @keyframes springUp { 0%{opacity:0;transform:translateY(40px) scale(0.98)} 100%{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes popIn { 0%{opacity:0;transform:scale(0.85)} 60%{opacity:1;transform:scale(1.02)} 100%{opacity:1;transform:scale(1)} }
        @keyframes slideInRight { 0%{transform:translateX(120%);opacity:0} 80%{transform:translateX(-10px);opacity:1} 100%{transform:translateX(0);opacity:1} }
        @keyframes pulseGlow { 0%{box-shadow:0 0 0 0 rgba(16,185,129,0.4)} 70%{box-shadow:0 0 0 15px rgba(16,185,129,0)} 100%{box-shadow:0 0 0 0 rgba(16,185,129,0)} }
        @keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-6px) rotate(-1deg)} 75%{transform:translateX(6px) rotate(1deg)} }
        .animate-fade-in { animation: springUp 0.6s cubic-bezier(0.175,0.885,0.32,1.1) forwards; }
        .animate-fade-in-up { animation: springUp 0.6s cubic-bezier(0.175,0.885,0.32,1.1) forwards; opacity:0; }
        .animate-scale-in { animation: popIn 0.5s cubic-bezier(0.175,0.885,0.32,1.2) forwards; }
        .animate-toast-in { animation: slideInRight 0.5s cubic-bezier(0.175,0.885,0.32,1.1) forwards; }
        .animate-shake { animation: shake 0.4s ease-in-out; }
        .hover-pulse-glow:hover { animation: pulseGlow 1.5s infinite; }
        .custom-scrollbar::-webkit-scrollbar { width:6px; height:6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background:transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background:rgba(148,163,184,0.3); border-radius:10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background:rgba(148,163,184,0.6); }
        .glass-panel { background:rgba(255,255,255,0.85); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); border:1px solid rgba(255,255,255,0.5); }
        @media print {
          body * { visibility:hidden; }
          .print-section,.print-section * { visibility:visible; }
          .print-section { position:absolute; left:0; top:0; width:100%; padding:0; margin:0; box-shadow:none; }
          .no-print,.no-print * { display:none !important; }
          main { overflow:visible !important; height:auto !important; padding:0 !important; }
        }
      `}</style>

      {deleteModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 no-print">
          <div className="bg-white rounded-2xl md:rounded-3xl p-6 md:p-8 max-w-sm w-full shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] animate-scale-in border border-slate-100">
            <div className="w-12 h-12 md:w-16 md:h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-5 shadow-inner"><AlertTriangle className="w-6 h-6 md:w-8 md:h-8" /></div>
            <h3 className="text-lg md:text-xl font-bold text-center text-slate-800 mb-2">ยืนยันการลบข้อมูล</h3>
            <p className="text-center text-slate-500 mb-8 text-xs md:text-sm leading-relaxed">คุณต้องการลบรายการ <br/> <span className="font-bold text-slate-700 bg-slate-50 px-2 py-1 rounded-md">{deleteModal.name}</span> ใช่หรือไม่?</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteModal(null)} className="flex-1 px-3 py-2.5 md:py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl active:scale-95 transition-all text-sm">ยกเลิก</button>
              <button onClick={handleDeleteConfirm} className="flex-1 px-3 py-2.5 md:py-3 bg-red-500 hover:bg-red-600 text-white font-bold rounded-xl active:scale-95 transition-all text-sm">ยืนยันลบ</button>
            </div>
          </div>
        </div>
      )}

      {editModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 no-print">
          <div className="glass-panel rounded-2xl md:rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] animate-scale-in">
            <div className="flex justify-between items-center mb-6 md:mb-8">
              <h3 className="text-lg md:text-xl font-bold text-slate-800 flex items-center gap-3">
                <div className="p-2 bg-blue-50 text-blue-500 rounded-xl"><Edit className="w-5 h-5 md:w-6 md:h-6" /></div>
                แก้ไขข้อมูลยา
              </h3>
              <button onClick={() => setEditModal(null)} className="p-2 hover:bg-slate-200/50 rounded-full text-slate-400 transition-colors"><XCircle className="w-5 h-5 md:w-6 md:h-6" /></button>
            </div>
            <form onSubmit={handleEditSubmit} className="space-y-4 md:space-y-5">
              <div><label className="block text-xs md:text-sm font-bold text-slate-700 mb-1.5">ชื่อยา</label><input required type="text" value={editModal.name} onChange={e=>setEditModal({...editModal, name: e.target.value})} className="w-full px-4 py-3 bg-white/50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-300 text-sm shadow-sm" /></div>
              <div className="grid grid-cols-2 gap-4 md:gap-5">
                <div><label className="block text-xs md:text-sm font-bold text-slate-700 mb-1.5">Lot Number</label><input required type="text" value={editModal.lot} onChange={e=>setEditModal({...editModal, lot: e.target.value})} className="w-full px-4 py-3 bg-white/50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 font-mono text-sm shadow-sm transition-all duration-300" /></div>
                <div><label className="block text-xs md:text-sm font-bold text-slate-700 mb-1.5">วันหมดอายุ</label><input required type="date" value={editModal.expDate} onChange={e=>setEditModal({...editModal, expDate: e.target.value})} className="w-full px-4 py-3 bg-white/50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 text-sm shadow-sm transition-all duration-300" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4 md:gap-5">
                <div><label className="block text-xs md:text-sm font-bold text-slate-700 mb-1.5">คงเหลือ</label><input required type="number" min="1" value={editModal.qty} onChange={e=>setEditModal({...editModal, qty: parseInt(e.target.value)})} className="w-full px-4 py-3 bg-white/50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 text-sm shadow-sm transition-all duration-300" /></div>
                <div><label className="block text-xs md:text-sm font-bold text-slate-700 mb-1.5">ชั้นวาง</label><input required type="text" value={editModal.shelf} onChange={e=>setEditModal({...editModal, shelf: e.target.value})} className="w-full px-4 py-3 bg-white/50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 text-sm shadow-sm transition-all duration-300" /></div>
                <div className="col-span-2"><label className="block text-xs md:text-sm font-bold text-slate-700 mb-1.5">ราคาต่อหน่วย (บาท)</label><input type="number" step="0.01" min="0" value={editModal.price || 0} onChange={e=>setEditModal({...editModal, price: parseFloat(e.target.value)})} className="w-full px-4 py-3 bg-white/50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 text-sm shadow-sm transition-all duration-300" /></div>
              </div>
              <button type="submit" className="w-full mt-8 px-4 py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl active:scale-95 transform hover:-translate-y-0.5 transition-all duration-300 text-sm md:text-base">บันทึกการแก้ไข</button>
            </form>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed top-4 right-4 md:top-8 md:right-8 z-[110] animate-toast-in no-print w-[calc(100%-2rem)] md:w-auto max-w-sm">
          <div className={`flex items-center gap-3 px-4 py-3 md:px-6 md:py-4 rounded-xl md:rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.2)] border backdrop-blur-xl ${toast.type === 'success' ? 'bg-emerald-500/90 border-emerald-400 text-white' : 'bg-red-500/90 border-red-400 text-white'}`}>
            {toast.type === 'success' ? <CheckCircle className="w-5 h-5 md:w-6 md:h-6 shrink-0" /> : <XCircle className="w-5 h-5 md:w-6 md:h-6 shrink-0" />}
            <span className="font-semibold text-xs md:text-sm tracking-wide">{toast.message}</span>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row bg-slate-50 min-h-screen font-sans selection:bg-emerald-200 selection:text-emerald-900 overflow-hidden relative">
        <MobileHeader />
        <Sidebar />
        <main className="flex-1 px-4 py-6 md:p-10 h-[calc(100vh-64px)] md:h-screen overflow-y-auto custom-scrollbar relative bg-slate-50 w-full max-w-full">
          <div className="absolute top-0 right-0 w-[800px] h-[600px] bg-gradient-to-bl from-blue-50/50 via-emerald-50/30 to-transparent rounded-bl-full pointer-events-none -z-10" />
          <div key={activeTab} className="max-w-7xl mx-auto w-full">
            {activeTab === 'dashboard' && <Dashboard />}
            {activeTab === 'dispense' && <DispenseStock />}
            {activeTab === 'inventory' && <Inventory />}
            {activeTab === 'add' && <AddStock />}
            {activeTab === 'history' && <HistoryLog />}
            {activeTab === 'master' && currentUser?.role === 'admin' && <MasterData />}
            {activeTab === 'users' && currentUser?.role === 'admin' && <UsersManagement />}
          </div>
        </main>
      </div>
    </>
  );
}
