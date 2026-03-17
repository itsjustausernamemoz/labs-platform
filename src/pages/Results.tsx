import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  ArrowLeft, Users, Trophy, AlertCircle,
  Calendar, CheckCircle2, Search, FileEdit, ShieldCheck, Download
} from 'lucide-react';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';

interface Submission {
  id: string;
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
  const [examTitle, setExamTitle] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

  const fetchResults = async () => {
    // Fetch exam title
    const { data: exam } = await supabase
      .from('exams')
      .select('title')
      .eq('id', examId)
      .single();

    if (exam) setExamTitle(exam.title);

    // Fetch submissions with student details and violation counts
    const { error } = await supabase
      .from('submissions')
      .select(`
        id,
        score,
        total_marks,
        graded,
        submitted_at,
        student:students(student_number)
      `)
      .eq('exam_id', examId)
      .order('submitted_at', { ascending: false });

    if (error) {
      console.error('Error fetching results:', error);
    } else {
      // Fetch with student_id to count violations
      const { data: dataWithId } = await supabase
        .from('submissions')
        .select(`
          id,
          student_id,
          score,
          total_marks,
          graded,
          submitted_at,
          student:students(student_number)
        `)
        .eq('exam_id', examId);

      const enriched = await Promise.all((dataWithId || []).map(async (sub: any) => {
        const { count } = await supabase
          .from('violations')
          .select('*', { count: 'exact', head: true })
          .eq('exam_id', examId)
          .eq('student_id', sub.student_id);

        return {
          id: sub.id,
          student_id: sub.student_id,
          student: sub.student,
          score: sub.score,
          total_marks: sub.total_marks,
          graded: sub.graded,
          submitted_at: sub.submitted_at,
          violations_count: count || 0
        };
      }));

      // Group by student_id and take the latest submission (since they are ordered by submitted_at)
      const uniqueSubmissionsMap = new Map();
      enriched.forEach(sub => {
        if (!uniqueSubmissionsMap.has(sub.student_id)) {
          uniqueSubmissionsMap.set(sub.student_id, sub);
        }
      });

      setSubmissions(Array.from(uniqueSubmissionsMap.values()));
    }
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
            <h2 className="text-xl font-bold text-primary">Student Performance</h2>
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
              <button
                onClick={handleDownloadScript}
                disabled={submissions.length === 0}
                className="flex items-center justify-center gap-2 bg-primary text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-primary/90 transition-all disabled:opacity-50"
                title="Download Results as CSV"
              >
                <Download className="w-4 h-4" />
                Download Script
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
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
            {filteredSubmissions.length === 0 && (
              <div className="p-12 text-center text-slate-400">
                No submissions found for this exam.
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
