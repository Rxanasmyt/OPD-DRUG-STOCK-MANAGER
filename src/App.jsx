import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import { ROLES } from './lib/constants'

import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import ReceiveStock from './pages/ReceiveStock'
import TransferToFloor from './pages/TransferToFloor'
import Dispense from './pages/Dispense'
import AdjustReturn from './pages/AdjustReturn'
import Reports from './pages/Reports'
import UsersManagement from './pages/admin/UsersManagement'
import MedicationMaster from './pages/admin/MedicationMaster'
import QRLabels from './pages/admin/QRLabels'

const ALL_ROLES = [ROLES.PHARMACIST, ROLES.TECH, ROLES.ADMIN]
const PHARMACIST_ADMIN = [ROLES.PHARMACIST, ROLES.ADMIN]

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route path="/" element={<ProtectedRoute roles={ALL_ROLES}><Dashboard /></ProtectedRoute>} />
          <Route path="/receive" element={<ProtectedRoute roles={PHARMACIST_ADMIN}><ReceiveStock /></ProtectedRoute>} />
          <Route path="/transfer" element={<ProtectedRoute roles={ALL_ROLES}><TransferToFloor /></ProtectedRoute>} />
          <Route path="/dispense" element={<ProtectedRoute roles={ALL_ROLES}><Dispense /></ProtectedRoute>} />
          <Route path="/adjust" element={<ProtectedRoute roles={ALL_ROLES}><AdjustReturn /></ProtectedRoute>} />
          <Route path="/reports" element={<ProtectedRoute roles={PHARMACIST_ADMIN}><Reports /></ProtectedRoute>} />

          <Route path="/admin/users" element={<ProtectedRoute roles={[ROLES.ADMIN]}><UsersManagement /></ProtectedRoute>} />
          <Route path="/admin/medications" element={<ProtectedRoute roles={PHARMACIST_ADMIN}><MedicationMaster /></ProtectedRoute>} />
          <Route path="/admin/qr-labels" element={<ProtectedRoute roles={PHARMACIST_ADMIN}><QRLabels /></ProtectedRoute>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
