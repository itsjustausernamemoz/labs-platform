const express = require('express');
const crypto = require('crypto');
const db = require('../db/knex');
const { optionalAuth, requireAuth } = require('../lib/auth');

const router = express.Router();

// Kept permissive on read/insert, matching the original "no sensitive
// payload" reasoning (just student_id/exam_id/timestamp) — the same
// UUID-possession posture used throughout the anon-facing surface.
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { student_id, exam_id } = req.query;
    let query = db('enrollments as e')
      .join('exams as x', 'x.id', 'e.exam_id')
      .select(
        'e.id', 'e.student_id', 'e.exam_id', 'e.enrolled_at',
        'x.title', 'x.duration_minutes', 'x.is_active', 'x.total_marks',
        'x.exam_type', 'x.allowed_attempts', 'x.exam_mode'
      );
    if (student_id) query = query.where('e.student_id', student_id);
    if (exam_id) query = query.where('e.exam_id', exam_id);
    if (!student_id && !exam_id) return res.status(400).json({ error: 'Provide student_id and/or exam_id' });

    res.json(await query.orderBy('e.enrolled_at', 'desc'));
  } catch (err) {
    next(err);
  }
});

router.post('/', optionalAuth, async (req, res, next) => {
  try {
    const { student_id, exam_id } = req.body || {};
    if (!student_id || !exam_id) return res.status(400).json({ error: 'student_id and exam_id are required' });

    const existing = await db('enrollments').where({ student_id, exam_id }).first();
    if (existing) return res.json(existing);

    const id = crypto.randomUUID();
    await db('enrollments').insert({ id, student_id, exam_id });
    res.status(201).json(await db('enrollments').where({ id }).first());
  } catch (err) {
    next(err);
  }
});

// Bulk enroll — used by the lecturer roster-upload flow.
router.post('/bulk', requireAuth, async (req, res, next) => {
  try {
    const { exam_id, student_ids } = req.body || {};
    if (!exam_id || !Array.isArray(student_ids) || !student_ids.length) {
      return res.status(400).json({ error: 'exam_id and student_ids[] are required' });
    }
    const rows = student_ids.map((student_id) => ({ id: crypto.randomUUID(), exam_id, student_id }));
    await db('enrollments').insert(rows).onConflict(['student_id', 'exam_id']).ignore();
    res.status(201).json(await db('enrollments').where({ exam_id }));
  } catch (err) {
    next(err);
  }
});

// Unenroll — lecturer only (matches "Allow individual enrollment delete",
// which was scoped to the exam's owning lecturer).
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const enrollment = await db('enrollments').where({ id: req.params.id }).first();
    if (!enrollment) return res.status(404).json({ error: 'Not found' });
    const exam = await db('exams').where({ id: enrollment.exam_id }).first();
    if (!exam || exam.lecturer_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    await db('enrollments').where({ id: enrollment.id }).delete();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
