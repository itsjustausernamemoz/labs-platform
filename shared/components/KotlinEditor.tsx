import { useEffect, useRef, useState } from 'react';
import { Copy, Terminal, Check } from 'lucide-react';

interface KotlinEditorProps {
  initialCode?: string;
  theme?: 'darcula' | 'default';
  platform?: 'jvm' | 'js' | 'canvas' | 'junit';
  onChange?: (code: string) => void;
  height?: string;
  className?: string;
  autoFocus?: boolean;
}

declare global {
  interface Window {
    KotlinPlayground?: (selector: string | HTMLElement) => void;
  }
}

const KotlinEditor: React.FC<KotlinEditorProps> = ({
  initialCode = '// Type your Kotlin code here\nfun main() {\n    println("Hello, World!")\n}',
  theme = 'darcula',
  platform = 'js',
  height = '300px',
  className = '',
}) => {
  const codeRef = useRef<HTMLPreElement>(null);
  const playgroundInstance = useRef<any>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCopied, setShowCopied] = useState(false);

  useEffect(() => {
    let script: HTMLScriptElement | null = null;
    const scriptId = 'kotlin-playground-script';

    const initPlayground = async () => {
      if (window.KotlinPlayground && codeRef.current) {
        try {
          const result = (window.KotlinPlayground as any)(codeRef.current);

          // Handle both Promise and direct Array return types
          const instances = result instanceof Promise ? await result : result;

          if (instances && instances.length > 0) {
            playgroundInstance.current = instances[0];
          } else if ((window.KotlinPlayground as any).instances) {
            // Fallback for some versions that store instances in a global array
            const allInstances = (window.KotlinPlayground as any).instances;
            playgroundInstance.current = allInstances[allInstances.length - 1];
          }
        } catch (err) {
          console.error('Kotlin initialization error:', err);
        }
        setIsLoaded(true);
      }
    };

    if (window.KotlinPlayground) {
      initPlayground();
    } else {
      const existingScript = document.getElementById(scriptId);
      if (!existingScript) {
        script = document.createElement('script');
        script.id = scriptId;
        script.src = 'https://unpkg.com/kotlin-playground@1';
        script.async = true;
        script.onload = initPlayground;
        script.onerror = () => setError('Failed to load Kotlin compiler. Please check your connection.');
        document.body.appendChild(script);
      } else {
        const handleScriptLoad = () => {
          existingScript.removeEventListener('load', handleScriptLoad);
          initPlayground();
        };
        existingScript.addEventListener('load', handleScriptLoad);
      }
    }

    return () => {
      // No-op
    };
  }, []);

  const handleCopy = () => {
    try {
      let code = '';

      // Strategy 1: Use the official instance API (Ref-captured)
      if (playgroundInstance.current && typeof playgroundInstance.current.getContent === 'function') {
        code = playgroundInstance.current.getContent();
      }

      // Strategy 2: Global Instances fallback
      if (!code && (window as any).KotlinPlayground?.instances?.length > 0) {
        const instances = (window as any).KotlinPlayground.instances;
        // Find the instance matching our element or just get the last one
        code = instances[instances.length - 1].getContent();
      }

      // Strategy 3: CodeMirror internal API discovery
      if (!code) {
        const cmElements = document.querySelectorAll('.CodeMirror');
        for (const el of Array.from(cmElements)) {
          if ((el as any).CodeMirror) {
            const val = (el as any).CodeMirror.getValue();
            if (val && val.includes('fun main')) { // Validate it's likely our code
              code = val;
              break;
            }
          }
        }
      }

      // Strategy 4: Brute-force DOM Scraper (The "Never Fail" Fallback)
      // Iterates through the actual visible lines of the editor in the DOM
      if (!code) {
        const lines = document.querySelectorAll('.CodeMirror-line');
        if (lines.length > 0) {
          code = Array.from(lines).map(l => (l as HTMLElement).innerText || '').join('\n');
        }
      }

      if (code && code.trim()) {
        (window as any).__KOTLIN_CODE_BUFFER = code;

        // Use the modern clipboard API
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code).catch(() => {});
        }

        setShowCopied(true);
        setTimeout(() => setShowCopied(false), 2000);
      } else {
        console.warn('Copy failed: No content detected in any strategy.');
      }
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  return (
    <div
      className={`kotlin-editor-container ${className}`}
      style={{
        border: '1px solid var(--color-divider)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        minHeight: height,
      }}
    >
      <style>{`
        .playground-footer, .playground-footer * { display: none !important; visibility: hidden !important; height: 0 !important; padding: 0 !important; }
        .kotlin-playground { border-radius: 0 !important; }
        .CodeMirror-gutters { border-right: 1px solid rgba(255,255,255,0.05) !important; background-color: transparent !important; width: auto !important; min-width: 40px !important; }
        .CodeMirror-linenumber { color: rgba(255,255,255,0.2) !important; padding-right: 12px !important; text-align: right !important; min-width: 28px !important; }
        .CodeMirror-lines { padding-left: 8px !important; }
      `}</style>
      <style>{`
        @keyframes kotlin-editor-spin { to { transform: rotate(360deg); } }
      `}</style>

      <div
        style={{
          background: 'var(--color-neutral-900)',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          padding: '10px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Terminal size={16} style={{ color: 'var(--color-accent-2)', opacity: 0.7 }} />
          <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'rgba(255,255,255,0.5)' }}>
            Kotlin IDE
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={handleCopy}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              border: `1px solid ${showCopied ? '#3fae4a' : 'rgba(255,255,255,0.15)'}`,
              background: showCopied ? 'rgba(63,174,74,0.15)' : 'rgba(255,255,255,0.05)',
              color: showCopied ? '#5fcf6a' : 'rgba(255,255,255,0.6)',
              fontWeight: showCopied ? 800 : 700,
              cursor: 'pointer',
            }}
          >
            {showCopied ? <Check size={14} /> : <Copy size={14} />}
            <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.15em' }}>
              {showCopied ? 'Copied!' : 'Copy Snippet'}
            </span>
          </button>
        </div>
      </div>

      <div style={{ position: 'relative', flex: 1, background: '#1E1E1E' }}>
        {error ? (
          <div style={{ padding: 32, textAlign: 'center', background: 'rgba(220,38,38,0.08)', color: '#f87171' }}>
            <p style={{ fontWeight: 800, marginBottom: 8 }}>Editor Error</p>
            <p style={{ fontSize: 12, opacity: 0.8 }}>{error}</p>
          </div>
        ) : (
          <pre
            ref={codeRef}
            data-theme={theme}
            data-platform={platform}
            data-target-platform={platform}
            data-highlight-on-fly="true"
            data-autocomplete="true"
            data-match-brackets="true"
            data-line-numbers="true"
            line-numbers="true"
            data-indent="4"
            auto-indent="true"
            className="kotlin-code"
            style={{ visibility: isLoaded ? 'visible' : 'hidden' }}
          >
            {initialCode}
          </pre>
        )}

        {!isLoaded && !error && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#1E1E1E',
              color: 'rgba(255,255,255,0.4)',
              zIndex: 10,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  border: '2px solid var(--color-accent)',
                  borderTopColor: 'transparent',
                  animation: 'kotlin-editor-spin 1s linear infinite',
                }}
              />
              <p style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.15em' }}>
                Initializing Compiler...
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default KotlinEditor;
