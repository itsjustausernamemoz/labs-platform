import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useNotification } from '../components/NotificationProvider';
import {
  ArrowLeft, CheckCircle2, ShieldAlert,
  Save, Loader2, Info, AlertCircle, ShieldCheck
} from 'lucide-react';

interface Question {
  id: string;
  question_text: string;
  type: 'mcq' | 'structured';
  correct_answer: string;
  marks: number;
}

interface Submission {
  id: string;
  exam_id: string;
  student_id: string;
  answers: Record<string, string>;
  marking_details: Record<string, { awarded_marks: number; feedback: string }>;
  score: number;
  total_marks: number;
  is_manual: boolean;
  graded: boolean;
  students: { student_number: string };
  exams: { title: string };
}

const SubmissionReview: React.FC = () => {
  const { submissionId } = useParams();
  const navigate = useNavigate();
  const { showToast } = useNotification();
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [violationCount, setViolationCount] = useState(0);

  useEffect(() => {
    fetchSubmissionData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionId]);

  const fetchSubmissionData = async () => {
    setIsLoading(true);
    try {
      const { data: sub, error: subError } = await supabase
        .from('submissions')
        .select(`
          *,
          students(student_number),
          exams(title)
        `)
        .eq('id', submissionId)
        .single();

      if (subError) throw subError;
      setSubmission(sub);

      const { data: qs, error: qsError } = await supabase
        .from('questions')
        .select('*')
        .eq('exam_id', sub.exam_id)
        .order('order_index');

      if (qsError) throw qsError;
      setQuestions(qs || []);

      // Fetch violation count for this student on this exam
      const { count: vCount } = await supabase
        .from('violations')
        .select('*', { count: 'exact', head: true })
        .eq('exam_id', sub.exam_id)
        .eq('student_id', sub.student_id);
      setViolationCount(vCount || 0);

      // Initialize overrides with current marks
      const initialOverrides: Record<string, number> = {};
      Object.entries(sub.marking_details || {}).forEach(([id, detail]: [string, any]) => {
        initialOverrides[id] = detail.awarded_marks;
      });
      setOverrides(initialOverrides);
    } catch (err) {
      console.error('Error fetching submission review:', err);
      showToast('Failed to load submission data.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOverrideChange = (questionId: string, value: number, maxMarks: number) => {
    const val = Math.max(0, Math.min(maxMarks, value));
    setOverrides({ ...overrides, [questionId]: val });
  };

  const handleSave = async () => {
    if (!submission) return;
    setIsSaving(true);

    try {
      // Build updated marking details ensuring every question has an entry
      const updatedDetails: Record<string, { awarded_marks: number; feedback: string }> = {};
      let newTotalScore = 0;

      questions.forEach((q) => {
        const overrideMarks = overrides[q.id] ?? submission.marking_details?.[q.id]?.awarded_marks ?? 0;
        const existingFeedback = submission.marking_details?.[q.id]?.feedback ?? 'Manually marked by lecturer.';
        const clamped = Math.max(0, Math.min(q.marks, overrideMarks));

        updatedDetails[q.id] = {
          awarded_marks: clamped,
          feedback: existingFeedback,
        };
        newTotalScore += clamped;
      });

      const { error } = await supabase
        .from('submissions')
        .update({
          marking_details: updatedDetails,
          score: newTotalScore,
          is_manual: true,
          graded: true
        })
        .eq('id', submission.id);

      if (error) throw error;

      // Sync local state so both panels reflect the new marks immediately
      setSubmission({
        ...submission,
        marking_details: updatedDetails,
        score: newTotalScore,
        is_manual: true,
        graded: true,
      });
      // Re-sync overrides so the inputs stay in sync
      const fresh: Record<string, number> = {};
      questions.forEach((q) => { fresh[q.id] = updatedDetails[q.id].awarded_marks; });
      setOverrides(fresh);

      showToast('Marks saved successfully. The student can now see their updated script.', 'success');
    } catch (err) {
      console.error('Error saving overrides:', err);
      showToast('Failed to save changes', 'error');
    } finally {
      setIsSaving(false);
    }
  };


  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-primary animate-spin" />
      </div>
    );
  }

  if (!submission) return <div>Submission not found</div>;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans pb-20">
      <nav className="bg-primary text-white p-4 sticky top-0 z-50 shadow-md">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-panel/60 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Back
          </button>
          <div className="text-center">
            <h1 className="text-lg font-bold">Review: {submission.students.student_number}</h1>
            <p className="text-xs text-accent/60 uppercase tracking-widest">{submission.exams.title}</p>
          </div>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 bg-accent text-primary px-4 py-2 rounded-lg font-bold text-sm hover:bg-accent/90 transition-all disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto p-8">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm mb-8 grid grid-cols-1 sm:grid-cols-3 gap-6 items-center">
          <div>
            <p className="text-sm text-slate-500 font-medium">Final Score</p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-4xl font-bold text-primary">{submission.score.toFixed(1)}</span>
              <span className="text-slate-400 font-medium text-xl">/ {submission.total_marks}</span>
            </div>
          </div>

          {/* Violations */}
          <div className="flex flex-col items-center">
            <p className="text-sm text-slate-500 font-medium mb-2">Security Violations</p>
            <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm ${
              violationCount === 0
                ? 'bg-green-50 text-green-700'
                : violationCount >= 3
                ? 'bg-red-50 text-red-700'
                : 'bg-orange-50 text-orange-700'
            }`}>
              <ShieldAlert className="w-4 h-4" />
              {violationCount} Violation{violationCount !== 1 ? 's' : ''} Detected
            </span>
          </div>

          <div className="text-right">
            <p className="text-sm text-slate-500 font-medium">Marking Status</p>
            {submission.is_manual ? (
              <span className="inline-flex items-center gap-2 text-accent font-bold mt-1">
                <ShieldCheck className="w-5 h-5" />
                Lecturer Marked
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 text-green-600 font-bold mt-1">
                <CheckCircle2 className="w-5 h-5" />
                AI Marked
              </span>
            )}
          </div>
        </div>

        {/* Violation Warning Banner */}
        {submission.marking_details?.violation && (
          <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-6 mb-8 flex items-start gap-4">
            <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center text-red-600 shrink-0">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-red-800">Autosubmitted due to Security Violations</h3>
              <p className="text-red-700 font-medium mt-1">
                {submission.marking_details.violation.feedback || "This exam was automatically submitted because the student exceeded the allowed number of security violations."}
              </p>
              <p className="text-sm text-red-600/80 mt-2">
                As a lecturer, you can manually mark the questions below to override this automatic zero score if necessary.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-8">
          {questions.map((q, index) => {
            const detail = submission.marking_details[q.id] || { awarded_marks: 0, feedback: 'Not marked' };
            const studentAnswer = submission.answers[q.id] || '(No Answer)';
            
            return (
              <div key={q.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-start">
                  <div className="flex gap-4">
                    <span className="w-8 h-8 rounded-lg bg-primary text-white flex items-center justify-center font-bold text-sm shrink-0">
                      Q{index + 1}
                    </span>
                    <div>
                      <h3 className="font-bold text-primary text-lg">{q.question_text}</h3>
                      <p className="text-xs text-slate-400 uppercase tracking-widest mt-1 font-bold">
                        {q.type} • {q.marks} Marks Max
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-xl border border-slate-200 shadow-sm">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-tighter">Awarded:</span>
                      <input
                        type="number"
                        value={overrides[q.id] ?? detail.awarded_marks}
                        onChange={(e) => handleOverrideChange(q.id, parseFloat(e.target.value) || 0, q.marks)}
                        className="w-16 font-bold text-primary text-right outline-none bg-transparent"
                        step="0.5"
                      />
                      <span className="text-slate-400 font-medium">/ {q.marks}</span>
                    </div>
                  </div>
                </div>

                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Student Answer</h4>
                      {studentAnswer === '(No Answer)' ? (
                        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-slate-400 italic text-sm">
                          No answer provided for this question.
                        </div>
                      ) : (
                        <pre
                          className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-slate-700 font-mono text-sm whitespace-pre-wrap break-words leading-relaxed overflow-auto max-h-64"
                        >
                          {studentAnswer}
                        </pre>
                      )}
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Model / Correct Answer</h4>
                      <pre
                        className="p-4 bg-blue-50/50 rounded-xl border border-blue-100 text-primary font-mono text-sm whitespace-pre-wrap break-words leading-relaxed overflow-auto max-h-64"
                      >
                        {q.correct_answer}
                      </pre>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                      <Info className="w-3 h-3" />
                      Marking Feedback
                    </h4>
                    <div className={`p-4 rounded-xl border ${
                      submission.marking_details?.violation 
                        ? 'bg-red-50/50 border-red-100 text-red-800' 
                        : detail.awarded_marks === q.marks 
                          ? 'bg-green-50 border-green-100 text-green-800' 
                          : 'bg-orange-50 border-orange-100 text-orange-800'
                    }`}>
                      <p className="text-sm font-medium leading-relaxed">
                        {submission.marking_details?.violation 
                          ? "Individual marking suppressed due to violation. Adjust 'Awarded' to mark manually."
                          : detail.feedback}
                      </p>
                    </div>
                    {(detail.awarded_marks !== overrides[q.id] && overrides[q.id] !== undefined) && (
                      <div className="flex items-center gap-2 text-xs font-bold text-accent bg-primary px-3 py-1.5 rounded-lg w-fit">
                        <AlertCircle className="w-3 h-3" />
                        Manually Adjusted
                      </div>
                    )}
                  </div>
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
