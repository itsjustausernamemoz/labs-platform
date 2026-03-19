import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  Calendar, Search, FileEdit, Download, Trash2,
  ChevronRight, ArrowLeft, Users, Trophy, AlertCircle, XCircle
} from 'lucide-react';
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
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);
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

    return Object.entries(groups).map(([id, data]) => ({
      student_id: id,
      ...data
    })).filter(group => 
      group.student.student_number.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [submissions, searchTerm]);

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
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans">
      <nav className="bg-primary text-white p-4 sticky top-0 z-50 shadow-md">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <button
            onClick={() => navigate('/lecturer/dashboard')}
            className="flex items-center gap-2 text-panel/60 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Dashboard
          </button>
          <div className="text-center">
            <h1 className="text-lg font-bold truncate max-w-xs">{examTitle}</h1>
            <p className="text-xs text-accent/60 uppercase tracking-widest">Exam Results</p>
          </div>
          <div className="w-24"></div> {/* Spacer for symmetry */}
        </div>
      </nav>

      <main className="max-w-6xl mx-auto p-8">
        <div className="flex gap-4 mb-8">
          <button
            onClick={() => setActiveTab('submissions')}
            className={`px-6 py-2 rounded-lg font-bold transition-all flex items-center gap-2 ${
              activeTab === 'submissions' 
                ? 'bg-primary text-white shadow-md' 
                : 'bg-white text-slate-400 hover:bg-slate-50 border border-slate-200'
            }`}
          >
            {isRefreshing && activeTab === 'submissions' && <Loader2 className="w-4 h-4 animate-spin" />}
            Students ({groupedSubmissions.length})
          </button>
          <button
            onClick={() => setActiveTab('students')}
            className={`px-6 py-2 rounded-lg font-bold transition-all flex items-center gap-2 ${
              activeTab === 'students' 
                ? 'bg-primary text-white shadow-md' 
                : 'bg-white text-slate-400 hover:bg-slate-50 border border-slate-200'
            }`}
          >
            {isRefreshing && activeTab === 'students' && <Loader2 className="w-4 h-4 animate-spin" />}
            Enrolled Students ({enrollments.length})
          </button>
          <button
            onClick={() => setActiveTab('trash')}
            className={`px-6 py-2 rounded-lg font-bold transition-all flex items-center gap-2 ${
              activeTab === 'trash' 
                ? 'bg-red-500 text-white shadow-md' 
                : 'bg-white text-slate-400 hover:bg-slate-50 border border-slate-200'
            }`}
          >
            {isRefreshing && activeTab === 'trash' && <Loader2 className="w-4 h-4 animate-spin" />}
            Trash ({trashSubmissions.length})
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">Total Students</p>
              <p className="text-2xl font-bold text-primary">{submissions.length}</p>
            </div>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center text-green-600">
              <Trophy className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">Average Score</p>
              <p className="text-2xl font-bold text-primary">{averageScore}%</p>
            </div>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center text-red-600">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">High Violations</p>
              <p className="text-2xl font-bold text-primary">{submissions.filter(s => (s.violations_count ?? 0) >= 2).length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h2 className="text-xl font-bold text-primary">
              {activeTab === 'submissions' ? 'Submission Results' : activeTab === 'students' ? 'Enrolled Candidates' : 'Trash Box'}
            </h2>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search student number..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-primary transition-all text-sm w-full md:w-64"
                />
              </div>
              {activeTab === 'submissions' && (
                <button
                  onClick={handleDownloadScript}
                  disabled={submissions.length === 0}
                  className="flex items-center justify-center gap-2 bg-primary text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-primary/90 transition-all disabled:opacity-50"
                  title="Download Results as CSV"
                >
                  <Download className="w-4 h-4" />
                  Download Script
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            {activeTab === 'submissions' ? (
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs font-bold uppercase tracking-wider">
                    <th className="px-6 py-4">Student Number</th>
                    <th className="px-6 py-4">Score</th>
                    <th className="px-6 py-4">Submission Time</th>
                    <th className="px-6 py-4">Violations</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {groupedSubmissions.map((group) => {
                    const latest = group.submissions[0];
                    const isExpanded = expandedStudentId === group.student_id;
                    
                    return (
                      <React.Fragment key={group.student_id}>
                        <tr 
                          className={`hover:bg-slate-50 transition-colors cursor-pointer ${isExpanded ? 'bg-slate-50/50' : ''}`}
                          onClick={() => setExpandedStudentId(isExpanded ? null : group.student_id)}
                        >
                          <td className="px-6 py-4 font-bold text-primary">
                            <div className="flex items-center gap-2">
                              {group.submissions.length > 1 && (
                                <ChevronRight className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                              )}
                              {group.student?.student_number || 'Unknown'}
                              {group.submissions.length > 1 && (
                                <span className="bg-slate-100 text-slate-500 text-[10px] px-1.5 py-0.5 rounded-full">
                                  {group.submissions.length} attempts
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <span className="font-bold">{latest.score}</span>
                              <span className="text-slate-400 text-sm">/ {latest.total_marks}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-500">
                            <div className="flex items-center gap-2">
                              <Calendar className="w-4 h-4" />
                              {format(new Date(latest.submitted_at), 'MMM d, HH:mm')}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 rounded text-xs font-bold ${
                              (latest.violations_count ?? 0) === 0 ? 'text-green-600 bg-green-50' :
                              (latest.violations_count ?? 0) >= 3 ? 'text-red-600 bg-red-50' :
                              'text-orange-600 bg-orange-50'
                            }`}>
                              {latest.violations_count ?? 0} Detected
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-500">
                            <div className="flex items-center justify-between gap-4">
                              <span>
                                {latest.status === 'draft' ? 'In Progress' : latest.is_manual ? 'Lecturer Marked' : latest.graded ? 'Auto-Graded' : 'Marking...'}
                              </span>
                              {latest.marked_by_name || latest.marked_by_email ? (
                                <p className="text-[9px] text-slate-400 font-bold italic mt-1 text-right">
                                  By: {latest.marked_by_name || latest.marked_by_email}
                                </p>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                              <button
                                onClick={() => navigate(`/lecturer/review/${latest.id}`)}
                                className="flex items-center gap-1 bg-primary/10 text-primary border border-primary/20 text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-primary/20 transition-all"
                              >
                                <FileEdit className="w-3.5 h-3.5" />
                                Mark
                              </button>
                              <button
                                onClick={() => handleDeleteSubmission(latest.id, group.student.id)}
                                className="p-1.5 text-orange-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-all"
                                title="Delete submission (Move to Trash)"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => group.student?.id && handleWipeStudent(group.student.id, group.student.student_number)}
                                className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-all"
                                title="Wipe Student Attempt (Deletes submission AND clears all violations to allow a full fresh start)"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>

                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={6} className="bg-slate-50/30 px-6 py-4">
                              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-inner">
                                <table className="w-full text-xs">
                                  <thead className="bg-slate-50 text-slate-400 uppercase tracking-wider font-bold">
                                    <tr>
                                      <th className="px-4 py-2 text-left">Attempt Date</th>
                                      <th className="px-4 py-2 text-left">Score</th>
                                      <th className="px-4 py-2 text-left">Status</th>
                                      <th className="px-4 py-2 text-right">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {group.submissions.map((sub) => (
                                      <tr key={sub.id} className="hover:bg-slate-50">
                                        <td className="px-4 py-3 text-slate-500">
                                          {format(new Date(sub.submitted_at), 'MMM d, yyyy HH:mm:ss')}
                                        </td>
                                        <td className="px-4 py-3 font-bold">
                                          {sub.score} / {sub.total_marks}
                                        </td>
                                        <td className="px-4 py-3">
                                          <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                                            sub.status === 'draft' ? 'bg-slate-100 text-slate-500' :
                                            sub.graded ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'
                                          }`}>
                                            {sub.status === 'draft' ? 'Draft' : sub.is_manual ? 'Manual' : sub.graded ? 'Auto' : 'Pending'}
                                          </span>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                          <div className="flex items-center justify-end gap-2">
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                navigate(`/lecturer/review/${sub.id}`);
                                              }}
                                              className="text-accent hover:underline font-bold"
                                            >
                                              Review
                                            </button>
                                            {sub.status === 'submitted' && (
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleResumeSession(sub.id, group.student.student_number);
                                                }}
                                                className="text-blue-500 hover:underline font-bold"
                                              >
                                                Resume
                                              </button>
                                            )}
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteSubmission(sub.id, group.student.id);
                                              }}
                                              className="text-red-400 hover:text-red-600"
                                            >
                                              <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            ) : activeTab === 'students' ? (
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs font-bold uppercase tracking-wider">
                    <th className="px-6 py-4">Student Number</th>
                    <th className="px-6 py-4">Enrollment Date</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {enrollments
                    .filter(e => e.student.student_number.toLowerCase().includes(searchTerm.toLowerCase()))
                    .map((e) => {
                      const hasSubmitted = submissions.some(s => s.student_id === e.student_id);
                      return (
                        <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 font-bold text-primary">{e.student.student_number}</td>
                          <td className="px-6 py-4 text-sm text-slate-500">
                            {format(new Date(e.enrolled_at), 'MMM d, yyyy HH:mm')}
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 rounded text-xs font-bold ${
                              hasSubmitted ? 'text-green-600 bg-green-50' : 'text-slate-500 bg-slate-50'
                            }`}>
                              {hasSubmitted ? 'Submitted' : 'Pending Start'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={() => handleUnenroll(e.id, e.student.student_number)}
                              className="text-red-500 hover:text-red-700 font-bold text-xs uppercase tracking-wider px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 transition-all"
                            >
                              Unenroll
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            ) : activeTab === 'trash' ? (
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs font-bold uppercase tracking-wider">
                    <th className="px-6 py-4">Student Number</th>
                    <th className="px-6 py-4">Previous Score</th>
                    <th className="px-6 py-4">Deleted At</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {trashSubmissions.map((sub) => (
                    <tr key={sub.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 font-bold text-slate-600">{sub.student?.student_number || 'Unknown'}</td>
                      <td className="px-6 py-4 font-bold text-slate-400">
                        {sub.score} / {sub.total_marks}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-400">
                        {format(new Date((sub as any).deleted_at || sub.submitted_at), 'MMM d, HH:mm')}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={() => handleRestoreSubmission(sub)}
                            className="bg-green-50 text-green-600 px-4 py-1.5 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-green-100"
                          >
                            Restore
                          </button>
                          <button
                            onClick={() => handlePermanentDelete(sub.id)}
                            className="text-red-400 hover:text-red-600"
                            title="Permanent delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {(activeTab === 'submissions' && groupedSubmissions.length === 0) ||
             (activeTab === 'students' && enrollments.length === 0) ||
             (activeTab === 'trash' && trashSubmissions.length === 0) ? (
              <div className="p-12 text-center text-slate-400">
                {activeTab === 'submissions' 
                  ? 'No submissions found for this exam.' 
                  : activeTab === 'students'
                  ? 'No students are currently enrolled in this exam.'
                  : 'The Trash Box is empty.'}
              </div>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Results;

const Loader2 = ({ className }: { className?: string }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
);
