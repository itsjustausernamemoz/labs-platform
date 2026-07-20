const express = require('express');
const crypto = require('crypto');
const db = require('../db/knex');
const { optionalAuth, requireAuth, requireRole } = require('../lib/auth');
const { isExamOwnerOrCoMarker } = require('../lib/authz');

const router = express.Router();

const VALID_TYPES = ['tab_switch', 'fullscreen_exit', 'blur', 'cursor_exit'];

// Telemetry write, no session to check against — anon insert stays open
// (matches the original permissive INSERT policy; no sensitive read-back).
router.post('/', optionalAuth, async (req, res, next) => {
  try {
    const { student_id, exam_id, violation_type } = req.body || {};
    if (!student_id || !exam_id || !VALID_TYPES.includes(violation_type)) {
      return res.status(400).json({ error: 'student_id, exam_id, and a valid violation_type are required' });
    }
    const id = crypto.randomUUID();
    await db('violations').insert({ id, student_id, exam_id, violation_type });
    res.status(201).json(await db('violations').where({ id }).first());
  } catch (err) {
    next(err);
  }
});

// Lightweight count endpoint the ExamRoom polls to detect a lecturer-triggered
// reset (replaces the Supabase Realtime `violation-resets` DELETE subscription).
router.get('/count', async (req, res, next) => {
  try {
    const { student_id, exam_id } = req.query;
    if (!student_id || !exam_id) return res.status(400).json({ error: 'student_id and exam_id are required' });
    const [{ count }] = await db('violations').where({ student_id, exam_id }).count({ count: '*' });
    res.json({ count: Number(count) });
  } catch (err) {
    next(err);
  }
});

// Read — lecturer/co-marker only (this was the one table where the
// blanket-permissive SELECT policy from the Supabase era got tightened back
// to a real ownership check; see api/lib/authz.js).
router.get('/', requireAuth, requireRole('lecturer'), async (req, res, next) => {
  try {
    const { exam_id } = req.query;
    if (!exam_id) return res.status(400).json({ error: 'exam_id is required' });
    const exam = await db('exams').where({ id: exam_id }).first();
    if (!exam || !(await isExamOwnerOrCoMarker(db, req.user, exam))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(await db('violations').where({ exam_id }).orderBy('occurred_at', 'desc'));
  } catch (err) {
    next(err);
  }
});

// Resume a student's session — wipes their violations for this exam. This is
// the write that the polling endpoint above detects.
router.delete('/', requireAuth, requireRole('lecturer'), async (req, res, next) => {
  try {
    const { exam_id, student_id } = req.query;
    if (!exam_id || !student_id) return res.status(400).json({ error: 'exam_id and student_id are required' });
    const exam = await db('exams').where({ id: exam_id }).first();
    if (!exam || !(await isExamOwnerOrCoMarker(db, req.user, exam))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await db('violations').where({ exam_id, student_id }).delete();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
