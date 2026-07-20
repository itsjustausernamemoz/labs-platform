import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { NotificationProvider } from '@shared/components/NotificationProvider';
import RequireInstitutionAdmin from './components/RequireInstitutionAdmin';
import InstitutionAdminLogin from './pages/InstitutionAdminLogin';
import InstitutionAdminDashboard from './pages/InstitutionAdminDashboard';
import ResetPassword from './pages/ResetPassword';

function App() {
  return (
    <NotificationProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<InstitutionAdminLogin />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route
            path="/dashboard"
            element={
              <RequireInstitutionAdmin>
                {(admin) => <InstitutionAdminDashboard admin={admin} />}
              </RequireInstitutionAdmin>
            }
          />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </NotificationProvider>
  );
}

export default App;
