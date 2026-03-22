import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ShieldCheck, Lock, Mail, ArrowRight, Loader2 } from 'lucide-react';

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
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#0A1024] relative overflow-hidden">
      {/* Decorative Orbs */}
      <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[120px] animate-float" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-accent/10 rounded-full blur-[120px] animate-float" style={{ animationDelay: '-3s' }} />

      <div className="max-w-md w-full relative z-10">
        <div className="glass-panel rounded-[2.5rem] p-10 md:p-12">
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-accent/10 rounded-[2.5rem] mb-6 shadow-lg shadow-accent/20 animate-float">
              <ShieldCheck className="w-10 h-10 text-accent" />
            </div>
            <h1 className="text-4xl font-black mb-3 tracking-tight text-white font-outfit">Lecturer Portal</h1>
            <p className="text-white/40 text-sm font-medium">Secure access for administrative management</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <label className="block text-xs font-bold text-white/40 uppercase tracking-[0.2em] ml-1">Email Address</label>
              <div className="relative group">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/20 group-focus-within:text-accent transition-colors" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="premium-input pl-12 group-hover:bg-white/[0.05]"
                  placeholder="lecturer@university.edu"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center ml-1">
                <label className="block text-xs font-bold text-white/40 uppercase tracking-[0.2em]">Password</label>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={isResetting}
                  className="text-[10px] text-accent hover:underline disabled:opacity-50 font-bold uppercase tracking-widest"
                >
                  {isResetting ? 'Sending...' : 'Forgot?'}
                </button>
              </div>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/20 group-focus-within:text-accent transition-colors" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="premium-input pl-12 group-hover:bg-white/[0.05]"
                  placeholder="••••••••"
                />
              </div>
            </div>

            {error && (
              <div className={`mt-4 bg-white/5 border rounded-xl p-3 text-xs text-center font-medium animate-pulse-subtle ${
                error.includes('sent') ? 'text-green-400 border-green-500/20' : 'text-red-400 border-red-500/20'
              }`}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="glass-button w-full bg-accent text-[#0A1024] font-black py-4 rounded-2xl flex items-center justify-center gap-3 hover:scale-[1.02] hover:shadow-[0_0_32px_rgba(0,229,255,0.4)] transition-all disabled:opacity-50 mt-6"
            >
              {isLoading ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                <>
                  Sign In
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>

          <div className="mt-10 pt-8 border-t border-white/5 text-center space-y-4">
            <button
              onClick={() => navigate('/lecturer/signup')}
              className="text-white/20 hover:text-accent font-bold text-xs uppercase tracking-widest transition-all block w-full hover:tracking-[0.1em]"
            >
              Request Access / Sign Up
            </button>
            <button
              onClick={() => navigate('/')}
              className="text-white/20 hover:text-white font-bold text-xs uppercase tracking-widest transition-all block w-full"
            >
              &larr; Student Portal
            </button>
          </div>
        </div>
        
        <p className="mt-8 text-center text-[10px] text-white/10 font-bold uppercase tracking-[0.3em]">
          Secure Laboratory Management System
        </p>
      </div>
    </div>
  );
};

export default LecturerLogin;
