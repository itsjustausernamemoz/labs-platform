import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface TabGuardProps {
  violationCount: number;
  maxViolations: number;
  showWarning: boolean;
  onDismiss: () => void;
}

const TabGuard: React.FC<TabGuardProps> = ({ violationCount, maxViolations, showWarning, onDismiss }) => {
  if (!showWarning) return null;

  return (
    <div className="fixed inset-0 z-[110] bg-black/80 flex items-center justify-center p-6 backdrop-blur-sm">
      <div className="bg-panel text-primary rounded-xl p-8 max-w-md w-full shadow-2xl">
        <div className="flex items-center gap-4 mb-4 text-red-600">
          <AlertTriangle className="w-8 h-8" />
          <h2 className="text-2xl font-bold">Security Violation</h2>
        </div>
        <p className="mb-6 text-gray-700">
          We detected that you switched tabs or lost focus from the exam window.
          This is a violation of the exam policy.
        </p>
        <div className="bg-red-50 p-4 rounded-lg mb-6">
          <p className="font-bold text-red-700">
            Violations: {violationCount} / {maxViolations}
          </p>
          <p className="text-sm text-red-600 mt-1">
            The exam will automatically submit after {maxViolations} violations.
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
