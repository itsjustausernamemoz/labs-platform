import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@shared/lib/apiClient';
import { useTabGuard } from '@shared/hooks/useTabGuard';
import type { ViolationType } from '@shared/hooks/useTabGuard';
import TabGuard from '@shared/components/TabGuard';
import QuestionRenderer from '@shared/components/QuestionRenderer';
import type { Question } from '@shared/components/QuestionRenderer';
import Timer from '@shared/components/Timer';
import { Send, Shield, AlertTriangle, Loader2, MousePointer, ClipboardCopy, Save, FileDown, Clock, Check } from 'lucide-react';
import { useNotification } from '@shared/components/NotificationProvider';
import { jsPDF } from 'jspdf';

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
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [attemptNumber, setAttemptNumber] = useState(1);
  const [isJittering, setIsJittering] = useState(false);
  const [jitterMessage, setJitterMessage] = useState('Finalizing Submission.');
  const retryCount = useRef(0);
  const maxRetries = 3;

  // Pending violations accumulated between DB flushes
  const pendingViolations = useRef<Array<{ violation_type: string }>>([]);
  const violationFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [violationCount, setViolationCount] = useState(0);
  const [showViolationWarning, setShowViolationWarning] = useState(false);
  const [lastViolationType, setLastViolationType] = useState<ViolationType>('blur');

  const examContainerRef = useRef<HTMLDivElement>(null);
  const isOpenBook = exam?.exam_mode === 'open_book';
  const maxViolations = exam?.allowed_violations || 3;

  const lastViolationTime = React.useRef(0);

  const handleViolation = useCallback((type: ViolationType) => {
    if (isSubmitting || showViolationWarning || isOpenBook) {
      console.log('ExamRoom: Violation ignored - isSubmitting:', isSubmitting, 'warningAlreadyShowing:', showViolationWarning, 'isOpenBook:', isOpenBook);
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

  // Log violations to DB — batched with a 2-second debounce window.
  // This prevents a write spike when 1000 students simultaneously trigger
  // a violation (e.g. an OS notification popup across all machines).
  useEffect(() => {
    if (isOpenBook) return;
    if (violationCount > 0 && student && examId) {
      // Queue this violation for the next flush
      pendingViolations.current.push({ violation_type: lastViolationType });

      // Clear any existing flush timer and restart the 2-second window
      if (violationFlushTimer.current) clearTimeout(violationFlushTimer.current);

      violationFlushTimer.current = setTimeout(async () => {
        const batch = pendingViolations.current.splice(0); // drain queue
        if (batch.length === 0) return;

        const rows = batch.map(v => ({
          student_id: student.id,
          exam_id: examId,
          violation_type: v.violation_type,
        }));

        const { error } = await supabase.from('violations').insert(rows);
        if (error) console.error('Error batch-logging violations to DB:', error);
        else console.log(`ExamRoom: Flushed ${rows.length} violation(s) to DB.`);
      }, 2000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [violationCount, student, examId]);

  useTabGuard(handleViolation, examContainerRef, isOpenBook);

  useEffect(() => {
    const storedStudent = localStorage.getItem('student');
    if (!storedStudent) {
      navigate('/');
      return;
    }
    // Restore answers from localStorage as a fail-safe backup
    const backupAnswers = localStorage.getItem(`exam_answers_backup_${examId}`);
    if (backupAnswers && Object.keys(answers).length === 0) {
      console.log('ExamRoom: Restored answers from local backup.');
      setAnswers(JSON.parse(backupAnswers));
    }

    setStudent(JSON.parse(storedStudent));
    fetchExamData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId]);

  // Prevent right-click and keyboard shortcuts
  useEffect(() => {
    if (isOpenBook) return;
    
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

  // Polls for a lecturer-triggered violation reset (replaces the old Supabase
  // Realtime `violation-resets` DELETE subscription — this API has no
  // realtime push, so a few seconds of lag replaces instant notification).
  // If the lecturer hits "Resume" on the dashboard, it deletes all violations
  // for this student in the DB; the count drop below is what we detect here.
  const violationCountRef = useRef(0);
  useEffect(() => {
    violationCountRef.current = violationCount;
  }, [violationCount]);

  useEffect(() => {
    if (!student || !examId) return;
    const interval = setInterval(async () => {
      const { count } = await supabase
        .from('violations')
        .select('*', { count: 'exact', head: true })
        .eq('exam_id', examId)
        .eq('student_id', student.id);
      if (count !== null && count !== undefined && count < violationCountRef.current) {
        setViolationCount(0);
        pendingViolations.current = [];
        setShowViolationWarning(false);
        showToast('Your session has been formally resumed by the lecturer. Security violations reset.', 'info');
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [student, examId, showToast]);

  const seededShuffle = (array: any[], seed: string) => {
    if (!seed) return array;
    // Simple hash for the seed string
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = ((hash << 5) - hash) + seed.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    
    let state = Math.abs(hash);
    const nextInt = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state;
    };

    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = nextInt() % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  const [examEndTime, setExamEndTime] = useState<number | null>(null);

  const fetchExamData = async () => {
    setIsLoading(true);
    const storedStudent = localStorage.getItem('student');
    if (!storedStudent) return;
    const studentData = JSON.parse(storedStudent);

    try {
      // 1. Fetch Exam Details
      const { data: examData, error: examError } = await supabase
        .from('exams')
        .select('*')
        .eq('id', examId)
        .single();

      if (examError) throw examError;
      setExam(examData);

      // 2. Check Enrollment
      const { data: enrollment, error: enrollError } = await supabase
        .from('enrollments')
        .select('*')
        .eq('student_id', studentData.id)
        .eq('exam_id', examId)
        .maybeSingle();

      if (enrollError) throw enrollError;
      if (!enrollment) {
        showToast('You are not enrolled in this examination.', 'error');
        navigate('/dashboard');
        return;
      }

      // 3. Check for existing submissions (Multi-Attempt Support)
      const { data: allSubs, error: subError } = await supabase
        .from('submissions')
        .select('*')
        .eq('exam_id', examId)
        .eq('student_id', studentData.id)
        .order('attempt_number', { ascending: false });

      if (subError) console.error('Error fetching submissions:', subError);

      const latestSub = allSubs?.[0];
      const attemptCount = allSubs?.length || 0;

      if (latestSub) {
        if (latestSub.status === 'draft') {
          console.log('ExamRoom: Resumed from draft session.');
          setCurrentSubmissionId(latestSub.id);
          setAnswers(latestSub.answers || {});
          setAttemptNumber(latestSub.attempt_number || 1);
        } else {
          // Latest is submitted. Can we start a new one?
          const maxAllowed = examData.allowed_attempts || 1;
          if (attemptCount < maxAllowed) {
            const nextAttempt = attemptCount + 1;
            console.log(`ExamRoom: Starting new attempt #${nextAttempt}`);
            setAttemptNumber(nextAttempt);
            // Fresh start for the timer as well
            localStorage.removeItem(`exam_start_${examId}`);
            setAnswers({});
          } else {
            showToast('Maximum attempts reached for this examination.', 'error');
            navigate('/dashboard');
            return;
          }
        }
      } else {
        setAttemptNumber(1);
      }

      // 4. Handle Timer Persistence
      const startTimeKey = `exam_start_${examId}`;
      let startTime = localStorage.getItem(startTimeKey);
      
      if (!startTime) {
        startTime = Date.now().toString();
        localStorage.setItem(startTimeKey, startTime);
      }

      const durationMs = (examData.duration_minutes || 60) * 60 * 1000;
      setExamEndTime(parseInt(startTime) + durationMs);

      // 5. Fetch Questions
      const { data: questionData, error: qError } = await supabase
        .from('questions')
        .select('*')
        .eq('exam_id', examId)
        .order('order_index', { ascending: true });

      if (qError) throw qError;
      
      // Randomize questions for this student
      const randomizedQuestions = seededShuffle(questionData || [], studentData.id);
      setQuestions(randomizedQuestions);

      // 6. Fetch Violation Count
      const { count: dbViolationCount } = await supabase
        .from('violations')
        .select('*', { count: 'exact', head: true })
        .eq('exam_id', examId)
        .eq('student_id', studentData.id);
      
      if (dbViolationCount != null) {
        setViolationCount(dbViolationCount);
      }
    } catch (err) {
      console.error('Error fetching exam data:', err);
      showToast('Error loading exam. Please try again.', 'error');
      navigate('/dashboard');
    } finally {
      setIsLoading(false);
    }
  };

  // Optimized saveDraft logic
  const saveDraft = useCallback(async (currentAnswers: Record<string, string>) => {
    if (!student || !examId || isSubmitting) return;
    
    setSaveStatus('saving');
    console.log('ExamRoom: Saving draft (optimized)...');
    
    const submissionData = {
      exam_id: examId,
      student_id: student.id,
      answers: currentAnswers,
      status: 'draft' as const,
      updated_at: new Date().toISOString()
    };

    try {
      // Use upsert with onConflict to be "fail-proof" against duplicates
      const { data: result, error: subError } = await supabase
        .from('submissions')
        .upsert({
          ...submissionData,
          attempt_number: attemptNumber,
          id: currentSubmissionId || undefined // Use ID if we have it, otherwise let onConflict handle it
        }, { 
          onConflict: 'exam_id,student_id,attempt_number',
          ignoreDuplicates: false 
        })
        .select('id')
        .single();
        
      if (subError) throw subError;
      
      if (result && !currentSubmissionId) {
        setCurrentSubmissionId(result.id);
      }
      setSaveStatus('saved');
      retryCount.current = 0; // Reset retries on success
      // Reset to idle after 2 seconds
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err: any) {
      console.error('Error auto-saving draft:', err);
      const errorMsg = err?.message || 'Unknown error';
      
      // Exponential backoff retry
      if (retryCount.current < maxRetries) {
        retryCount.current++;
        const backoffMs = Math.pow(2, retryCount.current) * 1000;
        console.warn(`ExamRoom: Save failed (${errorMsg}). Retrying in ${backoffMs}ms... (Attempt ${retryCount.current})`);
        setTimeout(() => saveDraft(currentAnswers), backoffMs);
      } else {
        setSaveStatus('error');
        showToast(`Auto-save failed: ${errorMsg}. Please use Manual Sync.`, 'error');
      }
    }
  }, [student, examId, currentSubmissionId, isSubmitting]);

  // Debounced Auto-save (triggers after 5 seconds of inactivity)
  useEffect(() => {
    if (Object.keys(answers).length === 0) return;
    
    // Immediate local backup for "at all costs" reliability
    localStorage.setItem(`exam_answers_backup_${examId}`, JSON.stringify(answers));

    const handler = setTimeout(() => {
      saveDraft(answers);
    }, 5000);

    return () => clearTimeout(handler);
  }, [answers, saveDraft, examId]);

  const calculateAutoScore = (currentAnswers: Record<string, string>) => {
    let score = 0;
    let hasStructured = false;
    const markingDetails: Record<string, any> = {};
    
    questions.forEach(q => {
      if (q.type === 'mcq') {
        const studentAns = currentAnswers[q.id];
        const correctAns = q.correct_answer;
        // Ultra-lenient: Ignore all whitespace and case
          const stud = (studentAns || '').replace(/\s+/g, '').toUpperCase();
          const corr = (q.correct_answer || '').replace(/\s+/g, '').toUpperCase();
          // Lenient matching: Compare letter or check if corr starts with stud letter (e.g. "A" vs "A. Option")
          const isCorrect = stud === corr || (stud.length === 1 && (corr.startsWith(stud + ".") || corr.startsWith(stud + " ")));
        
        if (isCorrect) {
          score += q.marks;
          markingDetails[q.id] = { 
            awarded_marks: q.marks, 
            feedback: `Correct [${studentAns}] (Auto-Marked).` 
          };
        } else {
          markingDetails[q.id] = { 
            awarded_marks: 0, 
            feedback: studentAns ? `Incorrect [${studentAns}]. Expected [${correctAns}]` : "No answer provided." 
          };
        }
      } else {
        hasStructured = true;
      }
    });
    
    return { score, hasStructured, markingDetails };
  };

  const submitWithZeroScore = async () => {
    if (isSubmitting || isJittering) return;
    
    setJitterMessage('Violations Detected. Finalizing Kick-out Submission.');
    setIsJittering(true);

    // Apply 0-20s jitter to avoid database overload during mass kick-outs
    const jitterMs = Math.floor(Math.random() * 20000);
    console.log(`ExamRoom: Violation kick-out triggered. Jittering for ${jitterMs}ms...`);

    setTimeout(async () => {
      setIsJittering(false);
      setIsSubmitting(true);
      
      showToast('Maximum violations reached. Your exam has been automatically submitted with a score of 0.', 'error');

    try {
      const totalMarks = questions.reduce((acc, q) => acc + q.marks, 0);
      const { score: autoScore, markingDetails: autoMarkingDetails } = calculateAutoScore(answers);

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
          ...autoMarkingDetails,
          violation_audit: { 
            awarded_marks: 0, 
            original_auto_score: autoScore, 
            feedback: `Automatic zero due to maximum violations (${violationCount}/${maxViolations}).` 
          } 
        }
      };

      const { error: subError } = await supabase
        .from('submissions')
        .upsert({
          ...submissionData,
          attempt_number: attemptNumber,
          id: currentSubmissionId || undefined
        }, { onConflict: 'exam_id,student_id,attempt_number' });

      if (subError) throw subError;
      localStorage.removeItem(`exam_start_${examId}`);
      navigate(`/dashboard`);
    } catch (err) {
      console.error('Error submitting exam with zero score:', err);
    } finally {
      setIsSubmitting(false);
      localStorage.removeItem(`exam_answers_backup_${examId}`);
    }
    }, jitterMs);
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const totalMarks = questions.reduce((acc, q) => acc + q.marks, 0);
      const { score: autoScore, hasStructured, markingDetails: autoMarkingDetails } = calculateAutoScore(answers);
      const isMcqOnly = exam?.exam_type === 'mcq_only';
      const isGraded = isMcqOnly || !hasStructured;

      const submissionData = {
        exam_id: examId,
        student_id: student.id,
        answers: answers,
        total_marks: totalMarks,
        score: autoScore,
        graded: isGraded, 
        is_manual: false,
        status: 'submitted' as const,
        marking_details: {
          ...autoMarkingDetails,
          ...(!isGraded 
            ? { note: "Structured questions require manual or AI marking." } 
            : { note: "Automatically graded (MCQ Only)." })
        }
      };

      const { error: subError } = await supabase
        .from('submissions')
        .upsert({
          ...submissionData,
          attempt_number: attemptNumber,
          id: currentSubmissionId || undefined
        }, { onConflict: 'exam_id,student_id,attempt_number' });

      if (subError) throw subError;

      // Navigate to dashboard
      localStorage.removeItem(`exam_start_${examId}`);
      localStorage.removeItem(`exam_answers_backup_${examId}`);
      navigate(`/dashboard`);
    } catch (err: any) {
      console.error('Error submitting exam:', err);
      showToast(`Failed to submit exam: ${err?.message || 'Please contact your invigilator.'}`, 'error');
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

  const handleDownloadBackupScript = () => {
    if (questions.length === 0) return;

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const maxWidth = pageWidth - (margin * 2);
    let y = margin;

    // Helper to add text and manage pagination
    const addWrappedText = (text: string, fontSize: number, isBold: boolean, color: number = 0) => {
      doc.setFontSize(fontSize);
      doc.setFont('helvetica', isBold ? 'bold' : 'normal');
      doc.setTextColor(color);
      
      const lines = doc.splitTextToSize(text, maxWidth);
      const lineHeight = fontSize * 0.4;
      
      for (let i = 0; i < lines.length; i++) {
        if (y + lineHeight > pageHeight - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(lines[i], margin, y);
        y += lineHeight;
      }
      y += 2; // Extra padding after block
    };

    // Header
    addWrappedText('OFFICIAL EXAM BACKUP SCRIPT', 16, true);
    y += 5;
    addWrappedText(`Examination: ${exam?.title || 'Unknown Exam'}`, 12, false, 100);
    addWrappedText(`Student Number: ${student?.student_number || 'Unknown'}`, 12, false, 100);
    addWrappedText(`Generated At: ${new Date().toLocaleString()}`, 10, false, 150);
    y += 10;

    // Questions
    questions.forEach((q, index) => {
      // Add a separator space between questions
      if (index > 0) y += 8;
      
      // Question Header
      addWrappedText(`QUESTION ${index + 1} (${q.marks} Marks) - ${q.type.toUpperCase()}`, 11, true, 80);
      y += 2;
      
      // Question Text
      addWrappedText(q.question_text, 11, false, 0);
      
      // MCQ Options
      if (q.type === 'mcq' && q.options && q.options.length > 0) {
        y += 2;
        q.options.forEach((opt, oIdx) => {
          addWrappedText(`  ${String.fromCharCode(65 + oIdx)}. ${opt}`, 11, false, 60);
        });
      }

      y += 4;
      
      // Student Answer
      addWrappedText('YOUR ANSWER:', 10, true, 80);
      const currentAns = answers[q.id] || '(No Answer Provided)';
      addWrappedText(currentAns, 11, false, 0);
      
      // Draw a subtle line separator
      if (y < pageHeight - margin - 5) {
        y += 4;
        doc.setDrawColor(200);
        doc.line(margin, y, pageWidth - margin, y);
        y += 4;
      }
    });

    doc.save(`Exam_Backup_${student?.student_number}_${new Date().getTime()}.pdf`);
    showToast('Backup PDF downloaded successfully.', 'success');
  };

  const handleConfirmSubmit = () => {
    showConfirm({
      title: 'Submit Examination',
      message: `You've answered ${Object.keys(answers).length} of ${questions.length} question${questions.length !== 1 ? 's' : ''}. Once submitted, you cannot make further changes.`,
      confirmText: 'Submit',
      onConfirm: handleSubmit
    });
  };

  const handleAutoSubmitWithJitter = () => {
    if (isSubmitting || isJittering) return;
    
    setIsJittering(true);
    setJitterMessage('Time Ended. Finalizing Submission.');
    // Add jitter between 0 and 20 seconds to spread load
    const jitterMs = Math.floor(Math.random() * 20000);
    console.log(`ExamRoom: Auto-submit triggered. Jittering for ${jitterMs}ms...`);
    
    setTimeout(() => {
      setIsJittering(false);
      handleSubmit();
    }, jitterMs);
  };

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={40} className="spin" style={{ color: 'var(--color-accent)' }} />
      </div>
    );
  }

  const isLastQuestion = questions.length > 0 && currentQuestionIndex === questions.length - 1;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-text)' }}>
      {/* Header */}
      <header
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40,
          background: 'var(--color-bg)', borderBottom: '2px solid var(--color-divider)',
          padding: 'var(--space-3) var(--space-4)',
        }}
      >
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <div style={{
              width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none',
              background: isOpenBook ? 'var(--color-accent-2-100)' : 'var(--color-accent-100)',
            }}>
              <Shield size={18} style={{ color: isOpenBook ? 'var(--color-accent-2-700)' : 'var(--color-accent-700)' }} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <h1 style={{ fontSize: 17, margin: 0, lineHeight: 1.2 }}>{exam.title}</h1>
                {isOpenBook && <span className="tag tag-accent-2">Open Book</span>}
              </div>
              <p className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '2px 0 0' }}>
                Secure Session ID: {examId?.slice(0, 8)}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
            {examEndTime && <Timer endTime={examEndTime} onExpiry={handleAutoSubmitWithJitter} />}
            {isLastQuestion && (
              <button
                onClick={handleConfirmSubmit}
                disabled={isSubmitting}
                className="btn btn-primary"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={16} className="spin" />
                    Submitting…
                  </>
                ) : (
                  <>
                    Submit exam
                    <Send size={15} />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Jitter Overlay */}
      {isJittering && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 60,
            background: 'color-mix(in srgb, var(--color-neutral-900) 94%, transparent)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: 'var(--space-6)', textAlign: 'center',
          }}
        >
          <Loader2 size={56} className="spin" style={{ color: 'var(--color-accent-2-300)', marginBottom: 'var(--space-6)' }} />
          <h2 style={{ color: 'var(--color-bg)', marginBottom: 'var(--space-3)' }}>{jitterMessage}</h2>
          <p style={{ color: 'color-mix(in srgb, var(--color-bg) 65%, transparent)', maxWidth: 480, fontSize: 16, lineHeight: 1.6, margin: 0 }}>
            The exam session is being securely finalized. We are currently syncing your latest progress to the database.
            <span style={{ display: 'block', marginTop: 'var(--space-4)', color: 'var(--color-accent-2-300)', fontWeight: 800 }}>
              Please do not close this window.
            </span>
          </p>
        </div>
      )}

      {/* Main Content */}
      <main ref={examContainerRef} style={{ maxWidth: 1200, margin: '0 auto', padding: '96px var(--space-6) 140px' }}>
        {!isOpenBook && (
          <div
            style={{
              border: '1px solid var(--color-accent-700)', background: 'var(--color-accent-100)',
              padding: 'var(--space-4)', marginBottom: 'var(--space-6)',
              display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)',
            }}
          >
            <AlertTriangle size={18} style={{ color: 'var(--color-accent-700)', flex: 'none', marginTop: 2 }} />
            <p style={{ fontSize: 13, margin: 0, color: 'var(--color-accent-800)' }}>
              <strong style={{ textTransform: 'uppercase' }}>Warning:</strong> All activity is being monitored.
              Switching tabs, minimizing the browser, or <strong>moving the cursor outside this window</strong> will result in a violation.
              {' '}{maxViolations} violations will trigger automatic submission with a score of 0.
            </p>
          </div>
        )}

        {isOpenBook && (
          <div
            style={{
              border: '1px solid var(--color-accent-2-700)', background: 'var(--color-accent-2-100)',
              padding: 'var(--space-4)', marginBottom: 'var(--space-6)',
              display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)',
            }}
          >
            <Shield size={16} style={{ color: 'var(--color-accent-2-700)', flex: 'none', marginTop: 2 }} />
            <p style={{ fontSize: 13, margin: 0, color: 'var(--color-accent-2-800)' }}>
              <strong style={{ textTransform: 'uppercase' }}>Open Book Mode:</strong> Security restrictions and violation monitoring are disabled for this assessment.
              You may freely switch tabs and access external resources.
            </p>
          </div>
        )}

        <div className="examroom-grid">
          {/* Main Question Column */}
          <div>
            {questions.length > 0 && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
                    <span className="card-kicker" style={{ fontSize: 12 }}>Question</span>
                    <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 22 }}>{currentQuestionIndex + 1}</span>
                    <span className="text-muted" style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 22 }}>/ {questions.length}</span>
                  </div>
                  <div className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Attempt {attemptNumber}
                  </div>
                </div>

                <QuestionRenderer
                  key={questions[currentQuestionIndex].id}
                  question={questions[currentQuestionIndex]}
                  index={currentQuestionIndex}
                  answer={answers[questions[currentQuestionIndex].id]}
                  onChange={(val) => setAnswers({ ...answers, [questions[currentQuestionIndex].id]: val })}
                  hasCoding={exam?.has_coding}
                  language={exam?.coding_language}
                />

                {/* Pagination Controls */}
                <div
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    border: '1px solid var(--color-divider)', padding: 'var(--space-3) var(--space-4)',
                    marginTop: 'var(--space-4)', gap: 'var(--space-4)',
                  }}
                >
                  <button
                    onClick={() => setCurrentQuestionIndex(prev => Math.max(0, prev - 1))}
                    disabled={currentQuestionIndex === 0}
                    className="btn btn-secondary"
                  >
                    ← Previous
                  </button>

                  {isLastQuestion ? (
                    <span className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Last question — use Submit exam above when ready
                    </span>
                  ) : (
                    <button
                      onClick={() => setCurrentQuestionIndex(prev => Math.min(questions.length - 1, prev + 1))}
                      className="btn btn-primary"
                    >
                      Next Question →
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Sidebar Jumper Column */}
          <aside style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div className="card" style={{ gap: 'var(--space-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 className="card-kicker" style={{ margin: 0 }}>Navigation</h3>
                <span className="tag tag-neutral">{Object.keys(answers).length} / {questions.length} Solved</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
                {questions.map((q, idx) => {
                  const isCurrent = idx === currentQuestionIndex;
                  const isAnswered = !!answers[q.id];

                  return (
                    <button
                      key={q.id}
                      onClick={() => setCurrentQuestionIndex(idx)}
                      style={{
                        position: 'relative', height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'var(--font-heading)',
                        border: isCurrent ? '1px solid var(--color-accent)' : '1px solid var(--color-divider)',
                        background: isCurrent ? 'var(--color-accent)' : isAnswered ? 'var(--color-accent-100)' : 'transparent',
                        color: isCurrent ? 'var(--color-bg)' : isAnswered ? 'var(--color-accent-800)' : 'var(--color-text)',
                      }}
                    >
                      {isAnswered && !isCurrent ? <Check size={14} /> : idx + 1}
                    </button>
                  );
                })}
              </div>

              <div style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {questions.some(q => (q as any).can_copy) && (
                  <button
                    onClick={handleCopyAllowedQuestions}
                    className="btn btn-secondary btn-block"
                    style={{ justifyContent: 'center' }}
                  >
                    <ClipboardCopy size={14} />
                    Copy Lab Prompts
                  </button>
                )}

                <button
                  onClick={handleDownloadBackupScript}
                  disabled={isSubmitting || questions.length === 0}
                  className="btn btn-ghost btn-block"
                  style={{ justifyContent: 'center', fontSize: 11 }}
                >
                  <FileDown size={13} />
                  Save Local Backup
                </button>
              </div>
            </div>

            {/* Hint Panel */}
            <div className="card" style={{ background: 'var(--color-accent-2-100)', gap: 'var(--space-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-accent-2-800)' }}>
                <Clock size={15} />
                <span className="card-kicker" style={{ color: 'var(--color-accent-2-800)' }}>Pro-Tip</span>
              </div>
              <p style={{ fontSize: 12, margin: 0, color: 'var(--color-accent-2-800)', opacity: 0.85, lineHeight: 1.5 }}>
                You can jump between questions at any time. Your progress is automatically synced as you navigate.
              </p>
            </div>
          </aside>
        </div>
      </main>

      {/* Floating Save Button - "At all costs" visibility */}
      <div style={{ position: 'fixed', bottom: 88, right: 'var(--space-6)', zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--space-2)' }}>
        <button
          onClick={() => saveDraft(answers)}
          disabled={saveStatus === 'saving' || isSubmitting}
          className="btn"
          style={{
            boxShadow: 'var(--shadow-lg)',
            border: '1px solid var(--color-divider)',
            padding: 'var(--space-2) var(--space-4)',
            background:
              saveStatus === 'saved' ? 'var(--color-accent-2-500)' :
              saveStatus === 'error' ? '#b3261e' :
              saveStatus === 'saving' ? 'var(--color-surface)' :
              'var(--color-accent)',
            color:
              saveStatus === 'saving' ? 'var(--color-text)' : 'var(--color-bg)',
            cursor: saveStatus === 'saving' ? 'wait' : 'pointer',
          }}
        >
          {saveStatus === 'saving' ? (
            <>
              <Loader2 size={18} className="spin" />
              Syncing...
            </>
          ) : saveStatus === 'saved' ? (
            <>
              Synced ✓
            </>
          ) : saveStatus === 'error' ? (
            <>
              <AlertTriangle size={18} />
              Retry Save
            </>
          ) : (
            <>
              <Save size={18} />
              Save Progress
            </>
          )}
        </button>
        {saveStatus === 'error' && (
          <div style={{ fontSize: 10, padding: '4px 8px', border: '1px solid #b3261e', color: '#b3261e', background: 'var(--color-bg)' }}>
            Click to retry manual save
          </div>
        )}
      </div>

      {/* Footer Info */}
      <footer
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 30,
          background: 'var(--color-bg)', borderTop: '2px solid var(--color-divider)',
          padding: 'var(--space-3) var(--space-4)',
        }}
      >
        <div
          style={{
            maxWidth: 1200, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
            color: 'color-mix(in srgb, var(--color-text) 50%, transparent)', flexWrap: 'wrap', gap: 'var(--space-2)',
          }}
        >
          <span>Student: {student?.student_number}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <MousePointer size={12} style={{ color: isOpenBook ? 'var(--color-accent-2-600)' : 'var(--color-accent-600)' }} />
              {isOpenBook ? 'Open Book Environment' : 'Monitoring Active'}
            </span>
          </div>
          {!isOpenBook && <span>Violations: {violationCount}/{maxViolations}</span>}
          {isOpenBook && <span style={{ color: 'var(--color-accent-2-600)' }}>Verified Mode</span>}
        </div>
      </footer>

      <TabGuard
        violationCount={violationCount}
        maxViolations={maxViolations}
        showWarning={showViolationWarning}
        violationType={lastViolationType}
        onDismiss={handleAcknowledgeViolation}
      />

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
        .examroom-grid { display: grid; grid-template-columns: 2fr 1fr; gap: var(--space-8); align-items: start; }
        @media (max-width: 960px) {
          .examroom-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
};

export default ExamRoom;
