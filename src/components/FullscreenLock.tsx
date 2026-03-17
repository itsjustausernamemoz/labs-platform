import React from 'react';
import { ShieldAlert } from 'lucide-react';

interface FullscreenLockProps {
  isFullscreen: boolean;
  onEnterFullscreen: () => void;
}

const FullscreenLock: React.FC<FullscreenLockProps> = ({ isFullscreen, onEnterFullscreen }) => {
  if (isFullscreen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-primary flex flex-col items-center justify-center p-6 text-center">
      <ShieldAlert className="w-20 h-20 text-accent mb-6 animate-pulse" />
      <h1 className="text-3xl font-bold mb-4">Fullscreen Required</h1>
      <p className="text-panel/80 max-w-md mb-8">
        This exam platform requires fullscreen mode to ensure integrity.
        Leaving fullscreen mode is considered a violation.
      </p>
      <button
        onClick={onEnterFullscreen}
        className="px-8 py-3 bg-accent text-primary font-bold rounded-lg hover:bg-accent/90 transition-colors"
      >
        Re-enter Fullscreen
      </button>
    </div>
  );
};

export default FullscreenLock;
