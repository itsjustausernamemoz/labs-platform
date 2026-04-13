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
    <div className={`kotlin-editor-container rounded-3xl overflow-hidden border border-white/10 flex flex-col ${className}`} style={{ minHeight: height }}>
      <style>{`
        .playground-footer, .playground-footer * { display: none !important; visibility: hidden !important; height: 0 !important; padding: 0 !important; }
        .kotlin-playground { border-radius: 0 !important; }
        .CodeMirror-gutters { border-right: 1px solid rgba(255,255,255,0.05) !important; background-color: transparent !important; width: auto !important; min-width: 40px !important; }
        .CodeMirror-linenumber { color: rgba(255,255,255,0.2) !important; padding-right: 12px !important; text-align: right !important; min-width: 28px !important; }
        .CodeMirror-lines { padding-left: 8px !important; }
      `}</style>
      <div className="bg-white/[0.03] border-b border-white/10 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Terminal className="w-4 h-4 text-accent/50" />
          <span className="text-[10px] font-black uppercase tracking-widest text-white/40">Kotlin IDE</span>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            type="button"
            onClick={handleCopy}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all active:scale-95 ${
              showCopied 
                ? 'bg-green-500/20 border-green-500/40 text-green-400 font-black' 
                : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10 hover:text-white font-bold'
            }`}
          >
            {showCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="text-[10px] uppercase tracking-widest">{showCopied ? 'Copied!' : 'Copy Snippet'}</span>
          </button>
        </div>
      </div>

      <div className="relative flex-1 bg-[#1E1E1E]">
        {error ? (
          <div className="p-8 text-center bg-red-500/10 text-red-400">
            <p className="font-bold mb-2">Editor Error</p>
            <p className="text-xs opacity-80">{error}</p>
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
          <div className="absolute inset-0 flex items-center justify-center bg-[#1E1E1E] text-white/40 z-10">
            <div className="flex flex-col items-center gap-4">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-[10px] uppercase font-black tracking-widest">Initializing Compiler...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default KotlinEditor;
