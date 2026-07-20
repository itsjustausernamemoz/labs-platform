import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@shared/lib/apiClient';
import {
  Calendar, Search, FileEdit, Download, Trash2,
  ArrowLeft, Users, Trophy, Loader2, Sparkles, RotateCcw
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { useNotification } from '@shared/components/NotificationProvider';

interface Submission {
  id: string;
  student_id: string;
  student: { student_number: string };
  score: number;
  total_marks: number;
  graded: boolean;
  is_manual: boolean;
  status?: 'draft' | 'submitted';
  attempt_number?: number;
  submitted_at: string;
  violations_count?: number;
  marked_by_email?: string;
  marked_by_name?: string;
}

const Results: React.FC = () => {
  const { examId } = useParams();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [trashSubmissions, setTrashSubmissions] = useState<Submission[]>([]);
  const [activeTab, setActiveTab] = useState<'submissions' | 'students' | 'trash'>('submissions');
  const [examTitle, setExamTitle] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isGeneratingClassReport, setIsGeneratingClassReport] = useState(false);
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);
  const [sortOption, setSortOption] = useState<'status-pending' | 'status-graded' | 'score-highest' | 'score-lowest' | 'name-asc' | 'name-desc'>('status-pending');
  const navigate = useNavigate();
  const { showToast, showConfirm } = useNotification();

  const fetchResults = async () => {
    setIsRefreshing(true);
    try {
      // Fetch exam title
      const { data: exam } = await supabase
        .from('exams')
        .select('title')
        .eq('id', examId)
        .single();

      if (exam) setExamTitle(exam.title);

      // 1. Fetch Submissions
      let enriched: Submission[] = [];
      try {
        const { data: subs, error: subsError } = await supabase
          .from('submissions')
          .select(`
            id,
            student_id,
            score,
            total_marks,
            graded,
            is_manual,
            status,
            submitted_at,
            marked_by_email,
            marked_by_name,
            attempt_number,
            student:students(student_number)
          `)
          .eq('exam_id', examId);

        if (subsError) {
          console.warn('Primary submissions fetch failed (likely missing status column), trying fallback...', subsError);
          // Fallback without status column for backward compatibility
          const { data: fallbackSubs, error: fallbackError } = await supabase
            .from('submissions')
            .select(`
              id,
              student_id,
              score,
              total_marks,
              graded,
              is_manual,
              status,
              submitted_at,
              marked_by_email,
              marked_by_name,
              student:students(student_number)
            `)
            .eq('exam_id', examId);

          if (fallbackError) throw fallbackError;

          enriched = await Promise.all((fallbackSubs || []).map(async (sub: any) => {
            const { count } = await supabase
              .from('violations')
              .select('*', { count: 'exact', head: true })
              .eq('exam_id', examId)
              .eq('student_id', sub.student_id);

            return {
              ...sub,
              status: 'submitted', // Default if column is missing
              violations_count: count || 0
            };
          }));
        } else {
          enriched = await Promise.all((subs || []).map(async (sub: any) => {
            const { count } = await supabase
              .from('violations')
              .select('*', { count: 'exact', head: true })
              .eq('exam_id', examId)
              .eq('student_id', sub.student_id);

            return {
              ...sub,
              violations_count: count || 0
            };
          }));
        }
        setSubmissions(enriched || []);
      } catch (err) {
        console.error('Error fetching submissions:', err);
        showToast('Failed to fetch submissions. Please check your database migrations.', 'error');
      }

      // 2. Fetch All Enrolled Students (Independent of submissions)
      try {
        const { data: enrolls, error: enrollError } = await supabase
          .from('enrollments')
          .select(`
            id,
            student_id,
            enrolled_at,
            student:students(student_number)
          `)
          .eq('exam_id', examId);

        if (enrollError) throw enrollError;
        setEnrollments(enrolls || []);
      } catch (err) {
        console.error('Error fetching enrollments:', err);
      }

      // 3. Fetch Trash (Deleted Submissions)
      try {
        const { data: trash, error: trashError } = await supabase
          .from('deleted_submissions')
          .select(`
            id,
            student_id,
            score,
            total_marks,
            graded,
            is_manual,
            status,
            submitted_at,
            marked_by_email,
            marked_by_name,
            student:students(student_number)
          `)
          .eq('exam_id', examId);

        if (!trashError) {
          const enrichedTrash = (trash || []).map((t: any) => ({
            ...t,
            // Handle the case where student might be an array or null
            student: Array.isArray(t.student) ? t.student[0] : t.student,
            violations_count: 0
          }));
          setTrashSubmissions(enrichedTrash as any[]);
        }
      } catch (err) {
        console.error('Error fetching deleted submissions:', err);
      }

    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleGenerateClassFocusReport = async () => {
    if (!examId) return;
    setIsGeneratingClassReport(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-class-focus-report', {
        body: { examId }
      });

      if (error) throw error;

      // PDF Generation logic
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.width;

      // -- Header --
      doc.setFillColor(13, 17, 23); // Dark theme header
      doc.rect(0, 0, pageWidth, 45, 'F');

      doc.setTextColor(0, 229, 255);
      doc.setFontSize(24);
      doc.setFont('helvetica', 'bold');
      doc.text('CLASS FOCUS REPORT', 20, 25);

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(10);
      doc.text('AGGREGATE ACADEMIC PERFORMANCE ANALYSIS', 20, 32);

      // -- Exam info --
      doc.setTextColor(150, 150, 150);
      doc.setFontSize(9);
      doc.text(`EXAM: ${examTitle.toUpperCase()}`, 20, 55);
      doc.text(`DATE: ${new Date().toLocaleDateString()}`, pageWidth - 20, 55, { align: 'right' });
      doc.text(`TOTAL GRADED SUBMISSIONS: ${submissions.filter(s => s.graded).length}`, 20, 60);
      doc.text(`CLASS AVERAGE: ${averageScore}%`, pageWidth - 20, 60, { align: 'right' });

      doc.setDrawColor(230, 230, 230);
      doc.line(20, 65, pageWidth - 20, 65);

      // -- Overall Summary --
      let yPos = 80;
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('EXAM PERFORMANCE OVERVIEW', 20, yPos);

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      const distributionLines = doc.splitTextToSize(data.distribution_analysis || '', pageWidth - 40);
      if (distributionLines.length > 0) {
        doc.text(distributionLines, 20, yPos + 8);
        yPos += 15 + (distributionLines.length * 5);
      }

      const summaryLines = doc.splitTextToSize(data.overall_summary, pageWidth - 40);
      doc.text(summaryLines, 20, yPos);
      yPos += 10 + (summaryLines.length * 5);

      // -- Class SWOT Analysis --
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('PEDAGOGICAL SWOT ANALYSIS', 20, yPos);
      yPos += 10;

      autoTable(doc, {
        startY: yPos,
        head: [['CLASS STRENGTHS', 'CLASS WEAKNESSES']],
        body: [
          [data.swot.strengths.map((s: string) => `• ${s}`).join('\n\n'), data.swot.weaknesses.map((w: string) => `• ${w}`).join('\n\n')],
          [{ content: 'PEDAGOGICAL OPPORTUNITIES', styles: { fillColor: [232, 240, 255], fontStyle: 'bold' } }, { content: 'THREATS TO OUTCOMES', styles: { fillColor: [255, 248, 232], fontStyle: 'bold' } }],
          [data.swot.opportunities.map((o: string) => `• ${o}`).join('\n\n'), data.swot.threats.map((t: string) => `• ${t}`).join('\n\n')]
        ],
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 5, overflow: 'linebreak' },
        columnStyles: { 0: { cellWidth: (pageWidth - 40) / 2 }, 1: { cellWidth: (pageWidth - 40) / 2 } },
        margin: { left: 20, right: 20 }
      });

      yPos = (doc as any).lastAutoTable.finalY + 15;

      // -- Common Misconceptions --
      if (data.misconceptions && data.misconceptions.length > 0) {
        if (yPos > doc.internal.pageSize.height - 40) { doc.addPage(); yPos = 20; }
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('COMMON MISCONCEPTIONS & CORRECTIONS', 20, yPos);
        yPos += 8;

        autoTable(doc, {
          startY: yPos,
          head: [['The Misconception', 'Correction Strategy']],
          body: data.misconceptions.map((m: any) => [m.error, m.correction_strategy]),
          theme: 'striped',
          styles: { fontSize: 9 },
          margin: { left: 20, right: 20 }
        });
        yPos = (doc as any).lastAutoTable.finalY + 15;
      }

      // -- 4-Week Action Plan --
      if (data.action_plan && data.action_plan.length > 0) {
        if (yPos > doc.internal.pageSize.height - 60) { doc.addPage(); yPos = 20; }
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('4-WEEK PEDAGOGICAL ACTION PLAN', 20, yPos);
        yPos += 8;

        autoTable(doc, {
          startY: yPos,
          head: [['Week', 'Focus Area', 'Recommended Activity']],
          body: data.action_plan.map((a: any) => [`Week ${a.week}`, a.focus, a.activity]),
          theme: 'grid',
          headStyles: { fillColor: [0, 102, 204] },
          styles: { fontSize: 9 },
          margin: { left: 20, right: 20 }
        });
        yPos = (doc as any).lastAutoTable.finalY + 15;
      }

      // -- Priority Re-teaching Topics --
      if (yPos > doc.internal.pageSize.height - 60) {
        doc.addPage();
        yPos = 20;
      }

      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('PRIORITY RE-TEACHING AREAS', 20, yPos);
      yPos += 8;

      autoTable(doc, {
        startY: yPos,
        head: [['Topic', 'Primary Reason', 'Classroom Activity Suggestion']],
        body: data.re_teaching_topics.map((item: any) => [item.topic, item.reason, item.activity_suggestion]),
        theme: 'striped',
        headStyles: { fillColor: [13, 17, 23] },
        styles: { fontSize: 9, cellPadding: 4 },
        margin: { left: 20, right: 20 }
      });

      // -- Footer --
      const totalPages = doc.internal.pages.length - 1;
      const lecturerName = submissions.length > 0 ? (submissions[0].marked_by_name || submissions[0].marked_by_email || 'Lecturer') : 'Lecturer';
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(`Aggregate Analysis by ${lecturerName} - Page ${i} of ${totalPages}`, pageWidth / 2, doc.internal.pageSize.height - 10, { align: 'center' });
      }

      doc.save(`Class_Focus_Report_${examTitle.replace(/\s+/g, '_')}.pdf`);
      showToast('Class Focus Report generated successfully!', 'success');
    } catch (err: any) {
      console.error('Error generating class focus report:', err);
      showToast(err.message || 'Failed to generate class report.', 'error');
    } finally {
      setIsGeneratingClassReport(false);
    }
  };

  const handleDeleteSubmission = async (submissionId: string, studentId?: string) => {
    showConfirm({
      title: 'Delete Submission',
      message: 'Are you sure you want to delete this submission? It will be moved to the Trash Box.',
      confirmText: 'Delete',
      onConfirm: async () => {
        const { error, count } = await supabase
          .from('submissions')
          .delete({ count: 'exact' })
          .eq('id', submissionId);

        if (error) {
          console.error('Delete error:', error);
          showToast(`Failed to delete submission: ${error.message}`, 'error');
        } else if (count === 0) {
          showToast('Submission not found or permission denied.', 'error');
        } else {
          // Guaranteed clean slate: Clear all security violations for this student automatically
          if (studentId) {
            await supabase
              .from('violations')
              .delete()
              .eq('exam_id', examId)
              .eq('student_id', studentId);
          }
          showToast('Submission deleted successfully. Student can start completely afresh.', 'success');
          fetchResults();
        }
      }
    });
  };

  const handleWipeStudent = async (studentId: string, studentNumber: string) => {
    showConfirm({
      title: 'Wipe Remaining Attempt',
      message: `Are you sure you want to completely Wipe ${studentNumber}'s current attempt? This will permanently delete their active submission AND clear all their security violations. They will start completely fresh.`,
      confirmText: 'Wipe Everything',
      onConfirm: async () => {
        // 1. Delete active submission (moves to trash) — the delete adapter only
        // supports deleting by id, so look up this student's submission first.
        const { data: existing } = await supabase
          .from('submissions')
          .select('id')
          .eq('exam_id', examId)
          .eq('student_id', studentId)
          .maybeSingle();

        if (existing?.id) {
          const { error: subError } = await supabase.from('submissions').delete().eq('id', existing.id);
          if (subError) {
            console.error('Wipe submission error:', subError);
            showToast(`Failed to delete submission: ${subError.message}`, 'error');
            return;
          }
        }

        // 2. Clear violations
        const { error: violError } = await supabase
          .from('violations')
          .delete()
          .eq('exam_id', examId)
          .eq('student_id', studentId);

        if (violError) {
          console.error('Wipe violations error:', violError);
          showToast(`Failed to clear violations: ${violError.message}`, 'error');
        } else {
          showToast(`Student ${studentNumber}'s attempt and violations have been wiped clean.`, 'success');
          fetchResults();
        }
      }
    });
  };

  const handleResumeSession = async (submissionId: string, studentNumber: string) => {
    showConfirm({
      title: 'Resume Student Session',
      message: `Do you want to allow student ${studentNumber} to resume their exam? Their latest submission will be converted back to a draft, allowing them to continue where they left off.`,
      onConfirm: async () => {
        // 1. Reset the submission status and scores
        const { error: subError } = await supabase
          .from('submissions')
          .update({
            status: 'draft',
            graded: false,
            score: 0,
            is_manual: false,
            marking_details: null // Clear kick-out notes
          })
          .eq('id', submissionId);

        if (subError) {
          showToast('Failed to reset submission status', 'error');
          return;
        }

        // 2. Clear violation history for this specific attempt to allow re-entry
        const { data: sub } = await supabase
          .from('submissions')
          .select('student_id, exam_id')
          .eq('id', submissionId)
          .single();

        if (sub) {
          const { error: violError } = await supabase
            .from('violations')
            .delete()
            .eq('student_id', sub.student_id)
            .eq('exam_id', sub.exam_id);

          if (violError) {
            console.error('Error clearing violations:', violError);
          }
        }


        showToast('Session is now resumable by the student', 'success');
        fetchResults();
      }
    });
  };

  const handleUnenroll = async (enrollmentId: string, studentNumber: string) => {
    showConfirm({
      title: 'Unenroll Student',
      message: `Are you sure you want to unenroll student ${studentNumber}? Their progress and submissions for this exam will be preserved in the database but they will no longer see this exam on their dashboard.`,
      onConfirm: async () => {
        const { error } = await supabase
          .from('enrollments')
          .delete()
          .eq('id', enrollmentId);

        if (error) {
          console.error('Error unenrolling:', error);
          showToast('Failed to unenroll student', 'error');
        } else {
          showToast('Student unenrolled successfully', 'success');
          fetchResults();
        }
      }
    });
  };

  const handleRestoreSubmission = async (sub: Submission) => {
    showConfirm({
      title: 'Restore Submission',
      message: `Do you want to restore student ${sub.student?.student_number}'s submission? It will be moved back to the active list.`,
      onConfirm: async () => {
        // Fetch full record from trash first (to get answers)
        const { data: fullSub, error: fetchError } = await supabase
          .from('deleted_submissions')
          .select('*')
          .eq('id', sub.id)
          .single();

        if (fetchError || !fullSub) {
          showToast('Failed to fetch submission from trash', 'error');
          return;
        }

        // Move back to submissions
        const { error: insertError } = await supabase
          .from('submissions')
          .insert([{
            id: fullSub.id,
            exam_id: fullSub.exam_id,
            student_id: fullSub.student_id,
            answers: fullSub.answers,
            score: fullSub.score,
            total_marks: fullSub.total_marks,
            graded: fullSub.graded,
            is_manual: fullSub.is_manual,
            status: fullSub.status || 'submitted',
            marking_details: fullSub.marking_details,
            submitted_at: fullSub.submitted_at,
            marked_by_email: fullSub.marked_by_email,
            marked_by_name: fullSub.marked_by_name
          }]);

        if (insertError) {
          console.error('Restore insert error:', insertError);
          showToast('Failed to restore: ' + insertError.message, 'error');
          return;
        }

        // Delete from trash
        await supabase.from('deleted_submissions').delete().eq('id', sub.id);

        showToast('Submission restored successfully', 'success');
        fetchResults();
      }
    });
  };

  const handlePermanentDelete = async (submissionId: string) => {
    showConfirm({
      title: 'Permanent Delete',
      message: 'Are you sure? This will permanently remove the submission from the Trash Box. This cannot be undone.',
      onConfirm: async () => {
        const { error } = await supabase
          .from('deleted_submissions')
          .delete()
          .eq('id', submissionId);

        if (error) {
          showToast('Failed to delete permanently', 'error');
        } else {
          showToast('Permanently deleted from trash', 'success');
          fetchResults();
        }
      }
    });
  };

  useEffect(() => {
    fetchResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId]);

  // Group submissions by student
  const groupedSubmissions = React.useMemo(() => {
    const groups: Record<string, { student: any, submissions: Submission[] }> = {};

    submissions.forEach(sub => {
      if (!groups[sub.student_id]) {
        groups[sub.student_id] = {
          student: sub.student,
          submissions: []
        };
      }
      groups[sub.student_id].submissions.push(sub);
    });

    // Sort submissions within each group by date (latest first)
    Object.values(groups).forEach(group => {
      group.submissions.sort((a, b) =>
        new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()
      );
    });

    const filteredGroups = Object.entries(groups).map(([id, data]) => ({
      student_id: id,
      ...data
    })).filter(group =>
      group.student.student_number.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return filteredGroups.sort((a, b) => {
      const latestA = a.submissions[0];
      const latestB = b.submissions[0];

      const scoreA = latestA.total_marks > 0 ? (latestA.score / latestA.total_marks) : 0;
      const scoreB = latestB.total_marks > 0 ? (latestB.score / latestB.total_marks) : 0;

      const isPendingA = !latestA.graded;
      const isPendingB = !latestB.graded;

      switch (sortOption) {
        case 'status-pending':
          if (isPendingA && !isPendingB) return -1;
          if (!isPendingA && isPendingB) return 1;
          return a.student.student_number.localeCompare(b.student.student_number);
        case 'status-graded':
          if (!isPendingA && isPendingB) return -1;
          if (isPendingA && !isPendingB) return 1;
          return a.student.student_number.localeCompare(b.student.student_number);
        case 'score-highest':
          return scoreB - scoreA;
        case 'score-lowest':
          return scoreA - scoreB;
        case 'name-desc':
          return b.student.student_number.localeCompare(a.student.student_number);
        case 'name-asc':
        default:
          return a.student.student_number.localeCompare(b.student.student_number);
      }
    });
  }, [submissions, searchTerm, sortOption]);

  const averageScore = submissions.filter(s => s.status === 'submitted').length > 0
    ? (submissions.filter(s => s.status === 'submitted').reduce((acc, curr) => acc + (curr.score / (curr.total_marks || 1)), 0) / submissions.filter(s => s.status === 'submitted').length * 100).toFixed(1)
    : 0;

  const handleDownloadScript = () => {
    if (submissions.length === 0) return;

    // Prepare data for the script - only keep the latest submission per student for the report
    const reportDataMap = new Map();
    submissions.forEach(sub => {
      if (!reportDataMap.has(sub.student_id)) {
        reportDataMap.set(sub.student_id, sub);
      } else {
        const existing = reportDataMap.get(sub.student_id);
        if (new Date(sub.submitted_at) > new Date(existing.submitted_at)) {
          reportDataMap.set(sub.student_id, sub);
        }
      }
    });

    const data = Array.from(reportDataMap.values()).map(sub => ({
      'Student Number': sub.student?.student_number || 'Unknown',
      'Score (%)': parseFloat(((sub.score / (sub.total_marks || 1)) * 100).toFixed(1)),
      'Violations': sub.violations_count ?? 0
    }));

    // Create a new workbook and add the data as a worksheet
    const worksheet = XLSX.utils.json_to_sheet(data);

    // Set column widths for clean formatting
    worksheet['!cols'] = [
      { wch: 20 }, // Student Number
      { wch: 12 }, // Score (%)
      { wch: 12 }, // Violations
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Results');

    // Generate proper .xlsx file with separate columns and trigger download
    XLSX.writeFile(workbook, `${examTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_results.xlsx`);
  };

  // -- Presentational helpers (styling only, no business logic) --
  const tabButtonStyle = (active: boolean, danger = false): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '9px 16px', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em',
    fontFamily: 'var(--font-heading)',
    border: '1px solid var(--color-divider)',
    borderColor: active ? (danger ? 'var(--color-accent-700)' : 'var(--color-accent)') : 'var(--color-divider)',
    background: active ? (danger ? 'var(--color-accent-700)' : 'var(--color-accent)') : 'transparent',
    color: active ? 'var(--color-bg)' : (danger ? 'var(--color-accent-700)' : 'var(--color-text)'),
    cursor: 'pointer',
  });

  const statValue: React.CSSProperties = { fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 30 };
  const iconBtn: React.CSSProperties = { padding: 6 };
  const dangerIconBtn: React.CSSProperties = { padding: 6, color: 'var(--color-accent-700)' };

  const isEmpty =
    (activeTab === 'submissions' && groupedSubmissions.length === 0) ||
    (activeTab === 'students' && enrollments.length === 0) ||
    (activeTab === 'trash' && trashSubmissions.length === 0);

  return (
    <div style={{ minHeight: '100vh' }}>
      <nav className="nav">
        <button
          onClick={() => navigate('/dashboard')}
          className="btn btn-ghost"
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 'auto' }}
        >
          <ArrowLeft size={16} /> Dashboard
        </button>
        <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 16, textAlign: 'center' }}>
          {examTitle}
        </span>
        <span className="tag tag-accent" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Trophy size={12} /> Results
        </span>
      </nav>

      <main className="wrap" style={{ maxWidth: 1120, margin: '0 auto', padding: 'var(--space-8) var(--space-6)' }}>
        <div style={{ marginBottom: 'var(--space-4)' }}>
          {examTitle && <span className="tag tag-neutral">{examTitle}</span>}
          <h1 style={{ marginTop: 'var(--space-2)' }}>Results &amp; analytics</h1>
          <p className="text-muted" style={{ margin: 0 }}>
            Review candidate submissions, manage enrollment, and generate class insight reports.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-4)', margin: 'var(--space-6) 0' }}>
          <div className="card elev-sm">
            <span className="card-kicker">Total candidates</span>
            <span style={statValue}>{submissions.length}</span>
          </div>
          <div className="card elev-sm">
            <span className="card-kicker">Mean performance</span>
            <span style={statValue}>{averageScore}%</span>
          </div>
          <div className="card elev-sm">
            <span className="card-kicker">High-risk violations</span>
            <span style={{ ...statValue, color: 'var(--color-accent-700)' }}>
              {submissions.filter(s => (s.violations_count ?? 0) >= 2).length}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <button onClick={() => setActiveTab('submissions')} style={tabButtonStyle(activeTab === 'submissions')}>
              {isRefreshing && activeTab === 'submissions' ? <Loader2 size={14} className="spin" /> : <Users size={14} />}
              Candidates ({groupedSubmissions.length})
            </button>
            <button onClick={() => setActiveTab('students')} style={tabButtonStyle(activeTab === 'students')}>
              {isRefreshing && activeTab === 'students' ? <Loader2 size={14} className="spin" /> : <Calendar size={14} />}
              Enrolled ({enrollments.length})
            </button>
            <button onClick={() => setActiveTab('trash')} style={tabButtonStyle(activeTab === 'trash', true)}>
              <Trash2 size={14} />
              Trash ({trashSubmissions.length})
            </button>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.4, pointerEvents: 'none' }} />
              <input
                type="text"
                placeholder="Filter student ID…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input"
                style={{ paddingLeft: 30, width: 200 }}
              />
            </div>

            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as any)}
              className="input"
              style={{ width: 'auto' }}
            >
              <option value="status-pending">Review required first</option>
              <option value="name-asc">Student no. (A–Z)</option>
              <option value="name-desc">Student no. (Z–A)</option>
              <option value="status-graded">Verified first</option>
              <option value="score-highest">Score: highest first</option>
              <option value="score-lowest">Score: lowest first</option>
            </select>

            <button
              onClick={handleDownloadScript}
              disabled={submissions.length === 0}
              className="btn btn-secondary"
              title="Export Manifest (CSV)"
            >
              <Download size={16} /> Export
            </button>
            <button
              onClick={handleGenerateClassFocusReport}
              disabled={isGeneratingClassReport || submissions.filter(s => s.graded).length === 0}
              className="btn btn-primary"
            >
              {isGeneratingClassReport ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
              Generate focus report
            </button>
          </div>
        </div>

        {activeTab === 'submissions' && (
          groupedSubmissions.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Score</th>
                  <th>Security</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {groupedSubmissions.map((group) => {
                  const latest = group.submissions[0];
                  const isExpanded = expandedStudentId === group.student_id;
                  const violations = latest.violations_count ?? 0;

                  return (
                    <React.Fragment key={group.student_id}>
                      <tr
                        style={{ cursor: 'pointer' }}
                        onClick={() => setExpandedStudentId(isExpanded ? null : group.student_id)}
                      >
                        <td>
                          <div style={{ fontWeight: 700 }}>{group.student?.student_number || 'Internal-ID'}</div>
                          <div className="text-muted" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
                            Attempt #{latest.attempt_number || 1}
                            {group.submissions.length > 1 && (
                              <span className="tag tag-neutral">{group.submissions.length} sessions</span>
                            )}
                          </div>
                        </td>
                        <td style={{ fontWeight: 800 }}>
                          {latest.score} <span className="text-muted" style={{ fontWeight: 400 }}>/ {latest.total_marks}</span>
                        </td>
                        <td>
                          <span
                            className="tag"
                            style={{
                              background: violations === 0 ? 'var(--color-accent-2-100)' : violations >= 3 ? 'var(--color-accent-100)' : 'var(--color-neutral-200)',
                              color: violations === 0 ? 'var(--color-accent-2-800)' : violations >= 3 ? 'var(--color-accent-700)' : 'var(--color-neutral-800)',
                            }}
                          >
                            {violations} violation{violations === 1 ? '' : 's'}
                          </span>
                        </td>
                        <td className="text-muted">{format(new Date(latest.submitted_at), 'MMM d, HH:mm')}</td>
                        <td>
                          <span className={`tag ${latest.status === 'draft' ? 'tag-neutral' : latest.graded ? 'tag-accent-2' : 'tag-outline'}`}>
                            {latest.status === 'draft' ? 'At work' : latest.graded ? 'Verified' : 'Review required'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate(`/review/${latest.id}`); }}
                            className="btn btn-ghost"
                            style={iconBtn}
                            title="Detailed Audit"
                          >
                            <FileEdit size={15} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleResumeSession(latest.id, group.student?.student_number || ''); }}
                            className="btn btn-ghost"
                            style={iconBtn}
                            title="Restore Draft Access"
                          >
                            <RotateCcw size={15} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteSubmission(latest.id, group.student_id); }}
                            className="btn btn-ghost"
                            style={dangerIconBtn}
                            title="Decommission Submission"
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>

                      {isExpanded && group.submissions.length > 1 && (
                        <tr>
                          <td colSpan={6} style={{ background: 'var(--color-neutral-100)' }}>
                            <div className="card-kicker" style={{ margin: 'var(--space-2) 0' }}>Historical assessment logs</div>
                            <table className="table" style={{ fontSize: 13 }}>
                              <tbody>
                                {group.submissions.slice(1).map((sub) => (
                                  <tr key={sub.id}>
                                    <td>Attempt #{sub.attempt_number || 1} — {format(new Date(sub.submitted_at), 'MMM d, yyyy · HH:mm')}</td>
                                    <td style={{ fontWeight: 800 }}>{sub.score} pts</td>
                                    <td style={{ textAlign: 'right' }}>
                                      <button
                                        onClick={() => navigate(`/review/${sub.id}`)}
                                        className="btn btn-ghost"
                                        style={iconBtn}
                                        title="Detailed Audit"
                                      >
                                        <FileEdit size={14} />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          ) : null
        )}

        {activeTab === 'students' && (
          enrollments.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Enrolled</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {enrollments.filter(e => e.student?.student_number.toLowerCase().includes(searchTerm.toLowerCase())).map((enroll) => (
                  <tr key={enroll.id}>
                    <td style={{ fontWeight: 700 }}>{enroll.student?.student_number}</td>
                    <td className="text-muted">{format(new Date(enroll.enrolled_at), 'MMM d, yyyy')}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => handleWipeStudent(enroll.student_id, enroll.student?.student_number)}
                        className="btn btn-ghost"
                        style={dangerIconBtn}
                        title="Wipe Remaining Attempt"
                      >
                        <RotateCcw size={15} />
                      </button>
                      <button
                        onClick={() => handleUnenroll(enroll.id, enroll.student?.student_number)}
                        className="btn btn-ghost"
                        style={dangerIconBtn}
                        title="Unenroll Candidate"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null
        )}

        {activeTab === 'trash' && (
          trashSubmissions.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Score</th>
                  <th>Submitted</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {trashSubmissions.map((sub) => (
                  <tr key={sub.id}>
                    <td style={{ fontWeight: 700 }}>{sub.student?.student_number}</td>
                    <td style={{ fontWeight: 800 }}>{sub.score}/{sub.total_marks}</td>
                    <td className="text-muted">{format(new Date(sub.submitted_at), 'MMM d, yyyy')}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button onClick={() => handleRestoreSubmission(sub)} className="btn btn-secondary" style={{ marginRight: 6 }}>
                        Restore
                      </button>
                      <button
                        onClick={() => handlePermanentDelete(sub.id)}
                        className="btn btn-ghost"
                        style={dangerIconBtn}
                        title="Permanently Delete"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null
        )}

        {isEmpty && (
          <div className="card elev-sm" style={{ padding: 'var(--space-8)', alignItems: 'center', textAlign: 'center' }}>
            <Search size={28} style={{ opacity: 0.3, margin: '0 auto var(--space-3)' }} />
            <h3 style={{ marginBottom: 4 }}>No records found</h3>
            <p className="text-muted" style={{ margin: 0 }}>No matching datasets were discovered in the current scope.</p>
          </div>
        )}
      </main>
    </div>
  );
};

export default Results;
