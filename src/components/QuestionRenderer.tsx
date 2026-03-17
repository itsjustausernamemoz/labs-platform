import React from 'react';

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

const QuestionRenderer: React.FC<QuestionRendererProps> = ({ question, index, answer, onChange }) => {
  return (
    <div className="bg-panel/5 border border-white/10 rounded-xl p-6 mb-8">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-xl font-bold text-accent">Question {index + 1}</h3>
        <span className="px-3 py-1 bg-white/10 rounded-full text-sm">{question.marks} Marks</span>
      </div>

      <p className="text-lg mb-6 leading-relaxed">{question.question_text}</p>

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
        <textarea
          value={answer || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type your answer here..."
          className="w-full h-48 bg-white/5 border border-white/10 rounded-lg p-4 focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all resize-none"
        />
      )}
    </div>
  );
};

export default QuestionRenderer;
