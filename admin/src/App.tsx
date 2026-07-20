import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { NotificationProvider } from '@shared/components/NotificationProvider';
import RequireAdmin from './components/RequireAdmin';
import AdminLogin from './pages/AdminLogin';
import AdminOverview from './pages/AdminOverview';
import AdminDashboard from './pages/AdminDashboard';
import AdminUsers from './pages/AdminUsers';
import AdminBilling from './pages/AdminBilling';
import AdminSupport from './pages/AdminSupport';
import AdminAuditLog from './pages/AdminAuditLog';
import AdminSettings from './pages/AdminSettings';

function App() {
  return (
    <NotificationProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AdminLogin />} />
          <Route path="/overview" element={<RequireAdmin><AdminOverview /></RequireAdmin>} />
          <Route path="/institutions" element={<RequireAdmin><AdminDashboard /></RequireAdmin>} />
          <Route path="/users" element={<RequireAdmin><AdminUsers /></RequireAdmin>} />
          <Route path="/billing" element={<RequireAdmin><AdminBilling /></RequireAdmin>} />
          <Route path="/support" element={<RequireAdmin><AdminSupport /></RequireAdmin>} />
          <Route path="/audit-log" element={<RequireAdmin><AdminAuditLog /></RequireAdmin>} />
          <Route path="/settings" element={<RequireAdmin><AdminSettings /></RequireAdmin>} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </NotificationProvider>
  );
}

export default App;
