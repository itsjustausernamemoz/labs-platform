import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel?: () => void;
}

interface NotificationContextType {
  showToast: (message: string, type?: ToastType) => void;
  showConfirm: (options: ConfirmOptions) => void;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotification must be used within NotificationProvider');
  return context;
};

const TOAST_COLORS: Record<ToastType, string> = {
  success: 'var(--color-accent-700)',
  error: '#b3261e',
  info: 'var(--color-text)',
};

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmOptions, setConfirmOptions] = useState<ConfirmOptions | null>(null);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  }, []);

  const hideToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const showConfirm = useCallback((options: ConfirmOptions) => {
    setConfirmOptions(options);
  }, []);

  const handleConfirm = () => {
    if (confirmOptions) {
      confirmOptions.onConfirm();
      setConfirmOptions(null);
    }
  };

  const handleCancel = () => {
    if (confirmOptions) {
      confirmOptions.onCancel?.();
      setConfirmOptions(null);
    }
  };

  return (
    <NotificationContext.Provider value={{ showToast, showConfirm }}>
      {children}

      <div
        style={{
          position: 'fixed', bottom: 'var(--space-6)', right: 'var(--space-6)', zIndex: 100,
          display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxWidth: 380, width: '100%',
        }}
      >
        {toasts.map(toast => (
          <div
            key={toast.id}
            className="card elev-lg"
            style={{ flexDirection: 'row', alignItems: 'center', borderLeft: `3px solid ${TOAST_COLORS[toast.type]}` }}
          >
            {toast.type === 'success' && <CheckCircle2 size={18} style={{ flexShrink: 0, color: TOAST_COLORS.success }} />}
            {toast.type === 'error' && <AlertCircle size={18} style={{ flexShrink: 0, color: TOAST_COLORS.error }} />}
            {toast.type === 'info' && <Info size={18} style={{ flexShrink: 0 }} />}
            <p style={{ flex: 1, fontSize: 13, margin: 0 }}>{toast.message}</p>
            <button className="btn btn-icon" onClick={() => hideToast(toast.id)} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {confirmOptions && (
        <div className="dialog-backdrop" onClick={handleCancel}>
          <div className="dialog" onClick={e => e.stopPropagation()}>
            <div className="dialog-title">{confirmOptions.title}</div>
            <p className="dialog-body">{confirmOptions.message}</p>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={handleCancel}>
                {confirmOptions.cancelText || 'Cancel'}
              </button>
              <button className="btn btn-primary" onClick={handleConfirm}>
                {confirmOptions.confirmText || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </NotificationContext.Provider>
  );
};
