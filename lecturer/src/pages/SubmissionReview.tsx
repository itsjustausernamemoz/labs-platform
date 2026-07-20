import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@shared/lib/apiClient';
import { useNotification } from '@shared/components/NotificationProvider';
import { ArrowLeft, Loader2, Sparkles } from 'lucide-react';

interface Question {
  id: string; question_text: string; type: 'mcq' | 'structured'; options: string[] | null; correct_answer: string; marks: number; order_index: number;
}
interface Submission {
  id: string; exam_id: string; student_id: string; answers: Record<string, string>; marking_details: Record<string, any>; score: number; total_marks: number; is_manual: boolean; graded: boolean; students: { student_number: string }; exams: { title: string; exam_type?: string }; submitted_at?: string; marked_by_name?: string;
}

const SubmissionReview: React.FC = () => {
  const { submissionId } = useParams();
  const navigate = useNavigate();
  const { showToast, showConfirm } = useNotification();
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [feedbackOverrides, setFeedbackOverrides] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isAutomarking, setIsAutomarking] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [violationCount, setViolationCount] = useState(0);
  const [markingSingleId, setMarkingSingleId] = useState<string | null>(null);

  useEffect(() => { fetchSubmissionData(); }, [submissionId]);

  const fetchSubmissionData = async () => {
    setIsLoading(true);
    try {
      const { data: sub, error: subErr } = await supabase.from('submissions').select(`*, students(student_number), exams(title, exam_type)`).eq('id', submissionId).single();
      if (subErr) throw subErr;
      setSubmission(sub);
      const { data: qs, error: qsErr } = await supabase.from('questions').select('*').eq('exam_id', sub.exam_id).order('order_index');
      if (qsErr) throw qsErr;
      setQuestions(qs || []);
      const { count } = await supabase.from('violations').select('*', { count: 'exact', head: true }).eq('exam_id', sub.exam_id).eq('student_id', sub.student_id);
      setViolationCount(count || 0);
      const initO: Record<string, number> = {}; const initF: Record<string, string> = {};
      Object.entries(sub.marking_details || {}).forEach(([id, detail]: [string, any]) => {
        initO[id] = detail.awarded_marks; initF[id] = detail.feedback;
      });
      setOverrides(initO); setFeedbackOverrides(initF);
    } catch (err) { console.error(err); showToast('Load fail', 'error'); } finally { setIsLoading(false); }
  };

  const handleOverrideChange = (qId: string, val: number, max: number) => {
    setOverrides({ ...overrides, [qId]: Math.max(0, Math.min(max, val)) });
  };

  const handleFeedbackChange = (qId: string, val: string) => {
    setFeedbackOverrides({ ...feedbackOverrides, [qId]: val });
  };

  const getLiveScore = () => {
    return questions.reduce((t, q) => t + (overrides[q.id] ?? submission?.marking_details?.[q.id]?.awarded_marks ?? 0), 0);
  };

  const handleAutomark = async () => {
    if (!submission || questions.length === 0) return;
    setIsAutomarking(true); showToast('Automarking MCQs locally...', 'info');
    
    try {
      const newO = { ...overrides };
      const newF = { ...feedbackOverrides };
      
      // 1. Local MCQ Marking (Immediate & Robust)
      questions.forEach(q => {
        if (q.type === 'mcq') {
          const stud = (submission.answers[q.id] || '').replace(/\s+/g, '').toUpperCase();
          const corr = (q.correct_answer || '').replace(/\s+/g, '').toUpperCase();
          // Lenient matching: Compare letter or check if corr starts with stud letter (e.g. "A" vs "A. Option")
          const isCorrect = stud === corr || (stud.length === 1 && (corr.startsWith(stud + ".") || corr.startsWith(stud + " ")));
          
          newO[q.id] = isCorrect ? q.marks : 0;
          newF[q.id] = isCorrect ? "Correct answer (Auto-Marked)." : `Incorrect. Correct answer: ${q.correct_answer}`;
        }
      });

      const { data, error } = await supabase.functions.invoke('grade-submission', { 
        body: { submissionId: submission.id } 
      });
      
      if (error) throw error;
      
      if (data?.marking_details) {
        setOverrides(prev => {
          const updated = { ...prev };
          Object.keys(data.marking_details).forEach(id => {
            updated[id] = data.marking_details[id].awarded_marks;
          });
          return updated;
        });
        
        setFeedbackOverrides(prev => {
          const updated = { ...prev };
          Object.keys(data.marking_details).forEach(id => {
            updated[id] = data.marking_details[id].feedback;
          });
          return updated;
        });
        
        showToast('Automarking complete!', 'success');
      }
    } catch (err) {
      console.error(err);
      showToast('Automarking failed.', 'error');
    } finally {
      setIsAutomarking(false);
    }
  };

  const handleMarkSingle = async (q: Question) => {
    if (!submission) return;
    setMarkingSingleId(q.id);
    try {
      // The API grades this one question server-side and returns the same
      // { marking_details: { [questionId]: {awarded_marks, feedback} } }
      // shape handleAutomark uses — no client-built prompt or response
      // parsing needed anymore.
      const { data, error } = await supabase.functions.invoke('grade-submission', {
        body: { submissionId: submission.id, questionId: q.id },
      });

      if (error) throw error;
      const result = data?.marking_details?.[q.id];
      if (!result) throw new Error('AI grading returned no result for this question');

      setOverrides({ ...overrides, [q.id]: result.awarded_marks });
      setFeedbackOverrides({ ...feedbackOverrides, [q.id]: result.feedback });
      showToast('AI Audit Complete', 'success');
    } catch (err) {
      console.error(err);
      showToast('Marking failed.', 'error');
    } finally {
      setMarkingSingleId(null);
    }
  };

  const handleSave = async () => {
    if (!submission) return;
    setIsSaving(true);
    try {
      const details: Record<string, any> = {}; let score = 0;
      questions.forEach(q => {
        const m = overrides[q.id] ?? submission.marking_details?.[q.id]?.awarded_marks ?? 0;
        const f = feedbackOverrides[q.id] ?? submission.marking_details?.[q.id]?.feedback ?? 'Manual';
        details[q.id] = { awarded_marks: m, feedback: f }; score += m;
      });
      const { error } = await supabase.from('submissions').update({ marking_details: details, score, graded: true }).eq('id', submission.id);
      if (error) throw error;
      setSubmission({ ...submission, marking_details: details, score, graded: true }); showToast('Saved', 'success');
    } catch (err) { showToast('Fail', 'error'); } finally { setIsSaving(false); }
  };

  const handleDelete = () => {
    if (!submission) return;
    showConfirm({
      title: 'Delete', message: `Delete ${submission.students.student_number}'s submission?`,
      confirmText: 'Delete',
      onConfirm: async () => {
        setIsDeleting(true);
        try {
          await supabase.from('submissions').delete().eq('id', submission.id);
          await supabase.from('violations').delete().eq('exam_id', submission.exam_id).eq('student_id', submission.student_id);
          showToast('Deleted', 'success'); navigate(-1);
        } catch (err) { showToast('Fail', 'error'); } finally { setIsDeleting(false); }
      }
    });
  };

  if (isLoading) return <div style={{ padding: 'var(--space-8)', textAlign: 'center' }} className="text-muted">Loading...</div>;
  if (!submission) return <div style={{ padding: 'var(--space-8)' }}>Not found</div>;

  const liveScore = getLiveScore();
  const percentage = (liveScore / (submission.total_marks || 1)) * 100;

  return (
    <div style={{ minHeight: '100vh' }}>
      <header
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap',
          gap: 'var(--space-4)', padding: 'var(--space-4) var(--space-6)', borderBottom: '2px solid var(--color-divider)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <button onClick={() => navigate(-1)} className="btn btn-icon btn-secondary" aria-label="Back">
            <ArrowLeft size={18} />
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{submission.exams.title}</span>
              {submission.exams.exam_type && (
                <span className="tag tag-outline">{submission.exams.exam_type.replace('_', ' ')}</span>
              )}
            </div>
            <h1 style={{ marginBottom: 0 }}>{submission.students.student_number}</h1>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <button onClick={handleDelete} disabled={isDeleting} className="btn btn-secondary">Delete submission</button>
          <button onClick={handleSave} disabled={isSaving} className="btn btn-primary">Commit Marks</button>
        </div>
      </header>

      <main style={{ maxWidth: 1120, margin: '0 auto', padding: 'var(--space-6) var(--space-6) var(--space-8)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
          <div className="card elev-sm">
            <span className="card-kicker">Total Marks</span>
            <h2 style={{ marginBottom: 0 }}>{liveScore.toFixed(1)} <span className="text-muted" style={{ fontSize: 18, fontWeight: 400 }}>/ {submission.total_marks}</span></h2>
          </div>
          <div className="card elev-sm">
            <span className="card-kicker">Percentage</span>
            <h2 style={{ marginBottom: 0 }}>{percentage.toFixed(1)}%</h2>
          </div>
          <div className="card elev-sm">
            <span className="card-kicker">Violations</span>
            <h2 style={{ marginBottom: 0, color: violationCount > 3 ? '#b3261e' : 'var(--color-accent-700)' }}>{violationCount}</h2>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <h2 style={{ marginBottom: 0 }}>Question Analysis</h2>
          <button onClick={handleAutomark} disabled={isAutomarking} className="btn btn-primary">
            {isAutomarking ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
            {isAutomarking ? 'Automarking…' : 'Automark Submission'}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {questions.map((q, idx) => {
            const awarded = overrides[q.id] ?? submission.marking_details?.[q.id]?.awarded_marks ?? 0;
            const feedback = feedbackOverrides[q.id] ?? submission.marking_details?.[q.id]?.feedback ?? '';
            const stud = (submission.answers[q.id] || '').replace(/\s+/g, '').toUpperCase();
            const corr = (q.correct_answer || '').replace(/\s+/g, '').toUpperCase();
            const isCorrect = q.type === 'mcq' && (stud === corr || (stud.length === 1 && (corr.startsWith(stud + ".") || corr.startsWith(stud + " "))));

            return (
              <div key={q.id} className="card elev-sm">
                {/* ── Question Header ── */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <span
                      style={{
                        width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'var(--color-accent-100)', color: 'var(--color-accent-800)', fontFamily: 'var(--font-heading)', fontWeight: 800,
                      }}
                    >
                      {idx + 1}
                    </span>
                    <div>
                      <span className="card-kicker">{q.type === 'mcq' ? 'Multiple Choice' : 'Structured / Essay'}</span>
                      {q.type === 'mcq' && (
                        <span className={`tag ${isCorrect ? 'tag-accent-2' : 'tag-neutral'}`} style={{ marginLeft: 'var(--space-2)' }}>
                          {isCorrect ? 'Correct' : 'Incorrect'}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <div className="field" style={{ width: 90, marginBottom: 0 }}>
                      <label>Marks awarded</label>
                      <input
                        type="number" step="0.5" min={0} max={q.marks} value={awarded}
                        onChange={(e) => handleOverrideChange(q.id, parseFloat(e.target.value) || 0, q.marks)}
                        className="input"
                      />
                    </div>
                    <span className="text-muted" style={{ fontSize: 13, marginTop: 14 }}>/ {q.marks}</span>
                    <button onClick={() => handleMarkSingle(q)} disabled={markingSingleId === q.id} className="btn btn-ghost" style={{ marginTop: 14 }}>
                      {markingSingleId === q.id ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} AI Audit
                    </button>
                  </div>
                </div>

                {/* ── Question Text ── */}
                <p style={{ fontSize: 14, margin: 0 }}>{q.question_text}</p>

                <div className="hr" style={{ margin: '4px 0' }} />

                {/* ── Answers Section ── */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'var(--space-4)' }}>
                  {/* Student Answer */}
                  <div>
                    <div className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Student's Answer</div>
                    <div style={{ border: '1px solid var(--color-divider)', padding: 'var(--space-3)', minHeight: 80 }}>
                      <pre style={{ margin: 0, fontFamily: 'ui-monospace, monospace', fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{submission.answers[q.id] || '(No answer provided)'}</pre>
                      {q.type === 'mcq' && q.options && (
                        <div style={{ marginTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                          {q.options.map((opt, i) => {
                            const char = String.fromCharCode(65 + i);
                            const isSel = (submission.answers[q.id] || '').trim().toUpperCase() === char;
                            const isCor = (q.correct_answer || '').trim().toUpperCase() === char;
                            const bg = isSel ? (isCor ? 'var(--color-accent-2-100)' : '#fbeceb') : isCor ? 'var(--color-accent-2-100)' : 'transparent';
                            const border = isSel ? (isCor ? 'var(--color-accent-2-500)' : '#b3261e') : isCor ? 'var(--color-accent-2-300)' : 'var(--color-divider)';
                            const color = isSel ? (isCor ? 'var(--color-accent-2-800)' : '#b3261e') : isCor ? 'var(--color-accent-2-800)' : 'inherit';
                            return (
                              <div key={i} style={{ padding: '6px 10px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', border: `1px solid ${border}`, background: bg, color }}>
                                <span style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 11, background: 'color-mix(in srgb, currentColor 12%, transparent)' }}>{char}</span>
                                <span style={{ wordBreak: 'break-word' }}>{opt}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Model Answer */}
                  <div>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4, color: 'var(--color-accent-700)' }}>Model Answer</div>
                    <div style={{ border: '1px solid var(--color-accent-300)', background: 'var(--color-accent-100)', padding: 'var(--space-3)', minHeight: 80 }}>
                      <pre style={{ margin: 0, fontFamily: 'ui-monospace, monospace', fontSize: 13, color: 'var(--color-accent-800)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{q.correct_answer || '(No model answer set)'}</pre>
                    </div>
                  </div>
                </div>

                {/* ── Feedback ── */}
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Feedback to student</label>
                  <textarea
                    value={feedback} onChange={(e) => handleFeedbackChange(q.id, e.target.value)}
                    placeholder="Add feedback for this question..." className="input" style={{ minHeight: 90, resize: 'vertical' }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </main>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
};
export default SubmissionReview;
