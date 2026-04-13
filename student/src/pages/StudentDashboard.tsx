import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@shared/lib/supabase';
import {
  BookOpen, Clock, ChevronRight, ArrowRight,
  LogOut, GraduationCap, ShieldCheck, AlertCircle, Loader2, Terminal
} from 'lucide-react';
import { useNotification } from '@shared/components/NotificationProvider';

interface Exam {
  id: string;
  title: string;
  duration_minutes: number;
  is_active: boolean;
  total_marks?: number;
  exam_type?: 'mcq_only' | 'structured_only' | 'mixed';
  allowed_attempts?: number;
  attempt_count?: number; // Local property for UI
  exam_mode?: 'closed_book' | 'open_book';
  has_coding?: boolean;
  coding_language?: string | null;
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
      // 1. Fetch all enrollment data with exam details
      const { data: enrollmentData, error: enrollError } = await supabase
        .from('enrollments')
        .select(`
          exams (
            id,
            title,
            duration_minutes,
            is_active,
            total_marks,
            exam_type,
            allowed_attempts,
            exam_mode
          )
        `)
        .eq('student_id', initialStudentData.id);

      if (enrollError) {
        console.error('Error fetching student enrollments:', enrollError);
        setExams([]);
        return;
      }

      // 2. Fetch all submissions to check attempt counts
      const { data: allSubs } = await supabase
        .from('submissions')
        .select('exam_id, status')
        .eq('student_id', initialStudentData.id);

      const submissionCounts = new Map();
      (allSubs || []).forEach(s => {
        if (s.status === 'submitted') {
          submissionCounts.set(s.exam_id, (submissionCounts.get(s.exam_id) || 0) + 1);
        }
      });
      
      const activeExams = (enrollmentData || [])
        .map((e: any) => e.exams)
        .filter((exam: any) => {
          if (!exam || !(exam.is_active || (exam as any).is_active)) return false;
          
          const submittedCount = submissionCounts.get(exam.id) || 0;
          const allowed = exam.allowed_attempts || 1;
          const hasDraft = (allSubs || []).some(s => s.exam_id === exam.id && s.status === 'draft');
          
          return submittedCount < allowed || hasDraft;
        })
        .map((exam: any) => ({
          ...exam,
          attempt_count: (submissionCounts.get(exam.id) || 0) + 1
        }));

      console.log(`Found ${activeExams.length} active enrolled exams.`);
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
    <div className="min-h-screen bg-[#0A1024] text-white font-sans selection:bg-accent/30">
      {/* Background decoration */}
      <div className="fixed top-0 left-0 w-full h-full pointer-events-none opacity-40">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-accent/5 rounded-full blur-[120px] animate-pulse-subtle" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-500/5 rounded-full blur-[120px] animate-pulse-subtle" style={{ animationDelay: '-3s' }} />
      </div>

      <nav className="sticky top-0 z-50 glass-panel border-x-0 border-t-0 px-6 py-4">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3 group cursor-pointer" onClick={() => navigate('/dashboard')}>
            <div className="w-10 h-10 bg-accent/10 rounded-xl flex items-center justify-center group-hover:bg-accent/20 transition-all">
              <GraduationCap className="w-6 h-6 text-accent" />
            </div>
            <span className="text-xl font-black tracking-tight font-outfit">SecureLab</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden md:flex flex-col items-end mr-2">
              <span className="text-[10px] text-white/30 font-bold uppercase tracking-widest">Logged in as</span>
              <span className="text-sm font-bold text-accent">{student?.student_number}</span>
            </div>
            <button 
              onClick={handleLogout} 
              className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-400 transition-all"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-12 relative z-10">
        <header className="mb-16 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
          <div className="space-y-2">
            <h1 className="text-5xl font-black tracking-tight font-outfit">Assessments</h1>
            <p className="text-white/40 text-lg max-w-xl">
              Welcome back. Access your active examinations and verify your system compatibility.
            </p>
          </div>
          
          <div className="flex flex-col md:flex-row items-center gap-4">
            <button 
              onClick={() => navigate('/env-check')}
              className="glass-button bg-white/5 text-white border-white/10 px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center gap-3 hover:bg-white/10 transition-all shadow-xl w-full md:w-auto"
            >
              <Terminal className="w-5 h-5 text-accent" /> Verify Compiler Environment
            </button>

