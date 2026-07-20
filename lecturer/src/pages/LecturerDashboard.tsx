import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@shared/lib/apiClient';
import {
  Plus, FileUp, Trash2,
  Save, Edit3, UserPlus, ShieldCheck,
  User, X, Lock, Clock, RotateCcw, Copy,
  BarChart3, LogOut, Loader2, Settings, BookOpen, FolderOpen, Code2, Terminal
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { useNotification } from '@shared/components/NotificationProvider';
import logo from '@shared/assets/mashoke-logo.png';


interface Exam {
  id: string;
  title: string;
  duration_minutes: number;
  is_active: boolean;
  created_at: string;
  total_marks?: number;
  allowed_violations?: number;
  allowed_attempts: number;
  enrollment_code: string;
  exam_type: 'mcq_only' | 'structured_only' | 'mixed';
  subject_id?: string | null;
  exam_mode?: 'closed_book' | 'open_book';
  has_coding?: boolean;
  coding_language?: string | null;
}

interface LecturerProfile {
  id: string;
  full_name: string;
  email: string;
}

interface Subject {
  id: string;
  name: string;
  lecturer_id: string;
  created_at: string;
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
    allowed_attempts: 1,
    enrollment_code: Math.random().toString(36).substring(2, 8).toUpperCase(),
    exam_type: 'mixed' as 'mcq_only' | 'structured_only' | 'mixed',
    subject_id: null as string | null,
    exam_mode: 'closed_book' as 'closed_book' | 'open_book',
    has_coding: false,
    coding_language: 'kotlin'
  });
  const [editingSettings, setEditingSettings] = useState<ExamWithStats | null>(null);
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
  
  // Feature 6: Subjects State
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | 'all'>('all');
  const [isCreatingSubject, setIsCreatingSubject] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  
  const navigate = useNavigate();
  const { showToast, showConfirm } = useNotification();

  useEffect(() => {
    fetchProfile();
    fetchSubjects();
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
      // Every lecturer's profile row is created atomically by /auth/signup —
      // this should be unreachable, but fall back to a local-only display
      // profile rather than a guaranteed-to-fail insert (lecturer_profiles
      // rows can only be created server-side during signup).
      const newProfile = {
        id: user.id,
        full_name: user.email?.split('@')[0] || 'Lecturer',
        email: user.email || ''
      };
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

  const fetchSubjects = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('subjects')
        .select('*')
        .eq('lecturer_id', user.id)
        .order('name', { ascending: true });

      if (error) throw error;
      setSubjects(data || []);
    } catch (err: any) {
      console.error('Error fetching subjects:', err);
    }
  };

  const handleCreateSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubjectName.trim()) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    try {
      const { error } = await supabase
        .from('subjects')
        .insert([{
          name: newSubjectName.trim(),
          lecturer_id: user.id
        }]);

      if (error) throw error;
      
      showToast('Subject created successfully!', 'success');
      setNewSubjectName('');
      setIsCreatingSubject(false);
      fetchSubjects();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const fetchExams = async () => {
    setIsLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate('/');
      return;
    }

    try {
      const { data: ownExams, error: ownError } = await supabase
        .from('exams')
        .select('*')
        .eq('lecturer_id', user.id)
        .order('created_at', { ascending: false });

      if (ownError) throw ownError;

      const examsWithStats: ExamWithStats[] = await Promise.all(
        (ownExams || []).map(async (exam: any) => {
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
            ? (subs.reduce((acc: number, curr: any) => acc + (curr.score / (curr.total_marks || 1)), 0) / subs.length * 100)
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
          enrollment_code: newExam.enrollment_code,
          exam_type: newExam.exam_type,
          subject_id: newExam.subject_id,
          exam_mode: newExam.exam_mode,
          has_coding: newExam.has_coding,
          coding_language: newExam.coding_language
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
        allowed_attempts: 1,
        enrollment_code: Math.random().toString(36).substring(2, 8).toUpperCase(),
        exam_type: 'mixed',
        subject_id: null,
        exam_mode: 'closed_book',
        has_coding: false,
        coding_language: 'kotlin'
      });
      showToast('Assessment created successfully!', 'success');
    } catch (err: any) {
      console.error('Error creating exam:', err);
      showToast(err.message || 'Failed to create exam.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMoveToSubject = async (examId: string, subjectId: string | null) => {
    try {
      const { error } = await supabase
        .from('exams')
        .update({ subject_id: subjectId })
        .eq('id', examId);

      if (error) throw error;
      
      showToast('Exam moved successfully!', 'success');
      fetchExams();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleDeleteSubject = async (subjectId: string) => {
    if (!confirm('Are you sure? This will unorganize all exams in this subject.')) return;

    try {
      const { error } = await supabase
        .from('subjects')
        .delete()
        .eq('id', subjectId);

      if (error) throw error;
      
      showToast('Subject deleted successfully!', 'success');
      if (selectedSubjectId === subjectId) {
        setSelectedSubjectId('all');
      }
      fetchSubjects();
      fetchExams();
    } catch (err: any) {
      showToast(err.message, 'error');
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
      const rows = questions.map(({ id, ...rest }) => rest);
      const { error } = await supabase.questions.bulkReplace(editingExamQuestions.id, rows);
      if (error) throw error;

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
        showToast('No student numbers found.', 'error');
        return;
      }

      const uniqueStudentNumbers = [...new Set(studentNumbers)];
      const studentsToUpsert = uniqueStudentNumbers.map(num => ({ student_number: num }));
      const { data: upsertedStudents, error: upsertError } = await supabase
        .from('students')
        .upsert(studentsToUpsert, { onConflict: 'student_number' })
        .select();

      if (upsertError) throw upsertError;

      const enrollmentsToUpsert = (upsertedStudents || []).map((s: any) => ({
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
        const getVal = (keys: string[]) => {
          const foundKey = Object.keys(row).find(k => keys.includes(k.trim().toLowerCase()));
          return foundKey ? row[foundKey] : undefined;
        };

        const typeRaw = (getVal(['type']) || 'mcq').toString().toLowerCase();
        const type = typeRaw.includes('structured') ? 'structured' : 'mcq';
        
        const options = type === 'mcq' ? [
          getVal(['option_a', 'a', 'option a']),
          getVal(['option_b', 'b', 'option b']),
          getVal(['option_c', 'c', 'option c']),
          getVal(['option_d', 'd', 'option d'])
        ].map(v => v?.toString() || '').filter(opt => opt !== '') : null;

        return {
          question_text: getVal(['question_text', 'question', 'text'])?.toString() || `Question ${idx + 1}`,
          type,
          options,
          correct_answer: getVal(['correct_answer', 'answer', 'correct answer', 'correct'])?.toString() || '',
          marks: parseInt(getVal(['marks', 'mark', 'score', 'weight'])?.toString() || '1') || 1,
          can_copy: getVal(['can_copy', 'copyable', 'allow copy'])?.toString().toLowerCase() === 'true',
          order_index: idx
        };
      });

      const { error } = await supabase.questions.bulkReplace(examId, mappedQuestions);
      if (error) throw error;

      showToast(`${mappedQuestions.length} questions uploaded!`, 'success');
      if (editingExamQuestions?.id === examId) fetchQuestions(examId);
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



  const handleUpdateExamSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSettings) return;
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('exams')
        .update({
          title: editingSettings.title,
          duration_minutes: editingSettings.duration_minutes,
          total_marks: editingSettings.total_marks,
          allowed_violations: editingSettings.allowed_violations,
          allowed_attempts: editingSettings.allowed_attempts,
          exam_type: editingSettings.exam_type,
          subject_id: (editingSettings as any).subject_id,
          exam_mode: (editingSettings as any).exam_mode,
          has_coding: (editingSettings as any).has_coding,
          coding_language: (editingSettings as any).coding_language
        })
        .eq('id', editingSettings.id);

      if (error) throw error;
      
      // Update local state by merging the edited settings with existing metadata
      setExams(exams.map(ex => ex.id === editingSettings.id ? { ...ex, ...editingSettings } : ex));
      setEditingSettings(null);
      showToast('Settings updated successfully!', 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  const chipStyle = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', fontSize: 11, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.04em', border: '1px solid var(--color-divider)',
    background: active ? 'var(--color-accent)' : 'transparent', color: active ? 'var(--color-bg)' : 'var(--color-text)',
    borderColor: active ? 'var(--color-accent)' : 'var(--color-divider)', cursor: 'pointer', fontFamily: 'var(--font-body)',
  });
  const spinStyle: React.CSSProperties = { animation: 'lb-spin 0.8s linear infinite' };

  return (
    <div style={{ minHeight: '100vh' }}>
      <style>{`
        @keyframes lb-spin { to { transform: rotate(360deg); } }
        summary::-webkit-details-marker { display: none; }
        summary { list-style: none; }
      `}</style>
      <nav className="nav">
        <div className="nav-brand" style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => navigate('/dashboard')}>
          <img src={logo} alt="Mashoke Tech" style={{ width: 30, height: 30, objectFit: 'contain' }} />
          Mashoke Labs <span className="tag tag-neutral" style={{ marginLeft: 4 }}>Lecturer</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <button className="btn btn-icon btn-secondary" title="Profile & security" onClick={() => setIsEditingProfile(true)}><User size={16} /></button>
          <button className="btn btn-icon btn-secondary" title="Log out" onClick={handleLogout}><LogOut size={16} /></button>
        </div>
      </nav>

      <main className="wrap" style={{ maxWidth: 1120, margin: '0 auto', padding: 'var(--space-8) var(--space-6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--space-6)', flexWrap: 'wrap', marginBottom: 'var(--space-6)' }}>
          <div>
            <h1>Dashboard</h1>
            <p className="text-muted">Manage your academic assessments, track marking progress, and coordinate with co-markers.</p>
          </div>
          <button className="btn btn-primary" onClick={() => setIsCreating(true)}>
            <Plus size={16} /> Create examination
          </button>
        </div>

        {isEditingProfile && (
          <div className="dialog-backdrop" onClick={() => setIsEditingProfile(false)}>
            <div className="dialog" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div className="dialog-title">Profile & security</div>
                <button className="btn btn-icon" onClick={() => setIsEditingProfile(false)}><X size={16} /></button>
              </div>
              <form onSubmit={handleUpdateProfile} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div className="field">
                  <label>Full name</label>
                  <input type="text" required className="input" value={editedName} onChange={(e) => setEditedName(e.target.value)} placeholder="Full Name" />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input type="email" disabled className="input" value={profile?.email || ''} />
                </div>
                <div className="hr" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                  <div className="field">
                    <label>New password</label>
                    <input type="password" className="input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" />
                  </div>
                  <div className="field">
                    <label>Confirm password</label>
                    <input type="password" className="input" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} placeholder="••••••••" />
                  </div>
                </div>
                <button type="button" className="btn btn-secondary btn-block" style={{ justifyContent: 'center' }} onClick={handleUpdatePassword} disabled={isUpdatingPassword || !newPassword}>
                  {isUpdatingPassword ? <Loader2 size={16} style={spinStyle} /> : <ShieldCheck size={16} />} Update password
                </button>
                <div className="dialog-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setIsEditingProfile(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={isSavingProfile}>
                    {isSavingProfile ? <Loader2 size={16} style={spinStyle} /> : <Save size={16} />} Save changes
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {isCreating && (
          <div className="dialog-backdrop" onClick={() => setIsCreating(false)}>
            <div className="dialog" style={{ maxWidth: 560, maxHeight: '88vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="dialog-title">New examination</div>
                  <p className="text-muted" style={{ fontSize: 12, margin: '2px 0 0' }}>Configure the assessment parameters below.</p>
                </div>
                <button className="btn btn-icon" onClick={() => setIsCreating(false)}><X size={16} /></button>
              </div>

              <form onSubmit={handleCreateExam} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div className="field">
                  <label>Title</label>
                  <input type="text" required className="input" placeholder="e.g., Computer Science 101 Final" value={newExam.title} onChange={(e) => setNewExam({ ...newExam, title: e.target.value })} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                  <div className="field">
                    <label>Duration (minutes)</label>
                    <input type="number" required className="input" value={newExam.duration} onChange={(e) => setNewExam({ ...newExam, duration: parseInt(e.target.value) || 60 })} />
                  </div>
                  <div className="field">
                    <label>Allowed attempts</label>
                    <input type="number" required min="1" className="input" value={newExam.allowed_attempts || 1} onChange={(e) => setNewExam({ ...newExam, allowed_attempts: parseInt(e.target.value) || 1 })} />
                  </div>
                </div>

                <div className="field">
                  <label>Category</label>
                  <div className="seg">
                    <label className="seg-opt">
                      <input type="radio" name="examType" checked={newExam.exam_type === 'mcq_only'} onChange={() => setNewExam({ ...newExam, exam_type: 'mcq_only' })} /> MCQ only
                    </label>
                    <label className="seg-opt">
                      <input type="radio" name="examType" checked={newExam.exam_type === 'structured_only'} onChange={() => setNewExam({ ...newExam, exam_type: 'structured_only' })} /> Structured
                    </label>
                    <label className="seg-opt">
                      <input type="radio" name="examType" checked={newExam.exam_type === 'mixed'} onChange={() => setNewExam({ ...newExam, exam_type: 'mixed' })} /> Mixed
                    </label>
                  </div>
                </div>

                <div className="hr" />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                  <div className="field">
                    <label>Assign to subject</label>
                    <select className="input" value={newExam.subject_id || ''} onChange={(e) => setNewExam({ ...newExam, subject_id: e.target.value || null })}>
                      <option value="">No subject</option>
                      {subjects.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Mode</label>
                    <div className="seg">
                      <label className="seg-opt">
                        <input type="radio" name="examMode" checked={newExam.exam_mode === 'closed_book'} onChange={() => setNewExam({ ...newExam, exam_mode: 'closed_book' })} /> <Lock size={13} /> Closed
                      </label>
                      <label className="seg-opt">
                        <input type="radio" name="examMode" checked={newExam.exam_mode === 'open_book'} onChange={() => setNewExam({ ...newExam, exam_mode: 'open_book' })} /> <BookOpen size={13} /> Open
                      </label>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)' }}>
                  <div className="field">
                    <label>Total marks</label>
                    <input type="number" required className="input" value={newExam.total_marks} onChange={(e) => setNewExam({ ...newExam, total_marks: parseInt(e.target.value) || 100 })} />
                  </div>
                  <div className="field">
                    <label>Violation limit</label>
                    <input type="number" required className="input" value={newExam.allowed_violations} onChange={(e) => setNewExam({ ...newExam, allowed_violations: parseInt(e.target.value) || 3 })} />
                  </div>
                  <div className="field">
                    <label>Enrollment code</label>
                    <input type="text" required maxLength={6} className="input" style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: '0.1em' }} value={newExam.enrollment_code} onChange={(e) => setNewExam({ ...newExam, enrollment_code: e.target.value.toUpperCase() })} />
                  </div>
                </div>

                <div className="hr" />

                <label className="radio">
                  <input type="checkbox" checked={newExam.has_coding} onChange={() => setNewExam({ ...newExam, has_coding: !newExam.has_coding })} />
                  <span className="dot" style={{ borderRadius: 4 }}></span>
                  <span><Code2 size={13} style={{ verticalAlign: -2, marginRight: 4 }} /> Enable in-browser coding environment</span>
                </label>

                {newExam.has_coding && (
                  <div className="field">
                    <label><Terminal size={12} style={{ verticalAlign: -2, marginRight: 4 }} /> Integrated compiler</label>
                    <select className="input" value={newExam.coding_language || 'kotlin'} onChange={(e) => setNewExam({ ...newExam, coding_language: e.target.value })}>
                      <option value="kotlin">Kotlin (JVM/JS)</option>
                    </select>
                  </div>
                )}

                <div className="dialog-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setIsCreating(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                    {isSubmitting ? <Loader2 size={16} style={spinStyle} /> : <ShieldCheck size={16} />} Create examination
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {isCollaborating && (() => {
          const collabExam = exams.find(e => e.id === collabExamId) || null;
          return (
            <div className="dialog-backdrop" onClick={() => setIsCollaborating(false)}>
              <div className="dialog" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
                <div>
                  <div className="dialog-title">Manage enrollment & co-markers</div>
                  {collabExam && <p className="text-muted" style={{ fontSize: 12, margin: '2px 0 0' }}>{collabExam.title}</p>}
                </div>

                <h4 style={{ marginBottom: 'var(--space-2)' }}>Enrollment</h4>
                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end', marginBottom: 'var(--space-2)' }}>
                  <div className="field" style={{ flex: 1 }}>
                    <label>Enrollment code</label>
                    <input className="input" disabled value={collabExam?.enrollment_code || ''} style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: '0.1em' }} />
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-icon"
                    title="Copy code"
                    onClick={() => {
                      if (!collabExam) return;
                      navigator.clipboard.writeText(collabExam.enrollment_code);
                      showToast('Enrollment code copied!', 'success');
                    }}
                  >
                    <Copy size={14} />
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => collabExamId && regenerateEnrollmentCode(collabExamId)}>
                    <RotateCcw size={14} /> Regenerate
                  </button>
                </div>

                <div className="field">
                  <label>Bulk-enroll students (.xlsx roster)</label>
                  <input
                    className="input" type="file" accept=".xlsx,.xls,.csv"
                    disabled={isEnrolling}
                    onChange={(e) => collabExamId && handleEnrollStudents(collabExamId, e)}
                  />
                </div>

                <div className="hr" />
                <h4 style={{ marginBottom: 'var(--space-2)' }}>Co-markers</h4>
                <div className="field">
                  <label>Lecturer email</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="email" required placeholder="lecturer@university.edu" className="input" value={newCollabEmail} onChange={(e) => setNewCollabEmail(e.target.value)} />
                    <button
                      type="button" className="btn btn-secondary"
                      onClick={() => collabExamId && handleAddCoMarker(collabExamId)}
                      disabled={isAddingCollab || !newCollabEmail}
                    >
                      {isAddingCollab ? <Loader2 size={14} style={spinStyle} /> : 'Add'}
                    </button>
                  </div>
                </div>

                <div className="dialog-actions">
                  <button className="btn btn-primary" onClick={() => setIsCollaborating(false)}>Done</button>
                </div>
              </div>
            </div>
          );
        })()}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 'var(--space-6)' }}>
          <button style={chipStyle(selectedSubjectId === 'all')} onClick={() => setSelectedSubjectId('all')}>
            All assessments
          </button>
          {subjects.map(subject => (
            <span key={subject.id} style={{ display: 'inline-flex', alignItems: 'stretch' }}>
              <button style={chipStyle(selectedSubjectId === subject.id)} onClick={() => setSelectedSubjectId(subject.id)}>
                {subject.name}
              </button>
              <button
                title="Delete subject"
                onClick={(e) => { e.stopPropagation(); handleDeleteSubject(subject.id); }}
                style={{ ...chipStyle(false), borderLeft: 'none', padding: '5px 8px', color: 'var(--color-accent-700)' }}
              >
                <X size={11} />
              </button>
            </span>
          ))}
          <button
            onClick={() => setIsCreatingSubject(true)}
            title="New subject"
            style={{ ...chipStyle(false), color: 'var(--color-accent)', borderColor: 'var(--color-accent)' }}
          >
            <Plus size={12} /> New subject
          </button>
        </div>

        {isCreatingSubject && (
          <div className="dialog-backdrop" onClick={() => setIsCreatingSubject(false)}>
            <div className="dialog" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
              <div className="dialog-title">New subject</div>
              <form onSubmit={handleCreateSubject} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div className="field">
                  <label>Subject name</label>
                  <input
                    autoFocus
                    type="text"
                    className="input"
                    placeholder="e.g. Computer Science"
                    value={newSubjectName}
                    onChange={(e) => setNewSubjectName(e.target.value)}
                  />
                </div>
                <div className="dialog-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setIsCreatingSubject(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={!newSubjectName.trim()}>Create</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {isLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-8) 0', gap: 'var(--space-3)' }}>
            <Loader2 size={32} style={{ ...spinStyle, color: 'var(--color-accent)' }} />
            <p className="text-muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Syncing laboratory data…</p>
          </div>
        ) : exams.filter(e => selectedSubjectId === 'all' || e.subject_id === selectedSubjectId).length === 0 ? (
          <div className="card" style={{ padding: 'var(--space-8)', textAlign: 'center', border: '1px dashed var(--color-divider)' }}>
            <h3>No examinations found</h3>
            <p className="text-muted" style={{ maxWidth: 420, margin: '0 auto var(--space-4)' }}>
              {selectedSubjectId === 'all'
                ? 'Create your first examination to begin managing assessments for your students.'
                : 'No examinations have been assigned to this category yet.'}
            </p>
            {selectedSubjectId === 'all' && (
              <button className="btn btn-primary" onClick={() => setIsCreating(true)}>Start now</button>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--space-4)' }}>
            {exams.filter(e => selectedSubjectId === 'all' || e.subject_id === selectedSubjectId).map((exam) => (
              <div key={exam.id} className="card elev-sm">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button style={chipStyle(exam.is_active)} title="Toggle published status" onClick={() => toggleExamStatus(exam.id, exam.is_active)}>
                      {exam.is_active ? 'Published' : 'Draft'}
                    </button>
                    <span className={`tag ${exam.exam_mode === 'open_book' ? 'tag-accent-2' : 'tag-accent'}`}>
                      {exam.exam_mode === 'open_book' ? 'Open book' : 'Closed book'}
                    </span>
                  </div>
                  <button className="btn btn-ghost btn-icon" title="Delete exam" style={{ color: 'var(--color-accent-700)' }} onClick={() => deleteExam(exam.id)}>
                    <Trash2 size={15} />
                  </button>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
                  <h3 className="card-title" style={{ wordBreak: 'break-word' }}>{exam.title}</h3>
                  <button
                    type="button"
                    title="Click to copy enrollment code"
                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(exam.enrollment_code); showToast('Enrollment code copied!', 'success'); }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid var(--color-divider)', background: 'transparent', padding: '3px 8px', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--color-accent-700)', cursor: 'pointer', flex: 'none' }}
                  >
                    {exam.enrollment_code} <Copy size={11} />
                  </button>
                </div>

                <div className="card-meta" style={{ flexWrap: 'wrap' }}>
                  <Clock size={12} /> {exam.duration_minutes}m
                  <span className="tag tag-neutral">{exam.exam_type?.replace('_', ' ')}</span>
                  {exam.total_submissions > 0 && <span className="tag tag-neutral">Avg {exam.average_score}%</span>}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, opacity: 0.6, marginTop: 4 }}>
                  <span>Marking progress</span>
                  <span>{exam.marked_submissions} / {exam.total_submissions}</span>
                </div>
                <div style={{ height: 6, background: 'var(--color-neutral-200)' }}>
                  <div style={{ height: '100%', width: `${exam.total_submissions > 0 ? (exam.marked_submissions / exam.total_submissions) * 100 : 0}%`, background: 'var(--color-accent)' }} />
                </div>

                <button className="btn btn-primary btn-block" style={{ justifyContent: 'center', marginTop: 'var(--space-2)' }} onClick={() => navigate(`/results/${exam.id}`)}>
                  <BarChart3 size={15} /> Review & grade
                </button>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, borderTop: '1px solid var(--color-divider)', paddingTop: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
                  <button className="btn btn-ghost" style={{ padding: 4 }} title="Edit questions" onClick={() => handleEditQuestions(exam)}><Edit3 size={15} /></button>
                  <button className="btn btn-ghost" style={{ padding: 4 }} title="Exam settings" onClick={() => setEditingSettings(exam)}><Settings size={15} /></button>
                  <label className="btn btn-ghost" style={{ padding: 4, cursor: 'pointer' }} title="Bulk-replace questions from file">
                    <FileUp size={15} />
                    <input type="file" style={{ display: 'none' }} accept=".xlsx,.xls,.csv" onChange={(e) => handleQuestionExcelUpload(exam.id, e)} disabled={isSavingQuestions} />
                  </label>
                  <details style={{ position: 'relative' }}>
                    <summary className="btn btn-ghost" style={{ padding: 4, cursor: 'pointer', listStyle: 'none' }} title="Move to subject"><FolderOpen size={15} /></summary>
                    <div style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 4, background: 'var(--color-surface)', border: '1px solid var(--color-divider)', boxShadow: 'var(--shadow-md)', padding: 'var(--space-2)', minWidth: 160, zIndex: 20 }}>
                      <div className="text-muted" style={{ fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>Move to:</div>
                      <button className="btn btn-ghost btn-block" style={{ fontSize: 12 }} onClick={() => handleMoveToSubject(exam.id, null)}>Unorganized</button>
                      {subjects.map(s => (
                        <button key={s.id} className="btn btn-ghost btn-block" style={{ fontSize: 12 }} onClick={() => handleMoveToSubject(exam.id, s.id)}>{s.name}</button>
                      ))}
                    </div>
                  </details>
                  <button className="btn btn-ghost" style={{ padding: 4 }} title="Manage enrollment & co-markers" onClick={() => { setCollabExamId(exam.id); setIsCollaborating(true); }}><UserPlus size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        {editingExamQuestions && (
          <div className="dialog-backdrop" onClick={() => setEditingExamQuestions(null)}>
            <div className="dialog" style={{ maxWidth: 640, maxHeight: '88vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="dialog-title">Questions</div>
                  <p className="text-muted" style={{ fontSize: 12, margin: '2px 0 0' }}>{editingExamQuestions.title}</p>
                </div>
                <button className="btn btn-icon" onClick={() => setEditingExamQuestions(null)}><X size={16} /></button>
              </div>

              <div className="field" style={{ background: 'var(--color-neutral-100)', padding: 'var(--space-3)' }}>
                <label>Bulk-replace from Excel</label>
                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                  <input
                    className="input" type="file" accept=".xlsx,.xls,.csv" style={{ flex: 1, background: 'var(--color-bg)' }}
                    onChange={(e) => handleQuestionExcelUpload(editingExamQuestions.id, e)}
                    disabled={isSavingQuestions}
                  />
                  <span className="text-muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>replaces list below</span>
                </div>
              </div>

              {questions.map((q, idx) => (
                <div key={q.id} className="card" style={{ background: 'var(--color-neutral-100)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
                    <span className="card-kicker">Question {idx + 1}</span>
                    <button className="btn btn-ghost btn-icon" style={{ color: 'var(--color-accent-700)' }} onClick={() => handleRemoveQuestion(q.id)}><Trash2 size={14} /></button>
                  </div>
                  <textarea
                    className="input" value={q.question_text} placeholder="Question text"
                    onChange={(e) => handleUpdateQuestion(q.id, { question_text: e.target.value })}
                  />
                  {q.type === 'mcq' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                      {(q.options || []).map((opt, oIdx) => (
                        <input
                          key={oIdx} type="text" className="input" value={opt}
                          onChange={(e) => {
                            const newOpts = [...(q.options || [])];
                            newOpts[oIdx] = e.target.value;
                            handleUpdateQuestion(q.id, { options: newOpts });
                          }}
                        />
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px', gap: 'var(--space-3)' }}>
                    <select className="input" value={q.type} onChange={(e) => handleUpdateQuestion(q.id, { type: e.target.value as any })}>
                      <option value="mcq">Multiple Choice</option>
                      <option value="structured">Structured / Essay</option>
                    </select>
                    <input type="number" className="input" value={q.marks} placeholder="Marks" onChange={(e) => handleUpdateQuestion(q.id, { marks: parseInt(e.target.value) || 1 })} />
                    <input type="text" className="input" value={q.correct_answer} placeholder="Answer" onChange={(e) => handleUpdateQuestion(q.id, { correct_answer: e.target.value })} />
                  </div>
                </div>
              ))}

              <button className="btn btn-secondary btn-block" style={{ justifyContent: 'center' }} onClick={handleAddQuestion}>
                <Plus size={14} /> Add question
              </button>

              <div className="dialog-actions">
                <button className="btn btn-secondary" onClick={() => setEditingExamQuestions(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleSaveQuestions} disabled={isSavingQuestions}>
                  {isSavingQuestions ? <Loader2 size={16} style={spinStyle} /> : <Save size={16} />} Save questions
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
      {editingSettings && (
        <div className="dialog-backdrop" onClick={() => setEditingSettings(null)}>
          <div className="dialog" style={{ maxWidth: 560, maxHeight: '88vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="dialog-title">Exam settings</div>
                <p className="text-muted" style={{ fontSize: 12, margin: '2px 0 0' }}>Configure assessment parameters.</p>
              </div>
              <button className="btn btn-icon" onClick={() => setEditingSettings(null)}><X size={16} /></button>
            </div>

            <form onSubmit={handleUpdateExamSettings} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div className="field">
                <label>Examination title</label>
                <input type="text" required className="input" placeholder="e.g. Advanced Microbiology 101" value={editingSettings.title} onChange={(e) => setEditingSettings({ ...editingSettings, title: e.target.value })} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)' }}>
                <div className="field">
                  <label>Total marks</label>
                  <input type="number" required className="input" value={editingSettings.total_marks} onChange={(e) => setEditingSettings({ ...editingSettings, total_marks: parseInt(e.target.value) })} />
                </div>
                <div className="field">
                  <label>Duration (min)</label>
                  <input type="number" required className="input" value={editingSettings.duration_minutes} onChange={(e) => setEditingSettings({ ...editingSettings, duration_minutes: parseInt(e.target.value) })} />
                </div>
                <div className="field">
                  <label>Violation limit</label>
                  <input type="number" required className="input" value={editingSettings.allowed_violations} onChange={(e) => setEditingSettings({ ...editingSettings, allowed_violations: parseInt(e.target.value) })} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                <div className="field">
                  <label>Allowed attempts</label>
                  <input type="number" required min="1" className="input" value={editingSettings.allowed_attempts} onChange={(e) => setEditingSettings({ ...editingSettings, allowed_attempts: parseInt(e.target.value) })} />
                </div>
                <div className="field">
                  <label>Exam type</label>
                  <select className="input" value={editingSettings.exam_type} onChange={(e) => setEditingSettings({ ...editingSettings, exam_type: e.target.value as any })}>
                    <option value="mcq_only">MCQ only</option>
                    <option value="structured_only">Structured only</option>
                    <option value="mixed">Mixed</option>
                  </select>
                </div>
              </div>

              <div className="hr" />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                <div className="field">
                  <label>Assigned subject</label>
                  <select className="input" value={editingSettings.subject_id || ''} onChange={(e) => setEditingSettings({ ...editingSettings, subject_id: e.target.value || null } as any)}>
                    <option value="">No subject</option>
                    {subjects.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Mode</label>
                  <div className="seg">
                    <label className="seg-opt">
                      <input type="radio" name="editExamMode" checked={editingSettings.exam_mode === 'closed_book'} onChange={() => setEditingSettings({ ...editingSettings, exam_mode: 'closed_book' } as any)} /> <Lock size={13} /> Closed
                    </label>
                    <label className="seg-opt">
                      <input type="radio" name="editExamMode" checked={editingSettings.exam_mode === 'open_book'} onChange={() => setEditingSettings({ ...editingSettings, exam_mode: 'open_book' } as any)} /> <BookOpen size={13} /> Open
                    </label>
                  </div>
                </div>
              </div>

              <div className="hr" />

              <label className="radio">
                <input type="checkbox" checked={!!editingSettings.has_coding} onChange={() => setEditingSettings({ ...editingSettings, has_coding: !editingSettings.has_coding } as any)} />
                <span className="dot" style={{ borderRadius: 4 }}></span>
                <span><Code2 size={13} style={{ verticalAlign: -2, marginRight: 4 }} /> Enable in-browser coding environment</span>
              </label>

              {editingSettings.has_coding && (
                <div className="field">
                  <label><Terminal size={12} style={{ verticalAlign: -2, marginRight: 4 }} /> Integrated compiler</label>
                  <select className="input" value={editingSettings.coding_language || 'kotlin'} onChange={(e) => setEditingSettings({ ...editingSettings, coding_language: e.target.value } as any)}>
                    <option value="kotlin">Kotlin (JVM/JS)</option>
                  </select>
                </div>
              )}

              <div className="dialog-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setEditingSettings(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 size={16} style={spinStyle} /> : <Save size={16} />} Save settings
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default LecturerDashboard;
