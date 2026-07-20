const express = require('express');
const crypto = require('crypto');
const db = require('../db/knex');
const { optionalAuth, requireAuth, requireRole } = require('../lib/auth');
const { isExamOwner } = require('../lib/authz');

const router = express.Router();

// Visible to anyone who can see the parent exam at all (matches "View
// questions" — open as long as the exam row exists).
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { exam_id } = req.query;
    if (!exam_id) return res.status(400).json({ error: 'exam_id is required' });
    const rows = await db('questions').where({ exam_id }).orderBy('order_index', 'asc');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

async function assertOwner(req, res, examId) {
  const exam = await db('exams').where({ id: examId }).first();
  if (!exam) {
    res.status(404).json({ error: 'Exam not found' });
    return null;
  }
  if (!isExamOwner(req.user, exam)) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return exam;
}

router.post('/', requireAuth, requireRole('lecturer'), async (req, res, next) => {
  try {
    const { exam_id } = req.body || {};
    if (!exam_id) return res.status(400).json({ error: 'exam_id is required' });
    if (!(await assertOwner(req, res, exam_id))) return;

    const id = crypto.randomUUID();
    const body = req.body;
    await db('questions').insert({
      id,
      exam_id,
      type: body.type,
      question_text: body.question_text,
      options: body.options != null ? JSON.stringify(body.options) : null,
      correct_answer: body.correct_answer ?? null,
      marks: body.marks ?? 1,
      order_index: body.order_index ?? 0,
      can_copy: Boolean(body.can_copy),
    });
    res.status(201).json(await db('questions').where({ id }).first());
  } catch (err) {
    next(err);
  }
});

// Bulk replace — matches the lecturer dashboard's "delete-all-then-insert"
// Excel-upload and question-set-save pattern in one atomic call.
router.put('/bulk', requireAuth, requireRole('lecturer'), async (req, res, next) => {
  try {
    const { exam_id, questions } = req.body || {};
    if (!exam_id || !Array.isArray(questions)) {
      return res.status(400).json({ error: 'exam_id and questions[] are required' });
    }
    if (!(await assertOwner(req, res, exam_id))) return;

    await db.transaction(async (trx) => {
      await trx('questions').where({ exam_id }).delete();
      if (questions.length) {
        await trx('questions').insert(
          questions.map((q, idx) => ({
            id: crypto.randomUUID(),
            exam_id,
            type: q.type,
            question_text: q.question_text,
            options: q.options != null ? JSON.stringify(q.options) : null,
            correct_answer: q.correct_answer ?? null,
            marks: q.marks ?? 1,
            order_index: q.order_index ?? idx,
            can_copy: Boolean(q.can_copy),
          }))
        );
      }
    });

    res.json(await db('questions').where({ exam_id }).orderBy('order_index', 'asc'));
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireAuth, requireRole('lecturer'), async (req, res, next) => {
  try {
    const question = await db('questions').where({ id: req.params.id }).first();
    if (!question) return res.status(404).json({ error: 'Not found' });
    if (!(await assertOwner(req, res, question.exam_id))) return;

    const allowed = ['type', 'question_text', 'options', 'correct_answer', 'marks', 'order_index', 'can_copy'];
    const patch = {};
    for (const key of allowed) if (key in req.body) patch[key] = req.body[key];
    if ('options' in patch) patch.options = patch.options != null ? JSON.stringify(patch.options) : null;

    await db('questions').where({ id: question.id }).update(patch);
    res.json(await db('questions').where({ id: question.id }).first());
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAuth, requireRole('lecturer'), async (req, res, next) => {
  try {
    const question = await db('questions').where({ id: req.params.id }).first();
    if (!question) return res.status(404).json({ error: 'Not found' });
    if (!(await assertOwner(req, res, question.exam_id))) return;

    await db('questions').where({ id: question.id }).delete();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
