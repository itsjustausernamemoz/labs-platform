import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  Calendar, Search, FileEdit, Download, Trash2,
  ChevronRight, ArrowLeft, Users, Trophy, AlertCircle, Loader2, Sparkles, Filter
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { useNotification } from '../components/NotificationProvider';

interface Submission {
  id: string;
  student_id: string;
  student: { student_number: string };
  score: number;
  total_marks: number;
  graded: boolean;
  is_manual: boolean;
  status?: 'draft' | 'submitted';
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
          const enrichedTrash = (trash || []).map(t => ({
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
        // 1. Delete active submission (moves to trash)
        await supabase.from('submissions').delete().eq('exam_id', examId).eq('student_id', studentId);
        
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
      'Score (%)': ((sub.score / (sub.total_marks || 1)) * 100).toFixed(1),
      'Status': sub.is_manual ? 'Lecturer Marked' : sub.graded ? 'Auto-Graded' : 'Pending',
      'Violations': sub.violations_count ?? 0
    }));

    // Create a new workbook and add the data as a worksheet
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Results');

    // Generate CSV and trigger download
    // XLSX.writeFile will handle the download in the browser
    XLSX.writeFile(workbook, `${examTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_results.csv`);
  };

  return (
    <div className="min-h-screen bg-[#0A1024] text-white font-outfit pb-20">
      {/* Dynamic Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-accent/10 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-500/10 rounded-full blur-[120px] animate-pulse" />
      </div>

      <nav className="sticky top-0 z-[100] bg-[#0A1024]/60 backdrop-blur-3xl border-b border-white/5 py-4">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          <button
            onClick={() => navigate('/lecturer/dashboard')}
            className="group flex items-center gap-3 text-white/40 hover:text-white transition-all"
          >
            <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-accent/10 group-hover:text-accent transition-all">
              <ArrowLeft className="w-5 h-5" />
            </div>
            <span className="text-xs font-black uppercase tracking-widest">Dashboard</span>
          </button>
          
          <div className="text-center">
            <h1 className="text-xl font-black tracking-tight text-white font-outfit truncate max-w-sm">{examTitle}</h1>
            <div className="flex items-center justify-center gap-2 mt-1">
              <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              <p className="text-[10px] text-accent/60 font-black uppercase tracking-[0.2em]">Live Intelligence Repository</p>
            </div>
          </div>

          <div className="w-24 flex justify-end">
            <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center border border-accent/20">
              <Trophy className="w-4 h-4 text-accent" />
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-12 relative z-10">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8 mb-12">
          <div className="flex bg-white/5 p-1.5 rounded-2xl border border-white/5 w-fit">
            <button
              onClick={() => setActiveTab('submissions')}
              className={`px-8 py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center gap-3 ${
                activeTab === 'submissions' 
                  ? 'bg-accent text-[#0A1024] shadow-[0_0_20px_rgba(0,229,255,0.3)]' 
                  : 'text-white/40 hover:text-white hover:bg-white/5'
              }`}
            >
              {isRefreshing && activeTab === 'submissions' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4"/>}
              Candidates ({groupedSubmissions.length})
            </button>
            <button
              onClick={() => setActiveTab('students')}
              className={`px-8 py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center gap-3 ${
                activeTab === 'students' 
                  ? 'bg-accent text-[#0A1024] shadow-[0_0_20px_rgba(0,229,255,0.3)]' 
                  : 'text-white/40 hover:text-white hover:bg-white/5'
              }`}
            >
              {isRefreshing && activeTab === 'students' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4"/>}
              Enrolled ({enrollments.length})
            </button>
            <button
              onClick={() => setActiveTab('trash')}
              className={`px-8 py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center gap-3 ${
                activeTab === 'trash' 
                  ? 'bg-red-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.3)]' 
                  : 'text-white/40 hover:text-white hover:bg-white/5'
              }`}
            >
              <Trash2 className="w-4 h-4"/>
              Trash ({trashSubmissions.length})
            </button>
          </div>

          <div className="flex items-center gap-4">
             <div className="relative group/search">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20 group-focus-within/search:text-accent transition-colors" />
                <input
                  type="text"
                  placeholder="Filter student ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-12 pr-6 py-4 bg-white/5 border border-white/10 rounded-2xl outline-none focus:border-accent/40 focus:bg-white/[0.08] transition-all text-sm font-bold w-full sm:w-64 placeholder:text-white/10"
                />
              </div>

              <div className="relative group/sort hidden sm:block">
                <Filter className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20 group-hover/sort:text-accent transition-colors pointer-events-none" />
                <select
                  value={sortOption}
                  onChange={(e) => setSortOption(e.target.value as any)}
                  className="pl-11 pr-10 py-4 bg-white/5 border border-white/10 rounded-2xl outline-none focus:border-accent/40 focus:bg-white/[0.08] transition-all text-[11px] font-black uppercase tracking-widest text-white cursor-pointer appearance-none hover:bg-white/10 w-full sm:w-auto"
                >
                  <option value="status-pending" className="bg-[#0A1024] text-white">Review Required First</option>
                  <option value="name-asc" className="bg-[#0A1024] text-white">Student No. (A-Z)</option>
                  <option value="name-desc" className="bg-[#0A1024] text-white">Student No. (Z-A)</option>
                  <option value="status-graded" className="bg-[#0A1024] text-white">Verified First</option>
                  <option value="score-highest" className="bg-[#0A1024] text-white">Score: Highest First</option>
                  <option value="score-lowest" className="bg-[#0A1024] text-white">Score: Lowest First</option>
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                  <ChevronRight className="w-4 h-4 text-white/20 rotate-90" />
                </div>
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={handleDownloadScript}
                  disabled={submissions.length === 0}
                  className="bg-white/5 border border-white/10 text-white p-4 rounded-2xl hover:bg-white/10 transition-all disabled:opacity-30 group"
                  title="Export Manifest (CSV)"
                >
                  <Download className="w-5 h-5 text-accent group-hover:scale-110 transition-transform" />
                </button>
                <button
                  onClick={handleGenerateClassFocusReport}
                  disabled={isGeneratingClassReport || submissions.filter(s => s.graded).length === 0}
                  className="glass-button bg-white text-[#0A1024] px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center gap-3 hover:scale-[1.02] shadow-xl disabled:opacity-30"
                >
                  {isGeneratingClassReport ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                  Generate Focus
                </button>
              </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          <div className="glass-panel p-10 rounded-[2.5rem] border border-white/5 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl -mr-16 -mt-16 group-hover:bg-blue-500/20 transition-all" />
            <div className="flex items-center gap-6 relative z-10">
              <div className="w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center text-blue-400 border border-blue-500/20">
                <Users className="w-8 h-8" />
              </div>
              <div>
                <p className="text-[10px] text-white/40 font-black uppercase tracking-[0.2em] mb-1">Total Candidates</p>
                <p className="text-4xl font-black text-white">{submissions.length}</p>
              </div>
            </div>
          </div>

          <div className="glass-panel p-10 rounded-[2.5rem] border border-white/5 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-accent/10 rounded-full blur-3xl -mr-16 -mt-16 group-hover:bg-accent/20 transition-all" />
            <div className="flex items-center gap-6 relative z-10">
              <div className="w-16 h-16 bg-accent/10 rounded-2xl flex items-center justify-center text-accent border border-accent/20">
                <Trophy className="w-8 h-8" />
              </div>
              <div>
                <p className="text-[10px] text-white/40 font-black uppercase tracking-[0.2em] mb-1">Mean Performance</p>
                <p className="text-4xl font-black text-white">{averageScore}%</p>
              </div>
            </div>
          </div>

          <div className="glass-panel p-10 rounded-[2.5rem] border border-white/5 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/10 rounded-full blur-3xl -mr-16 -mt-16 group-hover:bg-red-500/20 transition-all" />
            <div className="flex items-center gap-6 relative z-10">
              <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500 border border-red-500/20">
                <AlertCircle className="w-8 h-8" />
              </div>
              <div>
                <p className="text-[10px] text-white/40 font-black uppercase tracking-[0.2em] mb-1">High Risk Violations</p>
                <p className="text-4xl font-black text-white">{submissions.filter(s => (s.violations_count ?? 0) >= 2).length}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="relative group">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-3xl font-black tracking-tight font-outfit text-white">
              {activeTab === 'submissions' ? 'Submission Analysis' : activeTab === 'students' ? 'Candidate Roster' : 'Decommissioned Vault'}
            </h2>
          </div>

          <div className="space-y-4">
            {activeTab === 'submissions' ? (
              groupedSubmissions.map((group) => {
                const latest = group.submissions[0];
                const isExpanded = expandedStudentId === group.student_id;
                
                return (
                  <div key={group.student_id} className="glass-panel rounded-3xl overflow-hidden border border-white/5 hover:border-accent/20 transition-all duration-300">
                    <div 
                      className={`p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 cursor-pointer ${isExpanded ? 'bg-white/5' : 'hover:bg-white/[0.04]'}`}
                      onClick={() => setExpandedStudentId(isExpanded ? null : group.student_id)}
                    >
                      <div className="flex items-center gap-6">
                        <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center border border-accent/20 group-hover:scale-110 transition-transform">
                          <Users className="w-7 h-7 text-accent" />
                        </div>
                        <div>
                          <h3 className="text-xl font-black text-white font-outfit">{group.student?.student_number || 'Internal-ID'}</h3>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-[10px] font-black uppercase tracking-widest text-white/40">Attempt Profile</span>
                            {group.submissions.length > 1 && (
                              <span className="px-2 py-0.5 rounded-lg bg-accent/10 text-accent text-[9px] font-black uppercase tracking-widest border border-accent/20">
                                {group.submissions.length} Sessions
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 md:gap-12 flex-1 max-w-3xl">
                        <div className="space-y-1">
                          <p className="text-[9px] font-black text-white/30 uppercase tracking-[0.2em]">Aggregate Score</p>
                          <div className="flex items-baseline gap-1">
                            <span className="text-xl font-black text-accent">{latest.score}</span>
                            <span className="text-xs font-bold text-white/20">/ {latest.total_marks}</span>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <p className="text-[9px] font-black text-white/30 uppercase tracking-[0.2em]">Security Status</p>
                          <div className={`flex items-center gap-1.5 text-xs font-black uppercase tracking-widest ${
                            (latest.violations_count ?? 0) === 0 ? 'text-green-400' :
                            (latest.violations_count ?? 0) >= 3 ? 'text-red-400' : 'text-orange-400'
                          }`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${
                              (latest.violations_count ?? 0) === 0 ? 'bg-green-400' :
                              (latest.violations_count ?? 0) >= 3 ? 'bg-red-400' : 'bg-orange-400'
                            }`} />
                            {latest.violations_count ?? 0} Violations
                          </div>
                        </div>

                        <div className="space-y-1">
                          <p className="text-[9px] font-black text-white/30 uppercase tracking-[0.2em]">Submission</p>
                          <div className="flex items-center gap-2 text-xs font-bold text-white/60">
                            <Calendar className="w-3.5 h-3.5" />
                            {format(new Date(latest.submitted_at), 'MMM d, HH:mm')}
                          </div>
                        </div>

                        <div className="space-y-1">
                          <p className="text-[9px] font-black text-white/30 uppercase tracking-[0.2em]">Entity Status</p>
                          <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${
                            latest.status === 'draft' 
                              ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' 
                              : latest.graded 
                                ? 'bg-green-500/10 text-green-400 border-green-500/20' 
                                : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                          }`}>
                            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse mr-2" />
                            {latest.status === 'draft' ? 'At Work' : latest.graded ? 'Verified' : 'Review Required'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button 
                          onClick={(e) => { e.stopPropagation(); navigate(`/lecturer/review/${latest.id}`); }}
                          className="w-12 h-12 rounded-2xl bg-accent text-[#0A1024] flex items-center justify-center hover:scale-110 active:scale-95 transition-all shadow-lg"
                          title="Detailed Audit"
                        >
                          <FileEdit className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleResumeSession(latest.id, group.student?.student_number || ''); }}
                          className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-all text-white/40 hover:text-white"
                          title="Restore Draft Access"
                        >
                          <ChevronRight className="w-5 h-5 rotate-180" />
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleDeleteSubmission(latest.id, group.student_id); }}
                          className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 hover:bg-red-500 hover:text-white transition-all"
                          title="Decommission Submission"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>

                    {isExpanded && group.submissions.length > 1 && (
                      <div className="bg-black/20 border-t border-white/5 p-8 animate-in slide-in-from-top duration-300">
                        <div className="flex items-center gap-3 mb-6">
                           <div className="w-1 h-4 bg-accent rounded-full" />
                           <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40">Historical Assessment Logs</h4>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {group.submissions.slice(1).map((sub) => (
                            <div key={sub.id} className="bg-white/5 border border-white/5 p-6 rounded-2xl flex items-center justify-between group/audit">
                              <div className="flex items-center gap-5">
                                <div className="p-3 bg-white/5 rounded-xl border border-white/5 text-white/20 group-hover/audit:text-accent transition-colors">
                                  <Calendar className="w-4 h-4" />
                                </div>
                                <div>
                                  <p className="text-sm font-bold text-white/80">{format(new Date(sub.submitted_at), 'MMM d, yyyy · HH:mm')}</p>
                                  <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mt-1">Archived Repository</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-4">
                                <span className="text-lg font-black text-white/40">{sub.score} <span className="text-[10px] font-bold">PTS</span></span>
                                <button 
                                  onClick={() => navigate(`/lecturer/review/${sub.id}`)}
                                  className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent hover:bg-accent hover:text-[#0A1024] transition-all"
                                >
                                  <FileEdit className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            ) : activeTab === 'students' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {enrollments.filter(e => e.student?.student_number.toLowerCase().includes(searchTerm.toLowerCase())).map((enroll) => (
                  <div key={enroll.id} className="glass-panel p-8 rounded-[2rem] border border-white/5 hover:border-accent/30 transition-all group overflow-hidden relative">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-accent/5 rounded-full blur-2xl group-hover:bg-accent/10 transition-all" />
                    <div className="flex items-center justify-between mb-8 relative z-10">
                      <div className="w-14 h-14 bg-accent/10 rounded-2xl flex items-center justify-center text-accent border border-accent/20 font-black">
                        {enroll.student?.student_number?.substring(0, 2) || 'ST'}
                      </div>
                      <button 
                        onClick={() => handleUnenroll(enroll.id, enroll.student?.student_number)}
                        className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-red-400 opacity-0 group-hover:opacity-100 hover:bg-red-500 hover:text-white transition-all"
                        title="Remove Candidate"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <h3 className="text-2xl font-black mb-1 group-hover:text-accent transition-colors">{enroll.student?.student_number}</h3>
                    <p className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-8">Registered Candidate</p>

                    <div className="pt-6 border-t border-white/5 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-3 h-3 text-white/20" />
                        <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Enrolled {format(new Date(enroll.enrolled_at), 'MMM d')}</span>
                      </div>
                      <button 
                        onClick={() => handleWipeStudent(enroll.student_id, enroll.student?.student_number)}
                        className="text-[9px] font-black uppercase tracking-widest text-red-400 hover:text-red-300 transition-colors"
                      >
                       Full Wipe Access
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {trashSubmissions.map((sub) => (
                  <div key={sub.id} className="glass-panel p-8 rounded-[2rem] border border-red-500/10 hover:border-red-500/30 transition-all group relative grayscale opacity-60 hover:grayscale-0 hover:opacity-100">
                    <div className="flex justify-between items-start mb-8">
                       <div>
                        <h3 className="text-2xl font-black text-white">{sub.student?.student_number}</h3>
                        <p className="text-[10px] font-black uppercase tracking-widest text-red-500/60 mt-1">Decommissioned Data</p>
                       </div>
                       <Trophy className="w-5 h-5 text-white/10" />
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-8">
                      <div className="bg-black/20 p-4 rounded-2xl border border-white/5">
                        <p className="text-[9px] font-black text-white/20 uppercase mb-1">Score</p>
                        <p className="text-lg font-black">{sub.score}/{sub.total_marks}</p>
                      </div>
                      <div className="bg-black/20 p-4 rounded-2xl border border-white/5">
                        <p className="text-[9px] font-black text-white/20 uppercase mb-1">Time</p>
                        <p className="text-xs font-bold text-white/60">{format(new Date(sub.submitted_at), 'MMM d')}</p>
                      </div>
                    </div>

                    <div className="flex gap-3 mt-4">
                      <button 
                        onClick={() => handleRestoreSubmission(sub)}
                        className="flex-1 bg-accent text-[#0A1024] py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:scale-105 active:scale-95 transition-all"
                      >
                        Recommission
                      </button>
                      <button 
                        onClick={() => handlePermanentDelete(sub.id)}
                        className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 hover:bg-red-500 hover:text-white transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {((activeTab === 'submissions' && groupedSubmissions.length === 0) || 
              (activeTab === 'students' && enrollments.length === 0) ||
              (activeTab === 'trash' && trashSubmissions.length === 0)) && (
              <div className="glass-panel p-20 rounded-[3rem] border border-white/5 flex flex-col items-center text-center">
                <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-8">
                  <Search className="w-8 h-8 text-white/10" />
                </div>
                <h3 className="text-2xl font-black mb-2 opacity-60">Null Repository</h3>
                <p className="text-white/20 text-sm max-w-xs font-bold uppercase tracking-widest">No matching datasets were discovered in the current scope.</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Results;
