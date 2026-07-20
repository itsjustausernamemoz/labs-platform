const express = require('express');
const crypto = require('crypto');
const db = require('../db/knex');
const { requireAuth, requireRole } = require('../lib/auth');
const { isExamOwner } = require('../lib/authz');

const router = express.Router();

// Add a co-marker by email — no invite email, no existence check against
// auth_users, exactly as before (a co-marker is recognized purely by email
// match against their JWT once they do have an account).
router.post('/', requireAuth, requireRole('lecturer'), async (req, res, next) => {
  try {
    const { exam_id, lecturer_email } = req.body || {};
    if (!exam_id || !lecturer_email) return res.status(400).json({ error: 'exam_id and lecturer_email are required' });

    const exam = await db('exams').where({ id: exam_id }).first();
    if (!exam || !isExamOwner(req.user, exam)) return res.status(403).json({ error: 'Forbidden' });

    try {
      const id = crypto.randomUUID();
      await db('exam_lecturers').insert({ id, exam_id, lecturer_email });
      res.status(201).json(await db('exam_lecturers').where({ id }).first());
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Already a co-marker on this exam' });
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
