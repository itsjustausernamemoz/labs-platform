import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  Plus, FileUp, Trash2, Eye, EyeOff,
  BarChart3, LogOut, Loader2, FileText,
  Save, Edit3, UserPlus, ShieldCheck, Download,
  User, X, Lock, Clock, Mail, RotateCcw
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

interface LecturerProfile {
  id: string;
  full_name: string;
  email: string;
}

interface Question {
  id: string;
  type: 'mcq' | 'structured';
  question_text: string;
  options: string[] | null;
  correct_answer: string;
  marks: number;
  can_copy: boolean;
}

interface ExamWithStats extends Exam {
  total_submissions: number;
  marked_submissions: number;
  average_score?: number;
  lecturer_email?: string;
  lecturer_id: string;
}

const LecturerDashboard: React.FC = () => {
  const [exams, setExams] = useState<ExamWithStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isCollaborating, setIsCollaborating] = useState(false);
  const [collabExamId, setCollabExamId] = useState<string | null>(null);
  const [newCollabEmail, setNewCollabEmail] = useState('');
  const [isAddingCollab, setIsAddingCollab] = useState(false);
  const [newExam, setNewExam] = useState({ 
    title: '', 
    duration: 60,
    total_marks: 100,
    allowed_violations: 3,
    enrollment_code: Math.random().toString(36).substring(2, 8).toUpperCase()
  });
  const [uploadingExamId, setUploadingExamId] = useState<string | null>(null);
  const [editingExamQuestions, setEditingExamQuestions] = useState<ExamWithStats | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isSavingQuestions, setIsSavingQuestions] = useState(false);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [profile, setProfile] = useState<LecturerProfile | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  
  const navigate = useNavigate();
  const { showToast, showConfirm } = useNotification();

  useEffect(() => {
    fetchProfile();
    fetchExams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('lecturer_profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      console.error('Error fetching profile:', error);
    } else if (data) {
      setProfile(data);
      setEditedName(data.full_name);
    } else {
      // Create initial profile if it doesn't exist
      const newProfile = {
        id: user.id,
        full_name: user.email?.split('@')[0] || 'Lecturer',
        email: user.email || ''
      };
      await supabase.from('lecturer_profiles').insert([newProfile]);
      setProfile(newProfile);
      setEditedName(newProfile.full_name);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !editedName.trim()) return;
    setIsSavingProfile(true);

    try {
      const { error } = await supabase
        .from('lecturer_profiles')
        .update({ 
          full_name: editedName.trim(),
          updated_at: new Date().toISOString()
        })
        .eq('id', profile.id);

      if (error) throw error;
      
      setProfile({ ...profile, full_name: editedName.trim() });
      setIsEditingProfile(false);
      showToast('Profile updated successfully!', 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (newPassword.length < 6) {
      showToast('Password must be at least 6 characters', 'error');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      showToast('Passwords do not match', 'error');
      return;
    }

    setIsUpdatingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });
      if (error) throw error;
      showToast('Password updated successfully!', 'success');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const fetchExams = async () => {
    setIsLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate('/lecturer/login');
      return;
    }

    try {
      // Fetch exam list (no embedded submissions — we count separately)
      const { data: ownExams, error: ownError } = await supabase
        .from('exams')
        .select('*')
        .order('created_at', { ascending: false });

      if (ownError) throw ownError;

      // For each exam, fetch total and graded submission counts in parallel.
      // Using server-side COUNT avoids shipping 1000+ rows to the browser
      // when a large exam is running.
      const examsWithStats: ExamWithStats[] = await Promise.all(
        (ownExams || []).map(async (exam) => {
          const [totalResult, gradedResult, submissionsResult] = await Promise.all([
            supabase
              .from('submissions')
              .select('*', { count: 'exact', head: true })
              .eq('exam_id', exam.id),
            supabase
              .from('submissions')
              .select('*', { count: 'exact', head: true })
              .eq('exam_id', exam.id)
              .eq('graded', true),
            supabase
              .from('submissions')
              .select('score, total_marks')
              .eq('exam_id', exam.id)
              .not('status', 'eq', 'draft')
          ]);

          const subs = submissionsResult.data || [];
          const avgScore = subs.length > 0
            ? (subs.reduce((acc, curr) => acc + (curr.score / (curr.total_marks || 1)), 0) / subs.length * 100)
            : 0;

          return {
            ...exam,
            total_submissions: totalResult.count ?? 0,
            marked_submissions: gradedResult.count ?? 0,
            average_score: parseFloat(avgScore.toFixed(1))
          };
        })
      );

      setExams(examsWithStats);
    } catch (error) {
      console.error('Error fetching exams:', error);
      showToast('Failed to fetch examinations.', 'error');
    } finally {
      setIsLoading(false);
    }
  };


  const handleAddCoMarker = async (examId: string) => {
    if (!newCollabEmail) return;
    setIsAddingCollab(true);
    try {
      const { error } = await supabase
        .from('exam_lecturers')
        .insert([{
          exam_id: examId,
          lecturer_email: newCollabEmail
        }]);

      if (error) {
        if (error.code === '23505') throw new Error('Lecturer is already enrolled in this exam.');
        throw error;
      }

      showToast(`Lecturer ${newCollabEmail} added as co-marker!`, 'success');
      setNewCollabEmail('');
      setIsCollaborating(false);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setIsAddingCollab(false);
    }
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
      
      const examWithStats: ExamWithStats = {
        ...data,
        total_submissions: 0,
        marked_submissions: 0
      };
      
      setExams([examWithStats, ...exams]);
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

  const handleEditQuestions = (exam: ExamWithStats) => {
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
      marks: 1,
      can_copy: false
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
    } catch (err: any) {
      console.error('Error enrolling students:', err);
      showToast(err.message || 'Failed to enroll students', 'error');
    } finally {
      setIsEnrolling(false);
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
          can_copy: row.can_copy === 'TRUE' || row.can_copy === true || false,
          order_index: idx
        };
      });

      if (mappedQuestions.length === 0) {
        throw new Error('No valid questions found in Excel.');
      }

      const { error: delError } = await supabase.from('questions').delete().eq('exam_id', examId);
      if (delError) throw delError;

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
      showToast('Failed to regenerate code', 'error');
    } else {
      setExams(exams.map(e => e.id === examId ? { ...e, enrollment_code: newCode } : e));
      showToast('New enrollment code generated!', 'success');
    }
  };

  const deleteExam = async (id: string) => {
    showConfirm({
      title: 'Delete Exam',
      message: 'Are you sure you want to delete this exam?',
      confirmText: 'Delete',
      onConfirm: async () => {
        setIsLoading(true);
        const { error } = await supabase.from('exams').delete().eq('id', id);
        if (error) {
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
    try {
      let text = '';
      if (file.type === 'application/pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
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
      } else {
        text = await file.text();
      }

      if (!text.trim()) throw new Error('Could not extract text from file.');

      const { data, error } = await supabase.functions.invoke('extract-questions', {
        body: { examId, text }
      });

      if (error || data?.error) throw new Error(error?.message || data?.error);
      
      showToast('Questions extracted successfully!', 'success');
      if (editingExamQuestions?.id === examId) fetchQuestions(examId);
    } catch (err: any) {
      showToast(err.message || 'Failed to process file.', 'error');
    } finally {
      setUploadingExamId(null);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/lecturer/login');
  };

  return (
    <div className="min-h-screen bg-[#0A1024] text-white font-sans selection:bg-accent/30 selection:text-white">
      {/* Background decoration */}
      <div className="fixed top-0 left-0 w-full h-full pointer-events-none opacity-40">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-500/5 rounded-full blur-[120px] animate-pulse-subtle" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] bg-accent/5 rounded-full blur-[120px] animate-pulse-subtle" style={{ animationDelay: '-3s' }} />
      </div>

      <nav className="sticky top-0 z-50 glass-panel border-x-0 border-t-0 px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3 group cursor-pointer" onClick={() => navigate('/lecturer/dashboard')}>
            <div className="w-10 h-10 bg-accent/10 rounded-xl flex items-center justify-center group-hover:bg-accent/20 transition-all">
              <ShieldCheck className="w-6 h-6 text-accent" />
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-black tracking-tight font-outfit leading-none">SecureLab</span>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-accent/60 mt-1">Administrator</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden md:flex flex-col items-end mr-2">
              <span className="text-[10px] text-white/30 font-bold uppercase tracking-widest leading-none mb-1">Session Active</span>
              <span className="text-xs font-bold text-white/60">{profile?.email}</span>
            </div>
            <button 
              onClick={handleLogout} 
              className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-400 transition-all"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-12 relative z-10">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8 mb-16">
          <div className="space-y-2">
            <h1 className="text-5xl font-black tracking-tight font-outfit">
              Dashboard
            </h1>
            <p className="text-white/40 text-lg max-w-2xl">
              Manage your academic assessments, track marking progress, and coordinate with co-markers.
            </p>
          </div>
          <div className="flex flex-wrap gap-4">
            <button
              onClick={() => setIsEditingProfile(true)}
              className="glass-button bg-white/5 text-white border-white/10 px-6 py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center gap-3 hover:bg-white/10 transition-all shadow-xl"
            >
              <User className="w-5 h-5 text-accent" />
              Settings
            </button>
            <button
              onClick={() => setIsCreating(true)}
              className="glass-button bg-accent text-[#0A1024] px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center gap-3 hover:shadow-[0_0_30px_rgba(0,229,255,0.3)] transition-all"
            >
              <Plus className="w-6 h-6" />
              Create Examination
            </button>
          </div>
        </div>

        {isEditingProfile && (
          <div className="fixed inset-0 bg-[#0A1024]/80 backdrop-blur-xl flex items-center justify-center z-[100] p-6 animate-in fade-in duration-300">
            <div className="glass-panel max-w-xl w-full p-10 rounded-[3rem] shadow-2xl relative overflow-hidden">
              {/* Decorative element inside modal */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-accent/5 rounded-full blur-3xl -mr-16 -mt-16" />
              
              <div className="flex justify-between items-center mb-10 relative z-10">
                <div>
                  <h2 className="text-3xl font-black tracking-tight font-outfit">Security & Profile</h2>
                  <p className="text-white/40 text-xs font-bold uppercase tracking-widest mt-1">Laboratory Access Control</p>
                </div>
                <button 
                  onClick={() => setIsEditingProfile(false)} 
                  className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center hover:bg-white/10 transition-all group"
                >
                  <X className="w-6 h-6 text-white/30 group-hover:text-white transition-colors" />
                </button>
              </div>

              <form onSubmit={handleUpdateProfile} className="space-y-8 relative z-10">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-accent/60 uppercase tracking-[0.2em] ml-1">Full Name</label>
                    <div className="relative group">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/20 group-focus-within:text-accent transition-colors" />
                      <input
                        type="text"
                        required
                        value={editedName}
                        onChange={(e) => setEditedName(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-2xl pl-12 pr-4 py-4 outline-none focus:border-accent/50 focus:bg-white/[0.08] transition-all font-bold text-white placeholder:text-white/10"
                        placeholder="Administrator Name"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] ml-1">Email (ReadOnly)</label>
                    <div className="relative grayscale opacity-50">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/20" />
                      <input
                        type="email"
                        disabled
                        value={profile?.email || ''}
                        className="w-full bg-white/5 border border-white/10 rounded-2xl pl-12 pr-4 py-4 cursor-not-allowed font-bold text-white/40"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-6 pt-8 border-t border-white/5">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                      <Lock className="w-4 h-4 text-accent" />
                    </div>
                    <span className="text-xs font-black uppercase tracking-widest text-accent">Credential Management</span>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 outline-none focus:border-accent/50 transition-all font-bold text-white placeholder:text-white/20 text-sm"
                      placeholder="New Password"
                    />
                    <input
                      type="password"
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 outline-none focus:border-accent/50 transition-all font-bold text-white placeholder:text-white/20 text-sm"
                      placeholder="Confirm Password"
                    />
                  </div>
                  
                  <button
                    type="button"
                    onClick={handleUpdatePassword}
                    disabled={isUpdatingPassword || !newPassword}
                    className="w-full glass-button bg-white/5 text-white border-white/10 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-white/10 disabled:opacity-30 transition-all flex items-center justify-center gap-3"
                  >
                    {isUpdatingPassword ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5 text-accent" />}
                    Update Secure Password
                  </button>
                </div>
                
                <div className="flex gap-4 pt-4">
                  <button
                    type="submit"
                    disabled={isSavingProfile}
                    className="flex-1 glass-button bg-white text-[#0A1024] py-5 rounded-2xl font-black text-xs uppercase tracking-widest hover:scale-[1.02] shadow-xl flex items-center justify-center gap-3"
                  >
                    {isSavingProfile ? <Loader2 className="w-6 h-6 animate-spin" /> : <Save className="w-6 h-6" />}
                    Save Profile Changes
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {isCreating && (
          <div className="fixed inset-0 bg-[#0A1024]/80 backdrop-blur-xl flex items-center justify-center z-[100] p-6 animate-in zoom-in-95 duration-300">
            <div className="glass-panel max-w-xl w-full p-10 rounded-[3rem] shadow-2xl relative overflow-hidden">
              <div className="flex justify-between items-center mb-10">
                <div>
                  <h2 className="text-3xl font-black tracking-tight font-outfit text-white">New Assessment</h2>
                  <p className="text-accent/60 text-[10px] font-black uppercase tracking-[0.2em] mt-1">Configure Examination Parameters</p>
                </div>
                <button 
                  onClick={() => setIsCreating(false)} 
                  className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center hover:bg-white/10 transition-all group"
                >
                  <X className="w-6 h-6 text-white/30 group-hover:text-white transition-colors" />
                </button>
              </div>

              <form onSubmit={handleCreateExam} className="space-y-8">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-white/40 uppercase tracking-widest ml-1">Examination Title</label>
                  <input
                    type="text" 
                    required 
                    placeholder="e.g., Computer Science 101 Final"
                    value={newExam.title} 
                    onChange={(e) => setNewExam({ ...newExam, title: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-5 outline-none focus:border-accent/50 focus:bg-white/[0.08] transition-all font-bold text-lg text-white placeholder:text-white/10"
                  />
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-white/40 uppercase tracking-widest ml-1">Duration (Minutes)</label>
                    <div className="relative">
                      <Clock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                      <input 
                        type="number" 
                        required 
                        value={newExam.duration} 
                        onChange={(e) => setNewExam({ ...newExam, duration: parseInt(e.target.value) || 60 })} 
                        className="w-full bg-white/5 border border-white/10 rounded-2xl pl-12 pr-4 py-4 outline-none focus:border-accent/50 transition-all font-bold text-white shadow-inner"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-white/40 uppercase tracking-widest ml-1">Enrollment Code</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                      <input 
                        type="text" 
                        required 
                        value={newExam.enrollment_code} 
                        onChange={(e) => setNewExam({ ...newExam, enrollment_code: e.target.value.toUpperCase() })} 
                        className="w-full bg-white/5 border border-white/10 rounded-2xl pl-12 pr-4 py-4 outline-none focus:border-accent/50 transition-all font-bold text-white font-mono tracking-widest uppercase"
                        maxLength={6}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-white/40 uppercase tracking-widest ml-1">Total Marks</label>
                    <input 
                      type="number" 
                      required 
                      value={newExam.total_marks} 
                      onChange={(e) => setNewExam({ ...newExam, total_marks: parseInt(e.target.value) || 100 })} 
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 outline-none focus:border-accent/50 transition-all font-bold text-white shadow-inner"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-white/40 uppercase tracking-widest ml-1">Allowed Violations</label>
                    <input 
                      type="number" 
                      required 
                      value={newExam.allowed_violations} 
                      onChange={(e) => setNewExam({ ...newExam, allowed_violations: parseInt(e.target.value) || 3 })} 
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 outline-none focus:border-accent/50 transition-all font-bold text-white shadow-inner"
                    />
                  </div>
                </div>

                <div className="flex gap-4 pt-4">
                  <button 
                    type="submit" 
                    disabled={isSubmitting} 
                    className="flex-1 glass-button bg-accent text-[#0A1024] py-5 rounded-3xl font-black text-xs uppercase tracking-[0.2em] hover:scale-[1.02] shadow-[0_0_40px_rgba(0,229,255,0.2)] flex items-center justify-center gap-3 transition-all"
                  >
                    {isSubmitting ? <Loader2 className="w-6 h-6 animate-spin"/> : <ShieldCheck className="w-6 h-6"/>}
                    Initialize Laboratory Assessment
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {isCollaborating && (
          <div className="fixed inset-0 bg-[#0A1024]/80 backdrop-blur-xl flex items-center justify-center z-[100] p-6 animate-in fade-in zoom-in-95 duration-300">
            <div className="glass-panel max-w-md w-full p-10 rounded-[3rem] shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-accent/20" />
              <h2 className="text-3xl font-black tracking-tight font-outfit mb-2 text-white">Co-Marker Access</h2>
              <p className="text-white/40 text-xs font-bold uppercase tracking-widest mb-10">Delegate Assessment Permissions</p>
              
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-accent/60 uppercase tracking-widest ml-1">Lecturer Email Address</label>
                  <div className="relative group">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/20 group-focus-within:text-accent transition-colors" />
                    <input
                      type="email" 
                      required 
                      placeholder="lecturer@university.edu"
                      value={newCollabEmail} 
                      onChange={(e) => setNewCollabEmail(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-2xl pl-12 pr-4 py-4 outline-none focus:border-accent/50 focus:bg-white/[0.08] transition-all font-bold text-white placeholder:text-white/10"
                    />
                  </div>
                </div>

                <div className="flex gap-4">
                  <button 
                    onClick={() => setIsCollaborating(false)} 
                    className="flex-1 glass-button bg-white/5 text-white border-white/10 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={() => collabExamId && handleAddCoMarker(collabExamId)} 
                    disabled={isAddingCollab || !newCollabEmail} 
                    className="flex-1 glass-button bg-accent text-[#0A1024] py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:shadow-[0_0_30px_rgba(0,229,255,0.3)] disabled:opacity-30"
                  >
                    {isAddingCollab ? <Loader2 className="w-5 h-5 animate-spin mx-auto"/> : 'Grant Access'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <Loader2 className="w-12 h-12 text-accent animate-spin" />
            <p className="text-white/20 text-xs font-bold uppercase tracking-[0.3em]">Syncing Laboratory Data...</p>
          </div>
        ) : exams.length === 0 ? (
          <div className="glass-panel rounded-[3rem] p-24 text-center border-dashed">
            <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6">
              <FileText className="w-10 h-10 text-white/10" />
            </div>
            <h3 className="text-2xl font-black mb-2 font-outfit">No Examinations Found</h3>
            <p className="text-white/30 max-w-sm mx-auto mb-10">Create your first examination to begin managing assessments for your students.</p>
            <button
              onClick={() => setIsCreating(true)}
              className="glass-button bg-accent text-[#0A1024] px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest"
            >
              Start Now
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {exams.map((exam) => (
              <div key={exam.id} className="group relative glass-panel rounded-[2.5rem] overflow-hidden hover:bg-white/[0.06] hover:border-accent/30 transition-all duration-300">
                <div className="p-8">
                  <div className="flex justify-between items-start mb-6">
                    <div className={`px-4 py-1.5 rounded-full text-[10px] uppercase font-black tracking-widest border transition-colors ${
                      exam.is_active 
                        ? 'bg-green-500/10 text-green-400 border-green-500/20' 
                        : 'bg-white/5 text-white/30 border-white/5'
                    }`}>
                      {exam.is_active ? (
                        <span className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                          Published
                        </span>
                      ) : 'Draft Mode'}
                    </div>
                    <div className="flex gap-2">
                       <button 
                        onClick={() => toggleExamStatus(exam.id, exam.is_active)} 
                        className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center hover:bg-accent/10 hover:text-accent transition-all"
                        title={exam.is_active ? "Retract Assessment" : "Publish Assessment"}
                      >
                        {exam.is_active ? <EyeOff className="w-4 h-4"/> : <Eye className="w-4 h-4"/>}
                      </button>
                      <button 
                        onClick={() => deleteExam(exam.id)} 
                        className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center hover:bg-red-500/10 hover:text-red-400 transition-all"
                        title="Delete Exam"
                      >
                        <Trash2 className="w-4 h-4"/>
                      </button>
                    </div>
                  </div>

                  <h3 className="text-2xl font-black text-white mb-2 font-outfit truncate group-hover:text-accent transition-colors">{exam.title}</h3>
                  <div className="flex items-center gap-4 mb-8">
                    <div className="flex items-center gap-2 text-[10px] font-bold text-white/40 uppercase tracking-widest">
                      <Clock className="w-3.5 h-3.5" />
                      {exam.duration_minutes}m
                    </div>
                    {exam.average_score !== undefined && exam.total_submissions > 0 && (
                      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[10px] font-black uppercase tracking-widest leading-none">
                        <BarChart3 className="w-3 h-3" />
                        Avg: {exam.average_score}%
                      </div>
                    )}
                    <button 
                      onClick={() => regenerateEnrollmentCode(exam.id)}
                      className="flex items-center gap-2 px-2 py-1 bg-white/5 rounded-lg border border-white/5 hover:bg-accent/10 hover:border-accent/20 transition-all group/code"
                      title="Regenerate Code"
                    >
                      <span className="text-[10px] font-black uppercase text-accent/60 tracking-widest">Code:</span>
                      <span className="text-xs font-black text-white/80 font-mono select-all tracking-wider group-hover/code:text-accent">{exam.enrollment_code}</span>
                      <RotateCcw className="w-3 h-3 text-white/20 group-hover/code:text-accent group-hover/code:rotate-180 transition-all duration-500" />
                    </button>
                  </div>

                  {/* Stats Bar */}
                  <div className="space-y-4 mb-8">
                    <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-white/40">
                      <span>Marking Progress</span>
                      <span>{exam.marked_submissions} / {exam.total_submissions}</span>
                    </div>
                    <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
                      <div 
                        className="h-full bg-accent shadow-[0_0_10px_rgba(0,229,255,0.4)] transition-all duration-500" 
                        style={{ width: `${exam.total_submissions > 0 ? (exam.marked_submissions / exam.total_submissions) * 100 : 0}%` }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3">
                    <button
                      onClick={() => navigate(`/lecturer/results/${exam.id}`)}
                      className="glass-button bg-white text-[#0A1024] py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 hover:scale-[1.02] shadow-xl"
                    >
                      <BarChart3 className="w-5 h-5" />
                      Review & Grade
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-4 bg-white/5 border-t border-white/5 opacity-0 group-hover:opacity-100 transition-all divide-x divide-white/5">
                  <button 
                    onClick={() => handleEditQuestions(exam)}
                    className="p-4 flex flex-col items-center gap-2 hover:bg-white/5 transition-colors"
                    title="Edit Questions"
                  >
                    <Edit3 className="w-4 h-4 text-accent"/>
                    <span className="text-[8px] font-bold uppercase tracking-widest">Edit</span>
                  </button>
                  <label className="p-4 flex flex-col items-center gap-2 hover:bg-white/5 transition-colors cursor-pointer">
                    <FileUp className="w-4 h-4 text-accent"/>
                    <span className="text-[8px] font-bold uppercase tracking-widest">Upload</span>
                    <input type="file" className="hidden" accept=".pdf,.docx,.txt" onChange={(e) => handleFileUpload(exam.id, e)} disabled={uploadingExamId !== null}/>
                  </label>
                  <button 
                    onClick={() => { setCollabExamId(exam.id); setIsCollaborating(true); }}
                    className="p-4 flex flex-col items-center gap-2 hover:bg-white/5 transition-colors"
                    title="Add Co-Marker"
                  >
                    <UserPlus className="w-4 h-4 text-accent"/>
                    <span className="text-[8px] font-bold uppercase tracking-widest">Admin</span>
                  </button>
                  <label className="p-4 flex flex-col items-center gap-2 hover:bg-white/5 transition-colors cursor-pointer" title="Enroll Students (Excel)">
                    <Download className="w-4 h-4 text-accent rotate-180"/>
                    <span className="text-[8px] font-bold uppercase tracking-widest">Enroll</span>
                    <input type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={(e) => handleEnrollStudents(exam.id, e)} disabled={isEnrolling}/>
                  </label>
                  <label className="p-4 flex flex-col items-center gap-2 hover:bg-white/5 transition-colors cursor-pointer" title="Upload Questions (Excel)">
                    <FileUp className="w-4 h-4 text-purple-400"/>
                    <span className="text-[8px] font-bold uppercase tracking-widest">Bulk QS</span>
                    <input type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={(e) => handleQuestionExcelUpload(exam.id, e)} disabled={isSavingQuestions}/>
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}

        {editingExamQuestions && (
          <div className="fixed inset-0 bg-[#0A1024] z-[150] overflow-y-auto animate-in slide-in-from-bottom-10 duration-500">
            {/* Background decoration for editor */}
            <div className="fixed top-0 left-0 w-full h-full pointer-events-none opacity-20">
              <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-accent/20 rounded-full blur-[120px]" />
              <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-500/20 rounded-full blur-[120px]" />
            </div>

            <div className="max-w-5xl mx-auto px-6 py-12 relative z-10">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 mb-16 sticky top-0 bg-[#0A1024]/80 backdrop-blur-xl py-6 border-b border-white/5 z-20">
                <div>
                  <h2 className="text-4xl font-black tracking-tight font-outfit text-white">{editingExamQuestions.title}</h2>
                  <p className="text-accent/60 text-xs font-black uppercase tracking-[0.2em] mt-2 flex items-center gap-2">
                    <Edit3 className="w-4 h-4" />
                    Examination Blueprint Editor
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setEditingExamQuestions(null)} 
                    className="px-8 py-4 text-white/40 hover:text-white font-black text-xs uppercase tracking-widest transition-colors"
                  >
                    Discard Changes
                  </button>
                  <button 
                    onClick={handleSaveQuestions} 
                    disabled={isSavingQuestions} 
                    className="glass-button bg-accent text-[#0A1024] px-10 py-5 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center gap-3 hover:shadow-[0_0_40px_rgba(0,229,255,0.3)] transition-all active:scale-95 disabled:opacity-50"
                  >
                    {isSavingQuestions ? <Loader2 className="w-6 h-6 animate-spin"/> : <Save className="w-6 h-6"/>} 
                    Finalize Questions
                  </button>
                </div>
              </div>

              <div className="space-y-8 pb-32">
                {questions.map((q, idx) => (
                  <div key={q.id} className="group glass-panel rounded-[2rem] p-10 relative hover:bg-white/[0.04] transition-all border-white/5 hover:border-accent/20">
                     <div className="absolute -left-4 top-10 w-8 h-8 bg-accent rounded-lg flex items-center justify-center font-black text-[#0A1024] text-xs shadow-lg">
                      {idx + 1}
                    </div>
                    
                    <button 
                      onClick={() => handleRemoveQuestion(q.id)} 
                      className="absolute top-8 right-8 w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-red-400 opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all shadow-xl"
                      title="Remove Question"
                    >
                      <Trash2 className="w-5 h-5"/>
                    </button>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                      <div className="lg:col-span-8 space-y-6">
                        <div className="space-y-2">
                          <label className="text-[10px] font-black text-white/30 uppercase tracking-widest ml-1">Inquiry Statement</label>
                          <textarea
                            value={q.question_text}
                            onChange={(e) => handleUpdateQuestion(q.id, { question_text: e.target.value })}
                            className="w-full bg-white/5 border border-white/10 rounded-[1.5rem] px-6 py-5 outline-none focus:border-accent/50 focus:bg-white/[0.08] transition-all font-bold text-lg text-white placeholder:text-white/10 min-h-[120px]"
                            placeholder="State the question clearly..."
                          />
                        </div>

                        {q.type === 'mcq' && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {(q.options || []).map((opt, oIdx) => (
                              <div key={oIdx} className="relative group/option">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center text-[10px] font-black text-white/20 group-focus-within/option:bg-accent/20 group-focus-within/option:text-accent transition-all">
                                  {String.fromCharCode(65 + oIdx)}
                                </div>
                                <input
                                  type="text"
                                  value={opt}
                                  onChange={(e) => {
                                    const newOpts = [...(q.options || [])];
                                    newOpts[oIdx] = e.target.value;
                                    handleUpdateQuestion(q.id, { options: newOpts });
                                  }}
                                  className="w-full bg-white/5 border border-white/10 rounded-xl pl-12 pr-4 py-4 outline-none focus:border-accent/30 transition-all font-bold text-sm text-white/80"
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="lg:col-span-4 space-y-6">
                        <div className="glass-panel bg-white/5 p-6 rounded-2xl border-white/5">
                          <div className="space-y-6">
                            <div className="space-y-2">
                              <label className="text-[10px] font-black text-white/30 uppercase tracking-widest ml-1">Evaluation Model</label>
                              <select 
                                value={q.type} 
                                onChange={(e) => handleUpdateQuestion(q.id, { type: e.target.value as any })}
                                className="w-full bg-white/10 border border-white/10 rounded-xl px-4 py-3 text-white font-bold outline-none focus:border-accent/50"
                              >
                                <option value="mcq">Multiple Choice</option>
                                <option value="structured">Structured / Essay</option>
                              </select>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <label className="text-[10px] font-black text-white/30 uppercase tracking-widest ml-1">Score Value</label>
                                <input 
                                  type="number" 
                                  value={q.marks} 
                                  onChange={(e) => handleUpdateQuestion(q.id, { marks: parseInt(e.target.value) || 1 })}
                                  className="w-full bg-white/10 border border-white/10 rounded-xl px-4 py-3 text-white font-bold outline-none focus:border-accent/50"
                                />
                              </div>
                              <div className="space-y-2">
                                <label className="text-[10px] font-black text-white/30 uppercase tracking-widest ml-1">Correct Identity</label>
                                <input 
                                  type="text" 
                                  value={q.correct_answer} 
                                  onChange={(e) => handleUpdateQuestion(q.id, { correct_answer: e.target.value })}
                                  className="w-full bg-white/10 border border-white/10 rounded-xl px-4 py-3 text-white font-bold outline-none focus:border-accent/50 font-mono"
                                  placeholder="Answer Key"
                                />
                              </div>
                            </div>

                            <label className="flex items-center gap-3 cursor-pointer group/toggle">
                              <div className={`w-12 h-6 rounded-full transition-all flex items-center px-1 ${q.can_copy ? 'bg-accent' : 'bg-white/10'}`}>
                                <div className={`w-4 h-4 rounded-full bg-white shadow-lg transition-all ${q.can_copy ? 'translate-x-6' : 'translate-x-0'}`} />
                              </div>
                              <span className="text-[10px] font-black text-white/30 uppercase tracking-widest group-hover/toggle:text-white/60">Allow Text Copying</span>
                              <input 
                                type="checkbox" 
                                className="hidden" 
                                checked={q.can_copy} 
                                onChange={(e) => handleUpdateQuestion(q.id, { can_copy: e.target.checked })}
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  onClick={handleAddQuestion}
                  className="w-full py-12 border-2 border-dashed border-white/10 rounded-[3rem] flex flex-col items-center justify-center gap-4 text-white/20 hover:text-accent hover:border-accent/30 hover:bg-accent/5 transition-all group"
                >
                  <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Plus className="w-8 h-8" />
                  </div>
                  <span className="text-sm font-black uppercase tracking-[0.3em]">Integrate New Question</span>
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
