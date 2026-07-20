import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@shared/lib/apiClient';
import { LogOut, Clock, ArrowRight, Loader2, Terminal } from 'lucide-react';
import { useNotification } from '@shared/components/NotificationProvider';
import logo from '@shared/assets/mashoke-logo.png';

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

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const StudentDashboard: React.FC = () => {
  const [exams, setExams] = useState<Exam[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [student, setStudent] = useState<any>(null);
  const [joinCode, setJoinCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const navigate = useNavigate();
  const { showToast } = useNotification();

  // Additive: platform-wide announcement banner (new, self-contained fetch).
  const [announcement, setAnnouncement] = useState('');
  const [announcementPublished, setAnnouncementPublished] = useState(false);

  // Additive: "start exam" confirmation dialog UI state (mockup adds a
  // checkbox-gated confirmation step before entering an exam).
  const [startTarget, setStartTarget] = useState<Exam | null>(null);
  const [agreed, setAgreed] = useState(false);

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

  useEffect(() => {
    supabase
      .from('platform_settings')
      .select('announcement, announcement_published')
      .eq('id', 1)
      .single()
      .then(({ data }) => {
        if (data) {
          setAnnouncement(data.announcement || '');
          setAnnouncementPublished(!!data.announcement_published);
        }
      });
  }, []);

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
      (allSubs || []).forEach((s: any) => {
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
          const hasDraft = (allSubs || []).some((s: any) => s.exam_id === exam.id && s.status === 'draft');

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
      (subs || []).forEach((sub: any) => {
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

  // Additive: local UI-only handlers for the new confirmation dialog.
  const openStartDialog = (exam: Exam) => {
    setStartTarget(exam);
    setAgreed(false);
  };
  const closeStartDialog = () => setStartTarget(null);
  const confirmStart = () => {
    if (!startTarget) return;
    navigate(`/exam/${startTarget.id}`);
  };

  const pendingSubmissions = submissions.filter(s => !s.graded);
  const completedSubmissions = submissions.filter(s => s.graded);

  return (
    <>
      <nav className="nav">
        <div className="wrap" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', width: '100%' }}>
          <div className="nav-brand" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={logo} alt="Mashoke Tech" style={{ width: 30, height: 30, objectFit: 'contain' }} />
            Mashoke Labs
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'color-mix(in srgb, var(--color-text) 50%, transparent)' }}>
                Signed in
              </div>
              <div style={{ fontSize: 13, fontWeight: 800 }}>{student?.student_number}</div>
            </div>
            <button className="btn btn-icon btn-secondary" title="Log out" onClick={handleLogout}>
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </nav>

      <main className="wrap" style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-8)' }}>
        {announcementPublished && announcement && (
          <div className="card" style={{ background: 'var(--color-accent-100)', border: '1px solid var(--color-accent-300)', marginBottom: 'var(--space-6)' }}>
            <span style={{ fontSize: 13, color: 'var(--color-accent-800)' }}>{announcement}</span>
          </div>
        )}

        <header className="top-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--space-6)', marginBottom: 'var(--space-8)', flexWrap: 'wrap' }}>
          <div>
            <h1>Assessments</h1>
            <p className="text-muted" style={{ maxWidth: 480 }}>
              Welcome back. Join an exam with your code, or open one you're already enrolled in.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/env-check')}>
              <Terminal size={16} /> Check environment
            </button>
            <form onSubmit={handleJoinExam} style={{ display: 'flex', gap: 6 }}>
              <input
                className="input"
                placeholder="EXAM CODE"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={6}
                style={{ width: 130, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800 }}
              />
              <button type="submit" className="btn btn-primary" disabled={isJoining || !joinCode}>
                {isJoining ? <Loader2 size={16} className="spin" /> : 'Join'}
              </button>
            </form>
          </div>
        </header>

        <section style={{ marginBottom: 'var(--space-8)' }}>
          <h3 style={{ marginBottom: 'var(--space-4)' }}>Active exams</h3>
          {isLoading ? (
            <p className="text-muted">Loading your exams&hellip;</p>
          ) : exams.length === 0 ? (
            <p className="text-muted">No active exams right now. Join one using your code above.</p>
          ) : (
            <div className="exam-grid">
              {exams.map((exam) => (
                <button
                  key={exam.id}
                  onClick={() => openStartDialog(exam)}
                  className="card elev-sm"
                  style={{ textAlign: 'left', cursor: 'pointer' }}
                >
                  <span className="card-kicker">{exam.exam_type?.replace('_', ' ')}</span>
                  <span className="card-title">{exam.title}</span>
                  <span className="card-meta">
                    <Clock size={12} /> {exam.duration_minutes} min &middot; {exam.total_marks || 0} marks &middot; Attempt {exam.attempt_count}/{exam.allowed_attempts || 1}
                  </span>
                  {exam.exam_mode === 'open_book' && (
                    <span className="tag tag-accent-2" style={{ alignSelf: 'flex-start' }}>Open book</span>
                  )}
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, color: 'var(--color-accent-700)', marginTop: 'var(--space-2)' }}>
                    Enter exam <ArrowRight size={14} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <div className="hr" />

        <section style={{ marginBottom: 'var(--space-8)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-3)' }}>
            <h3>Awaiting grading</h3>
            <span className="text-muted" style={{ fontSize: 12 }}>{pendingSubmissions.length} record(s)</span>
          </div>
          <table className="table">
            <thead>
              <tr><th>Exam</th><th>Submitted</th><th>Status</th></tr>
            </thead>
            <tbody>
              {pendingSubmissions.length === 0 ? (
                <tr><td colSpan={3} className="text-muted">No evaluations in progress.</td></tr>
              ) : (
                pendingSubmissions.map((sub) => (
                  <tr key={sub.id}>
                    <td style={{ fontWeight: 600 }}>{sub.exams?.title || (sub as any).exam?.title || 'Unknown Exam'}</td>
                    <td>{formatDate(sub.submitted_at)}</td>
                    <td><span className="tag tag-outline">In progress</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-3)' }}>
            <h3>Completed</h3>
            <span className="text-muted" style={{ fontSize: 12 }}>{completedSubmissions.length} record(s)</span>
          </div>
          <table className="table">
            <thead>
              <tr><th>Exam</th><th>Date</th><th>Score</th><th>Marked by</th><th></th></tr>
            </thead>
            <tbody>
              {completedSubmissions.length === 0 ? (
                <tr><td colSpan={5} className="text-muted">No verified history found.</td></tr>
              ) : (
                completedSubmissions.map((sub) => {
                  const isClickable = sub.graded;
                  const pct = sub.total_marks > 0 ? Math.round((sub.score / sub.total_marks) * 100) : 0;
                  return (
                    <tr
                      key={sub.id}
                      onClick={() => (isClickable ? navigate(`/exam/results/${sub.id}`) : undefined)}
                      style={{ cursor: isClickable ? 'pointer' : 'default' }}
                    >
                      <td style={{ fontWeight: 600 }}>{sub.exams?.title || (sub as any).exam?.title || 'Unknown Exam'}</td>
                      <td>{formatDate(sub.submitted_at)}</td>
                      <td style={{ fontWeight: 800 }}>
                        {pct}% <span className="text-muted" style={{ fontWeight: 400 }}>({sub.score}/{sub.total_marks})</span>
                      </td>
                      <td>
                        <span className={`tag ${sub.is_manual ? 'tag-accent' : 'tag-neutral'}`}>
                          {sub.is_manual ? 'Lecturer marked' : 'Auto-graded'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: 0 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/exam/results/${sub.id}`);
                          }}
                        >
                          Review <ArrowRight size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </section>
      </main>

      {startTarget && (
        <div className="dialog-backdrop" onClick={closeStartDialog}>
          <div className="dialog" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">{startTarget.title}</div>
            <p className="dialog-body">
              Before you begin: this exam runs in fullscreen and switching tabs is logged. Make sure you've run the environment check.
            </p>
            <label className="radio" style={{ marginBottom: 'var(--space-2)' }}>
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span className="dot" style={{ borderRadius: 4 }} />
              <span>I understand the exam rules and I'm ready to begin.</span>
            </label>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={closeStartDialog}>Cancel</button>
              <button className="btn btn-primary" disabled={!agreed} onClick={confirmStart}>Begin exam</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
        .wrap { max-width: 1080px; margin: 0 auto; padding: 0 var(--space-6); }
        .exam-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-4); }
        @media (max-width: 900px) { .exam-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 640px) {
          .exam-grid { grid-template-columns: 1fr; }
          .top-actions { flex-direction: column; align-items: stretch !important; }
        }
      `}</style>
    </>
  );
};

export default StudentDashboard;
