import { useEffect, useRef } from 'react';

export type ViolationType = 'tab_switch' | 'blur' | 'cursor_exit';

export const useTabGuard = (
  onViolation: (type: ViolationType) => void,
  examContainerRef?: React.RefObject<HTMLElement | null>
) => {
  const onViolationRef = useRef(onViolation);

  useEffect(() => {
    onViolationRef.current = onViolation;
  }, [onViolation]);

  useEffect(() => {
    console.log('useTabGuard: Initializing listeners...');

    const triggerViolation = (type: ViolationType) => {
      console.warn(`useTabGuard: VIOLATION DETECTED [${type}]`);
      onViolationRef.current(type);
    };

    // --- Tab switch / visibility ---
    const handleVisibilityChange = () => {
      console.log('useTabGuard: visibilitychange - state:', document.visibilityState);
      if (document.visibilityState === 'hidden' || document.hidden) {
        triggerViolation('tab_switch');
      }
    };

    // --- Window blur (click outside browser, OS Alt+Tab, etc.) ---
    const handleBlur = (e: any) => {
      console.log('useTabGuard: blur event detected', e);
      triggerViolation('blur');
    };

    const handleFocus = () => {
      console.log('useTabGuard: focus returned');
    };

    // --- Cursor exits the browser viewport entirely ---
    const handleDocumentMouseLeave = (e: MouseEvent) => {
      if (e.relatedTarget === null) {
        console.log('useTabGuard: cursor exited viewport');
        triggerViolation('cursor_exit');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('mouseleave', handleDocumentMouseLeave);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);

    // Safari compatibility
    const oldOnBlur = window.onblur;
    const oldOnFocus = window.onfocus;

    window.onblur = (e) => {
      handleBlur(e);
      if (typeof oldOnBlur === 'function') oldOnBlur.apply(window, [e]);
    };

    window.onfocus = (e) => {
      handleFocus();
      if (typeof oldOnFocus === 'function') oldOnFocus.apply(window, [e]);
    };

    // --- Cursor exits the exam container element (if provided) ---
    let containerLeaveHandler: ((e: MouseEvent) => void) | null = null;
    const container = examContainerRef?.current;

    if (container) {
      containerLeaveHandler = (e: MouseEvent) => {
        // Only fire if the new target is outside the container
        if (!container.contains(e.relatedTarget as Node)) {
          console.log('useTabGuard: cursor exited exam screen container');
          triggerViolation('cursor_exit');
        }
      };
      container.addEventListener('mouseleave', containerLeaveHandler);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('mouseleave', handleDocumentMouseLeave);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      window.onblur = oldOnBlur;
      window.onfocus = oldOnFocus;
      if (container && containerLeaveHandler) {
        container.removeEventListener('mouseleave', containerLeaveHandler);
      }
      console.log('useTabGuard: Listeners cleaned up');
    };
  }, [examContainerRef]);
};
