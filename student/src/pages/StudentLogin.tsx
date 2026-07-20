import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@shared/lib/apiClient';
import { ArrowRight, Loader2 } from 'lucide-react';
import logo from '@shared/assets/mashoke-logo.png';

interface Institution {
  id: string;
  name: string;
}

const StudentLogin: React.FC = () => {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [studentNumber, setStudentNumber] = useState('');
  const [fullName, setFullName] = useState('');
  const [institutionId, setInstitutionId] = useState('');
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (mode !== 'signup' || institutions.length > 0) return;
    supabase
      .from('institutions')
      .select('id, name')
      .eq('status', 'active')
      .order('name')
      .then(({ data }) => setInstitutions(data || []));
  }, [mode, institutions.length]);

  const toggleMode = (e: React.MouseEvent) => {
    e.preventDefault();
    setMode(m => (m === 'signin' ? 'signup' : 'signin'));
    setError('');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentNumber.trim()) { setError('Enter your student number.'); return; }
    if (mode === 'signup' && !institutionId) { setError('Select the institution you belong to.'); return; }
    if (mode === 'signup' && !fullName.trim()) { setError('Enter your full name.'); return; }

    setIsLoading(true);
    setError('');

    try {
      // The API's login-or-create endpoint replaces the old two-step
      // select-then-insert-on-not-found pattern with one atomic call.
      const { data: student, error } = await supabase.students.loginOrCreate({
        student_number: studentNumber,
        full_name: mode === 'signup' ? fullName.trim() : undefined,
        institution_id: mode === 'signup' ? institutionId : undefined,
      });
      if (error || !student) throw new Error(error?.message || 'Could not sign in');

      localStorage.setItem('student', JSON.stringify(student));
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'An error occurred during login');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="student-split" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: '100vh' }}>
      <div
        style={{
          background: 'var(--color-accent)', color: 'var(--color-bg)',
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 'var(--space-8)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src={logo} alt="Mashoke Tech" style={{ width: 38, height: 38, objectFit: 'contain', background: 'var(--color-bg)', borderRadius: '50%' }} />
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 18 }}>Mashoke Labs</span>
        </div>
        <div>
          <h1 style={{ fontSize: 56, color: 'var(--color-bg)', maxWidth: 520 }}>Assessments, run cleanly.</h1>
          <p style={{ color: 'color-mix(in srgb, var(--color-bg) 82%, transparent)', fontSize: 16, maxWidth: 420 }}>
            Join your exam with a single code, verify your setup, and get straight to work.
          </p>
        </div>
        <p style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'color-mix(in srgb, var(--color-bg) 60%, transparent)' }}>
          A Mashoke Tech product
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-8)' }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          {mode === 'signup' ? (
            <>
              <h2 style={{ marginBottom: 'var(--space-1)' }}>Create your account</h2>
              <p className="text-muted" style={{ fontSize: 14, marginBottom: 'var(--space-6)' }}>Self-enroll with the institution you belong to.</p>
            </>
          ) : (
            <>
              <h2 style={{ marginBottom: 'var(--space-1)' }}>Student sign-in</h2>
              <p className="text-muted" style={{ fontSize: 14, marginBottom: 'var(--space-6)' }}>Enter your student number to begin.</p>
            </>
          )}

          <form onSubmit={handleLogin}>
            {mode === 'signup' && (
              <>
                <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
                  <label>Institution</label>
                  <select className="input" value={institutionId} onChange={e => { setInstitutionId(e.target.value); setError(''); }}>
                    <option value="">Select your institution…</option>
                    {institutions.map(inst => (
                      <option key={inst.id} value={inst.id}>{inst.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
                  <label>Full name</label>
                  <input
                    className="input" type="text" placeholder="e.g. Aisha Nkemdirim"
                    value={fullName} onChange={e => { setFullName(e.target.value); setError(''); }}
                  />
                </div>
              </>
            )}

            <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
              <label>Student number</label>
              <input
                className="input" type="text" placeholder="20240001"
                value={studentNumber} onChange={e => { setStudentNumber(e.target.value); setError(''); }}
                autoFocus style={{ fontSize: 18, letterSpacing: '0.08em' }}
              />
            </div>

            {error && (
              <div style={{ border: '1px solid var(--color-accent)', color: 'var(--color-accent-700)', fontSize: 13, padding: 'var(--space-2) var(--space-3)', marginBottom: 'var(--space-4)' }}>
                {error}
              </div>
            )}

            <button
              type="submit" className="btn btn-primary btn-block" disabled={isLoading}
              style={{ justifyContent: 'center', padding: 'var(--space-3)', fontSize: 15 }}
            >
              {isLoading ? (
                <Loader2 size={18} className="spin" />
              ) : (
                <>
                  <span>{mode === 'signup' ? 'Create account' : 'Continue to exams'}</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <div className="hr" />
          {mode === 'signin' ? (
            <p style={{ fontSize: 13, marginBottom: 'var(--space-2)' }}>
              New here? <a href="#" onClick={toggleMode}>Create an account &rarr;</a>
            </p>
          ) : (
            <p style={{ fontSize: 13, marginBottom: 'var(--space-2)' }}>
              Already have an account? <a href="#" onClick={toggleMode}>Sign in &rarr;</a>
            </p>
          )}
          <a href="https://lab-lecturer.web.app" style={{ fontSize: 13 }}>Lecturer &amp; staff sign-in &rarr;</a>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
        @media (max-width: 860px) {
          .student-split { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
};

export default StudentLogin;
