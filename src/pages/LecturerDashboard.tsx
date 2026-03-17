import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  Plus, FileUp, Trash2, Eye, EyeOff,
  BarChart3, LogOut, Loader2, FileText,
  X, Save, Edit3, Check
} from 'lucide-react';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

interface Exam {
  id: string;
  title: string;
  duration_minutes: number;
  is_active: boolean;
  created_at: string;
}

interface Question {
  id: string;
  type: 'mcq' | 'structured';
  question_text: string;
  options: string[] | null;
  correct_answer: string;
  marks: number;
}

const LecturerDashboard: React.FC = () => {
  const [exams, setExams] = useState<Exam[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newExam, setNewExam] = useState({ title: '', duration: 60 });
  const [uploadingExamId, setUploadingExamId] = useState<string | null>(null);
  const [editingExamQuestions, setEditingExamQuestions] = useState<Exam | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isSavingQuestions, setIsSavingQuestions] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchExams();
  }, []);

  const fetchExams = async () => {
    setIsLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate('/lecturer/login');
      return;
    }

    const { data, error } = await supabase
      .from('exams')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) console.error('Error fetching exams:', error);
    else setExams(data || []);
    setIsLoading(false);
  };

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('exams')
      .insert([{
        title: newExam.title,
        duration_minutes: newExam.duration,
        lecturer_id: user.id
      }])
      .select()
      .single();

    if (error) console.error('Error creating exam:', error);
    else {
      setExams([data, ...exams]);
      setIsCreating(false);
      setNewExam({ title: '', duration: 60 });
    }
  };

  const toggleExamStatus = async (id: string, currentStatus: boolean) => {
    const { error } = await supabase
      .from('exams')
      .update({ is_active: !currentStatus })
      .eq('id', id);

    if (error) console.error('Error updating exam:', error);
    else {
      setExams(exams.map(e => e.id === id ? { ...e, is_active: !currentStatus } : e));
    }
  };

  const deleteExam = async (id: string) => {
    if (!confirm('Are you sure you want to delete this exam?')) return;
    const { error } = await supabase.from('exams').delete().eq('id', id);
    if (error) console.error('Error deleting exam:', error);
    else setExams(exams.filter(e => e.id !== id));
  };

  const handleFileUpload = async (examId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingExamId(examId);
    try {
      let text = '';
      if (file.type === 'application/pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text += content.items.map((item: any) => item.str).join(' ') + '\n';
        }
      } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        text = result.value;
      } else {
        text = await file.text();
      }

      // Call Edge Function to extract questions
      const { error } = await supabase.functions.invoke('extract-questions', {
        body: { examId, text }
      });

      if (error) throw error;
      alert('Questions extracted and saved successfully!');
    } catch (err) {
      console.error('Error uploading/processing file:', err);
      alert('Failed to process file. Check console for details.');
    } finally {
      setUploadingExamId(null);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/lecturer/login');
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans">
      {/* Sidebar/Nav */}
      <nav className="bg-primary text-white p-4 flex justify-between items-center sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-8 h-8 text-accent" />
          <span className="text-xl font-bold tracking-tight">SecureLab <span className="text-accent/60 font-medium">Lecturer</span></span>
        </div>
        <button onClick={handleLogout} className="flex items-center gap-2 text-panel/60 hover:text-white transition-colors">
          <LogOut className="w-5 h-5" />
          <span>Logout</span>
        </button>
      </nav>

      <main className="max-w-6xl mx-auto p-8">
        <div className="flex justify-between items-center mb-10">
          <div>
            <h1 className="text-3xl font-bold text-primary">Exam Management</h1>
            <p className="text-slate-500">Create, manage, and monitor your academic assessments</p>
          </div>
          <button
            onClick={() => setIsCreating(true)}
            className="bg-primary text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-primary/90 transition-all shadow-lg"
          >
            <Plus className="w-5 h-5" />
            Create New Exam
          </button>
        </div>

        {isCreating && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] p-6">
            <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl">
              <h2 className="text-2xl font-bold mb-6 text-primary">New Exam Details</h2>
              <form onSubmit={handleCreateExam} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Exam Title</label>
                  <input
                    type="text"
                    required
                    value={newExam.title}
                    onChange={(e) => setNewExam({ ...newExam, title: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-4 py-2 outline-none focus:border-primary transition-all"
                    placeholder="e.g. Introduction to Psychology"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Duration (minutes)</label>
                  <input
                    type="number"
                    required
                    value={newExam.duration}
                    onChange={(e) => setNewExam({ ...newExam, duration: parseInt(e.target.value) })}
                    className="w-full border border-slate-200 rounded-lg px-4 py-2 outline-none focus:border-primary transition-all"
                  />
                </div>
                <div className="flex gap-3 mt-8">
                  <button
                    type="button"
                    onClick={() => setIsCreating(false)}
                    className="flex-1 py-3 border border-slate-200 rounded-lg font-bold hover:bg-slate-50 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-3 bg-primary text-white rounded-lg font-bold hover:bg-primary/90 transition-all shadow-md"
                  >
                    Create Exam
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <Loader2 className="w-10 h-10 animate-spin mb-4" />
            <p>Loading your exams...</p>
          </div>
        ) : exams.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center">
            <FileText className="w-16 h-16 text-slate-200 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-slate-600 mb-2">No exams found</h3>
            <p className="text-slate-400 max-w-xs mx-auto mb-8">Get started by creating your first exam and uploading questions.</p>
            <button
              onClick={() => setIsCreating(true)}
              className="text-primary font-bold flex items-center gap-2 mx-auto hover:underline"
            >
              <Plus className="w-5 h-5" />
              Create your first exam
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {exams.map((exam) => (
              <div key={exam.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all overflow-hidden group">
                <div className="p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                      exam.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {exam.is_active ? 'Active' : 'Draft'}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => toggleExamStatus(exam.id, exam.is_active)}
                        className="p-2 text-slate-400 hover:text-primary transition-colors"
                        title={exam.is_active ? "Deactivate" : "Activate"}
                      >
                        {exam.is_active ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                      <button
                        onClick={() => deleteExam(exam.id)}
                        className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                  <h3 className="text-xl font-bold text-primary mb-1 line-clamp-1">{exam.title}</h3>
                  <p className="text-sm text-slate-400 mb-6">{exam.duration_minutes} Minutes</p>

                  <div className="space-y-3">
                    <label className="flex items-center justify-center gap-2 w-full py-3 bg-slate-50 text-slate-600 rounded-xl cursor-pointer hover:bg-slate-100 transition-all border border-slate-200">
                      {uploadingExamId === exam.id ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <FileUp className="w-5 h-5" />
                      )}
                      <span className="font-bold">Upload Doc</span>
                      <input
                        type="file"
                        className="hidden"
                        accept=".pdf,.docx,.txt"
                        onChange={(e) => handleFileUpload(exam.id, e)}
                        disabled={uploadingExamId !== null}
                      />
                    </label>

                    <button
                      onClick={() => navigate(`/lecturer/results/${exam.id}`)}
                      className="flex items-center justify-center gap-2 w-full py-3 bg-white text-primary border border-primary rounded-xl font-bold hover:bg-primary/5 transition-all"
                    >
                      <BarChart3 className="w-5 h-5" />
                      View Results
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default LecturerDashboard;

const ShieldCheck = ({ className }: { className?: string }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>
);
