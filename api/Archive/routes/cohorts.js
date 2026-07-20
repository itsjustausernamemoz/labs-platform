const express = require('express');
const crypto = require('crypto');
const db = require('../db/knex');
const { requireAuth } = require('../lib/auth');
const { isPlatformOrInstitutionAdmin } = require('../lib/authz');

const router = express.Router();

// Public read — matches the original "Anon can view cohorts" policy. Anon/
// students may need to look up cohort names (e.g. displaying a student's
// cohort), so this is intentionally not gated behind auth.
router.get('/', async (req, res, next) => {
  try {
    const { institution_id } = req.query;
    if (!institution_id) return res.status(400).json({ error: 'institution_id is required' });

    const cohorts = await db('cohorts').where({ institution_id }).orderBy('name');
    res.json(cohorts);
  } catch (err) {
    next(err);
  }
});

// Find-or-create — the frontend's bulk-roster-import flow calls this once
// per import batch, so a repeat call with the same institution_id + name
// must return the existing cohort rather than creating a duplicate.
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { institution_id, name } = req.body || {};
    if (!institution_id || !name) return res.status(400).json({ error: 'institution_id and name are required' });
    if (!isPlatformOrInstitutionAdmin(req.user, institution_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const existing = await db('cohorts').where({ institution_id, name }).first();
    if (existing) return res.json(existing);

    const id = crypto.randomUUID();
    await db('cohorts').insert({ id, institution_id, name });
    const cohort = await db('cohorts').where({ id }).first();
    res.status(201).json(cohort);
  } catch (err) {
    next(err);
  }
});

// Stats card for the institution-admin Students tab. `last_activity` is an
// approximation — there's no per-cohort activity timestamp in this schema,
// so the most recent student.created_at within the cohort stands in for it,
// same limitation StudentsTab.tsx already documents on the frontend.
router.get('/:id/stats', requireAuth, async (req, res, next) => {
  try {
    const cohort = await db('cohorts').where({ id: req.params.id }).first();
    if (!cohort) return res.status(404).json({ error: 'Not found' });
    if (!isPlatformOrInstitutionAdmin(req.user, cohort.institution_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { count } = await db('students').where({ cohort_id: cohort.id }).count({ count: '*' }).first();

    const activeExamRow = await db('enrollments as e')
      .join('students as s', 's.id', 'e.student_id')
      .join('exams as x', 'x.id', 'e.exam_id')
      .where('s.cohort_id', cohort.id)
      .where('x.is_active', true)
      .countDistinct({ count: 'x.id' })
      .first();

    const lastActivityRow = await db('students')
      .where({ cohort_id: cohort.id })
      .max({ last_activity: 'created_at' })
      .first();

    res.json({
      student_count: Number(count) || 0,
      active_exam_count: Number(activeExamRow ? activeExamRow.count : 0) || 0,
      last_activity: lastActivityRow ? lastActivityRow.last_activity : null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
