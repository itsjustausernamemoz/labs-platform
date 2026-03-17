import { useEffect } from 'react';

export const useTabGuard = (onViolation: (type: 'tab_switch' | 'blur') => void) => {
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        onViolation('tab_switch');
      }
    };

    const handleBlur = () => {
      onViolation('blur');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
    };
  }, [onViolation]);
};
