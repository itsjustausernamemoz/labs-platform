import { useEffect, useRef } from 'react';

export type ViolationType = 'tab_switch' | 'blur' | 'cursor_exit';

export const useTabGuard = (
  onViolation: (type: ViolationType) => void,
  examContainerRef?: React.RefObject<HTMLElement | null>
) => {
  const onViolationRef = useRef(onViolation);
  const lastViolationTime = useRef(0);
  const violationThrottleMs = 1000; // 1 second ignore period after a violation

  useEffect(() => {
    onViolationRef.current = onViolation;
  }, [onViolation]);

  useEffect(() => {
    console.log('useTabGuard: Initializing listeners with throttle...');

    const triggerViolation = (type: ViolationType) => {
      const now = Date.now();
      if (now - lastViolationTime.current < violationThrottleMs) {
        console.log(`useTabGuard: Throttling duplicate violation [${type}]`);
        return;
      }
      lastViolationTime.current = now;
      console.warn(`useTabGuard: VIOLATION DETECTED [${type}]`);
      onViolationRef.current(type);
    };

    // --- Tab switch / visibility ---
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' || document.hidden) {
        triggerViolation('tab_switch');
      }
    };

    // --- Window blur ---
    const handleBlur = () => {
      triggerViolation('blur');
    };

    // --- Cursor exits the browser viewport ---
    const handleDocumentMouseLeave = (e: MouseEvent) => {
      if (e.relatedTarget === null) {
        triggerViolation('cursor_exit');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('mouseleave', handleDocumentMouseLeave);
    window.addEventListener('blur', handleBlur);

    // --- Cursor exits the exam container element (if provided) ---
    let containerLeaveHandler: ((e: MouseEvent) => void) | null = null;
    const container = examContainerRef?.current;

    if (container) {
      containerLeaveHandler = (e: MouseEvent) => {
        if (!container.contains(e.relatedTarget as Node)) {
          triggerViolation('cursor_exit');
        }
      };
      container.addEventListener('mouseleave', containerLeaveHandler);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('mouseleave', handleDocumentMouseLeave);
      window.removeEventListener('blur', handleBlur);
      if (container && containerLeaveHandler) {
        container.removeEventListener('mouseleave', containerLeaveHandler);
      }
      console.log('useTabGuard: Listeners cleaned up');
    };
  }, [examContainerRef]);
};
