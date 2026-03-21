import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ShieldCheck, Lock, Mail, ArrowRight } from 'lucide-react';

const LecturerLogin: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const { error: loginError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (loginError) throw loginError;
      navigate('/lecturer/dashboard');
    } catch (err: any) {
      setError(err.message || 'Invalid email or password');
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError('Please enter your email address first');
      return;
    }
    setIsResetting(true);
    setError('');

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (resetError) throw resetError;
      setError('Password reset link sent! Please check your email.');
    } catch (err: any) {
      setError(err.message || 'Failed to send reset link');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-primary">
      <div className="max-w-md w-full">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-accent/10 rounded-2xl mb-6">
            <ShieldCheck className="w-10 h-10 text-accent" />
          </div>
          <h1 className="text-4xl font-bold mb-2 text-white">Lecturer Portal</h1>
          <p className="text-panel/60">Secure access for exam management</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-panel/80">Email Address</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-panel/40" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl pl-12 pr-4 py-3 outline-none focus:border-accent transition-all text-white"
                placeholder="lecturer@university.edu"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="block text-sm font-medium text-panel/80">Password</label>
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={isResetting}
                className="text-xs text-accent hover:underline disabled:opacity-50"
              >
                {isResetting ? 'Sending...' : 'Forgot your password?'}
              </button>
            </div>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-panel/40" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl pl-12 pr-4 py-3 outline-none focus:border-accent transition-all text-white"
                placeholder="••••••••"
              />
            </div>
          </div>

          {error && (
            <p className={`text-sm text-center ${error.includes('sent') ? 'text-green-400' : 'text-red-500'}`}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-accent text-primary font-bold py-4 rounded-xl flex items-center justify-center gap-2 hover:bg-accent/90 transition-all disabled:opacity-50 mt-6"
          >
            {isLoading ? 'Signing in...' : (
              <>
                Sign In
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 text-center space-y-4">
          <button
            onClick={() => navigate('/lecturer/signup')}
            className="text-panel/40 hover:text-accent text-sm transition-colors block w-full"
          >
            Don't have an account? Sign up
          </button>
          <button
            onClick={() => navigate('/')}
            className="text-panel/40 hover:text-accent text-sm transition-colors block w-full"
          >
            Back to Student Login
          </button>
        </div>
      </div>
    </div>
  );
};

export default LecturerLogin;
