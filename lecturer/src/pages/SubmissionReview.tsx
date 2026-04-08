import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@shared/lib/supabase';
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
      const studentAnswer = submission.answers[q.id] || '(No answer provided)';
      const modelAnswer = q.correct_answer || '';
      
      const prompt = `
        You are a highly accurate academic examiner. Mark the following structured answer.
        
        QUESTION: "${q.question_text}"
        MAX MARKS POSSIBLE: ${q.marks}
        EXPECTED MODEL ANSWER: "${modelAnswer}"
        
        STUDENT ANSWER: "${studentAnswer}"
        
        INSTRUCTIONS:
        1. Compare the student answer against the model answer.
        2. Assign "marks" (integer or 0.5 increment, not exceeding ${q.marks}).
        3. Provide concise, constructive "feedback" speaking DIRECTLY to the student in the second person (e.g., "You correctly identified..." or "Your answer missed...").
        
        RESPONSE FORMAT:
        You must return ONLY a JSON object:
        { "marks": number, "feedback": "string" }
      `;

      const { data, error } = await supabase.functions.invoke('grade-submission', { 
        body: { prompt } 
      });
      
      if (error) throw error;
      
      const content = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = content.match(/\{.*\}/s);
      const res = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);
      
      setOverrides({ ...overrides, [q.id]: res.marks }); 
      setFeedbackOverrides({ ...feedbackOverrides, [q.id]: res.feedback });
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

  if (isLoading) return <div className="text-white p-10 flex items-center justify-center">Loading...</div>;
  if (!submission) return <div className="text-white p-10">Not found</div>;

  const liveScore = getLiveScore();
  const percentage = (liveScore / (submission.total_marks || 1)) * 100;

  return (
    <div className="min-h-screen bg-[#0D1117] text-white font-outfit p-8">
      <header className="flex justify-between items-center mb-12">
        <div className="flex items-center gap-6">
          <button onClick={() => navigate(-1)} className="p-3 bg-white/5 rounded-xl hover:bg-white/10 transition-all"><ArrowLeft size={20} /></button>
          <div>
            <div className="flex items-center gap-3">
              <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] break-words max-w-sm">{submission.exams.title}</p>
              {submission.exams.exam_type && (
                <span className="px-2 py-0.5 bg-[#00E5FF]/10 text-[#00E5FF] rounded-lg text-[10px] uppercase font-black tracking-widest border border-[#00E5FF]/20">
                  {submission.exams.exam_type.replace('_', ' ')}
                </span>
              )}
            </div>
            <h1 className="text-2xl font-black">{submission.students.student_number}</h1>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={handleDelete} disabled={isDeleting} className="px-6 py-2 rounded-xl bg-red-500/10 text-red-500 font-bold hover:bg-red-500 hover:text-white transition-all">Decommission</button>
          <button onClick={handleSave} disabled={isSaving} className="px-8 py-3 rounded-xl bg-[#00E5FF] text-black font-black hover:scale-105 transition-all">Commit Marks</button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto">
        <div className="grid grid-cols-3 gap-8 mb-12">
          <div className="bg-white/5 p-10 rounded-[2rem] border border-white/5">
            <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.3em] mb-4">Total Marks</p>
            <h2 className="text-6xl font-black">{liveScore.toFixed(1)} <span className="text-2xl opacity-20">/ {submission.total_marks}</span></h2>
          </div>
          <div className="bg-white/5 p-10 rounded-[2rem] border border-white/5">
            <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.3em] mb-4">Percentage</p>
            <h2 className="text-6xl font-black">{percentage.toFixed(1)}%</h2>
          </div>
          <div className="bg-white/5 p-10 rounded-[2rem] border border-white/5">
            <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.3em] mb-4">Violations</p>
            <h2 className={`text-6xl font-black ${violationCount > 3 ? 'text-red-500' : 'text-green-500'}`}>{violationCount}</h2>
          </div>
        </div>

        <div className="flex items-center justify-between mb-8">
          <h2 className="text-3xl font-black">Question Analysis</h2>
          <button onClick={handleAutomark} disabled={isAutomarking} className="bg-purple-500 px-8 py-2 rounded-xl flex items-center gap-3 font-bold hover:bg-purple-600 active:scale-95 transition-all">
            {isAutomarking ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />} Automark Submission
          </button>
        </div>

        <div className="space-y-8">
          {questions.map((q, idx) => {
            const awarded = overrides[q.id] ?? submission.marking_details?.[q.id]?.awarded_marks ?? 0;
            const feedback = feedbackOverrides[q.id] ?? submission.marking_details?.[q.id]?.feedback ?? '';
            const stud = (submission.answers[q.id] || '').replace(/\s+/g, '').toUpperCase();
            const corr = (q.correct_answer || '').replace(/\s+/g, '').toUpperCase();
            const isCorrect = q.type === 'mcq' && (stud === corr || (stud.length === 1 && (corr.startsWith(stud + ".") || corr.startsWith(stud + " "))));

            return (
              <div key={q.id} className="bg-white/5 rounded-[2.5rem] border border-white/5 hover:border-white/10 transition-all overflow-hidden">
                {/* ── Question Header ── */}
                <div className="flex items-center justify-between gap-4 px-10 pt-8 pb-4">
                  <div className="flex items-center gap-4">
                    <span className="w-12 h-12 flex items-center justify-center bg-[#00E5FF]/10 text-[#00E5FF] rounded-xl font-black">{idx + 1}</span>
                    <div>
                      <h4 className="text-sm font-black uppercase tracking-widest text-white/40">{q.type === 'mcq' ? 'Multiple Choice' : 'Structured / Essay'}</h4>
                      {q.type === 'mcq' && <span className={`inline-block mt-1 px-3 py-0.5 rounded-lg text-[10px] font-black uppercase ${isCorrect ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>{isCorrect ? 'Correct' : 'Incorrect'}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="bg-black/40 px-5 py-3 rounded-2xl border border-white/5 flex items-center gap-2">
                      <input type="number" step="0.5" value={awarded} onChange={(e) => handleOverrideChange(q.id, parseFloat(e.target.value) || 0, q.marks)} className="bg-transparent text-center text-2xl font-black text-[#00E5FF] outline-none w-16" />
                      <span className="text-lg opacity-20">/ {q.marks}</span>
                    </div>
                    <button onClick={() => handleMarkSingle(q)} disabled={markingSingleId === q.id} className="text-[10px] font-black uppercase tracking-widest text-[#00E5FF]/40 hover:text-[#00E5FF] transition-all flex items-center gap-1.5 px-3 py-2 rounded-xl hover:bg-[#00E5FF]/5">
                      {markingSingleId === q.id ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} AI Audit
                    </button>
                  </div>
                </div>

                {/* ── Question Text ── */}
                <div className="px-10 pb-6">
                  <p className="text-lg font-medium text-white/85 leading-relaxed whitespace-pre-wrap">{q.question_text}</p>
                </div>

                {/* ── Answers Section ── */}
                <div className="px-10 pb-6">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Student Answer */}
                    <div>
                      <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Student's Answer</p>
                      <div className="p-5 bg-black/30 rounded-2xl border border-white/5 min-h-[80px]">
                        <pre className="text-sm font-mono opacity-80 whitespace-pre-wrap break-words">{submission.answers[q.id] || '(No answer provided)'}</pre>
                        {q.type === 'mcq' && q.options && (
                          <div className="mt-5 space-y-2">
                            {q.options.map((opt, i) => {
                              const char = String.fromCharCode(65 + i);
                              const isSel = (submission.answers[q.id] || '').trim().toUpperCase() === char;
                              const isCor = (q.correct_answer || '').trim().toUpperCase() === char;
                              return (
                                <div key={i} className={`p-3 rounded-xl text-sm flex items-center gap-3 border ${isSel ? isCor ? 'bg-green-500/10 border-green-500/30 text-green-500' : 'bg-red-500/10 border-red-500/30 text-red-500' : isCor ? 'bg-green-500/5 border-green-500/10 text-green-500/60' : 'bg-white/5 border-transparent opacity-40'}`}>
                                   <span className="w-7 h-7 flex items-center justify-center bg-black/20 rounded-lg font-black text-xs">{char}</span>
                                   <span className="break-words">{opt}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Model Answer */}
                    <div>
                      <p className="text-[10px] font-black text-[#00E5FF]/30 uppercase tracking-[0.2em] mb-3">Model Answer</p>
                      <div className="p-5 bg-[#00E5FF]/5 rounded-2xl border border-[#00E5FF]/10 min-h-[80px]">
                        <pre className="text-sm font-mono text-[#00E5FF]/80 whitespace-pre-wrap break-words">{q.correct_answer || '(No model answer set)'}</pre>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── Feedback ── */}
                <div className="px-10 pb-8">
                  <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">Feedback to Student</p>
                  <textarea value={feedback} onChange={(e) => handleFeedbackChange(q.id, e.target.value)} placeholder="Add feedback for this question..." className="w-full h-28 bg-white/[0.03] p-5 rounded-2xl border border-white/5 outline-none focus:border-[#00E5FF]/30 transition-all text-sm leading-relaxed resize-none" />
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
};
export default SubmissionReview;
