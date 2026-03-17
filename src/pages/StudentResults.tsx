import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  Trophy, CheckCircle2, AlertTriangle,
  ArrowRight, GraduationCap
} from 'lucide-react';

const StudentResults: React.FC = () => {
  const { submissionId } = useParams();
  const [submission, setSubmission] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const pollResults = async () => {
      const { data } = await supabase
        .from('submissions')
        .select('*, exams(title)')
        .eq('id', submissionId)
        .single();

      if (data && data.graded) {
        setSubmission(data);
        setIsLoading(false);
      } else {
        // Poll every 3 seconds if not yet graded
        setTimeout(pollResults, 3000);
      }
    };

    pollResults();
  }, [submissionId]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-primary flex flex-col items-center justify-center p-6 text-center">
        <div className="relative mb-8">
          <div className="w-24 h-24 border-4 border-accent/20 border-t-accent rounded-full animate-spin"></div>
          <GraduationCap className="w-10 h-10 text-accent absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Grading in Progress</h2>
        <p className="text-panel/60 max-w-xs">Our AI is currently evaluating your structured answers. This usually takes less than a minute.</p>
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

        <div className="bg-white/5 rounded-2xl p-6 mb-8">
          <div className="text-5xl font-bold text-accent mb-2">
            {submission.score.toFixed(1)}<span className="text-2xl text-panel/40 font-medium">/{submission.total_marks}</span>
          </div>
          <div className="text-panel/60 font-medium">Total Score Achieved</div>
        </div>

        <div className="space-y-4 mb-10">
          <div className="flex justify-between items-center p-4 bg-white/5 rounded-xl text-sm">
            <span className="text-panel/60">Status</span>
            <span className="text-green-500 font-bold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              Graded Successfully
            </span>
          </div>
          <div className="flex justify-between items-center p-4 bg-white/5 rounded-xl text-sm">
            <span className="text-panel/60">Performance</span>
            <span className="font-bold">{percentage.toFixed(0)}%</span>
          </div>
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
