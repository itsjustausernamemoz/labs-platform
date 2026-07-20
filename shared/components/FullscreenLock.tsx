import React from 'react';
import { ShieldAlert } from 'lucide-react';

interface FullscreenLockProps {
  isFullscreen: boolean;
  onEnterFullscreen: () => void;
}

const FullscreenLock: React.FC<FullscreenLockProps> = ({ isFullscreen, onEnterFullscreen }) => {
  if (isFullscreen) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100, background: 'var(--color-bg)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-6)', textAlign: 'center',
      }}
    >
      <ShieldAlert size={72} color="var(--color-accent)" style={{ marginBottom: 'var(--space-6)' }} />
      <h1 style={{ marginBottom: 'var(--space-4)' }}>Fullscreen required</h1>
      <p className="text-muted" style={{ maxWidth: 420, marginBottom: 'var(--space-8)' }}>
        This exam platform requires fullscreen mode to ensure integrity.
        Leaving fullscreen mode is considered a violation.
      </p>
      <button onClick={onEnterFullscreen} className="btn btn-primary" style={{ padding: 'var(--space-3) var(--space-6)' }}>
        Re-enter fullscreen
      </button>
    </div>
  );
};

export default FullscreenLock;
