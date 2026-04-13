import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { NotificationProvider } from '@shared/components/NotificationProvider';
import StudentLogin from './pages/StudentLogin';
import StudentDashboard from './pages/StudentDashboard';
import ExamRoom from './pages/ExamRoom';
import StudentResults from './pages/StudentResults';
import ResetPassword from './pages/ResetPassword';
import EnvCheck from './pages/EnvCheck';

function App() {
  return (
    <NotificationProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<StudentLogin />} />
          <Route path="/dashboard" element={<StudentDashboard />} />
          <Route path="/exam/:examId" element={<ExamRoom />} />
          <Route path="/exam/results/:submissionId" element={<StudentResults />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/env-check" element={<EnvCheck />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </NotificationProvider>
  );
}

export default App;
