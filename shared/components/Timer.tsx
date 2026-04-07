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
    <div className={`flex items-center gap-2 px-4 py-2 rounded-lg font-mono text-xl font-bold border ${
      isLow ? 'bg-red-500/20 border-red-500 text-red-500 animate-pulse' : 'bg-accent/20 border-accent text-accent'
    }`}>
      <Clock className="w-5 h-5" />
      <span>{formatTime(timeLeft)}</span>
    </div>
  );
};

export default Timer;