            <form onSubmit={handleJoinExam} className="glass-panel p-1.5 rounded-2xl flex items-center gap-2 group focus-within:ring-2 focus-within:ring-accent/30 transition-all w-full md:w-auto">
              <div className="flex items-center gap-3 pl-4">
                <ShieldCheck className="w-5 h-5 text-white/20 group-focus-within:text-accent transition-colors" />
                <input
                  type="text"
                  placeholder="EXAM CODE"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  className="bg-transparent border-none outline-none py-2 text-sm font-black tracking-[0.3em] w-32 placeholder:text-white/10 placeholder:tracking-normal text-white"
                  maxLength={6}
                />
              </div>
              <button
                type="submit"
                disabled={isJoining || !joinCode}
                className="bg-accent text-[#0A1024] px-6 py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-white hover:shadow-[0_0_20px_rgba(255,255,255,0.2)] transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {isJoining ? <Loader2 className="w-4 h-4 animate-spin" /> : "Join"}
              </button>
            </form>
          </div>
        </header>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <Loader2 className="w-12 h-12 text-accent animate-spin" />
            <p className="text-white/20 text-xs font-bold uppercase tracking-[0.3em]">Syncing Laboratory Data...</p>
          </div>
        ) : exams.length === 0 ? (
          <div className="glass-panel rounded-[3rem] p-20 text-center border-dashed">
            <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertCircle className="w-10 h-10 text-white/10" />
            </div>
            <h3 className="text-2xl font-black mb-2 font-outfit">No Pending Assessments</h3>
            <p className="text-white/30 max-w-sm mx-auto">There are currently no active examinations assigned to your profile. Join one using an enrollment code.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {exams.map((exam) => (
              <button
                key={exam.id}
                onClick={() => navigate(`/exam/${exam.id}`)}
                className="group relative glass-panel p-8 rounded-[2.5rem] text-left hover:scale-[1.02] hover:bg-white/[0.06] hover:border-accent/30 transition-all duration-300"
              >
                <div className="absolute top-6 right-6 w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center group-hover:bg-accent group-hover:text-[#0A1024] transition-all duration-300 shadow-xl">
                  <ChevronRight className="w-6 h-6" />
                </div>
                
                <div className="mb-8">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-[10px] font-black text-accent uppercase tracking-widest mb-4">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                    Live Assessment
                  </div>
                  {exam.exam_mode === 'open_book' && (
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-[10px] font-black text-green-400 uppercase tracking-widest mb-4 ml-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                      Open Book
                    </div>
                  )}
                  <h3 className="text-2xl font-black leading-tight group-hover:text-accent transition-colors font-outfit mb-2">{exam.title}</h3>
                  <div className="flex items-center gap-3 text-[10px] font-bold text-accent/60 uppercase tracking-widest">
                    <span className="px-2 py-0.5 bg-accent/10 rounded-lg">{exam.exam_type?.replace('_', ' ')}</span>
                    <span className="w-1 h-1 rounded-full bg-white/10" />
                    <span>{exam.total_marks || 0} Marks Total</span>
                    <span className="w-1 h-1 rounded-full bg-white/10" />
                    <span className="text-white/40">Attempt {exam.attempt_count} / {exam.allowed_attempts || 1}</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 pt-6 border-t border-white/5">
                  <div className="flex items-center gap-2 text-[10px] font-bold text-white/40 uppercase tracking-widest">
                    <Clock className="w-3.5 h-3.5" />
                    {exam.duration_minutes}m Duration
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-bold text-white/40 uppercase tracking-widest">
                    <BookOpen className="w-3.5 h-3.5" />
                    {exam.exam_mode === 'open_book' ? 'Open Resource' : 'Closed Book'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        <section className="mt-16">
          <header className="mb-10 flex items-end justify-between">
            <div>
              <h2 className="text-3xl font-black tracking-tight font-outfit">Active Evaluations</h2>
              <p className="text-white/40">Assessments submitted and awaiting lecturer verification.</p>
            </div>
            <div className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">
              {submissions.filter(s => !s.graded).length} Record{submissions.filter(s => !s.graded).length !== 1 ? 's' : ''}
            </div>
          </header>

          {submissions.filter(s => !s.graded).length === 0 ? (
            <div className="glass-panel rounded-3xl p-12 text-center border-dashed">
              <p className="text-white/20 font-bold uppercase tracking-widest text-xs">No evaluations in progress.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {submissions.filter(s => !s.graded).map((sub) => (
                <div 
                  key={sub.id}
                  className="glass-panel p-6 md:p-8 rounded-[2rem] flex flex-col md:flex-row md:items-center justify-between gap-6 transition-all duration-300 opacity-80"
                >
                  <div className="flex items-center gap-6">
                    <div className="w-14 h-14 rounded-2xl flex flex-col items-center justify-center shrink-0 shadow-lg bg-orange-500/10 text-orange-400 border border-orange-500/20">
                      <div className="text-lg font-black leading-none"><Clock className="w-5 h-5"/></div>
                    </div>
                    <div>
                      <h3 className="text-xl font-black mb-1 font-outfit text-white/80">
                        {sub.exams?.title || (sub as any).exam?.title || 'Unknown Exam'}
                      </h3>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-white/20 font-bold uppercase tracking-widest leading-none">Record PK-{sub.id.slice(0, 8)}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between md:justify-end gap-8 border-t md:border-t-0 border-white/5 pt-4 md:pt-0">
                    <div className="flex flex-col items-end">
                      <div className="inline-flex items-center gap-3 px-4 py-2 bg-orange-500/10 border border-orange-500/20 rounded-2xl text-orange-400 font-bold text-sm">
                        <span className="w-2 h-2 bg-orange-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(251,146,60,0.5)]"></span>
                        Evaluation in Progress
                      </div>
                      <div className="text-[9px] text-white/20 font-bold uppercase tracking-[0.2em] mt-2 mr-1">Please check back soon</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mt-24">
          <header className="mb-10 flex items-end justify-between">
            <div>
              <h2 className="text-3xl font-black tracking-tight font-outfit">Completed Examinations</h2>
              <p className="text-white/40">Your historical performance and verified feedback reports.</p>
            </div>
            <div className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">
              {submissions.filter(s => s.graded).length} Record{submissions.filter(s => s.graded).length !== 1 ? 's' : ''}
            </div>
          </header>

          {submissions.filter(s => s.graded).length === 0 ? (
            <div className="glass-panel rounded-3xl p-12 text-center border-dashed">
              <p className="text-white/20 font-bold uppercase tracking-widest text-xs">No verified history found.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {submissions.filter(s => s.graded).map((sub) => {
                const isClickable = sub.graded;
                return (
                  <div 
                    key={sub.id}
                    onClick={() => isClickable ? navigate(`/exam/results/${sub.id}`) : undefined}
                    className={`glass-panel p-6 md:p-8 rounded-[2rem] flex flex-col md:flex-row md:items-center justify-between gap-6 transition-all duration-300 ${
                      isClickable ? 'cursor-pointer hover:bg-white/[0.06] hover:border-accent/20 group' : 'opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-6">
                      <div className={`w-14 h-14 rounded-2xl flex flex-col items-center justify-center shrink-0 shadow-lg ${isClickable ? 'bg-accent/10 text-accent' : 'bg-white/5 text-white/20'}`}>
                        <div className="text-lg font-black leading-none">{new Date(sub.submitted_at).getDate()}</div>
                        <div className="text-[8px] font-black uppercase tracking-tighter">{new Date(sub.submitted_at).toLocaleString('default', { month: 'short' })}</div>
                      </div>
                      <div>
                        <h3 className={`text-xl font-black mb-1 font-outfit ${isClickable ? 'group-hover:text-accent transition-colors' : 'text-white/40'}`}>
                          {sub.exams?.title || (sub as any).exam?.title || 'Unknown Exam'}
                        </h3>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] text-white/20 font-bold uppercase tracking-widest leading-none">Record PK-{sub.id.slice(0, 8)}</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between md:justify-end gap-8 border-t md:border-t-0 border-white/5 pt-4 md:pt-0">
                      <div className="text-right">
                        <div className="flex items-center gap-6">
                          <div className="flex flex-col items-end">
                            <div className="flex items-baseline gap-2">
                              <div className="text-4xl font-black text-white tabular-nums leading-none tracking-tighter">
                                {sub.total_marks > 0 ? ((sub.score / sub.total_marks) * 100).toFixed(0) : 0}<span className="text-accent text-xl">%</span>
                              </div>
                              <div className="text-lg font-bold text-white/50 tabular-nums">
                                ({sub.score}/{sub.total_marks})
                              </div>
                            </div>
                            <div className="text-[9px] text-accent font-bold uppercase tracking-[0.2em] mt-1">Final Result</div>
                          </div>
                          
                          <div className="hidden sm:flex flex-col items-end gap-2">
                            <div className={`flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full ${
                              sub.is_manual 
                                ? 'bg-accent/5 border border-accent/20 text-accent' 
                                : 'bg-purple-500/10 border border-purple-500/20 text-purple-400'
                            }`}>
                              <ShieldCheck className="w-3 h-3" />
                              {sub.is_manual ? 'Lecturer Marked' : 'Auto-Graded'}
                            </div>
                            
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/exam/results/${sub.id}`);
                              }}
                              className="flex items-center gap-2 bg-white text-[#0A1024] px-5 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-accent transition-all shadow-xl group-hover:scale-105"
                            >
                              Review
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                      
                      {isClickable && (
                        <div className="hidden md:flex w-10 h-10 rounded-full border border-white/5 flex-shrink-0 items-center justify-center group-hover:border-accent/40 group-hover:bg-accent/5 transition-all">
                          <ChevronRight className="w-5 h-5 text-white/20 group-hover:text-accent" />
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
