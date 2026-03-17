import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import StudentLogin from './pages/StudentLogin';
import StudentDashboard from './pages/StudentDashboard';
import ExamRoom from './pages/ExamRoom';
import StudentResults from './pages/StudentResults';
import LecturerLogin from './pages/LecturerLogin';
import LecturerDashboard from './pages/LecturerDashboard';
import Results from './pages/Results';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Student Routes */}
        <Route path="/" element={<StudentLogin />} />
        <Route path="/dashboard" element={<StudentDashboard />} />
        <Route path="/exam/:examId" element={<ExamRoom />} />
        <Route path="/exam/results/:submissionId" element={<StudentResults />} />

        {/* Lecturer Routes */}
        <Route path="/lecturer/login" element={<LecturerLogin />} />
        <Route path="/lecturer/dashboard" element={<LecturerDashboard />} />
        <Route path="/lecturer/results/:examId" element={<Results />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
