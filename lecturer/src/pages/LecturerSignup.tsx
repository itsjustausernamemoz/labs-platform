import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@shared/lib/apiClient';
import { ArrowRight, Loader2 } from 'lucide-react';
import logo from '@shared/assets/mashoke-logo.png';

const LecturerSignup: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const { data, error: signupError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (signupError) throw signupError;

      if (data.user) {
        navigate('/dashboard');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred during signup');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 'var(--space-6)' }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 'var(--space-6)' }}>
          <img src={logo} alt="Mashoke Tech" style={{ width: 34, height: 34, objectFit: 'contain' }} />
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 16 }}>Mashoke Labs</span>
        </div>
        <h2 style={{ textAlign: 'center', marginBottom: 'var(--space-1)' }}>Request lecturer access</h2>
        <p className="text-muted" style={{ textAlign: 'center', fontSize: 14, marginBottom: 'var(--space-6)' }}>
          Create your staff account to start building exams.
        </p>

        <form onSubmit={handleSignup}>
          <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
            <label>Email address</label>
            <input
              className="input" type="email" placeholder="lecturer@university.edu"
              value={email} onChange={(e) => setEmail(e.target.value)} required
            />
          </div>
          <div className="field" style={{ marginBottom: 'var(--space-6)' }}>
            <label>Password</label>
            <input
              className="input" type="password" placeholder="••••••••"
              value={password} onChange={(e) => setPassword(e.target.value)} required
            />
          </div>

          {error && (
            <div className="card" style={{ borderLeft: '3px solid #b3261e', marginBottom: 'var(--space-4)' }}>
              <p style={{ margin: 0, fontSize: 13 }}>{error}</p>
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-block"
            style={{ justifyContent: 'center', padding: 'var(--space-3)' }}
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 size={18} className="spin" />
            ) : (
              <>
                Create account <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        <div className="hr" />
        <p style={{ textAlign: 'center', fontSize: 13, marginBottom: 'var(--space-2)' }}>
          Already have an account?{' '}
          <button
            onClick={() => navigate('/')}
            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--color-accent)', cursor: 'pointer' }}
          >
            Sign in
          </button>
        </p>
        <p style={{ textAlign: 'center', fontSize: 13 }}>
          <button
            onClick={() => navigate('/')}
            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--color-accent)', cursor: 'pointer' }}
          >
            Back to Student Login
          </button>
        </p>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
};

export default LecturerSignup;
