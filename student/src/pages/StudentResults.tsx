import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@shared/lib/apiClient';
import {
  Trophy, CheckCircle2, AlertTriangle, XCircle,
  ArrowLeft, ShieldCheck,
  MessageSquare, Target, ChevronDown, ChevronUp,
  Award, BookOpen, FileText, Loader2
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useNotification } from '@shared/components/NotificationProvider';

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
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-6)', textAlign: 'center', background: 'var(--color-bg)' }}>
        <Loader2 size={40} className="spin" style={{ color: 'var(--color-accent)', marginBottom: 'var(--space-4)' }} />
        <h2 style={{ marginBottom: 'var(--space-2)' }}>Marking in Progress</h2>
        <p className="text-muted" style={{ maxWidth: 320, fontSize: 14 }}>Your answers are being reviewed. This usually takes less than a minute.</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } } .spin { animation: spin 1s linear infinite; }`}</style>
      </div>
    );
  }

  const percentage = submission.total_marks > 0 ? (submission.score / submission.total_marks) * 100 : 0;
  const isPassed = percentage >= 50;

  // Compute grade presentation (thresholds unchanged, only the styling tokens differ)
  const gradeLabel = percentage >= 75 ? 'Distinction' : percentage >= 60 ? 'Merit' : percentage >= 50 ? 'Pass' : percentage >= 35 ? 'Below Pass' : 'Fail';
  const GradeIcon = percentage >= 50 ? Trophy : percentage >= 35 ? AlertTriangle : XCircle;
  const gradeTagClass = percentage >= 75 ? 'tag-accent' : percentage >= 50 ? 'tag-accent-2' : percentage >= 35 ? 'tag-outline' : 'tag-neutral';
  const gradeColor = isPassed ? 'var(--color-accent)' : 'var(--color-text)';

  const totalAwarded = questions.reduce((acc, q) => acc + (submission.marking_details?.[q.id]?.awarded_marks ?? 0), 0);

  const markedBy = submission.marked_by_name || submission.marked_by_email;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', paddingBottom: 'var(--space-8)' }}>
      {/* ── Top Nav ── */}
      <nav className="nav" style={{ position: 'sticky', top: 0, zIndex: 100, background: 'var(--color-bg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', width: '100%', maxWidth: 880, margin: '0 auto' }}>
          <button
            onClick={() => navigate('/dashboard')}
            className="btn btn-ghost"
            style={{ paddingInline: 0 }}
          >
            <ArrowLeft size={16} />
            Dashboard
          </button>
          <div className="text-muted" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            <BookOpen size={14} />
            {submission.exams?.title}
          </div>
        </div>
      </nav>

      <main style={{ maxWidth: 880, margin: '0 auto', padding: '0 var(--space-6)', paddingTop: 'var(--space-8)' }}>

        {/* ── Header ── */}
        <span className="tag tag-neutral">{submission.exams?.title || 'Examination'}</span>
        <h1 style={{ marginTop: 'var(--space-2)' }}>Results</h1>
        <p className="text-muted">
          Submitted {submission.submitted_at ? new Date(submission.submitted_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
          {markedBy && <> &middot; Marked by {markedBy}</>}
        </p>

        {/* ── Stat Cards ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-4)', margin: 'var(--space-6) 0' }}>
          <div className="card elev-sm">
            <span className="card-kicker">Score</span>
            <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 40 }}>
              {percentage.toFixed(0)}<span style={{ color: 'var(--color-accent)', fontSize: 22 }}>%</span>
            </span>
            <span className="card-meta">{submission.score} / {submission.total_marks} marks</span>
          </div>
          <div className="card elev-sm">
            <span className="card-kicker">Grade</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 24, color: gradeColor }}>
              <GradeIcon size={22} />
              {gradeLabel}
            </span>
            <span className="card-meta">{isPassed ? 'Passing grade' : 'Below passing grade'}</span>
          </div>
          <div className="card elev-sm">
            <span className="card-kicker">Marking</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 18 }}>
              <ShieldCheck size={18} style={{ color: 'var(--color-accent)' }} />
              Lecturer Marked
            </span>
            <span className="card-meta">{markedBy || 'Reviewed'}</span>
          </div>
        </div>

        <span className={`tag ${gradeTagClass}`} style={{ marginBottom: 'var(--space-4)', display: 'inline-flex', gap: 6 }}>
          {isPassed ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
          {gradeLabel}
        </span>

        {/* ── Focus Report Button ── */}
        <div style={{ margin: 'var(--space-4) 0 var(--space-6)' }}>
          <button
            onClick={handleGenerateFocusReport}
            disabled={isGeneratingReport}
            className="btn btn-primary"
          >
            {isGeneratingReport ? <Loader2 size={16} className="spin" /> : <FileText size={16} />}
            Pull Focus Report (PDF)
          </button>
        </div>

        {/* ── Per-Question Breakdown ── */}
        {questions.length > 0 && (
          <section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Award size={16} />
                Question breakdown
              </h3>
              <span className="text-muted" style={{ fontSize: 12 }}>{questions.length} questions</span>
            </div>

            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Question</th>
                  <th>Type</th>
                  <th>Marks</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {questions.map((q, idx) => {
                  const detail = submission.marking_details?.[q.id];
                  const studentAnswer = submission.answers?.[q.id] || '';
                  const awarded = detail?.awarded_marks ?? 0;
                  const isExpanded = expandedQuestions.has(q.id);
                  const typeLabel = q.type === 'mcq' ? 'MCQ' : 'Structured';
                  const typeTagClass = q.type === 'mcq' ? 'tag-neutral' : 'tag-accent';

                  return (
                    <React.Fragment key={q.id}>
                      <tr onClick={() => toggleExpand(q.id)} style={{ cursor: 'pointer' }}>
                        <td className="text-muted">{idx + 1}</td>
                        <td style={{ maxWidth: 360 }}>{q.question_text}</td>
                        <td><span className={`tag ${typeTagClass}`}>{typeLabel}</span></td>
                        <td style={{ fontWeight: 800 }}>{awarded} / {q.marks}</td>
                        <td style={{ textAlign: 'right' }}>
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={5} style={{ background: 'var(--color-surface)' }}>
                            <div style={{ padding: 'var(--space-3) var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                              {/* Your answer */}
                              <div>
                                <p className="card-kicker" style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                                  <Target size={11} /> Your Answer
                                </p>
                                {studentAnswer ? (
                                  <pre style={{ margin: 0, padding: 'var(--space-3)', background: 'var(--color-bg)', border: '1px solid var(--color-divider)', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5, overflow: 'auto', maxHeight: 192 }}>
                                    {studentAnswer}
                                  </pre>
                                ) : (
                                  <p className="text-muted" style={{ fontStyle: 'italic', fontSize: 12, padding: 'var(--space-3)', background: 'var(--color-bg)', border: '1px solid var(--color-divider)', margin: 0 }}>No answer provided.</p>
                                )}
                              </div>

                              {/* MCQ Options Display */}
                              {q.type === 'mcq' && q.options && q.options.length > 0 && (
                                <div>
                                  <p className="card-kicker" style={{ marginBottom: 6 }}>Options</p>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {q.options.map((opt: string, optIdx: number) => {
                                      const letter = String.fromCharCode(65 + optIdx);
                                      const isStudentChoice = (studentAnswer || '').trim().toUpperCase() === letter;
                                      const isCorrectChoice = (q.correct_answer || '').trim().toUpperCase() === letter;

                                      let optTagClass = 'tag-neutral';
                                      if (isCorrectChoice) optTagClass = 'tag-accent';
                                      else if (isStudentChoice) optTagClass = 'tag-outline';

                                      return (
                                        <div key={optIdx} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--color-divider)' }}>
                                          <span className={`tag ${optTagClass}`} style={{ minWidth: 20, justifyContent: 'center', fontWeight: 800 }}>{letter}</span>
                                          <span style={{ wordBreak: 'break-word', flex: 1 }}>{opt}</span>
                                          {isStudentChoice && isCorrectChoice && <CheckCircle2 size={14} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />}
                                          {isStudentChoice && !isCorrectChoice && <XCircle size={14} className="text-muted" style={{ flexShrink: 0 }} />}
                                          {!isStudentChoice && isCorrectChoice && <CheckCircle2 size={14} style={{ color: 'var(--color-accent)', opacity: 0.5, flexShrink: 0 }} />}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* Correct answer (for structured questions only) */}
                              {q.type !== 'mcq' && q.correct_answer && (
                                <div>
                                  <p className="card-kicker" style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                                    <CheckCircle2 size={11} /> Model Answer
                                  </p>
                                  <pre style={{ margin: 0, padding: 'var(--space-3)', background: 'var(--color-bg)', border: '1px solid var(--color-accent)', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5, overflow: 'auto', maxHeight: 192 }}>
                                    {q.correct_answer}
                                  </pre>
                                </div>
                              )}

                              {/* Feedback */}
                              {detail?.feedback && (
                                <div style={{ padding: 'var(--space-3)', borderLeft: '2px solid var(--color-accent)', background: 'var(--color-bg)', fontSize: 13, lineHeight: 1.5 }}>
                                  <p className="card-kicker" style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                                    <MessageSquare size={11} /> Feedback
                                  </p>
                                  {detail.feedback}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>

            {/* Summary footer */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-3) var(--space-2)', borderTop: '2px solid var(--color-divider)' }}>
              <span className="text-muted" style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Total Awarded</span>
              <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 18, color: gradeColor }}>
                {totalAwarded} <span className="text-muted" style={{ fontWeight: 400, fontSize: 13 }}>/ {submission.total_marks}</span>
              </span>
            </div>
          </section>
        )}

        <div className="hr" />

        {/* ── Return Button ── */}
        <button
          onClick={() => navigate('/dashboard')}
          className="btn btn-secondary btn-block"
          style={{ justifyContent: 'center', padding: 'var(--space-3)' }}
        >
          Return to Dashboard
          <ArrowLeft size={16} style={{ transform: 'rotate(180deg)' }} />
        </button>
      </main>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } } .spin { animation: spin 1s linear infinite; }`}</style>
    </div>
  );
};

export default StudentResults;
