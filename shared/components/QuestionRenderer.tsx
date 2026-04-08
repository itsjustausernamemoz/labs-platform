import React, { useRef, useEffect } from 'react';

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
}

/** Auto-growing structured text area with tab-indent support */
const StructuredAnswerInput: React.FC<{ value: string; onChange: (v: string) => void }> = ({
  value,
  onChange,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
      // Auto-indent: match leading whitespace of current line
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
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={"Type your answer here...\n\nPress Tab to indent, Enter for a new line (auto-indented)."}
        rows={8}
        spellCheck={false}
        className={[
          'w-full min-h-[12rem] max-h-[24rem] overflow-y-auto resize-none',
          'bg-white/5 border border-white/10 rounded-lg',
          'p-4 pl-14',
          'focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all',
          'font-mono text-sm leading-6 whitespace-pre-wrap break-words',
        ].join(' ')}
        style={{ tabSize: 4 }}
      />
      {/* Line-number gutter */}
      <LineNumbers value={value} />
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

const QuestionRenderer: React.FC<QuestionRendererProps> = ({ question, index, answer, onChange }) => {
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
        <>
          <StructuredAnswerInput value={answer || ''} onChange={onChange} />
          <p className="mt-2 text-xs text-white/30">
            <kbd className="px-1 py-0.5 bg-white/10 rounded text-white/50 font-mono">Tab</kbd> to indent &nbsp;·&nbsp;
            <kbd className="px-1 py-0.5 bg-white/10 rounded text-white/50 font-mono">Enter</kbd> for new line (auto-indented)
          </p>
        </>
      )}
    </div>
  );
};

export default QuestionRenderer;

