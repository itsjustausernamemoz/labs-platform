// Replaces three Supabase Deno edge functions (grade-submission,
// generate-focus-report, generate-class-focus-report) with plain Express
// routes. AI calls go through lib/ai.js's Gemini-then-OpenAI fallback, which
// already returns a parsed JS object — no JSON parsing needed here.
//
// IMPORTANT: the old edge functions returned two DIFFERENT shapes for bulk
// vs. single-question grading (bulk: `{marking_details: {...}}`, single:
// a raw `{marks, feedback}` proxied straight from the model). Both routes
// here return the SAME shape: `{ marking_details: { [questionId]: {
// awarded_marks, feedback } } }` — the frontend will be updated separately
// to expect this one consistent shape from both calls.

const express = require('express');
const db = require('../db/knex');
const { optionalAuth, requireAuth, requireRole } = require('../lib/auth');
const { isExamOwnerOrCoMarker } = require('../lib/authz');
const { callAiWithFallback } = require('../lib/ai');

const router = express.Router();

async function canGrade(req, exam) {
  return req.user && req.user.role === 'lecturer' && (await isExamOwnerOrCoMarker(db, req.user, exam));
}

/** Clamps an AI-returned mark into [0, max], defaulting to 0 on garbage input. */
function clampMarks(value, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(n, 0), max);
}

