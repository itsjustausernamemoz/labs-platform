import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@shared/lib/apiClient';
import { ArrowRight, Loader2 } from 'lucide-react';
import logo from '@shared/assets/mashoke-logo.png';

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
      navigate('/dashboard');
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
        redirectTo: window.location.hostname === 'localhost'
          ? 'https://lab-lecturer.web.app/reset-password'
          : `${window.location.origin}/reset-password`,
      });

      if (resetError) throw resetError;
      setError('Password reset link sent! Please check your email.');
    } catch (err: any) {
      setError(err.message || 'Failed to send reset link');
    } finally {
      setIsResetting(false);
    }
  };

  const isSuccessMessage = error.includes('sent');

  return (
    <div className="lecturer-split" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: '100vh' }}>
      <div
        style={{
          background: 'var(--color-accent-900)', color: 'var(--color-bg)',
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 'var(--space-8)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src={logo} alt="Mashoke Tech" style={{ width: 38, height: 38, objectFit: 'contain', background: 'var(--color-bg)', borderRadius: '50%' }} />
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 18 }}>Mashoke Labs</span>
        </div>
        <div>
          <h1 style={{ fontSize: 52, color: 'var(--color-bg)', maxWidth: 480 }}>Run your assessments, not spreadsheets.</h1>
          <p style={{ color: 'color-mix(in srgb, var(--color-bg) 78%, transparent)', fontSize: 16, maxWidth: 420 }}>
            Create exams, enroll students in bulk, and grade with a clear, focused review flow.
          </p>
        </div>
        <p style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'color-mix(in srgb, var(--color-bg) 55%, transparent)' }}>
          Staff &amp; lecturer portal
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-8)' }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <h2 style={{ marginBottom: 'var(--space-1)' }}>Sign in</h2>
          <p className="text-muted" style={{ fontSize: 14, marginBottom: 'var(--space-6)' }}>
            Administrative access for lecturers and staff.
          </p>

          <form onSubmit={handleLogin}>
            <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
              <label>Email address</label>
              <input
                className="input" type="email" placeholder="lecturer@university.edu"
                value={email} onChange={(e) => setEmail(e.target.value)} required
              />
            </div>
            <div className="field" style={{ marginBottom: 'var(--space-2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <label>Password</label>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={isResetting}
                  style={{
                    fontSize: 12, background: 'none', border: 'none', padding: 0, font: 'inherit',
                    color: 'var(--color-accent)', cursor: isResetting ? 'default' : 'pointer',
                    opacity: isResetting ? 0.6 : 1,
                  }}
                >
                  {isResetting ? 'Sending…' : 'Forgot?'}
                </button>
              </div>
              <input
                className="input" type="password" placeholder="••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)} required
              />
            </div>

            {error && (
              <div
                className="card"
                style={{
                  borderLeft: `3px solid ${isSuccessMessage ? 'var(--color-accent)' : '#b3261e'}`,
                  margin: 'var(--space-4) 0',
                }}
              >
                <p style={{ margin: 0, fontSize: 13 }}>{error}</p>
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary btn-block"
              style={{ justifyContent: 'center', padding: 'var(--space-3)', fontSize: 15, marginTop: 'var(--space-4)' }}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 size={18} className="spin" />
              ) : (
                <>
                  Sign in <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <div className="hr" />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <button
              onClick={() => navigate('/signup')}
              style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--color-accent)', cursor: 'pointer' }}
            >
              Request access &rarr;
            </button>
            <a href="https://slab-student.web.app">&larr; Student portal</a>
          </div>
          <p style={{ textAlign: 'center', marginTop: 'var(--space-4)' }}>
            <a href="https://mashoke-admin.web.app" style={{ fontSize: 11, color: 'color-mix(in srgb, var(--color-text) 40%, transparent)' }}>Platform admin sign-in</a>
            {' '}&middot;{' '}
            <a href="https://mashoke-institution-admin.web.app" style={{ fontSize: 11, color: 'color-mix(in srgb, var(--color-text) 40%, transparent)' }}>Institution admin sign-in</a>
          </p>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
        @media (max-width: 860px) {
          .lecturer-split { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
};

export default LecturerLogin;
