import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  ArrowLeft, Users, Trophy, AlertCircle,
  Calendar, CheckCircle2, Search, FileEdit, ShieldCheck, Download
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
  submitted_at: string;
  violations_count: number;
}

const Results: React.FC = () => {
  const { examId } = useParams();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'submissions' | 'students'>('submissions');
  const [examTitle, setExamTitle] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
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
      const { data: subs, error: subsError } = await supabase
        .from('submissions')
        .select(`
          id,
          student_id,
          score,
          total_marks,
          graded,
          is_manual,
          submitted_at,
          student:students(student_number)
        `)
        .eq('exam_id', examId);

      if (subsError) throw subsError;

      const enriched = await Promise.all((subs || []).map(async (sub: any) => {
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

      const uniqueSubmissionsMap = new Map();
      enriched.forEach(sub => {
        if (!uniqueSubmissionsMap.has(sub.student_id)) {
          uniqueSubmissionsMap.set(sub.student_id, sub);
        }
      });
      setSubmissions(Array.from(uniqueSubmissionsMap.values()));

      // 2. Fetch All Enrolled Students (including those who haven't submitted)
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
      console.error('Error fetching dashboard data:', err);
    } finally {
      setIsRefreshing(false);
    }
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

  useEffect(() => {
    fetchResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId]);

  const filteredSubmissions = submissions.filter(s =>
    s.student.student_number.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const averageScore = submissions.length > 0
    ? (submissions.reduce((acc, curr) => acc + (curr.score / curr.total_marks), 0) / submissions.length * 100).toFixed(1)
    : 0;

  const handleDownloadScript = () => {
    if (submissions.length === 0) return;

    // Prepare data for the script
    const data = submissions.map(sub => ({
      'Student Number': sub.student.student_number,
      'Score (%)': ((sub.score / sub.total_marks) * 100).toFixed(1),
      'Status': sub.is_manual ? 'Lecturer Marked' : sub.graded ? 'Marked' : 'Pending',
      'Violations': sub.violations_count
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
            Submissions ({submissions.length})
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
              <p className="text-2xl font-bold text-primary">{submissions.filter(s => s.violations_count >= 2).length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h2 className="text-xl font-bold text-primary">
              {activeTab === 'submissions' ? 'Submission Results' : 'Enrolled Candidates'}
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
                  {filteredSubmissions.map((sub) => (
                    <tr key={sub.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 font-bold text-primary">{sub.student.student_number}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold">{sub.score}</span>
                          <span className="text-slate-400 text-sm">/ {sub.total_marks}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-500">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          {format(new Date(sub.submitted_at), 'MMM d, HH:mm')}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded text-xs font-bold ${
                          sub.violations_count === 0 ? 'text-green-600 bg-green-50' :
                          sub.violations_count >= 3 ? 'text-red-600 bg-red-50' :
                          'text-orange-600 bg-orange-50'
                        }`}>
                          {sub.violations_count} Detected
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {sub.is_manual ? (
                          <div className="flex items-center gap-1 text-accent text-sm font-bold">
                            <ShieldCheck className="w-4 h-4" />
                            Lecturer Marked
                          </div>
                        ) : sub.graded ? (
                          <div className="flex items-center gap-1 text-green-600 text-sm font-medium">
                            <CheckCircle2 className="w-4 h-4" />
                            AI Marked
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-orange-500 text-sm font-medium">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Marking...
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => navigate(`/lecturer/review/${sub.id}`)}
                          className="flex items-center gap-1.5 text-accent hover:text-accent/80 font-bold text-xs uppercase tracking-wider bg-accent/10 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          <FileEdit className="w-3.5 h-3.5" />
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
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
            )}
            {(activeTab === 'submissions' ? filteredSubmissions : enrollments).length === 0 && (
              <div className="p-12 text-center text-slate-400">
                {activeTab === 'submissions' 
                  ? 'No submissions found for this exam.' 
                  : 'No students are currently enrolled in this exam.'}
              </div>
            )}
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
