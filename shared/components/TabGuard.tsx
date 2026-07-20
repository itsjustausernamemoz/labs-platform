import React from 'react';
import { AlertTriangle, MousePointer } from 'lucide-react';
import type { ViolationType } from '../hooks/useTabGuard';

interface TabGuardProps {
  violationCount: number;
  maxViolations: number;
  showWarning: boolean;
  violationType?: ViolationType;
  onDismiss: () => void;
}

const TabGuard: React.FC<TabGuardProps> = ({
  violationCount,
  maxViolations,
  showWarning,
  violationType = 'blur',
  onDismiss,
}) => {
  if (!showWarning) return null;

  const isCursorExit = violationType === 'cursor_exit';
  const remaining = Math.max(0, maxViolations - violationCount);
  const pct = maxViolations > 0 ? (remaining / maxViolations) * 100 : 0;

  return (
    <div className="dialog-backdrop" style={{ zIndex: 9999 }}>
      <div className="dialog" style={{ maxWidth: 440, borderLeft: '3px solid var(--color-accent-700)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--color-accent-700)' }}>
          {isCursorExit ? <MousePointer size={28} /> : <AlertTriangle size={28} />}
          <div className="dialog-title">Security violation</div>
        </div>
        <p className="dialog-body">
          {isCursorExit
            ? 'Your cursor moved outside the exam screen. Keep your cursor within the exam window at all times during the examination.'
            : 'We detected that you switched tabs or minimized the exam window. This is a violation of the exam policy.'}
        </p>
        <div className="card" style={{ background: 'var(--color-accent-100)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
              <p className="card-kicker" style={{ marginBottom: 4 }}>Status</p>
              <p style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 18, color: 'var(--color-accent-800)', margin: 0 }}>Violation detected</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p className="card-kicker" style={{ marginBottom: 4 }}>Remaining</p>
              <p style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 18, color: 'var(--color-accent-800)', margin: 0 }}>{remaining} / {maxViolations}</p>
            </div>
          </div>
          <div style={{ height: 6, width: '100%', background: 'var(--color-accent-200)', marginTop: 12 }}>
            <div style={{ height: '100%', width: `${pct}%`, background: 'var(--color-accent-700)' }} />
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-accent-800)', textAlign: 'center', margin: 'var(--space-2) 0 0' }}>
            Clicking &quot;I understand&quot; will deduct one violation credit.
          </p>
        </div>
        <button onClick={onDismiss} className="btn btn-primary btn-block" style={{ justifyContent: 'center', padding: 'var(--space-3)' }}>
          I understand
        </button>
      </div>
    </div>
  );
};

export default TabGuard;
