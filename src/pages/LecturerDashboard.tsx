import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  Plus, FileUp, Trash2, Eye, EyeOff,
  BarChart3, LogOut, Loader2, FileText,
  Save, Edit3, UserPlus
} from 'lucide-react';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';

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
  const [enrollingExam, setEnrollingExam] = useState<Exam | null>(null);
  const [isEnrolling, setIsEnrolling] = useState(false);
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

  const fetchQuestions = async (examId: string) => {
    const { data, error } = await supabase
      .from('questions')
      .select('*')
      .eq('exam_id', examId)
      .order('order_index', { ascending: true });

    if (error) console.error('Error fetching questions:', error);
    else setQuestions(data || []);
  };

  const handleEditQuestions = (exam: Exam) => {
    setEditingExamQuestions(exam);
    fetchQuestions(exam.id);
  };

  const handleUpdateQuestion = (id: string, updates: Partial<Question>) => {
    setQuestions(questions.map(q => q.id === id ? { ...q, ...updates } : q));
  };

  const handleAddQuestion = () => {
    const newQ: Question = {
      id: `new-${Date.now()}`,
      type: 'mcq',
      question_text: 'New Question',
      options: ['A. ', 'B. ', 'C. ', 'D. '],
      correct_answer: 'A',
      marks: 1
    };
    setQuestions([...questions, newQ]);
  };

  const handleRemoveQuestion = (id: string) => {
    setQuestions(questions.filter(q => q.id !== id));
  };

  const handleSaveQuestions = async () => {
    if (!editingExamQuestions) return;
    setIsSavingQuestions(true);

    try {
      // Delete existing questions
      const { error: delError } = await supabase
        .from('questions')
        .delete()
        .eq('exam_id', editingExamQuestions.id);

      if (delError) throw delError;

      // Insert updated questions
      const toInsert = questions.map((q, idx) => {
        const { id, ...rest } = q;
        return {
          ...rest,
          exam_id: editingExamQuestions.id,
          order_index: idx
        };
      });

      const { error: insError } = await supabase
        .from('questions')
        .insert(toInsert);

      if (insError) throw insError;
      setEditingExamQuestions(null);
    } catch (err) {
      console.error('Error saving questions:', err);
      alert('Failed to save questions');
    } finally {
      setIsSavingQuestions(false);
    }
  };

  const handleEnrollStudents = async (examId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsEnrolling(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];

      // Expecting a column 'student_number'
      const studentNumbers = jsonData
        .map(row => row.student_number?.toString().trim())
        .filter(num => num);

      if (studentNumbers.length === 0) {
        alert('No student numbers found in the Excel file. Please ensure there is a "student_number" column.');
        return;
      }

      for (const num of studentNumbers) {
        // 1. Ensure student exists
        let { data: student, error: sError } = await supabase
          .from('students')
          .select('id')
          .eq('student_number', num)
          .single();

        if (sError && sError.code === 'PGRST116') {
          const { data: newStudent, error: iError } = await supabase
            .from('students')
            .insert([{ student_number: num }])
            .select('id')
            .single();
          if (iError) throw iError;
          student = newStudent;
        } else if (sError) throw sError;

        // 2. Enroll student
        await supabase
          .from('enrollments')
          .upsert([{ exam_id: examId, student_id: student!.id }]);
      }

      alert(`Successfully enrolled ${studentNumbers.length} students!`);
      setEnrollingExam(null);
    } catch (err) {
      console.error('Error enrolling students:', err);
      alert('Failed to enroll students');
    } finally {
      setIsEnrolling(false);
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
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex items-center justify-center gap-2 py-3 bg-slate-50 text-slate-600 rounded-xl cursor-pointer hover:bg-slate-100 transition-all border border-slate-200 text-sm">
                        {uploadingExamId === exam.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <FileUp className="w-4 h-4" />
                        )}
                        <span className="font-bold">Upload</span>
                        <input
                          type="file"
                          className="hidden"
                          accept=".pdf,.docx,.txt"
                          onChange={(e) => handleFileUpload(exam.id, e)}
                          disabled={uploadingExamId !== null}
                        />
                      </label>
                      <button
                        onClick={() => handleEditQuestions(exam)}
                        className="flex items-center justify-center gap-2 py-3 bg-slate-50 text-slate-600 rounded-xl hover:bg-slate-100 transition-all border border-slate-200 text-sm font-bold"
                      >
                        <Edit3 className="w-4 h-4" />
                        Edit Qs
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex items-center justify-center gap-2 py-3 bg-white text-primary border border-primary rounded-xl font-bold hover:bg-primary/5 transition-all text-sm cursor-pointer">
                        {isEnrolling && enrollingExam?.id === exam.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <UserPlus className="w-4 h-4" />
                        )}
                        Enroll
                        <input
                          type="file"
                          className="hidden"
                          accept=".xlsx,.xls,.csv"
                          onChange={(e) => {
                            setEnrollingExam(exam);
                            handleEnrollStudents(exam.id, e);
                          }}
                          disabled={isEnrolling}
                        />
                      </label>
                      <button
                        onClick={() => navigate(`/lecturer/results/${exam.id}`)}
                        className="flex items-center justify-center gap-2 py-3 bg-white text-primary border border-primary rounded-xl font-bold hover:bg-primary/5 transition-all text-sm"
                      >
                        <BarChart3 className="w-4 h-4" />
                        Results
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {editingExamQuestions && (
          <div className="fixed inset-0 bg-primary z-[150] overflow-y-auto p-8">
            <div className="max-w-4xl mx-auto">
              <div className="flex justify-between items-center mb-10 sticky top-0 bg-primary py-4 z-10 border-b border-white/10">
                <div>
                  <h2 className="text-3xl font-bold text-white">Review Questions</h2>
                  <p className="text-panel/60">{editingExamQuestions.title}</p>
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={() => setEditingExamQuestions(null)}
                    className="px-6 py-2 text-panel/60 hover:text-white font-bold"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveQuestions}
                    disabled={isSavingQuestions}
                    className="bg-accent text-primary px-8 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-accent/90 transition-all shadow-lg disabled:opacity-50"
                  >
                    {isSavingQuestions ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                    Save All Changes
                  </button>
                </div>
              </div>

              <div className="space-y-8 pb-20">
                {questions.map((q) => (
                  <div key={q.id} className="bg-white/5 border border-white/10 rounded-2xl p-6 relative group">
                    <button
                      onClick={() => handleRemoveQuestion(q.id)}
                      className="absolute top-6 right-6 p-2 text-red-400 hover:bg-red-400/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                      <div>
                        <label className="block text-xs font-bold text-panel/40 uppercase tracking-widest mb-2">Question Type</label>
                        <select
                          value={q.type}
                          onChange={(e) => handleUpdateQuestion(q.id, { type: e.target.value as any })}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 outline-none focus:border-accent text-white"
                        >
                          <option value="mcq">Multiple Choice (MCQ)</option>
                          <option value="structured">Structured / Open-ended</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-panel/40 uppercase tracking-widest mb-2">Marks</label>
                        <input
                          type="number"
                          value={q.marks}
                          onChange={(e) => handleUpdateQuestion(q.id, { marks: parseInt(e.target.value) })}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 outline-none focus:border-accent text-white"
                        />
                      </div>
                    </div>

                    <div className="mb-6">
                      <label className="block text-xs font-bold text-panel/40 uppercase tracking-widest mb-2">Question Text</label>
                      <textarea
                        value={q.question_text}
                        onChange={(e) => handleUpdateQuestion(q.id, { question_text: e.target.value })}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 outline-none focus:border-accent text-white h-24 resize-none"
                      />
                    </div>

                    {q.type === 'mcq' ? (
                      <div>
                        <label className="block text-xs font-bold text-panel/40 uppercase tracking-widest mb-2">Options & Correct Answer</label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {(q.options || []).map((opt, optIdx) => (
                            <div key={optIdx} className="flex gap-2 items-center">
                              <button
                                onClick={() => handleUpdateQuestion(q.id, { correct_answer: String.fromCharCode(65 + optIdx) })}
                                className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold border transition-all ${
                                  q.correct_answer === String.fromCharCode(65 + optIdx)
                                    ? 'bg-accent border-accent text-primary'
                                    : 'bg-white/5 border-white/10 text-white'
                                }`}
                              >
                                {String.fromCharCode(65 + optIdx)}
                              </button>
                              <input
                                type="text"
                                value={opt}
                                onChange={(e) => {
                                  const newOpts = [...(q.options || [])];
                                  newOpts[optIdx] = e.target.value;
                                  handleUpdateQuestion(q.id, { options: newOpts });
                                }}
                                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 outline-none focus:border-accent text-white text-sm"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label className="block text-xs font-bold text-panel/40 uppercase tracking-widest mb-2">Model Answer</label>
                        <textarea
                          value={q.correct_answer}
                          onChange={(e) => handleUpdateQuestion(q.id, { correct_answer: e.target.value })}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 outline-none focus:border-accent text-white h-32 resize-none"
                          placeholder="Provide the ideal answer for AI grading reference..."
                        />
                      </div>
                    )}
                  </div>
                ))}

                <button
                  onClick={handleAddQuestion}
                  className="w-full py-6 border-2 border-dashed border-white/10 rounded-2xl text-panel/40 hover:text-accent hover:border-accent/50 transition-all flex flex-col items-center gap-2"
                >
                  <Plus className="w-8 h-8" />
                  <span className="font-bold uppercase tracking-widest text-xs">Add New Question</span>
                </button>
              </div>
            </div>
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
