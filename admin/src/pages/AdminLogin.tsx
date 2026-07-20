import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { supabase } from '@shared/lib/apiClient';
import logo from '@shared/assets/mashoke-logo.png';

export default function AdminLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError || !data.user) {
      setError(authError?.message || 'Sign-in failed.');
      setLoading(false);
      return;
    }
    const { data: adminRow } = await supabase
      .from('platform_admins')
      .select('id, active')
      .eq('id', data.user.id)
      .maybeSingle();
    if (!adminRow || !adminRow.active) {
      await supabase.auth.signOut();
      setError('This account is not an active platform admin.');
      setLoading(false);
      return;
    }
    navigate('/overview');
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: '100vh' }} className="admin-split">
      <div
        style={{
          background: 'var(--color-accent-900)', color: 'var(--color-bg)',
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 'var(--space-8)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src={logo} alt="Mashoke Tech" style={{ width: 36, height: 36, objectFit: 'contain' }} />
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 18 }}>Mashoke Labs</span>
        </div>
        <div>
          <h1 style={{ fontSize: 48, color: 'var(--color-bg)', maxWidth: 460 }}>Platform administration.</h1>
          <p style={{ color: 'color-mix(in srgb, var(--color-bg) 78%, transparent)', fontSize: 16, maxWidth: 420 }}>
            Onboard institutions, manage seats, and oversee usage across every lecturer and student portal.
          </p>
        </div>
        <p style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'color-mix(in srgb, var(--color-bg) 55%, transparent)' }}>
          Internal &middot; Mashoke Tech staff only
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-8)' }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <h2 style={{ marginBottom: 'var(--space-1)' }}>Admin sign-in</h2>
          <p className="text-muted" style={{ fontSize: 14, marginBottom: 'var(--space-6)' }}>
            Restricted to Mashoke Tech platform staff.
          </p>

          {error && (
            <div className="card" style={{ borderLeft: '3px solid #b3261e', marginBottom: 'var(--space-4)' }}>
              <p style={{ margin: 0, fontSize: 13 }}>{error}</p>
            </div>
          )}

          <form onSubmit={handleLogin}>
            <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
              <label>Work email</label>
              <input
                className="input" type="email" placeholder="you@mashoketech.com"
                value={email} onChange={e => setEmail(e.target.value)} required
              />
            </div>
            <div className="field" style={{ marginBottom: 'var(--space-6)' }}>
              <label>Password</label>
              <input
                className="input" type="password" placeholder="••••••••"
                value={password} onChange={e => setPassword(e.target.value)} required
              />
            </div>
            <button type="submit" className="btn btn-primary btn-block" style={{ justifyContent: 'center', padding: 'var(--space-3)' }} disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'} <ArrowRight size={16} />
            </button>
          </form>

          <div className="hr" />
          <a href="https://lab-lecturer.web.app" style={{ fontSize: 13 }}>&larr; Lecturer portal</a>
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .admin-split { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
