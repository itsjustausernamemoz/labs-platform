import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@shared/lib/supabase';
import { GraduationCap, ArrowRight, Loader2 } from 'lucide-react';

const StudentLogin: React.FC = () => {
  const [studentNumber, setStudentNumber] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentNumber.trim()) return;

    setIsLoading(true);
    setError('');

    try {
      // Check if student exists
      let { data: student, error: fetchError } = await supabase
        .from('students')
        .select('*')
        .eq('student_number', studentNumber)
        .single();

      if (fetchError && fetchError.code === 'PGRST116') {
        // Student doesn't exist, create one
        const { data: newStudent, error: insertError } = await supabase
          .from('students')
          .insert([{ student_number: studentNumber }])
          .select()
          .single();

        if (insertError) throw insertError;
        student = newStudent;
      } else if (fetchError) {
        throw fetchError;
      }

      // Store student info in localStorage for simplicity (in a real app, use a proper session/context)
      localStorage.setItem('student', JSON.stringify(student));
      navigate('/dashboard'); // Students also have a dashboard to select exams
    } catch (err: any) {
      setError(err.message || 'An error occurred during login');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#0A1024] relative overflow-hidden">
      {/* Decorative Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-accent/10 rounded-full blur-[120px] animate-float" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[120px] animate-float" style={{ animationDelay: '-3s' }} />

      <div className="max-w-md w-full relative z-10">
        <div className="glass-panel rounded-[2.5rem] p-10 md:p-12">
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-accent/10 rounded-[2.5rem] mb-6 shadow-lg shadow-accent/20 animate-float">
              <GraduationCap className="w-10 h-10 text-accent" />
            </div>
            <h1 className="text-4xl font-black mb-3 tracking-tight text-white font-outfit">SecureLab</h1>
            <p className="text-white/40 text-sm font-medium">Enter your student number to begin your assessment</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label className="block text-xs font-bold text-white/40 uppercase tracking-[0.2em] ml-1">Student Number</label>
              <div className="relative group">
                <input
                  type="text"
                  required
                  value={studentNumber}
                  onChange={(e) => setStudentNumber(e.target.value)}
                  className="premium-input text-center text-xl font-bold tracking-widest group-hover:bg-white/[0.05]"
                  placeholder="20240001"
                  autoFocus
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-red-400 text-xs text-center font-medium animate-pulse-subtle">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="glass-button w-full bg-accent text-[#0A1024] font-black py-4 rounded-2xl flex items-center justify-center gap-3 hover:scale-[1.02] hover:shadow-[0_0_32px_rgba(0,229,255,0.4)] transition-all disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                <>
                  Continue to Exams
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>


        </div>
        
        <p className="mt-8 text-center text-[10px] text-white/10 font-bold uppercase tracking-[0.3em]">
          Powered by Onkoshi Palace Labs
        </p>
      </div>
    </div>
  );
};

export default StudentLogin;
