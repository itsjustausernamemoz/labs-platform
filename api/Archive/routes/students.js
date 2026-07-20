const express = require('express');
const crypto = require('crypto');
const db = require('../db/knex');
const { requireAuth, requireRole } = require('../lib/auth');

const router = express.Router();

// Students have no password/JWT — this mirrors the exact pre-migration
// pseudo-session model: look up by student_number, insert if missing, return
// the raw row for the frontend to store in localStorage.
router.post('/login-or-create', async (req, res, next) => {
  try {
    const { student_number, full_name, institution_id } = req.body || {};
    if (!student_number) return res.status(400).json({ error: 'student_number is required' });

    let student = await db('students').where({ student_number }).first();
    if (!student) {
      const id = crypto.randomUUID();
      await db('students').insert({
        id,
        student_number,
        full_name: full_name || null,
        institution_id: institution_id || null,
        active: true,
      });
      student = await db('students').where({ id }).first();
    }
    res.json(student);
  } catch (err) {
    next(err);
  }
});

// Bulk find-or-create by student_number — used by the lecturer roster bulk-
// enroll flow (upload a spreadsheet of student numbers, ensure they all
// exist, then enroll them). Requires an authenticated lecturer, matching the
// original "lecturers can manage students" spirit of that flow.
router.post('/bulk-upsert', requireAuth, requireRole('lecturer'), async (req, res, next) => {
  try {
    const { students: rows } = req.body || {};
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'students[] is required' });

    const numbers = rows.map((r) => r.student_number).filter(Boolean);
    const existing = await db('students').whereIn('student_number', numbers);
    const existingByNumber = new Map(existing.map((s) => [s.student_number, s]));

    const toInsert = rows
      .filter((r) => r.student_number && !existingByNumber.has(r.student_number))
      .map((r) => ({ id: crypto.randomUUID(), student_number: r.student_number, active: true }));
    if (toInsert.length) await db('students').insert(toInsert);

    const result = await db('students').whereIn('student_number', numbers);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Platform-wide count/list — used by the Platform Admin overview stats.
// Institution-scoped student directories go through /cohorts + /enrollments
// instead; this is intentionally the one cross-tenant view.
router.get('/', requireAuth, requireRole('platform_admin'), async (req, res, next) => {
  try {
    res.json(await db('students').orderBy('created_at', 'desc'));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const student = await db('students').where({ id: req.params.id }).first();
    if (!student) return res.status(404).json({ error: 'Not found' });
    res.json(student);
  } catch (err) {
    next(err);
  }
});

// Matches the original "Anyone can manage students" posture: no auth
// required, but only enrollment-time fields are writable here — suspending a
// student is an admin action (see PATCH /users/student/:id).
router.patch('/:id', async (req, res, next) => {
  try {
    const allowed = ['full_name', 'institution_id', 'cohort_id'];
    const patch = {};
    for (const key of allowed) if (key in (req.body || {})) patch[key] = req.body[key];
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No updatable fields provided' });

    await db('students').where({ id: req.params.id }).update(patch);
    const student = await db('students').where({ id: req.params.id }).first();
    res.json(student);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
