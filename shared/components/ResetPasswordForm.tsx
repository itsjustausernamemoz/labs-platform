import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@shared/lib/apiClient';
import { Lock, ArrowRight, Loader2 } from 'lucide-react';
import { useNotification } from '@shared/components/NotificationProvider';

// Shared password-reset/invite-accept form used across apps. The link's
// token travels as a `?token=` query param (signed server-side, see
// api/routes/auth.js `reset-password-confirm`) — not a Supabase-style hash
// fragment session, so there's no auth event to wait on, just a token to
// read and submit alongside the new password.
const ResetPasswordForm: React.FC = () => {
  const token = new URLSearchParams(window.location.search).get('token');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { showToast } = useNotification();

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!token) {
      setError('This link is missing its reset token. Please request a new one.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const { error: resetError } = await supabase.auth.confirmPasswordReset({ token, newPassword: password });
      if (resetError) throw resetError;

      showToast('Password set successfully! Please sign in.', 'success');
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Failed to update password');
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-8)', background: 'var(--color-bg)' }}>
        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          <h1 style={{ marginBottom: 'var(--space-2)' }}>Invalid link</h1>
          <p className="text-muted" style={{ fontSize: 14, marginBottom: 'var(--space-6)' }}>
            This reset link is missing its token. Please request a new one.
          </p>
          <button type="button" onClick={() => navigate('/')} className="btn btn-secondary">Back to login</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-8)', background: 'var(--color-bg)' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
          <div
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 64, height: 64, background: 'var(--color-accent-100)', marginBottom: 'var(--space-4)',
            }}
          >
            <Lock size={30} style={{ color: 'var(--color-accent)' }} />
          </div>
          <h1 style={{ marginBottom: 'var(--space-1)' }}>Set your password</h1>
          <p className="text-muted" style={{ fontSize: 14 }}>Choose a new secure password</p>
        </div>

        <form onSubmit={handleReset}>
          <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
            <label>New password</label>
            <input
              className="input"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
            <label>Confirm new password</label>
            <input
              className="input"
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div
              style={{
                border: '1px solid var(--color-accent)', color: 'var(--color-accent-700)', fontSize: 13,
                padding: 'var(--space-2) var(--space-3)', marginBottom: 'var(--space-4)',
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={isLoading}
            style={{ justifyContent: 'center', padding: 'var(--space-3)', fontSize: 15 }}
          >
            {isLoading ? (
              <Loader2 size={18} className="spin" />
            ) : (
              <>
                <span>Update password</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        <div style={{ marginTop: 'var(--space-6)', textAlign: 'center' }}>
          <button type="button" onClick={() => navigate('/')} className="btn btn-ghost" style={{ fontSize: 13 }}>
            Back to login
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } } .spin { animation: spin 1s linear infinite; }`}</style>
    </div>
  );
};

export default ResetPasswordForm;
