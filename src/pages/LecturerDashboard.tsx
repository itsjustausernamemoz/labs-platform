import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  Plus, FileUp, Trash2, Eye, EyeOff,
  BarChart3, LogOut, Loader2, FileText,
  Save, Edit3, UserPlus, ShieldCheck, Download
} from 'lucide-react';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';
import { useNotification } from '../components/NotificationProvider';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

interface Exam {
  id: string;
  title: string;
  duration_minutes: number;
  is_active: boolean;
  created_at: string;
  total_marks?: number;
  allowed_violations?: number;
  enrollment_code: string;
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
  const [newExam, setNewExam] = useState({ 
    title: '', 
    duration: 60,
    total_marks: 100,
    allowed_violations: 3,
    enrollment_code: Math.random().toString(36).substring(2, 8).toUpperCase()
  });
  const [uploadingExamId, setUploadingExamId] = useState<string | null>(null);
  const [editingExamQuestions, setEditingExamQuestions] = useState<Exam | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isSavingQuestions, setIsSavingQuestions] = useState(false);
  const [enrollingExam, setEnrollingExam] = useState<Exam | null>(null);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const { showToast, showConfirm } = useNotification();

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

    if (error) {
      console.error('Error fetching exams:', error);
      showToast('Failed to fetch examinations. Please refresh the page.', 'error');
    } else {
      setExams(data || []);
    }
    setIsLoading(false);
  };

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('exams')
        .insert([{
          title: newExam.title,
          duration_minutes: newExam.duration,
          lecturer_id: user.id,
          total_marks: newExam.total_marks,
          allowed_violations: newExam.allowed_violations,
          enrollment_code: newExam.enrollment_code
        }])
        .select()
        .single();

      if (error) throw error;
      
      setExams([data, ...exams]);
      setIsCreating(false);
      setNewExam({ 
        title: '', 
        duration: 60, 
        total_marks: 100,
        allowed_violations: 3,
        enrollment_code: Math.random().toString(36).substring(2, 8).toUpperCase()
      });
      showToast('Exam created successfully!', 'success');
    } catch (err: any) {
      console.error('Error creating exam:', err);
      showToast(err.message || 'Failed to create exam. Please check your connection and try again.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const fetchQuestions = async (examId: string) => {
    const { data, error } = await supabase
      .from('questions')
      .select('*')
      .eq('exam_id', examId)
      .order('order_index', { ascending: true });

    if (error) {
      console.error('Error fetching questions:', error);
      showToast('Failed to load exam questions.', 'error');
    } else {
      setQuestions(data || []);
    }
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
      showToast('Questions saved successfully!', 'success');
    } catch (err) {
      console.error('Error saving questions:', err);
      showToast('Failed to save questions', 'error');
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

      const studentNumbers = jsonData
        .map(row => row.student_number?.toString().trim())
        .filter(num => num);

      if (studentNumbers.length === 0) {
        showToast('No student numbers found in the Excel file. Please ensure there is a "student_number" column.', 'error');
        return;
      }

      // 1. Bulk upsert students to ensure they exist
      const uniqueStudentNumbers = [...new Set(studentNumbers)];
      const studentsToUpsert = uniqueStudentNumbers.map(num => ({ student_number: num }));
      const { data: upsertedStudents, error: upsertError } = await supabase
        .from('students')
        .upsert(studentsToUpsert, { onConflict: 'student_number' })
        .select();

      if (upsertError) throw upsertError;

      // 2. Bulk enroll students
      const enrollmentsToUpsert = (upsertedStudents || []).map(s => ({
        exam_id: examId,
        student_id: s.id
      }));

      const { error: enrollError } = await supabase
        .from('enrollments')
        .upsert(enrollmentsToUpsert, { onConflict: 'exam_id,student_id' });

      if (enrollError) throw enrollError;

      showToast(`Successfully enrolled ${studentNumbers.length} students!`, 'success');
      setEnrollingExam(null);
    } catch (err: any) {
      console.error('Error enrolling students:', err);
      showToast(err.message || 'Failed to enroll students', 'error');
    } finally {
      setIsEnrolling(false);
      // Reset file input
      event.target.value = '';
    }
  };

  const handleQuestionExcelUpload = async (examId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsSavingQuestions(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];

      const mappedQuestions = jsonData.map((row, idx) => {
        const type = (row.type || 'mcq').toLowerCase().includes('mcq') ? 'mcq' : 'structured';
        const options = type === 'mcq' ? [
          row.option_a || '',
          row.option_b || '',
          row.option_c || '',
          row.option_d || ''
        ].filter(opt => opt !== '') : null;

        return {
          exam_id: examId,
          type,
          question_text: row.question_text || `Question ${idx + 1}`,
          options,
          correct_answer: row.correct_answer?.toString() || '',
          marks: parseInt(row.marks) || 1,
          order_index: idx
        };
      });

      if (mappedQuestions.length === 0) {
        throw new Error('No valid questions found in Excel. Required columns: question_text, type, option_a, option_b, option_c, option_d, correct_answer, marks');
      }

      // 1. Clear existing questions
      const { error: delError } = await supabase.from('questions').delete().eq('exam_id', examId);
      if (delError) throw delError;

      // 2. Insert new ones
      const { error: insError } = await supabase.from('questions').insert(mappedQuestions);
      if (insError) throw insError;

      showToast(`${mappedQuestions.length} questions uploaded successfully!`, 'success');
      if (editingExamQuestions?.id === examId) {
        fetchQuestions(examId);
      }
    } catch (err: any) {
      console.error('Error uploading questions Excel:', err);
      showToast(err.message || 'Failed to upload questions', 'error');
    } finally {
      setIsSavingQuestions(false);
      event.target.value = '';
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

  const regenerateEnrollmentCode = async (examId: string) => {
    const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const { error } = await supabase
      .from('exams')
      .update({ enrollment_code: newCode })
      .eq('id', examId);

    if (error) {
      console.error('Error regenerating code:', error);
      showToast('Failed to regenerate code', 'error');
    } else {
      setExams(exams.map(e => e.id === examId ? { ...e, enrollment_code: newCode } : e));
      showToast('New enrollment code generated!', 'success');
    }
  };

  const deleteExam = async (id: string) => {
    showConfirm({
      title: 'Delete Exam',
      message: 'Are you sure you want to delete this exam? This will remove all submissions, questions, and enrollments linked to it.',
      confirmText: 'Delete',
      onConfirm: async () => {
        setIsLoading(true);
        const { error } = await supabase.from('exams').delete().eq('id', id);
        if (error) {
          console.error('Error deleting exam:', error);
          showToast('Failed to delete exam.', 'error');
        } else {
          setExams(exams.filter(e => e.id !== id));
          showToast('Exam deleted successfully.', 'success');
        }
        setIsLoading(false);
      }
    });
  };

  const handleFileUpload = async (examId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingExamId(examId);
    console.log('Starting file upload for exam:', examId, 'File type:', file.type);
    try {
      let text = '';
      if (file.type === 'application/pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        // Extract text from all pages in parallel for better performance
        const pagePromises = Array.from({ length: pdf.numPages }, (_, i) => 
          pdf.getPage(i + 1).then(async (page) => {
            const content = await page.getTextContent();
            return content.items.map((item: any) => item.str).join(' ');
          })
        );
        
        const pagesText = await Promise.all(pagePromises);
        text = pagesText.join('\n');
      } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        text = result.value;
        if (result.messages.length > 0) {
          console.log('Mammoth messages:', result.messages);
        }
      } else {
        text = await file.text();
      }

      console.log('Text extraction complete. Length:', text.length, 'Characters.');
      if (!text.trim()) {
        throw new Error('Could not extract any text from the file. Please ensure it is not empty or protected.');
      }

      // Call Edge Function to extract questions
      console.log('Invoking Edge Function extract-questions with payload size:', new TextEncoder().encode(text).length, 'bytes');
      
      const { data, error } = await supabase.functions.invoke('extract-questions', {
        body: { examId, text }
      });

      console.log('Edge Function response:', { data, error });

      if (error) {
        console.error('Supabase function error:', error);
        throw new Error(`Cloud Error: ${error.message || 'Failed to send a request to the Edge Function'}`);
      }
      
      if (data?.error) {
        throw new Error(`AI Processing Error: ${data.error}`);
      }

      showToast('Questions extracted and saved successfully!', 'success');
    } catch (err: any) {
      console.error('Error uploading/processing file:', err);
      showToast(err.message || 'Failed to process file. Check console for details.', 'error');
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
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Duration (minutes)</label>
                    <input
                      type="number"
                      required
                      min="1"
                      value={newExam.duration}
                      onChange={(e) => setNewExam({ ...newExam, duration: parseInt(e.target.value) || 60 })}
                      className="w-full border border-slate-200 rounded-lg px-4 py-2 outline-none focus:border-primary transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Total Marks</label>
                    <input
                      type="number"
                      required
                      min="1"
                      value={newExam.total_marks}
                      onChange={(e) => setNewExam({ ...newExam, total_marks: parseInt(e.target.value) || 100 })}
                      className="w-full border border-slate-200 rounded-lg px-4 py-2 outline-none focus:border-primary transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Allowed Violations</label>
                    <input
                      type="number"
                      required
                      min="1"
                      value={newExam.allowed_violations}
                      onChange={(e) => setNewExam({ ...newExam, allowed_violations: parseInt(e.target.value) || 3 })}
                      className="w-full border border-slate-200 rounded-lg px-4 py-2 outline-none focus:border-primary transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Enrollment Code</label>
                    <input
                      type="text"
                      required
                      value={newExam.enrollment_code}
                      onChange={(e) => setNewExam({ ...newExam, enrollment_code: e.target.value.toUpperCase() })}
                      className="w-full border border-slate-200 rounded-lg px-4 py-2 outline-none focus:border-primary transition-all font-mono font-bold tracking-widest"
                      maxLength={6}
                      placeholder="6-CHARS"
                    />
                  </div>
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
                    disabled={isSubmitting}
                    className="flex-1 py-3 bg-primary text-white rounded-lg font-bold hover:bg-primary/90 transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      'Create Exam'
                    )}
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
                  <div className="flex items-center justify-between mb-6">
                    <p className="text-sm text-slate-400">{exam.duration_minutes} Minutes</p>
                    <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Code:</span>
                      <code className="text-xs font-bold text-primary tracking-widest">{exam.enrollment_code}</code>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(exam.enrollment_code);
                          showToast('Code copied to clipboard!', 'success');
                        }}
                        className="p-1 hover:bg-slate-200 rounded transition-colors text-slate-400 hover:text-primary"
                        title="Copy code"
                      >
                         <Plus className="w-3 h-3 rotate-45" />
                      </button>
                      <button
                        onClick={() => regenerateEnrollmentCode(exam.id)}
                        className="p-1 hover:bg-slate-200 rounded transition-colors text-slate-400 hover:text-primary"
                        title="Regenerate code"
                      >
                         <ShieldCheck className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex items-center justify-center gap-2 py-3 bg-slate-50 text-slate-600 rounded-xl cursor-pointer hover:bg-slate-100 transition-all border border-slate-200 text-sm">
                        {uploadingExamId === exam.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <FileUp className="w-4 h-4" />
                        )}
                        <span className="font-bold whitespace-nowrap">Upload Paper</span>
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
                        <span className="whitespace-nowrap">Edit Qs</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex items-center justify-center gap-2 py-3 bg-white text-primary border border-primary rounded-xl font-bold hover:bg-primary/5 transition-all text-sm cursor-pointer">
                        {isSavingQuestions && uploadingExamId === exam.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4 rotate-180" />
                        )}
                        <span className="whitespace-nowrap">Import Qs</span>
                        <input
                          type="file"
                          className="hidden"
                          accept=".xlsx,.xls"
                          onChange={(e) => {
                            setUploadingExamId(exam.id);
                            handleQuestionExcelUpload(exam.id, e);
                          }}
                          disabled={isSavingQuestions}
                        />
                      </label>
                      <label className="flex items-center justify-center gap-2 py-3 bg-white text-primary border border-primary rounded-xl font-bold hover:bg-primary/5 transition-all text-sm cursor-pointer">
                        {isEnrolling && enrollingExam?.id === exam.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <UserPlus className="w-4 h-4" />
                        )}
                        <span className="whitespace-nowrap">Enroll</span>
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
                    </div>

                    <button
                      onClick={() => navigate(`/lecturer/results/${exam.id}`)}
                      className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-white rounded-xl font-bold hover:bg-primary/95 transition-all text-sm shadow-md"
                    >
                      <BarChart3 className="w-4 h-4" />
                      View Results & Submissions
                    </button>
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
                    onClick={() => {
                      const template = [
                        ['question_text', 'type', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer', 'marks'],
                        ['Sample Multiple Choice Question', 'MCQ', 'Option 1', 'Option 2', 'Option 3', 'Option 4', 'A', '1'],
                        ['Sample Structured Question', 'Structured', '', '', '', '', 'This is the model answer.', '5']
                      ];
                      const wb = XLSX.utils.book_new();
                      const ws = XLSX.utils.aoa_to_sheet(template);
                      XLSX.utils.book_append_sheet(wb, ws, "Template");
                      XLSX.writeFile(wb, "question_template.xlsx");
                      showToast('Template downloaded!', 'info');
                    }}
                    className="px-4 py-2 border border-white/20 rounded-lg text-white/60 hover:text-white flex items-center gap-2 hover:bg-white/5 transition-all"
                  >
                    <Download className="w-4 h-4" />
                    Template
                  </button>
                  <label className="px-4 py-2 border border-accent/50 text-accent rounded-lg flex items-center gap-2 hover:bg-accent/10 cursor-pointer transition-all">
                    <FileUp className="w-4 h-4" />
                    Upload Excel
                    <input
                      type="file"
                      className="hidden"
                      accept=".xlsx,.xls"
                      onChange={(e) => handleQuestionExcelUpload(editingExamQuestions.id, e)}
                    />
                  </label>
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

