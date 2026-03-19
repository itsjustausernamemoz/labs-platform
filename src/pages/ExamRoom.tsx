import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useTabGuard } from '../hooks/useTabGuard';
import type { ViolationType } from '../hooks/useTabGuard';
import TabGuard from '../components/TabGuard';
import QuestionRenderer from '../components/QuestionRenderer';
import type { Question } from '../components/QuestionRenderer';
import Timer from '../components/Timer';
import { Send, Shield, AlertTriangle, Loader2, MousePointer, ClipboardCopy } from 'lucide-react';
import { useNotification } from '../components/NotificationProvider';

const ExamRoom: React.FC = () => {
  const { examId } = useParams();
  const navigate = useNavigate();
  const { showToast, showConfirm } = useNotification();
  const [exam, setExam] = useState<any>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [student, setStudent] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentSubmissionId, setCurrentSubmissionId] = useState<string | null>(null);

  const [violationCount, setViolationCount] = useState(0);
  const [showViolationWarning, setShowViolationWarning] = useState(false);
  const [lastViolationType, setLastViolationType] = useState<ViolationType>('blur');

  const examContainerRef = useRef<HTMLDivElement>(null);

  const maxViolations = exam?.allowed_violations || 3;

  const lastViolationTime = React.useRef(0);

  const handleViolation = useCallback((type: ViolationType) => {
    if (isSubmitting || showViolationWarning) {
      console.log('ExamRoom: Violation ignored - isSubmitting:', isSubmitting, 'warningAlreadyShowing:', showViolationWarning);
      return;
    }
    
    const now = Date.now();
    if (now - lastViolationTime.current < 500) {
      console.log('ExamRoom: Throttling duplicate trigger');
      return;
    }
    lastViolationTime.current = now;

    console.warn(`ExamRoom: TRIGGERING WARNING FOR ${type}`);
    setLastViolationType(type);
    const toastMsg =
      type === 'cursor_exit'
        ? 'Security Violation: Cursor moved outside the exam screen'
        : 'Security Violation Detected: Unauthorized Window Activity';
    showToast(toastMsg, 'error');
    setShowViolationWarning(true);
  }, [isSubmitting, showViolationWarning, showToast]);

  const handleAcknowledgeViolation = () => {
    console.log('ExamRoom: Student acknowledged violation. Updating count...');
    setViolationCount(prev => {
      const next = prev + 1;
      console.log('ExamRoom: New violation count:', next, 'Max:', maxViolations);
      return next;
    });
    setShowViolationWarning(false);
  };

  // Handle auto-submission strictly on count change
  useEffect(() => {
    if (violationCount >= maxViolations && maxViolations > 0 && !isSubmitting) {
      console.error('ExamRoom: VIOLATIONS EXHAUSTED. SUBMITTING ZERO SCORE.');
      submitWithZeroScore();
    }
  }, [violationCount, maxViolations, isSubmitting]);

  // Log violations to DB
  useEffect(() => {
    if (violationCount > 0 && student && examId) {
      supabase.from('violations').insert([{
        student_id: student.id,
        exam_id: examId,
        violation_type: lastViolationType
      }]).then(({ error }) => {
        if (error) console.error('Error logging to DB:', error);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [violationCount, student, examId]);

  useTabGuard(handleViolation, examContainerRef);

  useEffect(() => {
    const storedStudent = localStorage.getItem('student');
    if (!storedStudent) {
      navigate('/');
      return;
    }
    setStudent(JSON.parse(storedStudent));
    fetchExamData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId]);

  // Prevent right-click and keyboard shortcuts
  useEffect(() => {
    const preventDefaults = (e: MouseEvent) => e.preventDefault();
    const handleKeyDown = (e: KeyboardEvent) => {
      const forbiddenKeys = ['F12', 'U', 'I', 'J']; // 'C' intentionally allowed so students can copy questions
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      const isAlt = e.altKey;

      if (
        forbiddenKeys.includes(e.key.toUpperCase()) && isCtrlOrMeta ||
        (e.key === 'F12') ||
        (isCtrlOrMeta && (e.key === 't' || e.key === 'n' || e.key === 'w' || e.key === 'Tab')) ||
        (isAlt && e.key === 'Tab')
      ) {
        e.preventDefault();
        return false;
      }
    };

    document.addEventListener('contextmenu', preventDefaults);
    window.addEventListener('keydown', handleKeyDown);

    // Navigation blocking - prevent accidental back and refresh
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Only show warning if not currently submitting
      if (!isSubmitting) {
        e.preventDefault();
        e.returnValue = ''; // Standard way to show browser confirmation
      }
    };

    const handlePopState = () => {
      if (!isSubmitting) {
        // Push state back to prevent navigation
        window.history.pushState(null, '', window.location.href);
        showToast('Back navigation is disabled during the exam. Please submit your exam when finished.', 'error');
      }
    };

    // Initialize history state for popstate to work
    window.history.pushState(null, '', window.location.href);

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('popstate', handlePopState);

    return () => {
      document.removeEventListener('contextmenu', preventDefaults);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isSubmitting, showToast]);

  const [examEndTime, setExamEndTime] = useState<number | null>(null);

  const fetchExamData = async () => {
    setIsLoading(true);
    const storedStudent = localStorage.getItem('student');
    if (!storedStudent) return;
    const studentData = JSON.parse(storedStudent);

    try {
      const { data: examData, error: examError } = await supabase
        .from('exams')
        .select('*')
        .eq('id', examId)
        .single();

      if (examError) throw examError;

      // Check if student is enrolled
      const { data: enrollment, error: enrollError } = await supabase
        .from('enrollments')
        .select('*')
        .eq('student_id', studentData.id)
        .eq('exam_id', examId)
        .single();

      if (enrollError || !enrollment) {
        showToast('You are not enrolled in this examination.', 'error');
        navigate('/dashboard');
        return;
      }

      // Enforce one-attempt rule: check for an existing submission (either draft or final)
      const { data: existingSubmission } = await supabase
        .from('submissions')
        .select('id, answers, status')
        .eq('student_id', studentData.id)
        .eq('exam_id', examId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingSubmission && existingSubmission.status === 'submitted') {
        showToast('You have already submitted this examination. Each exam may only be attempted once.', 'error');
        navigate('/dashboard');
        return;
      }

      // If there's a draft, load the answers
      if (existingSubmission && existingSubmission.status === 'draft') {
        console.log('ExamRoom: Loading session from draft...');
        setAnswers(existingSubmission.answers || {});
        setCurrentSubmissionId(existingSubmission.id);
      }

      setExam(examData);

      // Handle Timer Persistence
      const startTimeKey = `exam_start_${examId}`;
      let startTime = localStorage.getItem(startTimeKey);
      
      if (!startTime) {
        startTime = Date.now().toString();
        localStorage.setItem(startTimeKey, startTime);
        console.log('ExamRoom: Set new start time:', startTime);
      } else {
        console.log('ExamRoom: Resumed from start time:', startTime);
      }

      const durationMs = (examData.duration_minutes || 60) * 60 * 1000;
      setExamEndTime(parseInt(startTime) + durationMs);

      const { data: questionData, error: qError } = await supabase
        .from('questions')
        .select('*')
        .eq('exam_id', examId)
        .order('order_index', { ascending: true });

      if (qError) throw qError;
      setQuestions(questionData || []);
    } catch (err) {
      console.error('Error fetching exam:', err);
      navigate('/');
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-save logic
  const saveDraft = useCallback(async (currentAnswers: Record<string, string>) => {
    if (!student || !examId) return;
    
    console.log('ExamRoom: Saving draft...');
    const submissionData = {
      exam_id: examId,
      student_id: student.id,
      answers: currentAnswers,
      status: 'draft' as const
    };

    const { data, error } = await supabase
      .from('submissions')
      .upsert(currentSubmissionId ? [{ ...submissionData, id: currentSubmissionId }] : [submissionData])
      .select('id')
      .single();
      
    if (error) {
      console.error('Error auto-saving draft:', error);
    } else if (data && !currentSubmissionId) {
      setCurrentSubmissionId(data.id);
    }
  }, [student, examId, currentSubmissionId]);

  // Trigger auto-save every 15 seconds if answers changed
  const lastSavedAnswers = useRef<string>(JSON.stringify(answers));
  useEffect(() => {
    const timer = setInterval(() => {
      const current = JSON.stringify(answers);
      if (current !== lastSavedAnswers.current) {
        saveDraft(answers);
        lastSavedAnswers.current = current;
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [answers, saveDraft]);

  const calculateAutoScore = (currentAnswers: Record<string, string>) => {
    let score = 0;
    let hasStructured = false;
    
    questions.forEach(q => {
      if (q.type === 'mcq') {
        const studentAns = currentAnswers[q.id];
        const correctAns = q.correct_answer;
        if (studentAns && correctAns && studentAns.trim().toUpperCase() === correctAns.trim().toUpperCase()) {
          score += q.marks;
        }
      } else {
        hasStructured = true;
      }
    });
    
    return { score, hasStructured };
  };

  const submitWithZeroScore = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    
    showToast('Maximum violations reached. Your exam has been automatically submitted with a score of 0.', 'error');

    try {
      const totalMarks = questions.reduce((acc, q) => acc + q.marks, 0);

      const submissionData = {
        exam_id: examId,
        student_id: student.id,
        answers: answers,
        total_marks: totalMarks,
        score: 0,
        graded: true,
        is_manual: false,
        status: 'submitted' as const,
        marking_details: { 
          violation: { awarded_marks: 0, feedback: "Automatic zero due to maximum tab/blur violations." } 
        }
      };

      const { error: subError } = await supabase
        .from('submissions')
        .upsert(currentSubmissionId ? [{ ...submissionData, id: currentSubmissionId }] : [submissionData]);

      if (subError) throw subError;
      localStorage.removeItem(`exam_start_${examId}`);
      navigate(`/dashboard`);
    } catch (err) {
      console.error('Error submitting exam with zero score:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const totalMarks = questions.reduce((acc, q) => acc + q.marks, 0);
      const { score: autoScore, hasStructured } = calculateAutoScore(answers);

      const submissionData = {
        exam_id: examId,
        student_id: student.id,
        answers: answers,
        total_marks: totalMarks,
        score: autoScore,
        graded: !hasStructured, // Only fully graded if no essay questions
        is_manual: false,
        status: 'submitted' as const,
        marking_details: hasStructured 
          ? { note: "Structured questions require manual marking." } 
          : { note: "Automatically graded (MCQ/TF)." }
      };

      const { error: subError } = await supabase
        .from('submissions')
        .upsert(currentSubmissionId ? [{ ...submissionData, id: currentSubmissionId }] : [submissionData]);

      if (subError) throw subError;

      // Navigate to dashboard
      localStorage.removeItem(`exam_start_${examId}`);
      navigate(`/dashboard`);
    } catch (err) {
      console.error('Error submitting exam:', err);
      showToast('Failed to submit exam. Please contact your invigilator.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyAllowedQuestions = async () => {
    const copyable = questions.filter(q => (q as any).can_copy);
    if (copyable.length === 0) {
      showToast('No questions are available for copying.', 'error');
      return;
    }

    const text = copyable.map((q) => {
      const qIdx = questions.findIndex(orig => orig.id === q.id) + 1;
      let out = `Question ${qIdx} [${q.marks} Mark${q.marks !== 1 ? 's' : ''}]\n${q.question_text}`;
      if (q.type === 'mcq' && q.options && q.options.length > 0) {
        out += '\n' + q.options.map((opt, idx) => `  ${String.fromCharCode(65 + idx)}. ${opt}`).join('\n');
      }
      return out;
    }).join('\n\n---\n\n');

    try {
      await navigator.clipboard.writeText(text);
      showToast(`${copyable.length} question(s) copied to clipboard!`, 'success');
    } catch {
      showToast('Failed to copy. Please copy the questions manually.', 'error');
    }
  };

  const handleConfirmSubmit = () => {
    showConfirm({
      title: 'Submit Examination',
      message: 'Are you sure you want to submit your exam now?',
      confirmText: 'Submit',
      onConfirm: handleSubmit
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-primary flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-primary text-white font-mono selection:bg-accent selection:text-primary">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-primary/80 backdrop-blur-md border-b border-white/10 p-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent/10 rounded-lg">
              <Shield className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-none">{exam.title}</h1>
              <p className="text-xs text-panel/40 mt-1 uppercase tracking-tighter">Secure Session ID: {examId?.slice(0, 8)}</p>
            </div>
          </div>
          {examEndTime && <Timer endTime={examEndTime} onExpiry={handleSubmit} />}
        </div>
      </header>

      {/* Main Content */}
      <main ref={examContainerRef} className="max-w-4xl mx-auto pt-24 pb-32 px-6">
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-8 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-200">
            <span className="font-bold text-red-500 uppercase">Warning:</span> All activity is being monitored.
            Switching tabs, minimizing the browser, or <strong>moving the cursor outside this window</strong> will result in a violation.
            {maxViolations} violations will trigger automatic submission with a score of 0.
          </p>
        </div>

        {questions.map((q, index) => (
          <QuestionRenderer
            key={q.id}
            question={q}
            index={index}
            answer={answers[q.id]}
            onChange={(val) => setAnswers({ ...answers, [q.id]: val })}
          />
        ))}

        <div className="flex flex-col items-center gap-4 mt-12">
          {/* Copy allowed questions — for IDE-based questions */}
          {questions.some(q => (q as any).can_copy) && (
            <button
              onClick={handleCopyAllowedQuestions}
              className="group flex items-center gap-2 bg-white/5 text-panel/60 border border-white/10 px-6 py-3 rounded-xl font-bold text-sm hover:bg-white/10 hover:text-white hover:border-white/20 transition-all"
              title="Copy the designated questions to your clipboard"
            >
              <ClipboardCopy className="w-4 h-4" />
              Copy Copyable Questions
            </button>
          )}

          <button
            onClick={handleConfirmSubmit}
            disabled={isSubmitting}
            className="group flex items-center gap-3 bg-accent text-primary px-10 py-4 rounded-xl font-bold text-lg hover:bg-accent/90 transition-all shadow-[0_0_20px_rgba(0,229,255,0.3)] disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                Submit Examination
                <Send className="w-5 h-5 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
              </>
            )}
          </button>
        </div>
      </main>

      {/* Footer Info */}
      <footer className="fixed bottom-0 left-0 right-0 p-4 bg-primary/80 backdrop-blur-md border-t border-white/5">
        <div className="max-w-4xl mx-auto flex justify-between items-center text-[10px] text-panel/30 uppercase tracking-[0.2em]">
          <span>Student: {student?.student_number}</span>
          <span className="flex items-center gap-1">
            <MousePointer className="w-3 h-3" />
            Cursor &amp; Tab Monitoring Active
          </span>
          <span>Violations: {violationCount}/{maxViolations}</span>
        </div>
      </footer>

      <TabGuard
        violationCount={violationCount}
        maxViolations={maxViolations}
        showWarning={showViolationWarning}
        violationType={lastViolationType}
        onDismiss={handleAcknowledgeViolation}
      />
    </div>
  );
};

export default ExamRoom;
