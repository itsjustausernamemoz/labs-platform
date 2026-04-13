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
      className={`relative min-h-[12rem] bg-white/[0.03] border rounded-2xl overflow-hidden transition-all duration-300 ${
        isFocused ? 'border-accent ring-1 ring-accent/20 bg-white/[0.05]' : 'border-white/10 hover:border-white/20'
      }`}
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
        className={[
          'w-full min-h-[12rem] max-h-[24rem] overflow-y-auto resize-none',
          'bg-transparent border-none outline-none p-4 pl-14',
          'font-mono text-sm leading-6 whitespace-pre-wrap break-words text-white/80',
        ].join(' ')}
        style={{ tabSize: 4 }}
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
      className="absolute left-0 top-0 bottom-0 w-10 flex flex-col items-end pr-2 pt-4 pb-4 select-none pointer-events-none"
    >
      {lines.map((_, i) => (
        <span key={i} className="block font-mono text-sm leading-6 text-white/20">
          {i + 1}
        </span>
      ))}
    </div>
  );
};

const QuestionRenderer: React.FC<QuestionRendererProps> = ({ question, index, answer, onChange, hasCoding, language }) => {
  const { showToast } = useNotification();

  return (
    <div className="bg-panel/5 border border-white/10 rounded-xl p-6 mb-8">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-xl font-bold text-accent">Question {index + 1}</h3>
        <span className="px-3 py-1 bg-white/10 rounded-full text-sm">{question.marks} Marks</span>
      </div>

      <p className="text-lg mb-6 leading-relaxed whitespace-pre-wrap">{question.question_text}</p>

      {question.type === 'mcq' ? (
        <div className="space-y-3">
          {question.options?.map((option, idx) => {
            const letter = String.fromCharCode(65 + idx); // A, B, C, D...
            const isSelected = answer === letter;

            return (
              <label
                key={idx}
                className={`flex items-center gap-4 p-4 rounded-lg border cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-accent/20 border-accent'
                    : 'bg-white/5 border-white/10 hover:bg-white/10'
                }`}
              >
                <input
                  type="radio"
                  name={`question-${question.id}`}
                  value={letter}
                  checked={isSelected}
                  onChange={() => onChange(letter)}
                  className="w-4 h-4 accent-accent"
                />
                <span>{option}</span>
              </label>
            );
          })}
        </div>
      ) : (
        <div className="space-y-6">
          <StructuredAnswerInput value={answer || ''} onChange={onChange} />
          
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/20">
              <kbd className="px-1.5 py-0.5 bg-white/5 rounded-md border border-white/5 text-white/40">Tab Indent</kbd>
              <kbd className="px-1.5 py-0.5 bg-white/5 rounded-md border border-white/5 text-white/40">Auto Line</kbd>
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
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 ${
                  (window as any).__KOTLIN_CODE_BUFFER 
                    ? 'bg-accent/10 border border-accent/20 text-accent hover:bg-accent/20' 
                    : 'bg-white/5 border border-white/10 text-white/20'
                }`}
              >
                <ClipboardCheck className="w-3.5 h-3.5" /> Paste from Compiler
              </button>
            )}
          </div>

          {hasCoding && language === 'kotlin' && (
            <div className="pt-8 border-t border-white/5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center text-accent">
                    <FileCode className="w-4 h-4" />
                  </div>
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-accent font-outfit">Kotlin Compiler</h4>
                </div>
              </div>
              <KotlinEditor 
                initialCode={answer && answer.includes('fun main') ? answer : undefined}
                className="shadow-2xl"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default QuestionRenderer;

