import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  Trophy, CheckCircle2, AlertTriangle, XCircle,
  ArrowLeft, GraduationCap, ShieldCheck,
  MessageSquare, Target, ChevronDown, ChevronUp,
  Award, BookOpen, FileText, Loader2
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useNotification } from '../components/NotificationProvider';

const StudentResults: React.FC = () => {
  const { submissionId } = useParams();
  const [submission, setSubmission] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedQuestions, setExpandedQuestions] = useState<Set<string>>(new Set());
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const { showToast } = useNotification();
  const navigate = useNavigate();

  useEffect(() => {
    const fetchContent = async () => {
      const { data: sub } = await supabase
        .from('submissions')
        .select('*, exams(title)')
        .eq('id', submissionId)
        .single();

      if (sub && sub.graded) {
        setSubmission(sub);
        const { data: qs } = await supabase
          .from('questions')
          .select('*')
          .eq('exam_id', sub.exam_id)
          .order('order_index');
        setQuestions(qs || []);
        setExpandedQuestions(new Set((qs || []).map((q: any) => q.id))); // Show in full by default
        setIsLoading(false);
      } else {
        setTimeout(fetchContent, 3000);
      }
    };
    fetchContent();
  }, [submissionId]);

  const toggleExpand = (id: string) => {
    setExpandedQuestions(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

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
      doc.text('DETAILED ACADEMIC PERFORMANCE ANALYSIS', 20, 32);
      
      // -- Student info --
      doc.setTextColor(60, 60, 60);
      doc.setFontSize(10);
      doc.text(`EXAM: ${submission.exams?.title || 'Examination'}`, 20, 50);
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

      doc.save(`Focus_Report_${submission.exams?.title || 'Exam'}.pdf`);
      showToast('Focus Report generated successfully!', 'success');
    } catch (err: any) {
      console.error('Error generating focus report:', err);
      showToast(err.message || 'Failed to generate report.', 'error');
    } finally {
      setIsGeneratingReport(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-primary flex flex-col items-center justify-center p-6 text-center">
        <div className="relative mb-8">
          <div className="w-24 h-24 border-4 border-accent/20 border-t-accent rounded-full animate-spin" />
          <GraduationCap className="w-10 h-10 text-accent absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
        </div>
        <h2 className="text-2xl font-bold mb-2 text-white">Marking in Progress</h2>
        <p className="text-white/40 max-w-xs text-sm">Your answers are being reviewed. This usually takes less than a minute.</p>
      </div>
    );
  }

  const percentage = submission.total_marks > 0 ? (submission.score / submission.total_marks) * 100 : 0;
  const isPassed = percentage >= 50;

  // Compute color thresholds
  const gradeColor = percentage >= 75 ? 'text-green-400' : percentage >= 50 ? 'text-[#00E5FF]' : percentage >= 35 ? 'text-orange-400' : 'text-red-400';
  const gradeBg = percentage >= 75 ? 'from-green-500/20 to-green-500/5 border-green-500/20' : percentage >= 50 ? 'from-[#00E5FF]/20 to-[#00E5FF]/5 border-[#00E5FF]/20' : percentage >= 35 ? 'from-orange-500/20 to-orange-500/5 border-orange-500/20' : 'from-red-500/20 to-red-500/5 border-red-500/20';
  const gradeLabel = percentage >= 75 ? 'Distinction' : percentage >= 60 ? 'Merit' : percentage >= 50 ? 'Pass' : percentage >= 35 ? 'Below Pass' : 'Fail';
  const GradeIcon = percentage >= 50 ? Trophy : percentage >= 35 ? AlertTriangle : XCircle;

  const totalAwarded = questions.reduce((acc, q) => acc + (submission.marking_details?.[q.id]?.awarded_marks ?? 0), 0);

  return (
    <div className="min-h-screen bg-[#0A1024] text-white font-outfit pb-20">
      {/* Dynamic Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-accent/10 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '2s' }} />
      </div>
      {/* ── Top Nav ── */}
      <header className="sticky top-0 z-[100] bg-[#0A1024]/60 backdrop-blur-3xl border-b border-white/5 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 text-white/40 hover:text-white transition-colors group text-sm"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            Dashboard
          </button>
          <div className="flex items-center gap-2 text-white/30 text-xs font-mono uppercase tracking-widest">
            <BookOpen className="w-3.5 h-3.5" />
            {submission.exams?.title}
          </div>
          <div className="w-20" />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">

        {/* ── Hero Score Card ── */}
        <div className={`relative overflow-hidden rounded-[2.5rem] border bg-gradient-to-br ${gradeBg} p-12 mb-12 text-center shadow-2xl`}>
          {/* Decorative glow */}
          <div className="absolute inset-0 pointer-events-none">
            <div className={`absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full blur-3xl opacity-20 ${
              isPassed ? 'bg-green-400' : 'bg-orange-400'
            }`} />
          </div>

          <div className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-5 ${
            percentage >= 75 ? 'bg-green-500/20 text-green-400' :
            percentage >= 50 ? 'bg-[#00E5FF]/15 text-[#00E5FF]' :
            'bg-orange-500/20 text-orange-400'
          }`}>
            <GradeIcon className="w-8 h-8" />
          </div>

          <p className="text-white/40 text-xs uppercase tracking-[0.25em] font-bold mb-2">Your Result</p>
          <div className={`text-7xl font-black tabular-nums mb-1 ${gradeColor}`}>
            {percentage.toFixed(0)}%
          </div>
          <p className="text-white/30 text-sm mb-4">{submission.score} / {submission.total_marks} marks</p>

          <span className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-bold border ${
            percentage >= 75 ? 'bg-green-500/15 border-green-500/30 text-green-400' :
            percentage >= 50 ? 'bg-[#00E5FF]/10 border-[#00E5FF]/30 text-[#00E5FF]' :
            percentage >= 35 ? 'bg-orange-500/10 border-orange-500/30 text-orange-400' :
            'bg-red-500/10 border-red-500/30 text-red-400'
          }`}>
            {isPassed ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {gradeLabel}
          </span>

          {/* Marking status */}
          <div className="mt-6 pt-5 border-t border-white/10 flex items-center justify-center gap-4 text-sm">
            <span className="text-green-400 font-bold flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" /> Lecturer Marked
            </span>
            {(submission.marked_by_name || submission.marked_by_email) && (
              <span className="text-white/30 text-xs italic">
                by {submission.marked_by_name || submission.marked_by_email}
              </span>
            )}
          </div>

          {/* Focus Report Button */}
          <div className="mt-8 flex justify-center">
            <button
              onClick={handleGenerateFocusReport}
              disabled={isGeneratingReport}
              className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold text-sm transition-all shadow-lg ${
                isPassed 
                ? 'bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20' 
                : 'bg-[#00E5FF]/10 text-[#00E5FF] border border-[#00E5FF]/20 hover:bg-[#00E5FF]/20'
              } disabled:opacity-50`}
            >
              {isGeneratingReport ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              Pull Focus Report (PDF)
            </button>
          </div>
        </div>

        {/* ── Per-Question Breakdown ── */}
        {questions.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs text-white/40 uppercase tracking-[0.2em] font-bold flex items-center gap-2">
                <Award className="w-3.5 h-3.5" />
                Question Breakdown
              </h2>
              <span className="text-xs text-white/20 font-mono">{questions.length} questions</span>
            </div>

            <div className="space-y-3">
              {questions.map((q) => {
                const detail = submission.marking_details?.[q.id];
                const studentAnswer = submission.answers?.[q.id] || '';
                const awarded = detail?.awarded_marks ?? 0;
                const pct = q.marks > 0 ? (awarded / q.marks) * 100 : 0;
                const isExpanded = expandedQuestions.has(q.id);

                const barColor = pct === 100 ? 'bg-green-400' : pct >= 50 ? 'bg-[#00E5FF]' : pct > 0 ? 'bg-orange-400' : 'bg-white/10';
                const dotColor = pct === 100 ? 'bg-green-400' : pct >= 50 ? 'bg-[#00E5FF]' : pct > 0 ? 'bg-orange-400' : 'bg-white/20';
                const scoreColor = pct === 100 ? 'text-green-400' : pct >= 50 ? 'text-[#00E5FF]' : pct > 0 ? 'text-orange-400' : 'text-white/30';

                return (
                  <div
                    key={q.id}
                    className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden"
                  >
                    {/* Header row */}
                    <button
                      onClick={() => toggleExpand(q.id)}
                      className="w-full flex items-start gap-4 px-5 py-4 hover:bg-white/[0.02] transition-colors text-left"
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 mt-2 ${dotColor}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white/80 whitespace-normal break-words">{q.question_text}</p>
                        {/* Score bar */}
                        <div className="flex items-center gap-2 mt-1.5">
                          <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${barColor} transition-all duration-500`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[10px] text-white/25 uppercase tracking-wider font-bold">{pct.toFixed(0)}%</span>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className={`text-base font-black tabular-nums ${scoreColor}`}>{awarded}</span>
                        <span className="text-white/20 text-sm font-normal"> / {q.marks}</span>
                      </div>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-white/20 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-white/20 shrink-0" />}
                    </button>

                    {/* Expanded body */}
                    {isExpanded && (
                      <div className="border-t border-white/[0.05] px-5 py-4 space-y-4">
                        {/* Your answer */}
                        <div>
                          <p className="text-[10px] text-white/30 uppercase tracking-[0.15em] font-bold mb-1.5 flex items-center gap-1">
                            <Target className="w-2.5 h-2.5" /> Your Answer
                          </p>
                          {studentAnswer ? (
                            <pre className="p-3 bg-white/[0.03] border border-white/[0.05] rounded-xl font-mono text-xs text-white/60 whitespace-pre-wrap break-words leading-relaxed overflow-auto max-h-48">
                              {studentAnswer}
                            </pre>
                          ) : (
                            <p className="text-xs text-white/20 italic p-3 bg-white/[0.02] rounded-xl border border-white/[0.04]">No answer provided.</p>
                          )}
                        </div>

                        {/* Correct answer */}
                        {q.correct_answer && (
                          <div>
                            <p className="text-[10px] text-green-400/50 uppercase tracking-[0.15em] font-bold mb-1.5 flex items-center gap-1">
                              <CheckCircle2 className="w-2.5 h-2.5" /> Answer
                            </p>
                            <pre className="p-3 bg-green-500/[0.04] border border-green-500/15 rounded-xl font-mono text-xs text-green-300/70 whitespace-pre-wrap break-words leading-relaxed overflow-auto max-h-48">
                              {q.correct_answer}
                            </pre>
                          </div>
                        )}

                        {/* Feedback */}
                        {detail?.feedback && (
                          <div className={`p-3 rounded-xl border text-xs leading-relaxed ${
                            pct === 100 ? 'bg-green-500/5 border-green-500/15 text-green-300/80'
                            : pct >= 50 ? 'bg-[#00E5FF]/5 border-[#00E5FF]/15 text-[#00E5FF]/70'
                            : 'bg-orange-500/5 border-orange-500/15 text-orange-300/70'
                          }`}>
                            <p className="flex items-center gap-1 text-[9px] uppercase tracking-widest font-bold opacity-60 mb-1">
                              <MessageSquare className="w-2.5 h-2.5" /> Feedback
                            </p>
                            {detail.feedback}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Summary footer */}
            <div className="mt-6 flex items-center justify-between px-4 py-3 bg-white/[0.02] border border-white/[0.05] rounded-xl">
              <span className="text-xs text-white/30 font-bold uppercase tracking-widest">Total Awarded</span>
              <span className={`text-lg font-black tabular-nums ${gradeColor}`}>
                {totalAwarded} <span className="text-white/20 font-normal text-sm">/ {submission.total_marks}</span>
              </span>
            </div>
          </section>
        )}

        {/* ── Return Button ── */}
        <button
          onClick={() => navigate('/dashboard')}
          className="mt-8 w-full bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-3 transition-all group"
        >
          Return to Dashboard
          <ArrowLeft className="w-4 h-4 rotate-180 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </main>
    </div>
  );
};

export default StudentResults;
