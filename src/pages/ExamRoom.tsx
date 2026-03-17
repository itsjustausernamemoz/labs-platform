import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useFullscreenLock } from '../hooks/useFullscreenLock';
import { useTabGuard } from '../hooks/useTabGuard';
import FullscreenLock from '../components/FullscreenLock';
import TabGuard from '../components/TabGuard';
import QuestionRenderer from '../components/QuestionRenderer';
import type { Question } from '../components/QuestionRenderer';
import Timer from '../components/Timer';
import { Send, Shield, AlertTriangle, Loader2 } from 'lucide-react';

const ExamRoom: React.FC = () => {
  const { examId } = useParams();
  const navigate = useNavigate();
  const [exam, setExam] = useState<any>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [student, setStudent] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [violationCount, setViolationCount] = useState(0);
  const [showViolationWarning, setShowViolationWarning] = useState(false);
  const MAX_VIOLATIONS = 3;

  const { isFullscreen, enterFullscreen } = useFullscreenLock();

  const handleViolation = useCallback(async (type: 'tab_switch' | 'blur' | 'fullscreen_exit') => {
    if (isSubmitting) return;

    setViolationCount(prev => {
      const newCount = prev + 1;

      // Log violation to database
      if (student && examId) {
        supabase.from('violations').insert([{
          student_id: student.id,
          exam_id: examId,
          violation_type: type
        }]).then(({ error }) => {
          if (error) console.error('Error logging violation:', error);
        });
      }

      if (newCount >= MAX_VIOLATIONS) {
        handleSubmit();
      } else {
        setShowViolationWarning(true);
      }
      return newCount;
    });
  }, [student, examId, isSubmitting]);

  useTabGuard(handleViolation);

  useEffect(() => {
    const storedStudent = localStorage.getItem('student');
    if (!storedStudent) {
      navigate('/');
      return;
    }
    setStudent(JSON.parse(storedStudent));
    fetchExamData();
  }, [examId]);

  useEffect(() => {
    if (isFullscreen === false && exam) {
      handleViolation('fullscreen_exit');
    }
  }, [isFullscreen, exam, handleViolation]);

  // Prevent right-click and keyboard shortcuts
  useEffect(() => {
    const preventDefaults = (e: MouseEvent) => e.preventDefault();
    const handleKeyDown = (e: KeyboardEvent) => {
      const forbiddenKeys = ['F12', 'U', 'I', 'J', 'C'];
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

    return () => {
      document.removeEventListener('contextmenu', preventDefaults);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const fetchExamData = async () => {
    setIsLoading(true);
    try {
      const { data: examData, error: examError } = await supabase
        .from('exams')
        .select('*')
        .eq('id', examId)
        .single();

      if (examError) throw examError;
      setExam(examData);

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

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      // Calculate total marks
      const totalMarks = questions.reduce((acc, q) => acc + q.marks, 0);

      const { data: submission, error: subError } = await supabase
        .from('submissions')
        .insert([{
          exam_id: examId,
          student_id: student.id,
          answers: answers,
          total_marks: totalMarks
        }])
        .select()
        .single();

      if (subError) throw subError;

      // Trigger grading edge function
      await supabase.functions.invoke('grade-submission', {
        body: { submissionId: submission.id }
      });

      // Navigate to results
      navigate(`/exam/results/${submission.id}`);
    } catch (err) {
      console.error('Error submitting exam:', err);
      alert('Failed to submit exam. Please contact your invigilator.');
    } finally {
      setIsSubmitting(false);
    }
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
      <FullscreenLock isFullscreen={isFullscreen} onEnterFullscreen={enterFullscreen} />
      <TabGuard
        violationCount={violationCount}
        maxViolations={MAX_VIOLATIONS}
        showWarning={showViolationWarning}
        onDismiss={() => setShowViolationWarning(false)}
      />

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
          <Timer durationMinutes={exam.duration_minutes} onExpiry={handleSubmit} />
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto pt-24 pb-32 px-6">
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-8 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-200">
            <span className="font-bold text-red-500 uppercase">Warning:</span> All activity is being monitored.
            Switching tabs, exiting fullscreen, or using unauthorized shortcuts will result in a violation.
            3 violations will trigger automatic submission.
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

        <div className="flex justify-center mt-12">
          <button
            onClick={() => {
              if (confirm('Are you sure you want to submit your exam?')) {
                handleSubmit();
              }
            }}
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
          <span>System Status: Fully Locked</span>
          <span>Violations: {violationCount}/{MAX_VIOLATIONS}</span>
        </div>
      </footer>
    </div>
  );
};

export default ExamRoom;
