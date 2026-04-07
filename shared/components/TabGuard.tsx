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
  console.log('TabGuard rendering. showWarning:', showWarning, 'count:', violationCount, '/', maxViolations);
  if (!showWarning) return null;

  const isCursorExit = violationType === 'cursor_exit';

  return (
    <div className="fixed inset-0 z-[9999] bg-primary/90 flex items-center justify-center p-6 backdrop-blur-md">
      <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-[0_0_50px_rgba(239,68,68,0.3)] border border-red-500/20 animate-in zoom-in-95 duration-300">
        <div className="flex items-center gap-4 mb-4 text-red-600">
          {isCursorExit ? (
            <MousePointer className="w-8 h-8" />
          ) : (
            <AlertTriangle className="w-8 h-8" />
          )}
          <h2 className="text-2xl font-bold">Security Violation</h2>
        </div>
        <p className="mb-6 text-gray-700">
          {isCursorExit
            ? 'Your cursor moved outside the exam screen. Keep your cursor within the exam window at all times during the examination.'
            : 'We detected that you switched tabs or minimized the exam window. This is a violation of the exam policy.'}
        </p>
        <div className="bg-red-50 p-6 rounded-2xl mb-8 border border-red-100">
          <div className="flex justify-between items-end mb-4">
            <div>
              <p className="text-xs font-bold text-red-500 uppercase tracking-widest mb-1">Status</p>
              <p className="text-xl font-black text-red-700">Violation Detected</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold text-red-500 uppercase tracking-widest mb-1">Remaining</p>
              <p className="text-xl font-black text-red-700">{Math.max(0, maxViolations - violationCount)} / {maxViolations}</p>
            </div>
          </div>
          <div className="h-2 w-full bg-red-100 rounded-full overflow-hidden mb-4">
            <div
              className="h-full bg-red-500 transition-all duration-500"
              style={{ width: `${((maxViolations - violationCount) / maxViolations) * 100}%` }}
            />
          </div>
          <p className="text-sm text-red-600 font-medium text-center">
            Clicking &quot;I Understand&quot; will deduct one violation credit.
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="w-full py-3 bg-primary text-white font-bold rounded-lg hover:bg-primary/90 transition-colors"
        >
          I Understand
        </button>
      </div>
    </div>
  );
};

export default TabGuard;

