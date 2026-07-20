import { useRef, useEffect, useState } from 'react';
import { ClipboardCheck, FileCode } from 'lucide-react';
import { useNotification } from './NotificationProvider';
import KotlinEditor from './KotlinEditor';

export interface Question {
  id: string;
  type: 'mcq' | 'structured';
  question_text: string;
  options?: string[];
  correct_answer?: string;
  marks: number;
}

interface QuestionRendererProps {
  question: Question;
  index: number;
  answer?: string;
  onChange: (answer: string) => void;
  hasCoding?: boolean;
  language?: string | null;
}

/** Auto-growing structured text area with tab-indent support */
const StructuredAnswerInput: React.FC<{ value: string; onChange: (val: string) => void }> = ({
  value,
  onChange,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  // Auto-resize on every value change
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;

    if (e.key === 'Tab') {
      e.preventDefault();
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const indent = '    '; // 4 spaces

      const newValue = value.substring(0, start) + indent + value.substring(end);
      onChange(newValue);

      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + indent.length;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const start = el.selectionStart;
      const textBefore = value.substring(0, start);
      const currentLineStart = textBefore.lastIndexOf('\n') + 1;
      const currentLine = textBefore.substring(currentLineStart);
      const leadingWhitespace = currentLine.match(/^(\s*)/)?.[1] ?? '';

      const newValue = value.substring(0, start) + '\n' + leadingWhitespace + value.substring(el.selectionEnd);
      onChange(newValue);

      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 1 + leadingWhitespace.length;
      });
    }
  };

  return (
    <div
      style={{
        position: 'relative',
        minHeight: '12rem',
        background: 'var(--color-surface)',
        border: `1px solid ${isFocused ? 'var(--color-accent)' : 'var(--color-divider)'}`,
        overflow: 'hidden',
        transition: 'border-color 0.2s ease',
      }}
    >
      <LineNumbers value={value} />
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={"Type your answer here...\n\nPress Tab to indent, Enter for a new line."}
        rows={8}
        spellCheck={false}
        style={{
          width: '100%',
          minHeight: '12rem',
          maxHeight: '24rem',
          overflowY: 'auto',
          resize: 'none',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          padding: '16px 16px 16px 56px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: 14,
          lineHeight: '24px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: 'var(--color-text)',
          tabSize: 4,
        }}
      />
    </div>
  );
};

/** Renders line numbers in a fixed gutter next to the textarea */
const LineNumbers: React.FC<{ value: string }> = ({ value }) => {
  const lines = value ? value.split('\n') : [''];
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 40,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        paddingRight: 8,
        paddingTop: 16,
        paddingBottom: 16,
        userSelect: 'none',
        pointerEvents: 'none',
      }}
    >
      {lines.map((_, i) => (
        <span
          key={i}
          style={{
            display: 'block',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: 14,
            lineHeight: '24px',
            color: 'var(--color-text)',
            opacity: 0.35,
          }}
        >
          {i + 1}
        </span>
      ))}
    </div>
  );
};

const QuestionRenderer: React.FC<QuestionRendererProps> = ({ question, index, answer, onChange, hasCoding, language }) => {
  const { showToast } = useNotification();
  const hasCopiedSnippet = Boolean((window as any).__KOTLIN_CODE_BUFFER);

  return (
    <div className="card" style={{ border: '1px solid var(--color-divider)', padding: 'var(--space-6)', marginBottom: 'var(--space-8)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-4)' }}>
        <h3 style={{ fontSize: 20, color: 'var(--color-accent-700)', margin: 0 }}>Question {index + 1}</h3>
        <span className="tag tag-neutral">{question.marks} Marks</span>
      </div>

      <p style={{ fontSize: 18, marginBottom: 'var(--space-6)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{question.question_text}</p>

      {question.type === 'mcq' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <style>{`
            .qr-opt { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border: 1px solid var(--color-divider); cursor: pointer; transition: background 0.15s ease, border-color 0.15s ease; }
            .qr-opt:hover { background: var(--color-neutral-100); }
            .qr-opt.selected { background: var(--color-accent-100); border-color: var(--color-accent); }
            .qr-opt .qr-dot { width: 16px; height: 16px; border-radius: 50%; border: 1.5px solid var(--color-divider); flex: none; }
            .qr-opt.selected .qr-dot { border-color: var(--color-accent); background: var(--color-accent); box-shadow: inset 0 0 0 3px var(--color-bg); }
          `}</style>
          {question.options?.map((option, idx) => {
            const letter = String.fromCharCode(65 + idx); // A, B, C, D...
            const isSelected = answer === letter;

            return (
              <label key={idx} className={`qr-opt${isSelected ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name={`question-${question.id}`}
                  value={letter}
                  checked={isSelected}
                  onChange={() => onChange(letter)}
                  style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
                />
                <span className="qr-dot" />
                <span>{option}</span>
              </label>
            );
          })}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          <StructuredAnswerInput value={answer || ''} onChange={onChange} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 10,
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.2em',
                color: 'var(--color-text)',
                opacity: 0.4,
                margin: 0,
              }}
            >
              <kbd style={{ padding: '2px 6px', border: '1px solid var(--color-divider)', fontFamily: 'inherit', color: 'inherit' }}>Tab Indent</kbd>
              <kbd style={{ padding: '2px 6px', border: '1px solid var(--color-divider)', fontFamily: 'inherit', color: 'inherit' }}>Auto Line</kbd>
            </p>

            {hasCoding && (
              <button
                onClick={() => {
                  const code = (window as any).__KOTLIN_CODE_BUFFER;
                  if (code) {
                    const separator = answer ? '\n\n' : '';
                    onChange(answer + separator + code);
                    showToast('Snippet pasted into answer field.', 'success');
                  } else {
                    showToast('Buffer empty. Please click "Copy Snippet" on the IDE first.', 'info');
                  }
                }}
                className="btn btn-secondary"
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em',
                  borderColor: hasCopiedSnippet ? 'var(--color-accent)' : 'var(--color-divider)',
                  color: hasCopiedSnippet ? 'var(--color-accent-700)' : 'var(--color-text)',
                  opacity: hasCopiedSnippet ? 1 : 0.5,
                }}
              >
                <ClipboardCheck size={14} /> Paste from Compiler
              </button>
            )}
          </div>

          {hasCoding && language === 'kotlin' && (
            <div style={{ paddingTop: 'var(--space-6)', borderTop: '1px solid var(--color-divider)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'var(--color-accent-100)',
                      color: 'var(--color-accent-700)',
                    }}
                  >
                    <FileCode size={16} />
                  </div>
                  <h4 style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--color-accent-700)', margin: 0 }}>
                    Kotlin Compiler
                  </h4>
                </div>
              </div>
              <KotlinEditor
                initialCode={answer && answer.includes('fun main') ? answer : undefined}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default QuestionRenderer;
