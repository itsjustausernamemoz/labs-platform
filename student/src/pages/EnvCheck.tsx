import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, ArrowLeft, Terminal, Cpu, Zap, Info } from 'lucide-react';
import KotlinEditor from '@shared/components/KotlinEditor';

const EnvCheck: React.FC = () => {
  const navigate = useNavigate();
  const [testComplete, setTestComplete] = useState(false);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 'var(--space-8) var(--space-6)' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-8)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <button onClick={() => navigate(-1)} className="btn btn-secondary btn-icon" aria-label="Go back">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 style={{ fontSize: 25, marginBottom: 2 }}>Environment Verification</h1>
            <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>Status: Checking Compiler Connectivity</p>
          </div>
        </div>
        <span className="tag tag-accent-2" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ShieldCheck size={14} /> System Ready
        </span>
      </header>

      <main>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-8)' }}>
          {[
            { icon: <Terminal size={18} />, label: 'Kotlin SDK', status: 'Online', desc: 'v1.9.23' },
            { icon: <Cpu size={18} />, label: 'Architecture', status: 'JS/JVM', desc: 'Browser-based' },
            { icon: <Zap size={18} />, label: 'Latency', status: 'Low', desc: '< 200ms' }
          ].map((item, i) => (
            <div key={i} className="card" style={{ border: '1px solid var(--color-divider)' }}>
              <div style={{ color: 'var(--color-accent)' }}>{item.icon}</div>
              <p className="card-kicker">{item.label}</p>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <p className="card-title" style={{ margin: 0 }}>{item.status}</p>
                <p className="text-muted" style={{ fontSize: 11, margin: 0 }}>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div style={{ border: '1px solid var(--color-divider)' }}>
          <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-divider)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-accent)' }} />
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Interactive Test Bench</span>
            </div>
          </div>

          <div style={{ padding: 'var(--space-4)' }}>
            <div style={{ border: '1px solid var(--color-divider)', padding: 'var(--space-3)', display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
              <Info size={18} style={{ flexShrink: 0, color: 'var(--color-accent)' }} />
              <p style={{ fontSize: 13, margin: 0 }}>
                Type the following snippet into the editor and click <strong>Run</strong>. If you see "System Verified" in the console output, your browser is fully compatible with coding assessments.
              </p>
            </div>

            <div style={{ marginBottom: 'var(--space-4)' }}>
              <KotlinEditor
                height="250px"
                initialCode={`fun main() {\n    println("System Verified")\n}`}
              />
            </div>

            <button
              onClick={() => setTestComplete(true)}
              className="btn btn-primary btn-block"
              style={{ justifyContent: 'center' }}
            >
              Mark Verification as Complete
            </button>
          </div>
        </div>

        {testComplete && (
          <div style={{ marginTop: 'var(--space-6)', padding: 'var(--space-4)', border: '1px solid var(--color-divider)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <ShieldCheck size={24} style={{ color: 'var(--color-accent)' }} />
              <div>
                <h4 style={{ margin: 0 }}>Platform Certified</h4>
                <p className="text-muted" style={{ fontSize: 12, margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Your environment is exam-ready</p>
              </div>
            </div>
            <button onClick={() => navigate('/dashboard')} className="btn btn-primary">
              Return to Dashboard
            </button>
          </div>
        )}
      </main>

      <footer style={{ marginTop: 'var(--space-8)', textAlign: 'center' }}>
        <p className="text-muted" style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase' }}>SecureLab Laboratory Intelligence v2.0</p>
      </footer>
    </div>
  );
};

export default EnvCheck;
