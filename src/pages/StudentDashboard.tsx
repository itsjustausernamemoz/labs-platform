import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  BookOpen, Clock, ChevronRight, ArrowRight,
  LogOut, GraduationCap, ShieldCheck, CheckCircle2, AlertCircle, Loader2
} from 'lucide-react';
import { useNotification } from '../components/NotificationProvider';

interface Exam {
  id: string;
  title: string;
  duration_minutes: number;
  is_active: boolean;
}

interface Submission {
  id: string;
  score: number;
  total_marks: number;
  graded: boolean;
  is_manual: boolean;
  submitted_at: string;
  exams: { title: string; id: string };
  marked_by_email?: string;
  marked_by_name?: string;
}

const StudentDashboard: React.FC = () => {
  const [exams, setExams] = useState<Exam[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [student, setStudent] = useState<any>(null);
  const [joinCode, setJoinCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const navigate = useNavigate();
  const { showToast } = useNotification();

  const fetchDashboardData = async () => {
    setIsLoading(true);
    try {
      await Promise.all([
        fetchActiveExams(),
        fetchSubmissions()
      ]);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const storedStudent = localStorage.getItem('student');
    if (!storedStudent) {
      navigate('/');
      return;
    }
    setStudent(JSON.parse(storedStudent));
    fetchDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  const fetchActiveExams = async () => {
    const storedStudent = localStorage.getItem('student');
    if (!storedStudent) return;
    
    const initialStudentData = JSON.parse(storedStudent);
    console.log('Syncing profile for student:', initialStudentData.student_number);

    try {
      // 1. Fetch all active exams the student is enrolled in via the enrollments table
      const { data: enrollmentData, error: enrollError } = await supabase
        .from('enrollments')
        .select(`
          exams (
            id,
            title,
            duration_minutes,
            is_active
          )
        `)
        .eq('student_id', initialStudentData.id);

      if (enrollError) {
        console.error('Error fetching student enrollments:', enrollError);
        setExams([]);
        return;
      }

      // Filter for active exams and extract the exam objects
      // Also filter out exams that have already been submitted
      const submittedExamIds = new Set((submissions || []).map(s => s.exams?.id || (s as any).exam_id));
      
      const activeExams = (enrollmentData || [])
        .map((e: any) => e.exams)
        .filter((exam: any) => 
          exam && (exam.is_active || (exam as any).is_active) && !submittedExamIds.has(exam.id)
        );

      console.log(`Found ${activeExams.length} active enrolled exams after filtering ${submittedExamIds.size} submissions.`);
      setExams(activeExams);

      // 2. Keep the student profile synced (optional but helpful for student_number)
      const { data: refreshedStudent } = await supabase
        .from('students')
        .select('*')
        .eq('id', initialStudentData.id)
        .single();
        
      if (refreshedStudent) {
        localStorage.setItem('student', JSON.stringify(refreshedStudent));
        setStudent(refreshedStudent);
      }
    } catch (err) {
      console.error('Unexpected error in student dashboard:', err);
    }
  };

  const fetchSubmissions = async () => {
    const storedStudent = localStorage.getItem('student');
    if (!storedStudent) return;
    const studentId = JSON.parse(storedStudent).id;

    const { data: subs, error } = await supabase
      .from('submissions')
      .select(`
        id,
        score,
        total_marks,
        graded,
        is_manual,
        submitted_at,
        marked_by_email,
        marked_by_name,
        exams(title, id)
      `)
      .eq('student_id', studentId)
      .order('submitted_at', { ascending: false });

    if (error) {
      console.error('Error fetching submissions:', error);
    } else {
      // Group by exam title/id and take the latest submission
      const latestSubmissionsMap = new Map();
      (subs || []).forEach(sub => {
        const examObj = (sub.exams as any) || (sub as any).exam;
        const examId = examObj?.id || examObj?.title || 'unknown';
        if (!latestSubmissionsMap.has(examId)) {
          latestSubmissionsMap.set(examId, sub);
        }
      });
      setSubmissions(Array.from(latestSubmissionsMap.values()));
    }
  };

  const handleJoinExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode || !student) return;

    setIsJoining(true);
    try {
      // 1. Search for exam with this code
      const { data: exam, error: examError } = await supabase
        .from('exams')
        .select('id, title, is_active')
        .eq('enrollment_code', joinCode.toUpperCase().trim())
        .single();

      if (examError || !exam) {
        showToast('Invalid enrollment code. Please check with your lecturer.', 'error');
        return;
      }

      if (!exam.is_active) {
        showToast('This examination is currently not active.', 'error');
        return;
      }

      // 2. Check if already enrolled
      const { data: existing } = await supabase
        .from('enrollments')
        .select('*')
        .eq('exam_id', exam.id)
        .eq('student_id', student.id)
        .maybeSingle();

      if (existing) {
        showToast('You are already enrolled in this examination.', 'info');
        setJoinCode('');
        return;
      }

      // 3. Enroll student
      const { error: enrollError } = await supabase
        .from('enrollments')
        .insert([{
          exam_id: exam.id,
          student_id: student.id
        }]);

      if (enrollError) throw enrollError;

      showToast(`Successfully enrolled in ${exam.title}!`, 'success');
      setJoinCode('');
      fetchDashboardData();
    } catch (err) {
      console.error('Error joining exam:', err);
      showToast('Failed to join examination. Please try again.', 'error');
    } finally {
      setIsJoining(false);
    }
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
        <header className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h1 className="text-4xl font-bold mb-2">Available Examinations</h1>
            <p className="text-panel/60">Select an exam to begin. Ensure you are in a quiet environment.</p>
          </div>
          
          <form onSubmit={handleJoinExam} className="flex gap-2 bg-white/5 p-2 rounded-2xl border border-white/10 w-full md:w-auto">
            <input
              type="text"
              placeholder="ENTER EXAM CODE"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              className="bg-transparent border-none outline-none px-4 py-2 text-sm font-bold tracking-widest w-full md:w-48 placeholder:text-panel/20"
              maxLength={6}
            />
            <button
              type="submit"
              disabled={isJoining || !joinCode}
              className="bg-accent text-primary px-6 py-2 rounded-xl font-bold text-sm hover:bg-accent/90 transition-all disabled:opacity-50 flex items-center gap-2 shrink-0"
            >
              {isJoining ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Join Exam
            </button>
          </form>
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

        <section className="mt-16">
          <header className="mb-8">
            <h2 className="text-3xl font-bold mb-2">Examination Results</h2>
            <p className="text-panel/60">Review your performance from previous sessions.</p>
          </header>

          {submissions.length === 0 ? (
            <div className="bg-white/5 border border-white/5 rounded-2xl p-8 text-center text-panel/40">
              No previous results found.
            </div>
          ) : (
            <div className="space-y-4">
              {submissions.map((sub) => {
                const isClickable = sub.graded;
                return (
                  <div 
                    key={sub.id}
                    onClick={() => isClickable ? navigate(`/exam/results/${sub.id}`) : undefined}
                    className={`bg-white/5 border border-white/10 p-6 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all ${
                      isClickable ? 'cursor-pointer hover:bg-white/10 hover:border-accent/50 group' : 'opacity-80'
                    }`}
                  >
                    <div>
                      <h3 className={`text-xl font-bold mb-1 ${isClickable ? 'group-hover:text-accent transition-colors' : ''}`}>
                        {sub.exams?.title || (sub as any).exam?.title || 'Unknown Exam'}
                      </h3>
                      <p className="text-sm text-panel/40">Submitted on {new Date(sub.submitted_at).toLocaleDateString()}</p>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      <div className="text-right flex flex-col items-end">
                        {sub.graded ? (
                          <>
                            <div className="flex flex-col items-end text-right">
                              <div className="text-3xl font-black text-accent tabular-nums leading-none">
                                {sub.total_marks > 0 ? ((sub.score / sub.total_marks) * 100).toFixed(0) : 0}%
                              </div>
                              <div className="text-[10px] text-panel/40 font-bold uppercase tracking-widest mt-1">Grade</div>
                              
                              <div className="mt-4 flex flex-col items-end gap-2">
                                {sub.is_manual ? (
                                  <div className="flex items-center gap-1.5 text-accent font-bold text-xs bg-accent/10 px-2 py-1 rounded-lg">
                                    <ShieldCheck className="w-3.5 h-3.5" />
                                    Lecturer Marked
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5 text-green-500 font-bold text-xs bg-green-500/10 px-2 py-1 rounded-lg">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    AI Marked
                                  </div>
                                )}
                                
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/exam/results/${sub.id}`);
                                  }}
                                  className="flex items-center gap-2 bg-accent text-primary px-5 py-2.5 rounded-xl font-black text-xs hover:bg-accent/90 transition-all shadow-lg shadow-accent/20 group-hover:scale-105"
                                >
                                  Review Script
                                  <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="flex flex-col items-end">
                            <div className="text-lg font-bold text-orange-500 flex items-center gap-2">
                              <span className="w-2 h-2 bg-orange-500 rounded-full animate-pulse"></span>
                              Marking...
                            </div>
                            <div className="text-[10px] text-panel/40 font-bold uppercase tracking-wider mt-1">In Progress</div>
                          </div>
                        )}
                      </div>
                      
                      {!sub.graded && (
                        <div className="w-10 h-10 rounded-full bg-white/5 flex flex-shrink-0 items-center justify-center opacity-20">
                          <ChevronRight className="w-5 h-5" />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default StudentDashboard;