/** Lenient-but-simple MCQ match: trims and case-folds both sides. */
function mcqIsCorrect(studentAnswer, correctAnswer) {
  const a = String(studentAnswer ?? '').trim().toUpperCase();
  const b = String(correctAnswer ?? '').trim().toUpperCase();
  return a.length > 0 && a === b;
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildBatchStructuredPrompt(structuredQuestions, answers) {
  const items = structuredQuestions
    .map((q) => {
      const studentAnswer = answers?.[q.id] ?? '(No answer provided)';
      return [
        `Question ID: ${q.id}`,
        `Question: ${q.question_text}`,
        `Maximum marks: ${q.marks}`,
        `Model answer: ${q.correct_answer || '(none provided)'}`,
        `Student's answer: ${studentAnswer}`,
      ].join('\n');
    })
    .join('\n\n');

  return `You are a strict but fair academic examiner grading structured exam answers.

For EACH question below, compare the student's answer to the model answer and award marks out of that question's maximum. Award partial credit where the answer is partially correct. Write concise, constructive feedback addressed directly to the student in the second person (e.g. "You correctly identified..." / "Your answer missed...").

${items}

Respond with ONLY a single JSON object (no markdown, no commentary) mapping each Question ID above to its result, in exactly this shape:
{
  "<questionId>": { "awarded_marks": number, "feedback": "string" },
  ...
}
Include one entry for every Question ID listed above, no more and no fewer. "awarded_marks" must be a number between 0 and that question's maximum marks inclusive (0.5 increments are allowed).`;
}

function buildSingleQuestionPrompt(question, studentAnswer) {
  return `You are a strict but fair academic examiner grading a single structured exam answer.

Question: ${question.question_text}
Maximum marks: ${question.marks}
Model answer: ${question.correct_answer || '(none provided)'}
Student's answer: ${studentAnswer ?? '(No answer provided)'}

Compare the student's answer to the model answer and award marks out of the maximum. Award partial credit where the answer is partially correct. Write concise, constructive feedback addressed directly to the student in the second person (e.g. "You correctly identified..." / "Your answer missed...").

Respond with ONLY a single JSON object (no markdown, no commentary) in exactly this shape:
{ "awarded_marks": number, "feedback": "string" }
"awarded_marks" must be a number between 0 and ${question.marks} inclusive (0.5 increments are allowed).`;
}

function buildFocusReportPrompt(exam, questions, submission) {
  const markingDetails = submission.marking_details || {};
  const answers = submission.answers || {};

  const details = questions
    .map((q, idx) => {
      const detail = markingDetails[q.id] || {};
      const awarded = detail.awarded_marks ?? 0;
      const studentAnswer = answers[q.id] ?? '(No answer provided)';
      const outcome = awarded >= q.marks && q.marks > 0 ? 'correct' : awarded > 0 ? 'partially correct' : 'incorrect';
      return [
        `${idx + 1}. [${q.type.toUpperCase()}] ${q.question_text}`,
        `   Marks: ${awarded}/${q.marks} (${outcome})`,
        `   Student's answer: ${studentAnswer}`,
        q.correct_answer ? `   Model/correct answer: ${q.correct_answer}` : null,
        detail.feedback ? `   Prior feedback: ${detail.feedback}` : null,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');

  const percentage = submission.total_marks > 0 ? ((submission.score / submission.total_marks) * 100).toFixed(1) : '0';

  return `You are an academic coach generating a personalized study focus report for a student, based on their exam performance.

Exam: ${exam.title || 'Untitled exam'}
Overall score: ${submission.score}/${submission.total_marks} (${percentage}%)

Per-question breakdown:
${details}

Based strictly on this performance data, produce a JSON object with EXACTLY this shape (no markdown, no commentary, no extra keys):
{
  "overall_summary": "string - a 2-4 sentence encouraging but honest summary of the student's overall performance",
  "swot": {
    "strengths": ["string", ...],
    "weaknesses": ["string", ...],
    "opportunities": ["string", ...],
    "threats": ["string", ...]
  },
  "focus_topics": [
    { "topic": "string", "reason": "string - why they struggled with this topic", "recommendation": "string - how to master it" }
  ],
  "study_techniques": [
    { "method": "string", "description": "string - how to apply it" }
  ],
  "recovery_plan": [
    { "day_range": "string, e.g. 'Days 1-3'", "task": "string" }
  ]
}
Write directly to the student in a supportive, second-person tone. Do not invent topics that weren't covered by the questions above.`;
}

/** Aggregates raw submissions+questions into the numbers the class-report prompt needs. */
function computeClassStats(submissions, questions) {
  const percentages = submissions.map((s) => (s.total_marks > 0 ? (s.score / s.total_marks) * 100 : 0));
  const averageScore = percentages.length ? percentages.reduce((a, b) => a + b, 0) / percentages.length : 0;

  const distribution = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const p of percentages) {
    if (p >= 80) distribution.A++;
    else if (p >= 70) distribution.B++;
    else if (p >= 60) distribution.C++;
    else if (p >= 50) distribution.D++;
    else distribution.F++;
  }

  const questionStats = questions
    .map((q) => {
      let totalAwarded = 0;
      let count = 0;
      for (const s of submissions) {
        const detail = (s.marking_details || {})[q.id];
        if (detail && typeof detail.awarded_marks === 'number') {
          totalAwarded += detail.awarded_marks;
          count++;
        }
      }
      const avgPct = count > 0 && q.marks > 0 ? (totalAwarded / count / q.marks) * 100 : null;
      return { id: q.id, question_text: q.question_text, type: q.type, marks: q.marks, avgPct, count };
    })
    .filter((qs) => qs.avgPct !== null);

  const sortedByAvg = [...questionStats].sort((a, b) => b.avgPct - a.avgPct);
  const topQuestions = sortedByAvg.slice(0, 3);
  const bottomQuestions = sortedByAvg.slice(-3).reverse();

  return { averageScore, distribution, topQuestions, bottomQuestions };
}

function buildClassFocusReportPrompt(exam, stats, totalSubmissions) {
  const { averageScore, distribution, topQuestions, bottomQuestions } = stats;

  const fmtQ = (q) => `- [${q.type}] "${q.question_text}" — class average ${q.avgPct.toFixed(1)}% (${q.marks} marks, ${q.count} graded)`;
  const topList = topQuestions.length ? topQuestions.map(fmtQ).join('\n') : 'None available.';
  const bottomList = bottomQuestions.length ? bottomQuestions.map(fmtQ).join('\n') : 'None available.';

  return `You are an academic analyst producing a class-wide performance and pedagogy report for a lecturer, based on aggregated exam results.

Exam: ${exam.title || 'Untitled exam'}
Graded submissions analyzed: ${totalSubmissions}
Class average score: ${averageScore.toFixed(1)}%
Grade distribution: A (>=80%): ${distribution.A}, B (>=70%): ${distribution.B}, C (>=60%): ${distribution.C}, D (>=50%): ${distribution.D}, F (<50%): ${distribution.F}

Top-performing questions (highest class average):
${topList}

Lowest-performing questions (lowest class average):
${bottomList}

Based strictly on this data, produce a JSON object with EXACTLY this shape (no markdown, no commentary, no extra keys):
{
  "distribution_analysis": "string - 2-3 sentences interpreting the grade distribution and class average",
  "overall_summary": "string - 2-4 sentence summary of overall class performance",
  "swot": {
    "strengths": ["string", ...],
    "weaknesses": ["string", ...],
    "opportunities": ["string", ...],
    "threats": ["string", ...]
  },
  "misconceptions": [
    { "error": "string - a common misconception evident from the lowest-performing questions", "correction_strategy": "string" }
  ],
  "action_plan": [
    { "week": number, "focus": "string", "activity": "string" }
  ],
  "re_teaching_topics": [
    { "topic": "string", "reason": "string", "activity_suggestion": "string" }
  ]
}
Write from the perspective of a pedagogical advisor speaking to the lecturer. Do not invent topics that weren't covered by the questions above. Provide exactly 4 entries in "action_plan", one per week.`;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Bulk auto-mark: local MCQ grading + one batched AI call for all structured
// questions. Writes the result back to the submission, unless it's already
// been manually locked (is_manual=true) — mirrors the old edge function's
// "never re-grade a manually-marked submission" guard.
router.post('/grade-submission', requireAuth, requireRole('lecturer'), async (req, res, next) => {
  try {
    const { submissionId } = req.body || {};
    if (!submissionId) return res.status(400).json({ error: 'submissionId is required' });

    const submission = await db('submissions').where({ id: submissionId }).first();
    if (!submission) return res.status(404).json({ error: 'Submission not found' });

    const exam = await db('exams').where({ id: submission.exam_id }).first();
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    if (!(await canGrade(req, exam))) return res.status(403).json({ error: 'Forbidden' });

    const questions = await db('questions').where({ exam_id: exam.id }).orderBy('order_index', 'asc');
    const answers = submission.answers || {};

    const marking_details = {};

    // Local MCQ grading — no AI call needed.
    for (const q of questions) {
      if (q.type === 'mcq') {
        const isCorrect = mcqIsCorrect(answers[q.id], q.correct_answer);
        marking_details[q.id] = {
          awarded_marks: isCorrect ? q.marks : 0,
          feedback: isCorrect ? 'Correct answer (auto-marked).' : `Incorrect. Correct answer: ${q.correct_answer}`,
        };
      }
    }

    // One batched AI call for every structured question.
    const structuredQuestions = questions.filter((q) => q.type === 'structured');
    if (structuredQuestions.length > 0) {
      const prompt = buildBatchStructuredPrompt(structuredQuestions, answers);
      const aiResult = await callAiWithFallback(prompt);
      for (const q of structuredQuestions) {
        const result = aiResult && aiResult[q.id];
        marking_details[q.id] = {
          awarded_marks: clampMarks(result?.awarded_marks, q.marks),
          feedback: typeof result?.feedback === 'string' ? result.feedback : 'AI grading returned no feedback for this question.',
        };
      }
    }

    const score = Object.values(marking_details).reduce((sum, d) => sum + d.awarded_marks, 0);

    // Guarded by is_manual=false: if a lecturer already locked this
    // submission's marks, we still return the freshly computed
    // marking_details for review but do NOT touch the database row.
    await db('submissions')
      .where({ id: submission.id, is_manual: false })
      .update({ score, marking_details: JSON.stringify(marking_details), graded: true });

    res.json({ marking_details });
  } catch (err) {
    next(err);
  }
});

// Single-question AI "audit" — never writes to the database. The lecturer
// reviews the suggestion and applies it manually via PATCH /submissions/:id.
router.post('/grade-submission/question', requireAuth, requireRole('lecturer'), async (req, res, next) => {
  try {
    const { submissionId, questionId } = req.body || {};
    if (!submissionId || !questionId) return res.status(400).json({ error: 'submissionId and questionId are required' });

    const submission = await db('submissions').where({ id: submissionId }).first();
    if (!submission) return res.status(404).json({ error: 'Submission not found' });

    const exam = await db('exams').where({ id: submission.exam_id }).first();
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    if (!(await canGrade(req, exam))) return res.status(403).json({ error: 'Forbidden' });

    const question = await db('questions').where({ id: questionId, exam_id: exam.id }).first();
    if (!question) return res.status(404).json({ error: 'Question not found for this submission' });

    const studentAnswer = (submission.answers || {})[question.id];
    const prompt = buildSingleQuestionPrompt(question, studentAnswer);
    const result = await callAiWithFallback(prompt);

    const marking_details = {
      [question.id]: {
        awarded_marks: clampMarks(result?.awarded_marks, question.marks),
        feedback: typeof result?.feedback === 'string' ? result.feedback : 'AI grading returned no feedback for this question.',
      },
    };

    res.json({ marking_details });
  } catch (err) {
    next(err);
  }
});

// Student-facing focus report. Students have no JWT/session in this system,
// so this is the one route in this file that is NOT lecturer-gated —
// possession of the unguessable submissionId (v4 UUID) is the access
// control, matching the posture already used for anon submission reads.
router.post('/focus-report', optionalAuth, async (req, res, next) => {
  try {
    const { submissionId } = req.body || {};
    if (!submissionId) return res.status(400).json({ error: 'submissionId is required' });

    const submission = await db('submissions').where({ id: submissionId }).first();
    if (!submission || submission.status === 'draft') return res.status(404).json({ error: 'Submission not found' });

    const exam = await db('exams').where({ id: submission.exam_id }).first();
    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    const questions = await db('questions').where({ exam_id: exam.id }).orderBy('order_index', 'asc');

    const prompt = buildFocusReportPrompt(exam, questions, submission);
    const report = await callAiWithFallback(prompt);

    res.json(report);
  } catch (err) {
    next(err);
  }
});

// Class-wide focus report — lecturer/co-marker only, generated fresh each
// time (no DB write), matching the old behavior of rendering straight into a
// client-side PDF.
router.post('/class-focus-report', requireAuth, requireRole('lecturer'), async (req, res, next) => {
  try {
    const { examId } = req.body || {};
    if (!examId) return res.status(400).json({ error: 'examId is required' });

    const exam = await db('exams').where({ id: examId }).first();
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    if (!(await canGrade(req, exam))) return res.status(403).json({ error: 'Forbidden' });

    const [submissions, questions] = await Promise.all([
      db('submissions').where({ exam_id: examId, graded: true }),
      db('questions').where({ exam_id: examId }).orderBy('order_index', 'asc'),
    ]);

    if (submissions.length === 0) {
      return res.status(400).json({ error: 'No graded submissions to analyze yet' });
    }

    const stats = computeClassStats(submissions, questions);
    const prompt = buildClassFocusReportPrompt(exam, stats, submissions.length);
    const report = await callAiWithFallback(prompt);

    res.json(report);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
