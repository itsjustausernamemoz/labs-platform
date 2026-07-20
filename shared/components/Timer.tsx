import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

interface TimerProps {
  endTime: number;
  onExpiry: () => void;
}

const Timer: React.FC<TimerProps> = ({ endTime, onExpiry }) => {
  const [timeLeft, setTimeLeft] = useState(() => Math.max(0, Math.floor((endTime - Date.now()) / 1000)));

  useEffect(() => {
    if (timeLeft <= 0) {
      onExpiry();
      return;
    }

    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        onExpiry();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [endTime, onExpiry, timeLeft]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const isLow = timeLeft < 300; // 5 minutes

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
        fontFamily: 'monospace', fontSize: 20, fontWeight: 800, border: '1px solid',
        borderColor: isLow ? 'var(--color-accent-700)' : 'var(--color-accent)',
        color: isLow ? 'var(--color-accent-700)' : 'var(--color-accent)',
        background: isLow ? 'var(--color-accent-100)' : 'var(--color-accent-100)',
      }}
    >
      <Clock size={18} />
      <span>{formatTime(timeLeft)}</span>
    </div>
  );
};

export default Timer;
