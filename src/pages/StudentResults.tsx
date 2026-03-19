import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  Trophy, CheckCircle2, AlertTriangle,
  ArrowRight, GraduationCap, ChevronDown, ChevronUp,
  MessageSquare, Target, ShieldCheck
} from 'lucide-react';

const StudentResults: React.FC = () => {
  const { submissionId } = useParams();
  const [submission, setSubmission] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchContent = async () => {
      const { data: sub } = await supabase
        .from('submissions')
        .select('*, exams(title)')
        .eq('id', submissionId)
        .single();

      if (sub && sub.graded) {
        setSubmission(sub);
        
        // Fetch questions to show titles in breakdown
        const { data: qs } = await supabase
          .from('questions')
          .select('*')
          .eq('exam_id', sub.exam_id)
          .order('order_index');
        
        setQuestions(qs || []);
        setIsLoading(false);
      } else {
        setTimeout(fetchContent, 3000);
      }
    };

    fetchContent();
  }, [submissionId]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-primary flex flex-col items-center justify-center p-6 text-center">
        <div className="relative mb-8">
          <div className="w-24 h-24 border-4 border-accent/20 border-t-accent rounded-full animate-spin"></div>
          <GraduationCap className="w-10 h-10 text-accent absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Marking in Progress</h2>
        <p className="text-panel/60 max-w-xs">Your structured answers are currently being marked. This usually takes less than a minute.</p>
      </div>
    );
  }

  const percentage = (submission.score / submission.total_marks) * 100;
  const isPassed = percentage >= 50;

  return (
    <div className="min-h-screen bg-primary flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white/5 border border-white/10 rounded-3xl p-8 text-center backdrop-blur-sm">
        <div className={`inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-6 ${
          isPassed ? 'bg-green-500/10 text-green-500' : 'bg-orange-500/10 text-orange-500'
        }`}>
          {isPassed ? <Trophy className="w-10 h-10" /> : <AlertTriangle className="w-10 h-10" />}
        </div>

        <h1 className="text-3xl font-bold mb-2">Exam Completed</h1>
        <p className="text-panel/40 mb-8 uppercase tracking-widest text-xs font-bold">{submission.exams.title}</p>

        <div className="bg-white/5 rounded-2xl p-6 mb-8 mt-4">
          <div className="text-5xl font-bold text-accent mb-2">
            {percentage.toFixed(0)}%
          </div>
          <div className="text-panel/60 font-medium">Overall Performance</div>
          {(submission.marked_by_name || submission.marked_by_email) && (
            <p className="text-[10px] text-panel/30 italic mt-2 font-medium tracking-wide">
              Marked by: <span className="text-accent/60 not-italic">{submission.marked_by_name || submission.marked_by_email}</span>
            </p>
          )}
        </div>

        <div className="space-y-4 mb-10">
          <div className="flex justify-between items-center p-4 bg-white/5 rounded-xl text-sm">
            <span className="text-panel/60">Status</span>
            {submission.is_manual ? (
              <span className="text-accent font-bold flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" />
                Lecturer Marked Successfully
              </span>
            ) : (
              <span className="text-green-500 font-bold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                AI Marked Successfully
              </span>
            )}
          </div>
        </div>

        <div className="mb-8">
          <button 
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-2 text-panel/60 hover:text-white transition-colors mx-auto text-sm font-bold uppercase tracking-widest"
          >
            {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {showDetails ? 'Hide Marking Details' : 'View Marking Details'}
          </button>

          {showDetails && (
            <div className="mt-8 space-y-6 text-left">
              {questions.map((q, idx) => {
                const detail = submission.marking_details?.[q.id];
                const studentAnswer = submission.answers?.[q.id] || '(No Answer)';
                const pct = detail ? (detail.awarded_marks / q.marks) * 100 : 0;

                return (
                  <div key={q.id} className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                    {/* Question header */}
                    <div className="flex justify-between items-start p-6 border-b border-white/10">
                      <div className="flex gap-3">
                        <span className="w-7 h-7 rounded-lg bg-accent/10 text-accent font-bold text-xs flex items-center justify-center shrink-0">{idx + 1}</span>
                        <h4 className="font-bold text-white text-sm leading-snug pt-0.5">{q.question_text}</h4>
                      </div>
                      <div className="text-right shrink-0 pl-4">
                        <div className="text-lg font-black text-accent">{detail?.awarded_marks ?? '-'} <span className="text-panel/40 font-normal text-sm">/ {q.marks}</span></div>
                        <div className="text-[10px] text-panel/30 uppercase font-bold tracking-widest">Marks</div>
                      </div>
                    </div>

                    <div className="p-6 grid grid-cols-1 gap-4">
                      {/* Your answer */}
                      <div>
                        <p className="text-[10px] text-panel/40 uppercase font-bold mb-2 flex items-center gap-1">
                          <Target className="w-3 h-3" /> Your Answer
                        </p>
                        <pre className="p-4 bg-white/5 border border-white/10 rounded-xl font-mono text-sm text-panel/80 whitespace-pre-wrap break-words leading-relaxed overflow-auto max-h-56">{studentAnswer}</pre>
                      </div>

                      {/* Correct / model answer */}
                      <div>
                        <p className="text-[10px] text-green-400/70 uppercase font-bold mb-2 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Correct Answer
                        </p>
                        <pre className="p-4 bg-green-500/5 border border-green-500/20 rounded-xl font-mono text-sm text-green-300 whitespace-pre-wrap break-words leading-relaxed overflow-auto max-h-56">{q.correct_answer || '(No model answer provided)'}</pre>
                      </div>

                      {/* Marks bar */}
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              pct === 100 ? 'bg-green-500' : pct >= 50 ? 'bg-accent' : 'bg-orange-500'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-bold text-panel/40 uppercase tracking-widest shrink-0">{pct.toFixed(0)}%</span>
                      </div>

                      {/* Marker feedback */}
                      {detail && (
                        <div className={`p-4 rounded-xl border ${
                          pct === 100 ? 'bg-green-500/10 border-green-500/20 text-green-400'
                          : pct >= 50 ? 'bg-accent/10 border-accent/20 text-accent'
                          : 'bg-orange-500/10 border-orange-500/20 text-orange-400'
                        }`}>
                          <p className="text-[10px] uppercase font-bold mb-1.5 flex items-center gap-1 opacity-60">
                            <MessageSquare className="w-3 h-3" /> Marker Feedback
                          </p>
                          <p className="text-xs font-medium leading-relaxed">{detail.feedback}</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <button
          onClick={() => navigate('/dashboard')}
          className="w-full bg-white text-primary font-bold py-4 rounded-xl flex items-center justify-center gap-2 hover:bg-panel transition-all"
        >
          Return to Dashboard
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

export default StudentResults;
