import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  BookOpen, Clock, ChevronRight,
  LogOut, GraduationCap, AlertCircle
} from 'lucide-react';

interface Exam {
  id: string;
  title: string;
  duration_minutes: number;
  is_active: boolean;
}

const StudentDashboard: React.FC = () => {
  const [exams, setExams] = useState<Exam[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [student, setStudent] = useState<any>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const storedStudent = localStorage.getItem('student');
    if (!storedStudent) {
      navigate('/');
      return;
    }
    setStudent(JSON.parse(storedStudent));
    fetchActiveExams();
  }, []);

  const fetchActiveExams = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('exams')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) console.error('Error fetching exams:', error);
    else setExams(data || []);
    setIsLoading(false);
  };

  const handleLogout = () => {
    localStorage.removeItem('student');
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-primary text-white font-sans">
      <nav className="border-b border-white/10 p-6">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <GraduationCap className="w-8 h-8 text-accent" />
            <span className="text-xl font-bold">SecureLab</span>
          </div>
          <div className="flex items-center gap-6">
            <span className="text-panel/60 text-sm">Student: <span className="text-white font-medium">{student?.student_number}</span></span>
            <button onClick={handleLogout} className="text-panel/40 hover:text-white transition-colors">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto p-8">
        <header className="mb-12">
          <h1 className="text-4xl font-bold mb-2">Available Examinations</h1>
          <p className="text-panel/60">Select an exam to begin. Ensure you are in a quiet environment.</p>
        </header>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : exams.length === 0 ? (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-12 text-center">
            <AlertCircle className="w-12 h-12 text-panel/20 mx-auto mb-4" />
            <h3 className="text-xl font-bold mb-2">No Active Exams</h3>
            <p className="text-panel/40">There are currently no exams available for you to take.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {exams.map((exam) => (
              <button
                key={exam.id}
                onClick={() => navigate(`/exam/${exam.id}`)}
                className="group bg-white/5 border border-white/10 p-8 rounded-2xl text-left hover:bg-white/10 hover:border-accent/50 transition-all flex justify-between items-center"
              >
                <div>
                  <h3 className="text-2xl font-bold mb-4 group-hover:text-accent transition-colors">{exam.title}</h3>
                  <div className="flex gap-4 text-sm text-panel/60">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      <span>{exam.duration_minutes} Minutes</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4" />
                      <span>Formal Assessment</span>
                    </div>
                  </div>
                </div>
                <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-accent group-hover:text-primary transition-all">
                  <ChevronRight className="w-6 h-6" />
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default StudentDashboard;
