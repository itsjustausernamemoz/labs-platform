import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { GraduationCap, ArrowRight } from 'lucide-react';

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
    <div className="min-h-screen flex items-center justify-center p-6 bg-primary">
      <div className="max-w-md w-full">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-accent/10 rounded-2xl mb-6">
            <GraduationCap className="w-10 h-10 text-accent" />
          </div>
          <h1 className="text-4xl font-bold mb-2">SecureLab</h1>
          <p className="text-panel/60">Enter your student number to begin</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-panel/80 mb-2">Student Number</label>
            <input
              type="text"
              required
              value={studentNumber}
              onChange={(e) => setStudentNumber(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-accent transition-all text-lg"
              placeholder="e.g. 20240001"
            />
          </div>

          {error && <p className="text-red-500 text-sm text-center">{error}</p>}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-accent text-primary font-bold py-4 rounded-xl flex items-center justify-center gap-2 hover:bg-accent/90 transition-all disabled:opacity-50"
          >
            {isLoading ? 'Processing...' : (
              <>
                Continue to Exams
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 text-center">
          <button
            onClick={() => navigate('/lecturer/login')}
            className="text-panel/40 hover:text-accent text-sm transition-colors"
          >
            Are you a lecturer? Login here
          </button>
        </div>
      </div>
    </div>
  );
};

export default StudentLogin;
