import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useNotification } from '../components/NotificationProvider';
import {
  ArrowLeft, ShieldAlert,
  Save, Loader2, ShieldCheck,
  Trash2, RotateCcw, User, Award,
  ChevronDown, ChevronUp, Sparkles, FileText
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface Question {
  id: string;
  question_text: string;
  type: 'mcq' | 'structured';
  correct_answer: string;
  marks: number;
  order_index: number;
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
  status?: string;
  submitted_at?: string;
  students: { student_number: string };
  exams: { title: string };
  marked_by_email?: string;
  marked_by_name?: string;
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
  const [collapsedQuestions, setCollapsedQuestions] = useState<Set<string>>(new Set());
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [markingSingleId, setMarkingSingleId] = useState<string | null>(null);

  useEffect(() => {
    fetchSubmissionData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionId]);

  const fetchSubmissionData = async () => {
    setIsLoading(true);
    try {
      const { data: sub, error: subError } = await supabase
        .from('submissions')
        .select(`*, students(student_number), exams(title)`)
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

      const { count: vCount } = await supabase
        .from('violations')
        .select('*', { count: 'exact', head: true })
        .eq('exam_id', sub.exam_id)
        .eq('student_id', sub.student_id);
      setViolationCount(vCount || 0);

      const initialOverrides: Record<string, number> = {};
      const initialFeedbackOverrides: Record<string, string> = {};
      Object.entries(sub.marking_details || {}).forEach(([id, detail]: [string, any]) => {
        initialOverrides[id] = detail.awarded_marks;
        initialFeedbackOverrides[id] = detail.feedback;
      });
      setOverrides(initialOverrides);
      setFeedbackOverrides(initialFeedbackOverrides);
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

  const handleFeedbackChange = (questionId: string, value: string) => {
    setFeedbackOverrides({ ...feedbackOverrides, [questionId]: value });
  };

  const getLiveScore = () => {
    return questions.reduce((total, q) => {
      const val = overrides[q.id] ?? submission?.marking_details?.[q.id]?.awarded_marks ?? 0;
      return total + Math.max(0, Math.min(q.marks, val));
    }, 0);
  };

  const handleAutomark = async () => {
    if (!submission || questions.length === 0) return;
    setIsAutomarking(true);
    showToast('AI is marking the submission... Please wait.', 'info');

    try {
      // Build Prompt payload
      const promptData = questions.map(q => ({
        id: q.id,
        question: q.question_text,
        type: q.type,
        max_marks: q.marks,
        model_answer: q.correct_answer || 'None provided. Evaluate based on general knowledge.',
        student_answer: submission.answers[q.id] || 'NO ANSWER PROVIDED'
      }));

      const promptText = `
You are a highly experienced academic examiner. You are grading an exam submission for a student.
Please accurately and fairly grade the following student answers against the max_marks and model_answer provided.

### Grading Guidelines:
1. **Professional Judgment:** Use your professional judgment to evaluate the student's understanding. Do not penalize for minor spelling or grammar errors unless they obscure the meaning.
2. **Conceptual Evaluation:** For structured/essay questions, look for the core concepts described in the model_answer. If the student accurately describes the concept in their own words, award full marks.
3. **Partial Marks:** Award partial marks (in increments of 0.5) for partially correct answers that show some understanding. 
4. **No Binary Marking:** Avoid 0 or Max marking for structured questions unless the answer is completely wrong/missing or perfectly correct.
5. **Constructive Feedback:** Provide 2-3 sentences of constructive feedback for EVERY question. Address the student directly (e.g., "You correctly identified..., but forgot to mention...").

Return exactly and strictly a raw JSON object with NO markdown formatting, NO backticks, NO "json" wrapping. The object must map the question object "id" to its respective grading data. Example output format:
{
  "question-id-uuid-here": {
    "marks": 1.5,
    "feedback": "Great start on the definition! You missed the second key requirement, but showed good understanding of the first."
  }
}

Exam Data:
${JSON.stringify(promptData, null, 2)}
      `;

      const { data, error: invokeError } = await supabase.functions.invoke('grade-submission', {
        body: { prompt: promptText }
      });

      if (invokeError) {
        console.error('Full Edge Function Error Object:', invokeError);
        let detail = invokeError.message || 'Unknown error';
        
        // FunctionsHttpError contains the status and potentially the response body
        if (invokeError instanceof Error) {
          const status = (invokeError as any).status;
          if (status) detail = `(Status ${status}) ${detail}`;
          
          try {
            // Some versions of supabase-js place the response body in .context
            const context = (invokeError as any).context;
            if (context && typeof context.json === 'function') {
              const body = await context.json();
              if (body?.error) detail += ` - ${body.error}`;
            }
          } catch (e) {
            console.error('Failed to parse error body:', e);
          }
        }

        if (detail.includes('404')) {
          throw new Error('AI marking server not found. Please run: supabase functions deploy');
        }
        throw new Error(`AI marking failed: ${detail}`);
      }

      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error('AI returned an empty response.');

      // Strip potential markdown formatting if Gemini included it despite instructions
      const cleanJsonStr = rawText.replace(/^```json/g, '').replace(/^```/g, '').replace(/```$/g, '').trim();
      const aiResults = JSON.parse(cleanJsonStr);

      const newOverrides = { ...overrides };
      const newFeedback = { ...feedbackOverrides };

      questions.forEach(q => {
        if (aiResults[q.id]) {
          newOverrides[q.id] = Math.max(0, Math.min(q.marks, Number(aiResults[q.id].marks) || 0));
          newFeedback[q.id] = aiResults[q.id].feedback || 'Marked by AI.';
        }
      });

      setOverrides(newOverrides);
      setFeedbackOverrides(newFeedback);
      showToast('AI Automarking complete! Please review and save.', 'success');

      // Auto expand all questions so the lecturer can quickly review the feedback
      setCollapsedQuestions(new Set());

    } catch (err: any) {
      console.error('Automarking error:', err);
      showToast(`Automarking failed: ${err.message}`, 'error');
    } finally {
      setIsAutomarking(false);
    }
  };

  const handleMarkSingleQuestion = async (q: Question) => {
    if (!submission) return;
    setMarkingSingleId(q.id);
    try {
      const studentAnswer = submission.answers[q.id] || '(No answer provided)';
      const promptText = `
        You are a highly experienced academic examiner. Grade this specific question for the exam: "${submission.exams.title}".
        
        ### Grading Guidelines:
        1. **Conceptual Evaluation:** Compare student_answer against model_answer. Award marks based on conceptual understanding.
        2. **Partial Marks:** Award partial marks (increments of 0.5) if the student shows some knowledge but misses key points.
        3. **Tone:** Address the student DIRECTLY using "You" (e.g., "You explained X well, but you missed the connection to Y").
        4. **Depth:** Provide 2-3 sentences of constructive feedback that clearly explains the mark awarded.

        Question: ${q.question_text}
        Model Answer: ${q.correct_answer || 'Evaluate based on general knowledge.'}
        Student Answer: ${studentAnswer}
        Max Marks: ${q.marks}

        Return exactly a JSON object: { "marks": number, "feedback": "string" }
      `;

      const { data, error } = await supabase.functions.invoke('grade-submission', {
        body: { prompt: promptText }
      });

      if (error) throw error;

      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error('AI returned an empty response.');

      const cleanJsonStr = rawText.replace(/^```json/g, '').replace(/^```/g, '').replace(/```$/g, '').trim();
      const aiResult = JSON.parse(cleanJsonStr);

      setOverrides({ ...overrides, [q.id]: Math.max(0, Math.min(q.marks, Number(aiResult.marks) || 0)) });
      setFeedbackOverrides({ ...feedbackOverrides, [q.id]: aiResult.feedback || 'Marked by AI.' });
      showToast('Question marked by AI!', 'success');
      
      // Ensure question is expanded
      setCollapsedQuestions(prev => {
        const next = new Set(prev);
        next.delete(q.id);
        return next;
      });

    } catch (err: any) {
      console.error('Single question marking error:', err);
      showToast(`AI Marking failed: ${err.message}`, 'error');
    } finally {
      setMarkingSingleId(null);
    }
  };

  const handleSave = async () => {
    if (!submission) return;
    setIsSaving(true);
    try {
      const updatedDetails: Record<string, { awarded_marks: number; feedback: string }> = {};
      let newTotalScore = 0;

      questions.forEach((q) => {
        const overrideMarks = overrides[q.id] ?? submission.marking_details?.[q.id]?.awarded_marks ?? 0;
        const existingFeedback = feedbackOverrides[q.id] ?? submission.marking_details?.[q.id]?.feedback ?? 'Manually marked by lecturer.';
        const clamped = Math.max(0, Math.min(q.marks, overrideMarks));
        updatedDetails[q.id] = { awarded_marks: clamped, feedback: existingFeedback };
        newTotalScore += clamped;
      });

      const { data: { user } } = await supabase.auth.getUser();
      const profileRes = await supabase.from('lecturer_profiles').select('full_name').eq('id', user?.id).single();

      const { error } = await supabase
        .from('submissions')
        .update({
          marking_details: updatedDetails,
          score: newTotalScore,
          is_manual: true,
          graded: true,
          marked_by_email: user?.email,
          marked_by_name: profileRes.data?.full_name
        })
        .eq('id', submission.id);

      if (error) throw error;

      setSubmission({
        ...submission,
        marking_details: updatedDetails,
        score: newTotalScore,
        is_manual: true,
        graded: true,
        marked_by_email: user?.email || undefined,
        marked_by_name: profileRes.data?.full_name
      });

      const freshOverrides: Record<string, number> = {};
      const freshFeedback: Record<string, string> = {};
      questions.forEach((q) => {
        freshOverrides[q.id] = updatedDetails[q.id].awarded_marks;
        freshFeedback[q.id] = updatedDetails[q.id].feedback;
      });
      setOverrides(freshOverrides);
      setFeedbackOverrides(freshFeedback);

      showToast('Marks saved. The student can now see their updated script.', 'success');
    } catch (err) {
      console.error('Error saving overrides:', err);
      showToast('Failed to save changes', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteSubmission = () => {
    if (!submission) return;
    showConfirm({
      title: 'Delete Submission',
      message: `Are you sure you want to delete ${submission.students.student_number}'s submission? This will move it to the Trash Box. The student can be allowed to re-sit from the Results page.`,
      confirmText: 'Delete',
      onConfirm: async () => {
        setIsDeleting(true);
        try {
          const { error, count } = await supabase
            .from('submissions')
            .delete({ count: 'exact' })
            .eq('id', submission.id);

          if (error) throw error;
          if (count === 0) {
            showToast('Submission not found or permission denied.', 'error');
            return;
          }

          // Guaranteed clean slate: Clear all security violations for this student automatically
          await supabase
            .from('violations')
            .delete()
            .eq('exam_id', submission.exam_id)
            .eq('student_id', submission.student_id);

          showToast('Submission deleted. Student can start completely afresh.', 'success');
          navigate(-1);
        } catch (err: any) {
          showToast(`Failed to delete: ${err.message}`, 'error');
        } finally {
          setIsDeleting(false);
        }
      }
    });
  };

  const toggleCollapse = (id: string) => {
    setCollapsedQuestions(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0D1117] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 text-[#00E5FF] animate-spin" />
          <p className="text-white/40 text-sm font-mono uppercase tracking-widest">Loading Submission…</p>
        </div>
      </div>
    );
  }

  if (!submission) return <div className="min-h-screen bg-[#0D1117] flex items-center justify-center text-white">Submission not found</div>;

  const liveScore = getLiveScore();
  const percentage = submission.total_marks > 0 ? (liveScore / submission.total_marks) * 100 : 0;
  const handleGenerateFocusReport = async () => {
    if (!submission) return;
    setIsGeneratingReport(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-focus-report', {
        body: { submissionId: submission.id }
      });

      if (error) throw error;

      // PDF Generation logic
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.width;
      
      // -- Header --
      doc.setFillColor(13, 17, 23);
      doc.rect(0, 0, pageWidth, 40, 'F');
      
      doc.setTextColor(0, 229, 255);
      doc.setFontSize(22);
      doc.setFont('helvetica', 'bold');
      doc.text('FOCUS REPORT', 20, 25);
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(10);
      doc.text('AI-POWERED ACADEMIC ANALYSIS', 20, 32);
      
      // -- Student info --
      doc.setTextColor(60, 60, 60);
      doc.setFontSize(10);
      doc.text(`STUDENT: ${submission.students.student_number}`, 20, 50);
      doc.text(`EXAM: ${submission.exams.title}`, 20, 55);
      doc.text(`DATE: ${new Date(submission.submitted_at || '').toLocaleDateString()}`, pageWidth - 20, 50, { align: 'right' });
      doc.text(`SCORE: ${submission.score} / ${submission.total_marks} (${((submission.score / submission.total_marks) * 100).toFixed(1)}%)`, pageWidth - 20, 55, { align: 'right' });
      
      doc.setDrawColor(200, 200, 200);
      doc.line(20, 60, pageWidth - 20, 60);

      // -- Summary --
      let yPos = 75;
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('OVERALL SUMMARY', 20, yPos);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      const summaryLines = doc.splitTextToSize(data.overall_summary, pageWidth - 40);
      doc.text(summaryLines, 20, yPos + 8);
      yPos += 15 + (summaryLines.length * 5);

      // -- SWOT Analysis --
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('SWOT ANALYSIS', 20, yPos);
      yPos += 10;

      autoTable(doc, {
        startY: yPos,
        head: [['S.W.O.T ANALYSIS', '']],
        body: [
          [{ content: 'STRENGTHS', styles: { fillColor: [232, 255, 232], fontStyle: 'bold' } }, { content: 'WEAKNESSES', styles: { fillColor: [255, 232, 232], fontStyle: 'bold' } }],
          [data.swot.strengths.map((s: string) => `• ${s}`).join('\n'), data.swot.weaknesses.map((w: string) => `• ${w}`).join('\n')],
          [{ content: 'OPPORTUNITIES', styles: { fillColor: [232, 240, 255], fontStyle: 'bold' } }, { content: 'THREATS', styles: { fillColor: [255, 248, 232], fontStyle: 'bold' } }],
          [data.swot.opportunities.map((o: string) => `• ${o}`).join('\n'), data.swot.threats.map((t: string) => `• ${t}`).join('\n')]
        ],
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 5 },
        columnStyles: { 0: { cellWidth: (pageWidth - 40) / 2 }, 1: { cellWidth: (pageWidth - 40) / 2 } },
        margin: { left: 20, right: 20 }
      });

      yPos = (doc as any).lastAutoTable.finalY + 20;

      // -- Topics to Master --
      if (yPos > doc.internal.pageSize.height - 40) { doc.addPage(); yPos = 20; }
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('TOPICS TO MASTER', 20, yPos);
      yPos += 8;

      autoTable(doc, {
        startY: yPos,
        head: [['Topic', 'Reason for Struggle', 'Mastery Recommendation']],
        body: data.focus_topics.map((item: any) => [item.topic, item.reason, item.recommendation]),
        theme: 'striped',
        headStyles: { fillColor: [13, 17, 23] },
        styles: { fontSize: 9 },
        margin: { left: 20, right: 20 }
      });
      yPos = (doc as any).lastAutoTable.finalY + 15;

      // -- Study Techniques --
      if (data.study_techniques && data.study_techniques.length > 0) {
        if (yPos > doc.internal.pageSize.height - 40) { doc.addPage(); yPos = 20; }
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('RECOMMENDED STUDY TECHNIQUES', 20, yPos);
        yPos += 8;

        autoTable(doc, {
          startY: yPos,
          head: [['Method', 'How to Apply It']],
          body: data.study_techniques.map((s: any) => [s.method, s.description]),
          theme: 'grid',
          headStyles: { fillColor: [0, 102, 204] },
          styles: { fontSize: 9 },
          margin: { left: 20, right: 20 }
        });
        yPos = (doc as any).lastAutoTable.finalY + 15;
      }

      // -- Recovery Plan --
      if (data.recovery_plan && data.recovery_plan.length > 0) {
        if (yPos > doc.internal.pageSize.height - 40) { doc.addPage(); yPos = 20; }
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('PERSONAL 14-DAY RECOVERY PLAN', 20, yPos);
        yPos += 8;

        autoTable(doc, {
          startY: yPos,
          head: [['Timeline', 'Action Item']],
          body: data.recovery_plan.map((r: any) => [r.day_range, r.task]),
          theme: 'striped',
          styles: { fontSize: 9 },
          margin: { left: 20, right: 20 }
        });
        yPos = (doc as any).lastAutoTable.finalY + 15;
      }

      // -- Footer --
      const totalPages = doc.internal.pages.length - 1;
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150);
        const footerName = submission.marked_by_name || submission.marked_by_email || 'Lecturer';
        const footerText = `Reviewed by ${footerName} - Page ${i} of ${totalPages}`;
        doc.text(footerText, pageWidth / 2, doc.internal.pageSize.height - 10, { align: 'center' });
      }

      doc.save(`Focus_Report_${submission.students.student_number}_${submission.exams.title}.pdf`);
      showToast('Focus Report generated successfully!', 'success');
    } catch (err: any) {
      console.error('Error generating focus report:', err);
      showToast(err.message || 'Failed to generate report.', 'error');
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const isPassed = percentage >= 50;
  const isViolation = !!submission.marking_details?.violation;

  return (
    <div className="min-h-screen bg-[#0A1024] text-white font-outfit pb-20">
      {/* Dynamic Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-accent/10 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      {/* ── Top Nav ── */}
      <header className="sticky top-0 z-50 glass-panel border-b border-white/5 backdrop-blur-2xl">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-8 py-5">
          <div className="flex items-center gap-8">
            <button
              onClick={() => navigate(-1)}
              className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all hover:scale-110 active:scale-95 group"
            >
              <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
            </button>

            <div>
              <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.3em] mb-1">{submission.exams.title}</p>
              <h1 className="text-2xl font-black text-white flex items-center gap-3">
                <User className="w-6 h-6 text-accent" />
                {submission.students.student_number}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleDeleteSubmission}
              disabled={isDeleting || isAutomarking}
              className="px-6 py-3 rounded-2xl bg-red-500/10 text-red-400 border border-red-500/20 font-black text-xs uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all disabled:opacity-40"
            >
              <div className="flex items-center gap-2">
                {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Decommission
              </div>
            </button>
            <button
              onClick={handleGenerateFocusReport}
              disabled={isGeneratingReport || !submission.graded || isAutomarking}
              className="px-6 py-3 rounded-2xl bg-white/5 text-white/60 border border-white/10 font-black text-xs uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all disabled:opacity-40"
            >
              <div className="flex items-center gap-2">
                {isGeneratingReport ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                Focus Report
              </div>
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || isAutomarking}
              className="px-8 py-3 rounded-2xl bg-accent text-[#0A1024] font-black text-xs uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-lg shadow-accent/20 disabled:opacity-40"
            >
              <div className="flex items-center gap-2">
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Commit Marks
              </div>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-8 py-12">
        {/* ── Score Hero Panel ── */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
          <div className="md:col-span-2 glass-panel p-10 rounded-[2.5rem] border border-white/5 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-48 h-48 bg-accent/10 rounded-full blur-3xl -mr-20 -mt-20 group-hover:bg-accent/20 transition-all" />
            <div className="relative z-10">
              <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.4em] mb-4">Assessment Performance</p>
              <div className="flex items-baseline gap-4">
                <span className="text-7xl font-black text-white tabular-nums">{liveScore.toFixed(1)}</span>
                <span className="text-2xl font-black text-white/20">/ {submission.total_marks || '100'}</span>
                <div className={`ml-auto px-4 py-2 rounded-2xl font-black text-lg ${isPassed ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                  {percentage.toFixed(1)}%
                </div>
              </div>
              <div className="mt-8 h-3 bg-white/5 rounded-full overflow-hidden border border-white/5 p-1">
                <div 
                  className={`h-full rounded-full transition-all duration-1000 ease-out shadow-[0_0_20px_rgba(0,0,0,0.5)] ${isPassed ? 'bg-accent' : 'bg-red-500'}`}
                  style={{ width: `${Math.min(100, percentage)}%` }}
                />
              </div>
            </div>
          </div>

          <div className="glass-panel p-10 rounded-[2.5rem] border border-white/5 relative overflow-hidden group">
             <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/10 rounded-full blur-3xl -mr-16 -mt-16" />
             <div className="relative z-10 flex flex-col h-full justify-between">
                <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center text-red-500 border border-red-500/20">
                  <ShieldAlert className="w-7 h-7" />
                </div>
                <div>
                  <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] mb-1">Security Integrity</p>
                  <p className={`text-4xl font-black ${violationCount > 3 ? 'text-red-500' : violationCount > 0 ? 'text-orange-500' : 'text-green-500'}`}>
                    {violationCount} Violations
                  </p>
                </div>
             </div>
          </div>

          <div className="glass-panel p-10 rounded-[2.5rem] border border-white/5 relative overflow-hidden group">
             <div className="absolute top-0 right-0 w-32 h-32 bg-accent/10 rounded-full blur-3xl -mr-16 -mt-16" />
             <div className="relative z-10 flex flex-col h-full justify-between">
                <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center text-accent border border-accent/20">
                  <ShieldCheck className="w-7 h-7" />
                </div>
                <div>
                  <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] mb-1">Validation Status</p>
                  <p className="text-2xl font-black text-white">
                    {submission.is_manual ? 'Human Verified' : 'AI Processed'}
                  </p>
                </div>
             </div>
          </div>
        </div>

        {/* ── Violation Banner ── */}
        {isViolation && (
          <div className="mb-12 bg-red-500/5 border border-red-500/10 rounded-[2rem] p-10 flex items-start gap-8 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/5 rounded-full blur-3xl -mr-16 -mt-16" />
            <div className="w-20 h-20 bg-red-500/10 rounded-3xl flex items-center justify-center text-red-500 border border-red-500/20 shrink-0">
              <ShieldAlert className="w-10 h-10" />
            </div>
            <div>
              <h3 className="text-2xl font-black text-red-400 mb-2">Automated Security Lockdown</h3>
              <p className="text-white/60 leading-relaxed font-bold">
                {submission.marking_details.violation?.feedback || 'This session was terminated due to a critical security protocol breach. Assessment weighting has been neutralized.'}
              </p>
              <div className="flex items-center gap-3 mt-6">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-ping" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-red-500/60">Manual override required for mark restoration</span>
              </div>
            </div>
          </div>
        )}

        {/* ── Question List ── */}
        <div className="space-y-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <h2 className="text-3xl font-black text-white font-outfit uppercase tracking-tight">Question Analysis</h2>
              <span className="px-3 py-1 bg-white/5 rounded-lg border border-white/10 text-[10px] font-black text-white/40 uppercase tracking-widest">
                {questions.length} Items Total
              </span>
            </div>
            <div className="p-1 bg-white/5 rounded-xl border border-white/10 flex items-center gap-1">
              <button 
                onClick={handleAutomark}
                disabled={isAutomarking}
                className="flex items-center gap-2 px-6 py-2 rounded-lg bg-accent text-[#0A1024] font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all disabled:opacity-50"
              >
                {isAutomarking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                Batch AI Mark
              </button>
            </div>
          </div>

          {questions.map((q, index) => {
            const detail = submission.marking_details?.[q.id] || { awarded_marks: 0, feedback: 'Pending review.' };
            const studentAnswer = submission.answers?.[q.id] || '';
            const awarded = overrides[q.id] ?? detail.awarded_marks;
            const currentFeedback = feedbackOverrides[q.id] ?? detail.feedback;
            const isModified = (overrides[q.id] !== undefined && overrides[q.id] !== detail.awarded_marks) || 
                              (feedbackOverrides[q.id] !== undefined && feedbackOverrides[q.id] !== detail.feedback);
            const isCollapsed = collapsedQuestions.has(q.id);
            const qPct = q.marks > 0 ? (awarded / q.marks) * 100 : 0;
            const isCorrect = q.type === 'mcq' && studentAnswer.trim().toUpperCase() === q.correct_answer?.trim().toUpperCase();

            return (
              <div key={q.id} className="glass-panel rounded-[2.5rem] border border-white/5 overflow-hidden group/card hover:border-accent/20 transition-all duration-300">
                <div 
                  className={`p-8 flex items-center justify-between gap-8 cursor-pointer ${isCollapsed ? '' : 'bg-white/5 border-b border-white/5'}`}
                  onClick={() => toggleCollapse(q.id)}
                >
                  <div className="flex items-center gap-8 flex-1">
                     <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black text-xl transition-all border ${
                       qPct === 100 ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                       qPct > 0 ? 'bg-accent/10 text-accent border-accent/20' :
                       'bg-white/5 text-white/20 border-white/10'
                     }`}>
                       {index + 1}
                     </div>
                     <div className="flex-1">
                        <h4 className="text-xl font-black text-white leading-snug font-outfit mb-2 line-clamp-1">{q.question_text}</h4>
                        <div className="flex items-center gap-4">
                          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30">{q.type} Identification</span>
                          {q.type === 'mcq' && (
                            <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest ${isCorrect ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                              {isCorrect ? 'Logic Match' : 'Logic Mismatch'}
                            </span>
                          )}
                          {isModified && (
                             <span className="px-2 py-0.5 rounded-lg bg-accent/10 text-accent text-[9px] font-black uppercase tracking-widest border border-accent/20">Awaiting Commit</span>
                          )}
                        </div>
                     </div>
                  </div>

                  <div className="flex items-center gap-8">
                     <div 
                       className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-black/20 border border-white/5 hover:border-accent/30 transition-all font-black"
                       onClick={e => e.stopPropagation()}
                     >
                        <input 
                          type="number"
                          value={awarded}
                          step="0.5"
                          min="0"
                          max={q.marks}
                          onChange={(e) => handleOverrideChange(q.id, parseFloat(e.target.value) || 0, q.marks)}
                          className="w-14 bg-transparent outline-none text-right tabular-nums text-accent"
                        />
                        <span className="text-white/20">/ {q.marks}</span>
                     </div>
                     <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-white/20 group-hover/card:text-accent transition-all">
                       {isCollapsed ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
                     </div>
                  </div>
                </div>

                {!isCollapsed && (
                  <div className="p-10 animate-in slide-in-from-top duration-300">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                      <div className="space-y-8">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30 mb-4 flex items-center gap-3">
                            <ArrowLeft className="w-3 h-3 rotate-180" />
                            Candidate Repository Output
                          </p>
                          <div className="p-8 bg-black/40 rounded-[2rem] border border-white/5 relative group/code overflow-hidden">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-accent/5 rounded-full blur-3xl" />
                            <pre className="text-sm font-mono text-white/80 whitespace-pre-wrap leading-relaxed relative z-10 max-h-60 overflow-y-auto custom-scrollbar">
                              {studentAnswer || 'NULL_DATA_DETECTED'}
                            </pre>
                          </div>
                        </div>

                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-accent/40 mb-4 flex items-center gap-3">
                            <Award className="w-3 h-3 font-black" />
                            Institutional Baseline Logic
                          </p>
                          <div className="p-8 bg-accent/5 rounded-[2rem] border border-accent/10 relative overflow-hidden group/baseline">
                            <pre className="text-sm font-mono text-accent/70 whitespace-pre-wrap leading-relaxed relative z-10">
                              {q.correct_answer || 'NO_BASELINE_PROVIDED'}
                            </pre>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-8">
                        <div>
                           <div className="flex items-center justify-between mb-4">
                             <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30 flex items-center gap-3">
                               <Sparkles className="w-3 h-3" />
                               Assessment Synthesis
                             </p>
                             <button 
                               onClick={() => handleMarkSingleQuestion(q)}
                               disabled={markingSingleId === q.id}
                               className="px-4 py-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 font-black text-[9px] uppercase tracking-widest hover:bg-purple-500 transition-all"
                             >
                               {markingSingleId === q.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'AI Audit Item'}
                             </button>
                           </div>
                           <div className="p-1 bg-white/5 rounded-[2rem] border border-white/5 focus-within:border-accent/30 transition-all overflow-hidden">
                              <textarea 
                                value={currentFeedback}
                                onChange={(e) => handleFeedbackChange(q.id, e.target.value)}
                                className="w-full h-48 p-8 bg-transparent outline-none resize-none text-white/70 font-medium leading-relaxed"
                                placeholder="Documentation for the candidate..."
                              />
                           </div>
                        </div>

                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30 mb-4">Granular Weighting</p>
                          <div className="flex flex-wrap gap-2">
                             {[0, 0.5, 1, q.marks/2, q.marks].filter((v, i, a) => v <= q.marks && a.indexOf(v) === i).sort((a, b) => a-b).map(val => (
                               <button 
                                 key={val}
                                 onClick={() => setOverrides({...overrides, [q.id]: val})}
                                 className={`px-5 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest border transition-all ${
                                   awarded === val 
                                    ? 'bg-accent text-[#0A1024] border-accent shadow-lg shadow-accent/20' 
                                    : 'bg-white/5 text-white/40 border-white/5 hover:border-white/20'
                                 }`}
                               >
                                 {val} Pts
                               </button>
                             ))}
                             {isModified && (
                               <button 
                                 onClick={() => {
                                  const o = {...overrides}; const f = {...feedbackOverrides};
                                  delete o[q.id]; delete f[q.id];
                                  setOverrides(o); setFeedbackOverrides(f);
                                 }}
                                 className="ml-auto flex items-center gap-2 text-white/20 hover:text-red-400 transition-colors uppercase font-black text-[9px] tracking-widest"
                               >
                                 <RotateCcw className="w-3 h-3" />
                                 Revert Logic
                               </button>
                             )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Fixed Action Deck ── */}
        <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[100] w-full max-w-2xl px-8">
           <div className="glass-panel p-4 rounded-3xl border border-white/10 shadow-3xl shadow-black/80 flex items-center justify-between gap-8 animate-in slide-in-from-bottom duration-500">
              <div className="flex items-center gap-6 pl-4 border-l-4 border-accent">
                <div>
                   <p className="text-[9px] font-black text-white/30 uppercase tracking-[0.3em] mb-1">AGGREGATE</p>
                   <p className="text-xl font-black text-white">{liveScore.toFixed(1)} <span className="text-xs text-white/20">PTS</span></p>
                </div>
                <div className={`px-3 py-1.5 rounded-xl font-black text-[10px] tracking-widest uppercase ${isPassed ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'}`}>
                  {percentage.toFixed(0)}% Rank
                </div>
              </div>

              <div className="flex items-center gap-3">
                 <button 
                   onClick={handleAutomark}
                   disabled={isAutomarking || isSaving}
                   className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-purple-400 hover:bg-purple-500 hover:text-white transition-all shadow-lg"
                   title="Full System AI Marking"
                 >
                   {isAutomarking ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                 </button>
                 <button 
                   onClick={handleSave}
                   disabled={isSaving || isAutomarking}
                   className="px-8 py-3 rounded-2xl bg-accent text-[#0A1024] font-black text-xs uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-xl shadow-accent/20"
                 >
                   {isSaving ? 'Synchronizing...' : 'Save marking'}
                 </button>
              </div>
           </div>
        </div>
      </main>

      {/* Bottom padding for floating bar */}
      <div className="h-28" />
    </div>
  );
};

export default SubmissionReview;
