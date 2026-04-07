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

      // 2. AI Structured Marking (Optional/Async-ish)
      const structured = questions.filter(q => q.type === 'structured');
      if (structured.length > 0) {
        showToast('Invoking AI for structured questions...', 'info');
        try {
          const promptData = structured.map(q => ({ 
            id: q.id, question: q.question_text, max_marks: q.marks, 
            model_answer: q.correct_answer, student_answer: submission.answers[q.id] || "NO ANSWER"
          }));
          const { data, error } = await supabase.functions.invoke('grade-submission', { body: { prompt: `Return JSON mapping question ID to { "marks": number, "feedback": "string" }. Data: ${JSON.stringify(promptData)}` } });
          
          if (!error && data?.candidates?.[0]?.content?.parts?.[0]?.text) {
            const raw = data.candidates[0].content.parts[0].text;
            const aiRes = JSON.parse(raw.replace(/```json|```/g, '').trim());
            Object.keys(aiRes).forEach(id => {
              newO[id] = aiRes[id].marks;
              newF[id] = aiRes[id].feedback;
            });
          }
        } catch (aiErr) {
          console.error('AI marking failed:', aiErr);
        }
      }

      setOverrides(newO);
      setFeedbackOverrides(newF);
      showToast('Automarking complete!', 'success');
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
      const { data, error } = await supabase.functions.invoke('grade-submission', { body: { prompt: `Grade Question: ${q.question_text}, Student: ${submission.answers[q.id]}, Max: ${q.marks}. Return JSON { "marks": number, "feedback": "string" }` } });
      if (error) throw error;
      const res = JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text.replace(/```json|```/g, '').trim());
      setOverrides({ ...overrides, [q.id]: res.marks }); setFeedbackOverrides({ ...feedbackOverrides, [q.id]: res.feedback });
      showToast('AI Marked', 'success');
    } catch (err) { console.error(err); showToast('Fail', 'error'); } finally { setMarkingSingleId(null); }
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
              <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">{submission.exams.title}</p>
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
              <div key={q.id} className="bg-white/5 p-10 rounded-[2.5rem] border border-white/5 hover:border-white/10 transition-all">
                <div className="flex justify-between items-start gap-12 mb-8">
                  <div className="flex-1">
                    <div className="flex items-center gap-4 mb-4">
                      <span className="w-12 h-12 flex items-center justify-center bg-[#00E5FF]/10 text-[#00E5FF] rounded-xl font-black">{idx + 1}</span>
                      <h4 className="text-xl font-black uppercase tracking-tight">{q.type} Identification</h4>
                      {q.type === 'mcq' && <span className={`px-3 py-1 rounded-lg text-xs font-black uppercase ${isCorrect ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>{isCorrect ? 'Logic Match' : 'Logic Mismatch'}</span>}
                    </div>
                    <h3 className="text-2xl font-bold mb-6 italic opacity-90">"{q.question_text}"</h3>
                    
                    <div className="grid grid-cols-2 gap-8">
                      <div>
                        <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-4">Candidate Output</p>
                        <div className="p-6 bg-black/40 rounded-2xl border border-white/5 min-h-[100px]">
                           <pre className="text-sm font-mono opacity-80 whitespace-pre-wrap">{submission.answers[q.id] || 'NULL_DATA'}</pre>
                           {q.type === 'mcq' && q.options && (
                             <div className="mt-8 space-y-3">
                               {q.options.map((opt, i) => {
                                 const char = String.fromCharCode(65 + i);
                                 const isSel = (submission.answers[q.id] || '').trim().toUpperCase() === char;
                                 const isCor = (q.correct_answer || '').trim().toUpperCase() === char;
                                 return (
                                   <div key={i} className={`p-4 rounded-xl text-sm flex items-center gap-4 border ${isSel ? isCor ? 'bg-green-500/10 border-green-500/30 text-green-500' : 'bg-red-500/10 border-red-500/30 text-red-500' : isCor ? 'bg-green-500/5 border-green-500/10 text-green-500/60' : 'bg-white/5 border-transparent opacity-40'}`}>
                                      <span className="w-8 h-8 flex items-center justify-center bg-black/20 rounded-lg font-black">{char}</span>
                                      {opt}
                                   </div>
                                 );
                               })}
                             </div>
                           )}
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-[#00E5FF]/30 uppercase tracking-[0.2em] mb-4">Baseline Model</p>
                        <div className="p-6 bg-[#00E5FF]/5 rounded-2xl border border-[#00E5FF]/10 min-h-[100px]">
                          <pre className="text-sm font-mono text-[#00E5FF]/80 whitespace-pre-wrap">{q.correct_answer}</pre>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="w-64 flex flex-col items-end gap-6 pt-2">
                    <div className="bg-black/60 p-6 rounded-3xl border border-white/5 flex flex-col items-center">
                       <p className="text-[10px] font-black opacity-30 mb-2 uppercase">Weighting</p>
                       <div className="flex items-center gap-2">
                         <input type="number" step="0.5" value={awarded} onChange={(e) => handleOverrideChange(q.id, parseFloat(e.target.value) || 0, q.marks)} className="bg-transparent text-center text-4xl font-black text-[#00E5FF] outline-none w-20" />
                         <span className="text-xl opacity-20">/ {q.marks}</span>
                       </div>
                    </div>
                    <button onClick={() => handleMarkSingle(q)} disabled={markingSingleId === q.id} className="text-[10px] font-black uppercase tracking-widest text-[#00E5FF]/40 hover:text-[#00E5FF] transition-all flex items-center gap-2">
                      {markingSingleId === q.id ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} AI Audit Question
                    </button>
                  </div>
                </div>

                <div>
                   <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-4">Contextual Feedback</p>
                   <textarea value={feedback} onChange={(e) => handleFeedbackChange(q.id, e.target.value)} placeholder="Type notes for candidate..." className="w-full h-32 bg-white/5 p-6 rounded-2xl border border-white/5 outline-none focus:border-[#00E5FF]/30 transition-all text-sm italic" />
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
