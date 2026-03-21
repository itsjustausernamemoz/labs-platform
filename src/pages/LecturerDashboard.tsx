import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  Plus, FileUp, Trash2, Eye, EyeOff,
  BarChart3, LogOut, Loader2, FileText,
  Save, Edit3, UserPlus, ShieldCheck, Download,
  User, X, Lock
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
  const [enrollingExam, setEnrollingExam] = useState<Exam | null>(null);
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
          const [totalResult, gradedResult] = await Promise.all([
            supabase
              .from('submissions')
              .select('*', { count: 'exact', head: true })
              .eq('exam_id', exam.id),
            supabase
              .from('submissions')
              .select('*', { count: 'exact', head: true })
              .eq('exam_id', exam.id)
              .eq('graded', true),
          ]);

          return {
            ...exam,
            total_submissions: totalResult.count ?? 0,
            marked_submissions: gradedResult.count ?? 0,
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
      setEnrollingExam(null);
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
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans">
      <nav className="bg-primary text-white p-4 flex justify-between items-center sticky top-0 z-50 shadow-lg">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-8 h-8 text-accent" />
          <span className="text-xl font-bold">SecureLab <span className="text-accent/60">Lecturer</span></span>
        </div>
        <button onClick={handleLogout} className="flex items-center gap-2 text-white/60 hover:text-white transition-colors">
          <LogOut className="w-5 h-5" />
          <span>Logout</span>
        </button>
      </nav>

      <main className="max-w-6xl mx-auto p-8">
        <div className="flex justify-between items-center mb-10">
          <div>
            <h1 className="text-3xl font-bold text-primary">
              Welcome, {profile?.full_name || 'Lecturer'}
            </h1>
            <p className="text-slate-500">Manage your assessments and marking progress</p>
          </div>
          <div className="flex gap-4">
            <button
              onClick={() => setIsEditingProfile(true)}
              className="bg-white text-primary border border-slate-200 px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-50 transition-all shadow-sm"
            >
              <User className="w-5 h-5" />
              Profile Settings
            </button>
            <button
              onClick={() => setIsCreating(true)}
              className="bg-primary text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-primary/90 transition-all shadow-lg"
            >
              <Plus className="w-5 h-5" />
              Create Exam
            </button>
          </div>
        </div>

        {isEditingProfile && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] p-6">
            <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-primary">Profile Settings</h2>
                <button onClick={() => setIsEditingProfile(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <form onSubmit={handleUpdateProfile} className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Full Name</label>
                  <input
                    type="text"
                    required
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:border-primary transition-all font-medium"
                    placeholder="Enter your full name"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Email Address</label>
                  <input
                    type="email"
                    disabled
                    value={profile?.email || ''}
                    className="w-full bg-slate-100 border border-slate-200 rounded-xl px-4 py-3 text-slate-500 font-medium cursor-not-allowed"
                  />
                  <p className="text-[10px] text-slate-400 mt-2 italic">Email cannot be changed as it is linked to your account.</p>
                </div>
                <div className="border-t border-slate-100 pt-6">
                  <h3 className="text-sm font-bold text-primary mb-4 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4" />
                    Security
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">New Password</label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary transition-all"
                        placeholder="Min. 6 characters"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Confirm New Password</label>
                      <input
                        type="password"
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary transition-all"
                        placeholder="Repeat new password"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleUpdatePassword}
                      disabled={isUpdatingPassword || !newPassword}
                      className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm font-bold hover:bg-slate-900 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                    >
                      {isUpdatingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                      Update Password
                    </button>
                    {newPassword && newPassword.length < 6 && (
                      <p className="text-[10px] text-red-500 italic text-center">Password must be at least 6 characters</p>
                    )}
                  </div>
                </div>
                
                <div className="flex gap-3 pt-6 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIsEditingProfile(false)}
                    className="flex-1 px-6 py-3 border border-slate-200 rounded-xl font-bold hover:bg-slate-50 transition-all text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingProfile}
                    className="flex-1 bg-primary text-white px-6 py-3 rounded-xl font-bold hover:bg-primary/95 transition-all shadow-lg flex items-center justify-center gap-2 text-sm"
                  >
                    {isSavingProfile ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                    Save Info
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {isCreating && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] p-6">
            <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl">
              <h2 className="text-2xl font-bold mb-6 text-primary">New Exam Details</h2>
              <form onSubmit={handleCreateExam} className="space-y-4">
                <input
                  type="text" required placeholder="Exam Title"
                  value={newExam.title} onChange={(e) => setNewExam({ ...newExam, title: e.target.value })}
                  className="w-full border p-2 rounded focus:border-primary outline-none"
                />
                <div className="grid grid-cols-2 gap-4">
                  <input type="number" required placeholder="Duration (min)" value={newExam.duration} onChange={(e) => setNewExam({ ...newExam, duration: parseInt(e.target.value) || 60 })} className="w-full border p-2 rounded"/>
                  <input type="number" required placeholder="Total Marks" value={newExam.total_marks} onChange={(e) => setNewExam({ ...newExam, total_marks: parseInt(e.target.value) || 100 })} className="w-full border p-2 rounded"/>
                  <input type="number" required placeholder="Violations" value={newExam.allowed_violations} onChange={(e) => setNewExam({ ...newExam, allowed_violations: parseInt(e.target.value) || 3 })} className="w-full border p-2 rounded"/>
                  <input type="text" required value={newExam.enrollment_code} onChange={(e) => setNewExam({ ...newExam, enrollment_code: e.target.value.toUpperCase() })} className="w-full border p-2 rounded font-mono" maxLength={6}/>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setIsCreating(false)} className="flex-1 p-2 border rounded">Cancel</button>
                  <button type="submit" disabled={isSubmitting} className="flex-1 p-2 bg-primary text-white rounded font-bold">
                    {isSubmitting ? <Loader2 className="animate-spin mx-auto"/> : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {isCollaborating && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] p-6">
            <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl">
              <h2 className="text-2xl font-bold mb-2">Add Co-Marker</h2>
              <p className="text-sm text-slate-500 mb-6 font-medium">Allow another lecturer to mark this exam.</p>
              <input
                type="email" required placeholder="lecturer@example.com"
                value={newCollabEmail} onChange={(e) => setNewCollabEmail(e.target.value)}
                className="w-full border p-2 rounded mb-6 outline-none focus:border-primary"
              />
              <div className="flex gap-2">
                <button onClick={() => setIsCollaborating(false)} className="flex-1 p-2 border rounded font-bold">Cancel</button>
                <button onClick={() => collabExamId && handleAddCoMarker(collabExamId)} disabled={isAddingCollab} className="flex-1 p-2 bg-primary text-white rounded font-bold">
                  {isAddingCollab ? <Loader2 className="animate-spin mx-auto"/> : 'Enroll'}
                </button>
              </div>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <Loader2 className="w-10 h-10 animate-spin mb-4" />
            <p className="font-medium">Loading your exams...</p>
          </div>
        ) : exams.length === 0 ? (
          <div className="bg-white border-2 border-dashed rounded-2xl p-16 text-center text-slate-400">
            <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <p className="font-bold text-slate-600">No exams found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {exams.map((exam) => (
              <div key={exam.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                <div className="p-6">
                  <div className="flex justify-between items-start mb-4">
                    <span className={`px-2 py-1 rounded-full text-[10px] uppercase font-bold ${
                      exam.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {exam.is_active ? 'Active' : 'Draft'}
                    </span>
                    <div className="flex gap-1">
                      <button 
                        onClick={() => toggleExamStatus(exam.id, exam.is_active)} 
                        className="p-1 hover:text-primary transition-colors"
                        title={exam.is_active ? "Deactivate" : "Activate"}
                      >
                        {exam.is_active ? <EyeOff className="w-4 h-4"/> : <Eye className="w-4 h-4"/>}
                      </button>
                      <button 
                        onClick={() => deleteExam(exam.id)} 
                        className="p-1 hover:text-red-500 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4"/>
                      </button>
                    </div>
                  </div>

                  <h3 className="text-xl font-bold text-primary mb-1 truncate">{exam.title}</h3>
                  <div className="flex justify-between items-center mb-6">
                    <p className="text-sm text-slate-400">{exam.duration_minutes}m</p>
                    <div className="flex items-center gap-2 bg-slate-50 px-2 py-1 rounded border text-xs">
                      <span className="font-bold text-slate-400 uppercase">Code:</span>
                      <code className="font-bold text-primary tracking-widest">{exam.enrollment_code}</code>
                      <button onClick={() => regenerateEnrollmentCode(exam.id)} className="hover:text-primary"><ShieldCheck className="w-3 h-3"/></button>
                    </div>
                  </div>

                  {/* Marking Progress */}
                  <div className="mb-6">
                    <div className="flex justify-between items-center text-[10px] font-bold mb-2">
                      <span className="text-slate-400 uppercase">Marking Progress</span>
                      <span className="text-primary">{exam.total_submissions > 0 ? Math.round((exam.marked_submissions / exam.total_submissions) * 100) : 0}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full border">
                      <div className={`h-full transition-all duration-1000 rounded-full ${exam.marked_submissions === exam.total_submissions && exam.total_submissions > 0 ? 'bg-green-500' : 'bg-accent'}`} style={{ width: `${exam.total_submissions > 0 ? (exam.marked_submissions / exam.total_submissions)*100 : 0}%` }} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <button onClick={() => handleEditQuestions(exam)} className="flex items-center justify-center gap-2 py-2 bg-slate-50 border rounded-xl text-xs font-bold hover:bg-slate-100"><Edit3 className="w-4 h-4"/>Edit Qs</button>
                    <label className="flex items-center justify-center gap-2 py-2 bg-slate-50 border rounded-xl text-xs font-bold hover:bg-slate-100 cursor-pointer">
                      <FileUp className="w-4 h-4"/>{uploadingExamId === exam.id ? 'Wait...' : 'Upload'}
                      <input type="file" className="hidden" accept=".pdf,.docx,.txt" onChange={(e) => handleFileUpload(exam.id, e)} disabled={uploadingExamId !== null}/>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <button onClick={() => handleEditQuestions(exam)} className="flex items-center justify-center gap-2 py-2 bg-slate-50 border rounded-xl text-xs font-bold hover:bg-slate-100"><Edit3 className="w-4 h-4"/>Edit Qs</button>
                    <label className="flex items-center justify-center gap-2 py-2 bg-slate-50 border rounded-xl text-xs font-bold hover:bg-slate-100 cursor-pointer">
                      {uploadingExamId === exam.id ? <Loader2 className="w-4 h-4 animate-spin"/> : <FileUp className="w-4 h-4"/>}Upload Paper
                      <input type="file" className="hidden" accept=".pdf,.docx,.txt" onChange={(e) => handleFileUpload(exam.id, e)} disabled={uploadingExamId !== null}/>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <label className="flex items-center justify-center gap-2 py-2 bg-white border border-primary text-primary rounded-xl text-xs font-bold hover:bg-primary/5 cursor-pointer">
                      {isSavingQuestions && uploadingExamId === exam.id ? <Loader2 className="w-4 h-4 animate-spin"/> : <Download className="w-4 h-4 rotate-180"/>}Import Qs
                      <input type="file" className="hidden" accept=".xlsx,.xls" onChange={(e) => { setUploadingExamId(exam.id); handleQuestionExcelUpload(exam.id, e); }} disabled={isSavingQuestions}/>
                    </label>
                    <label className="flex items-center justify-center gap-2 py-2 bg-white border border-primary text-primary rounded-xl text-xs font-bold hover:bg-primary/5 cursor-pointer">
                      {isEnrolling && enrollingExam?.id === exam.id ? <Loader2 className="w-4 h-4 animate-spin"/> : <UserPlus className="w-4 h-4"/>}Enroll
                      <input type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={(e) => { setEnrollingExam(exam); handleEnrollStudents(exam.id, e); }} disabled={isEnrolling}/>
                    </label>
                  </div>

                  <div className="mb-4">
                    <button onClick={() => { setCollabExamId(exam.id); setIsCollaborating(true); }} className="w-full flex items-center justify-center gap-2 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-50">
                      <UserPlus className="w-4 h-4"/>Enroll Co-Marker
                    </button>
                  </div>

                  <button onClick={() => navigate(`/lecturer/results/${exam.id}`)} className="w-full py-3 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 text-sm hover:bg-primary/95 shadow-md"><BarChart3 className="w-4 h-4"/>Results & Submissions</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {editingExamQuestions && (
          <div className="fixed inset-0 bg-primary z-[150] overflow-y-auto p-8">
            <div className="max-w-4xl mx-auto">
              <div className="flex justify-between items-center mb-10 sticky top-0 bg-primary py-4 border-b border-white/10 z-20">
                <div><h2 className="text-3xl font-bold text-white">Review Questions</h2><p className="text-white/60">{editingExamQuestions.title}</p></div>
                <div className="flex gap-4">
                  <button onClick={() => setEditingExamQuestions(null)} className="px-6 py-2 text-white/60 hover:text-white font-bold">Cancel</button>
                  <button onClick={handleSaveQuestions} disabled={isSavingQuestions} className="bg-accent text-primary px-8 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-accent/90 transition-all shadow-lg active:scale-95">
                    {isSavingQuestions ? <Loader2 className="animate-spin"/> : <Save className="w-5 h-5"/>} Save
                  </button>
                </div>
              </div>

              <div className="space-y-6">
                {questions.map((q) => (
                  <div key={q.id} className="bg-white/5 border border-white/10 rounded-2xl p-6 relative group">
                    <button onClick={() => handleRemoveQuestion(q.id)} className="absolute top-6 right-6 p-2 text-red-400 hover:bg-red-400/10 rounded-lg group-hover:opacity-100 opacity-0 transition-opacity"><Trash2 className="w-5 h-5"/></button>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-4">
                      <div>
                        <label className="text-[10px] font-bold text-white/30 uppercase block mb-1">Type</label>
                        <select value={q.type} onChange={(e) => handleUpdateQuestion(q.id, { type: e.target.value as any })} className="w-full bg-white/10 border border-white/10 p-2 rounded text-white outline-none">
                          <option value="mcq">MCQ</option><option value="structured">Structured</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-white/30 uppercase block mb-1">Marks</label>
                        <input type="number" value={q.marks} onChange={(e) => handleUpdateQuestion(q.id, { marks: parseInt(e.target.value) || 1 })} className="w-full bg-white/10 border border-white/10 p-2 rounded text-white outline-none"/>
                      </div>
                      <div className="flex items-end pb-1.5">
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input type="checkbox" checked={q.can_copy} onChange={(e) => handleUpdateQuestion(q.id, { can_copy: e.target.checked })} className="w-5 h-5 rounded border-white/20 bg-white/5 text-accent"/>
                          <span className="text-sm font-bold text-white/60">Allow copying</span>
                        </label>
                      </div>
                    </div>
                    <textarea value={q.question_text} onChange={(e) => handleUpdateQuestion(q.id, { question_text: e.target.value })} className="w-full bg-white/10 border border-white/10 p-4 rounded text-white min-h-[100px] outline-none mb-4" placeholder="Enter question..."/>
                    {q.type === 'mcq' && (
                      <div className="grid grid-cols-2 gap-4">
                        {(q.options || []).map((opt, optIdx) => (
                          <input key={optIdx} value={opt} onChange={(e) => {
                            const newOpts = [...(q.options || [])];
                            newOpts[optIdx] = e.target.value;
                            handleUpdateQuestion(q.id, { options: newOpts });
                          }} className="bg-white/5 border border-white/10 p-2 rounded text-sm text-white/80 outline-none" placeholder={`Option ${optIdx + 1}`}/>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <button onClick={handleAddQuestion} className="w-full py-6 border-2 border-dashed border-white/10 rounded-2xl text-white/40 hover:text-white hover:border-white/20 font-bold transition-all flex flex-col items-center gap-2">
                  <Plus className="w-8 h-8"/> Add Question
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
