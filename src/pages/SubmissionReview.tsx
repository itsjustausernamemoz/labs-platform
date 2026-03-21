import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useNotification } from '../components/NotificationProvider';
import {
  ArrowLeft, CheckCircle2, ShieldAlert,
  Save, Loader2, Info, ShieldCheck,
  Trash2, RotateCcw, User, BookOpen, Award, Clock,
  ChevronDown, ChevronUp, Zap, Sparkles, FileText
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

  const handleFullMark = (questionId: string, maxMarks: number) => {
    setOverrides({ ...overrides, [questionId]: maxMarks });
  };

  const handleZeroMark = (questionId: string) => {
    setOverrides({ ...overrides, [questionId]: 0 });
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
5. **Constructive Feedback:** Provide a constructive, concise sentence of feedback for EVERY question. Address the student directly (e.g., "You correctly identified..., but forgot to mention...").

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
    <div className="min-h-screen bg-[#0D1117] text-white font-sans">
      {/* ── Top Nav ── */}
      <header className="sticky top-0 z-50 bg-[#0D1117]/90 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-6 py-4">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-white/40 hover:text-white transition-colors group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            <span className="text-sm font-medium">Back</span>
          </button>

          <div className="text-center">
            <p className="text-xs text-white/30 uppercase tracking-[0.2em] font-bold">{submission.exams.title}</p>
            <h1 className="font-bold text-base leading-tight flex items-center justify-center gap-2 mt-0.5">
              <User className="w-3.5 h-3.5 text-[#00E5FF]" />
              {submission.students.student_number}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDeleteSubmission}
              disabled={isDeleting || isAutomarking}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-red-400 border border-red-500/20 hover:bg-red-500/10 hover:border-red-500/40 transition-all disabled:opacity-40"
            >
              {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Delete
            </button>
            <button
              onClick={handleAutomark}
              disabled={isAutomarking || isSaving}
              className="flex items-center gap-2 bg-purple-500/10 text-purple-400 border border-purple-500/20 px-4 py-2 rounded-lg font-bold text-sm hover:bg-purple-500/20 hover:border-purple-500/40 transition-all shadow-[0_0_16px_rgba(168,85,247,0.1)] disabled:opacity-50"
            >
              {isAutomarking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Automark with AI
            </button>
            <button
              onClick={handleGenerateFocusReport}
              disabled={isGeneratingReport || !submission.graded || isAutomarking}
              className="flex items-center gap-2 bg-blue-500/10 text-blue-400 border border-blue-500/20 px-4 py-2 rounded-lg font-bold text-sm hover:bg-blue-500/20 hover:border-blue-500/40 transition-all shadow-[0_0_16px_rgba(59,130,246,0.1)] disabled:opacity-50"
            >
              {isGeneratingReport ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              Focus Report
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || isAutomarking}
              className="flex items-center gap-2 bg-[#00E5FF] text-[#0D1117] px-4 py-2 rounded-lg font-bold text-sm hover:bg-[#00E5FF]/90 transition-all disabled:opacity-50 shadow-[0_0_16px_rgba(0,229,255,0.3)]"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Marks
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">

        {/* ── Score Hero Panel ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {/* Live score */}
          <div className="md:col-span-1 relative overflow-hidden bg-gradient-to-br from-[#00E5FF]/10 to-[#00E5FF]/5 border border-[#00E5FF]/20 rounded-2xl p-6">
            <div className="absolute top-0 right-0 w-24 h-24 bg-[#00E5FF]/5 rounded-full -translate-y-8 translate-x-8" />
            <p className="text-xs text-white/40 uppercase tracking-[0.2em] font-bold mb-1">Live Score</p>
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-black text-[#00E5FF] tabular-nums">{liveScore.toFixed(1)}</span>
              <span className="text-white/30 text-xl font-medium">/ {submission.total_marks}</span>
            </div>
            <div className="mt-3 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${isPassed ? 'bg-green-400' : 'bg-orange-400'}`}
                style={{ width: `${Math.min(100, percentage)}%` }}
              />
            </div>
            <p className={`text-sm font-bold mt-2 ${isPassed ? 'text-green-400' : 'text-orange-400'}`}>
              {percentage.toFixed(1)}% — {isPassed ? 'Pass' : 'Fail'}
            </p>
          </div>

          {/* Violations */}
          <div className={`bg-white/[0.03] border rounded-2xl p-6 flex flex-col justify-between ${violationCount === 0 ? 'border-white/[0.06]' : violationCount >= 3 ? 'border-red-500/30 bg-red-500/[0.04]' : 'border-orange-500/30 bg-orange-500/[0.04]'
            }`}>
            <p className="text-xs text-white/40 uppercase tracking-[0.2em] font-bold mb-3">Security</p>
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${violationCount === 0 ? 'bg-green-500/10 text-green-400' :
                violationCount >= 3 ? 'bg-red-500/10 text-red-400' : 'bg-orange-500/10 text-orange-400'
                }`}>
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <p className={`text-2xl font-black ${violationCount === 0 ? 'text-green-400' : violationCount >= 3 ? 'text-red-400' : 'text-orange-400'
                  }`}>{violationCount}</p>
                <p className="text-xs text-white/30 font-medium">Violation{violationCount !== 1 ? 's' : ''}</p>
              </div>
            </div>
          </div>

          {/* Status */}
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 flex flex-col justify-between">
            <p className="text-xs text-white/40 uppercase tracking-[0.2em] font-bold mb-3">Marking Status</p>
            <div>
              {submission.is_manual ? (
                <span className="inline-flex items-center gap-2 text-[#00E5FF] font-bold">
                  <ShieldCheck className="w-5 h-5" />
                  Lecturer Marked
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 text-green-400 font-bold">
                  <CheckCircle2 className="w-5 h-5" />
                  Auto-Graded
                </span>
              )}
              {(submission.marked_by_name || submission.marked_by_email) && (
                <p className="text-[10px] text-white/30 mt-2 font-medium italic">
                  By: {submission.marked_by_name || submission.marked_by_email}
                </p>
              )}
              {submission.submitted_at && (
                <p className="text-[10px] text-white/20 mt-1 flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />
                  {new Date(submission.submitted_at).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── Violation Banner ── */}
        {isViolation && (
          <div className="mb-8 bg-red-500/10 border border-red-500/30 rounded-2xl p-5 flex items-start gap-4">
            <div className="w-10 h-10 bg-red-500/20 rounded-xl flex items-center justify-center text-red-400 shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-red-300 mb-1">Auto-submitted due to Security Violations</h3>
              <p className="text-sm text-red-400/80 leading-relaxed">
                {submission.marking_details.violation?.feedback || 'Exam was automatically submitted after exceeding the allowed violations.'}
              </p>
              <p className="text-xs text-red-400/50 mt-2">You can manually adjust marks below to override the automatic zero.</p>
            </div>
          </div>
        )}

        {/* ── Question Cards ── */}
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs text-white/30 uppercase tracking-[0.2em] font-bold flex items-center gap-2">
              <BookOpen className="w-3.5 h-3.5" />
              Questions ({questions.length})
            </h2>
            <div className="text-xs text-white/20 font-mono">
              {questions.filter(q => (overrides[q.id] ?? submission.marking_details?.[q.id]?.awarded_marks ?? 0) > 0).length} / {questions.length} marked
            </div>
          </div>

          {questions.map((q, index) => {
            const detail = submission.marking_details?.[q.id] || { awarded_marks: 0, feedback: 'Not yet marked.' };
            const studentAnswer = submission.answers?.[q.id] || '';
            const awarded = overrides[q.id] ?? detail.awarded_marks;
            const currentFeedback = feedbackOverrides[q.id] ?? detail.feedback;
            const isModified = (overrides[q.id] !== undefined && overrides[q.id] !== detail.awarded_marks) || (feedbackOverrides[q.id] !== undefined && feedbackOverrides[q.id] !== detail.feedback);
            const isCollapsed = collapsedQuestions.has(q.id);
            const qPct = q.marks > 0 ? (awarded / q.marks) * 100 : 0;
            const isMCQ = q.type === 'mcq';
            const isCorrect = isMCQ && studentAnswer.trim().toUpperCase() === q.correct_answer?.trim().toUpperCase();

            return (
              <div
                key={q.id}
                className={`rounded-2xl border overflow-hidden transition-all duration-200 ${isModified ? 'border-[#00E5FF]/30 shadow-[0_0_20px_rgba(0,229,255,0.05)]' : 'border-white/[0.06]'
                  } bg-white/[0.02]`}
              >
                {/* Card Header */}
                <div
                  className="flex items-start justify-between px-6 py-4 cursor-pointer hover:bg-white/[0.02] transition-colors"
                  onClick={() => toggleCollapse(q.id)}
                >
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className={`w-8 h-8 rounded-lg font-black text-xs flex items-center justify-center shrink-0 mt-0.5 ${qPct === 100 ? 'bg-green-500/20 text-green-400' :
                      qPct >= 50 ? 'bg-[#00E5FF]/15 text-[#00E5FF]' :
                        awarded > 0 ? 'bg-orange-500/20 text-orange-400' :
                          'bg-white/5 text-white/30'
                      }`}>
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-white/90 text-sm leading-snug whitespace-normal break-words">{q.question_text}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-white/30 uppercase tracking-widest font-bold">{q.type}</span>
                        {isMCQ && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isCorrect ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                            {isCorrect ? '✓ Correct' : '✗ Wrong'}
                          </span>
                        )}
                        {isModified && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#00E5FF]/10 text-[#00E5FF]">
                            Modified
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Marks input + collapse */}
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    {/* Quick mark buttons */}
                    <div className="hidden md:flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleZeroMark(q.id); }}
                        className="w-7 h-7 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all text-xs font-bold flex items-center justify-center"
                        title="Award 0"
                      >0</button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleFullMark(q.id, q.marks); }}
                        className="w-7 h-7 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-all text-xs font-bold flex items-center justify-center"
                        title="Award full marks"
                      >
                        <Zap className="w-3 h-3" />
                      </button>
                    </div>
                    <div
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-xl border text-sm font-bold ${isModified ? 'bg-[#00E5FF]/10 border-[#00E5FF]/30 text-[#00E5FF]' : 'bg-white/5 border-white/10 text-white'
                        }`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="number"
                        value={awarded}
                        onChange={(e) => handleOverrideChange(q.id, parseFloat(e.target.value) || 0, q.marks)}
                        className="w-10 bg-transparent outline-none text-right tabular-nums"
                        step="0.5"
                        min="0"
                        max={q.marks}
                      />
                      <span className="text-white/30 font-normal">/ {q.marks}</span>
                    </div>
                    {isCollapsed ? <ChevronDown className="w-4 h-4 text-white/30" /> : <ChevronUp className="w-4 h-4 text-white/30" />}
                  </div>
                </div>

                {/* Score bar */}
                <div className="h-0.5 bg-white/5 mx-6">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${qPct === 100 ? 'bg-green-400' : qPct >= 50 ? 'bg-[#00E5FF]' : qPct > 0 ? 'bg-orange-400' : 'bg-white/10'
                      }`}
                    style={{ width: `${Math.min(100, qPct)}%` }}
                  />
                </div>

                {/* Expandable body */}
                {!isCollapsed && (
                  <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Left: answers */}
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-[10px] font-bold text-white/30 uppercase tracking-[0.15em] mb-2 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-white/20 inline-block" />
                          Student Answer
                        </h4>
                        {studentAnswer ? (
                          <pre className="p-4 bg-white/[0.03] border border-white/[0.06] rounded-xl font-mono text-sm text-white/70 whitespace-pre-wrap break-words leading-relaxed overflow-auto max-h-52">
                            {studentAnswer}
                          </pre>
                        ) : (
                          <div className="p-4 bg-white/[0.02] border border-white/[0.04] rounded-xl text-white/20 italic text-sm">
                            No answer provided.
                          </div>
                        )}
                      </div>

                      <div>
                        <h4 className="text-[10px] font-bold text-[#00E5FF]/40 uppercase tracking-[0.15em] mb-2 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#00E5FF]/30 inline-block" />
                          {isMCQ ? 'Correct Answer' : 'Answer'}
                        </h4>
                        <pre className="p-4 bg-[#00E5FF]/[0.04] border border-[#00E5FF]/10 rounded-xl font-mono text-sm text-[#00E5FF]/80 whitespace-pre-wrap break-words leading-relaxed overflow-auto max-h-52">
                          {q.correct_answer || '(No answer provided)'}
                        </pre>
                      </div>
                    </div>

                    {/* Right: marking feedback + quick actions */}
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-[10px] font-bold text-white/30 uppercase tracking-[0.15em] mb-2 flex items-center gap-1.5">
                          <Info className="w-2.5 h-2.5" />
                          Marking Feedback
                        </h4>
                        <div className={`mt-2 rounded-xl border text-sm leading-relaxed overflow-hidden transition-all ${isViolation ? 'border-red-500/20 text-red-300/80 bg-red-500/5'
                          : qPct === 100 ? 'border-green-500/20 text-green-300 bg-green-500/5'
                            : qPct >= 50 ? 'border-[#00E5FF]/15 text-[#00E5FF]/80 bg-[#00E5FF]/5'
                              : 'border-orange-500/20 text-orange-300/80 bg-orange-500/5'
                          }`}>
                          {isViolation && !currentFeedback ? (
                            <div className="p-4 bg-transparent border-none outline-none resize-none w-full text-sm">
                              Marking suppressed due to violation. Adjust 'Awarded' or click 'Automark with AI' to override manually.
                            </div>
                          ) : (
                            <textarea
                              value={currentFeedback}
                              onChange={(e) => handleFeedbackChange(q.id, e.target.value)}
                              className="p-4 bg-transparent border-none outline-none resize-y min-h-[5rem] w-full text-sm leading-relaxed"
                              placeholder="Enter feedback for the student..."
                            />
                          )}
                        </div>
                      </div>

                      {/* Quick mark row */}
                      <div>
                        <h4 className="text-[10px] font-bold text-white/30 uppercase tracking-[0.15em] mb-2">Quick Mark</h4>
                        <div className="flex flex-wrap gap-2">
                          {[0, 0.5, 1].concat(
                            q.marks > 1 ? Array.from({ length: Math.min(q.marks - 1, 5) }, (_, i) => Math.round((q.marks * (i + 1)) / 6 * 2) / 2) : []
                          ).concat([q.marks]).filter((v, i, arr) => arr.indexOf(v) === i && v <= q.marks).sort((a, b) => a - b).map(val => (
                            <button
                              key={val}
                              onClick={() => setOverrides({ ...overrides, [q.id]: val })}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${awarded === val
                                ? 'bg-[#00E5FF]/20 border-[#00E5FF]/40 text-[#00E5FF]'
                                : 'bg-white/[0.03] border-white/[0.06] text-white/40 hover:border-white/20 hover:text-white/70'
                                }`}
                            >
                              {val}
                            </button>
                          ))}
                        </div>
                      </div>

                      {isModified && (
                        <button
                          onClick={() => {
                            const freshOver = { ...overrides };
                            const freshFeed = { ...feedbackOverrides };
                            delete freshOver[q.id];
                            delete freshFeed[q.id];
                            setOverrides(freshOver);
                            setFeedbackOverrides(freshFeed);
                          }}
                          className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Revert to original ({detail.awarded_marks})
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Floating Save Summary ── */}
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50">
          <div className="bg-[#0D1117]/90 backdrop-blur-xl border border-white/10 rounded-2xl px-6 py-3 flex items-center gap-6 shadow-2xl shadow-black/50">
            <div className="flex items-center gap-2">
              <Award className="w-4 h-4 text-[#00E5FF]" />
              <span className="text-sm font-bold text-white">
                {liveScore.toFixed(1)} / {submission.total_marks}
              </span>
              <span className={`text-sm font-bold ${isPassed ? 'text-green-400' : 'text-orange-400'}`}>
                ({percentage.toFixed(0)}%)
              </span>
            </div>
            <div className="w-px h-5 bg-white/10" />
            <button
              onClick={handleAutomark}
              disabled={isAutomarking || isSaving}
              className="flex items-center gap-2 bg-purple-500/10 text-purple-400 border border-purple-500/20 px-4 py-2 rounded-lg font-bold text-sm hover:bg-purple-500/20 hover:border-purple-500/40 transition-all shadow-[0_0_16px_rgba(168,85,247,0.1)] disabled:opacity-50"
            >
              {isAutomarking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Automark with AI
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || isAutomarking}
              className="flex items-center gap-2 bg-[#00E5FF] text-[#0D1117] px-5 py-2 rounded-xl font-bold text-sm hover:bg-[#00E5FF]/90 transition-all disabled:opacity-50 shadow-[0_0_16px_rgba(0,229,255,0.3)]"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save All Marks
            </button>
          </div>
        </div>
      </main>

      {/* Bottom padding for floating bar */}
      <div className="h-28" />
    </div>
  );
};

export default SubmissionReview;
