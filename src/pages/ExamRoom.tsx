import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useTabGuard } from '../hooks/useTabGuard';
import type { ViolationType } from '../hooks/useTabGuard';
import TabGuard from '../components/TabGuard';
import QuestionRenderer from '../components/QuestionRenderer';
import type { Question } from '../components/QuestionRenderer';
import Timer from '../components/Timer';
import { Send, Shield, AlertTriangle, Loader2, MousePointer, ClipboardCopy, Save, FileDown } from 'lucide-react';
import { useNotification } from '../components/NotificationProvider';
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

  // Log violations to DB — batched with a 2-second debounce window.
  // This prevents a write spike when 1000 students simultaneously trigger
  // a violation (e.g. an OS notification popup across all machines).
  useEffect(() => {
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

  useTabGuard(handleViolation, examContainerRef);

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

      // 3. Check for existing submission (Draft or Final)
      // We use maybeSingle and order to handle potential historical duplicates safely
      const { data: existingSub, error: subError } = await supabase
        .from('submissions')
        .select('*')
        .eq('exam_id', examId)
        .eq('student_id', studentData.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (subError) {
        console.error('Error fetching submission:', subError);
      }

      if (existingSub) {
        setCurrentSubmissionId(existingSub.id);
        if (existingSub.status === 'draft') {
          console.log('ExamRoom: Resumed from draft session.');
          setAnswers(existingSub.answers || {});
        } else {
          showToast('You have already submitted this examination.', 'error');
          navigate('/dashboard');
          return;
        }
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
      setQuestions(questionData || []);

      // 6. Fetch Violation Count
      const { count: dbViolationCount } = await supabase
        .from('violations')
        .select('*', { count: 'exact', head: true })
        .eq('exam_id', examId)
        .eq('student_id', studentData.id);
      
      if (dbViolationCount !== null) {
        setViolationCount(dbViolationCount);
      }

      // 7. Subscribe to Realtime Violation Resets
      // If the lecturer hits "Resume" on the dashboard, it deletes all violations
      // for this student in the DB. We must listen for this to sync our local state,
      // otherwise the student will get kicked out again on their very next tab switch.
      const violationChannel = supabase
        .channel('violation-resets')
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'violations', filter: `student_id=eq.${studentData.id}` },
          () => {
            console.log('ExamRoom: Violations cleared by lecturer. Resetting local count to 0.');
            setViolationCount(0);
            pendingViolations.current = [];
            setShowViolationWarning(false);
            showToast('Your session has been formally resumed by the lecturer. Security violations reset.', 'info');
          }
        )
        .subscribe();

      // Clean up the subscription when unmounting
      return () => {
        supabase.removeChannel(violationChannel);
      };

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
          id: currentSubmissionId || undefined // Use ID if we have it, otherwise let onConflict handle it
        }, { 
          onConflict: 'exam_id,student_id',
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
        .upsert({
          ...submissionData,
          id: currentSubmissionId || undefined
        }, { onConflict: 'exam_id,student_id' });

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
        .upsert({
          ...submissionData,
          id: currentSubmissionId || undefined
        }, { onConflict: 'exam_id,student_id' });

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
      message: 'Are you sure you want to submit your exam now?',
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
          {examEndTime && <Timer endTime={examEndTime} onExpiry={handleAutoSubmitWithJitter} />}
        </div>
      </header>

      {/* Jitter Overlay */}
      {isJittering && (
        <div className="fixed inset-0 z-[60] bg-primary/95 flex flex-col items-center justify-center p-6 text-center animate-fade-in backdrop-blur-xl">
          <Loader2 className="w-16 h-16 text-accent animate-spin mb-8" />
          <h2 className="text-3xl font-bold mb-3 tracking-tight">{jitterMessage}</h2>
          <p className="text-panel/60 max-w-md text-lg leading-relaxed">
            The exam session is being securely finalized. We are currently syncing your latest progress to the database. 
            <span className="block mt-4 text-accent font-bold animate-pulse">Please do not close this window.</span>
          </p>
        </div>
      )}

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
          
          <button
            onClick={handleDownloadBackupScript}
            disabled={isSubmitting || questions.length === 0}
            className="group flex items-center gap-2 text-panel/40 hover:text-white transition-colors mt-4 text-sm font-medium border border-transparent hover:border-white/10 px-4 py-2 rounded-lg"
            title="Download a local text copy of your answers in case of system failure"
          >
            <FileDown className="w-4 h-4" />
            Download Backup Script
          </button>
        </div>
      </main>

      {/* Floating Save Button - "At all costs" visibility */}
      <div className="fixed bottom-24 right-8 z-50 flex flex-col items-end gap-2 animate-bounce-subtle">
        <button
          onClick={() => saveDraft(answers)}
          disabled={saveStatus === 'saving' || isSubmitting}
          className={`flex items-center gap-2 pr-6 pl-5 py-3 rounded-full font-bold uppercase tracking-widest transition-all shadow-2xl ${
            saveStatus === 'saving' ? 'bg-white/5 text-panel/40 cursor-wait h-[48px]' :
            saveStatus === 'saved' ? 'bg-green-500 text-primary h-[48px]' :
            saveStatus === 'error' ? 'bg-red-500 text-white animate-pulse h-[48px]' :
            'bg-accent text-primary hover:scale-105 hover:shadow-accent/40 h-[48px]'
          }`}
        >
          {saveStatus === 'saving' ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Syncing...
            </>
          ) : saveStatus === 'saved' ? (
            <>
              Synced ✓
            </>
          ) : saveStatus === 'error' ? (
            <>
              <AlertTriangle className="w-5 h-5" />
              Retry Save
            </>
          ) : (
            <>
              <Save className="w-5 h-5" />
              Save Progress
            </>
          )}
        </button>
        {saveStatus === 'error' && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-500 text-[10px] px-3 py-1 rounded-lg backdrop-blur-md">
            Click to retry manual save
          </div>
        )}
      </div>

      {/* Footer Info */}
      <footer className="fixed bottom-0 left-0 right-0 p-4 bg-primary/80 backdrop-blur-md border-t border-white/5">
        <div className="max-w-4xl mx-auto flex justify-between items-center text-[10px] text-panel/30 uppercase tracking-[0.2em]">
          <span>Student: {student?.student_number}</span>
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-1">
              <MousePointer className="w-3 h-3 text-accent" />
              Monitoring Active
            </span>
          </div>
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
