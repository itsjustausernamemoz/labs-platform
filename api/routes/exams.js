const express = require('express');
const crypto = require('crypto');
const db = require('../db/knex');
const { optionalAuth, requireAuth, requireRole } = require('../lib/auth');
const { isExamOwner, isExamOwnerOrCoMarker, isPlatformOrInstitutionAdmin } = require('../lib/authz');

const router = express.Router();

function generateEnrollmentCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet[crypto.randomInt(alphabet.length)];
  return code;
}

// Public join-by-code lookup. Only the fields the join flow needs — the
// frontend checks `is_active` itself and shows a friendly "not active yet"
// message rather than a generic not-found, same as before the RLS tightening.
router.get('/by-code/:code', async (req, res, next) => {
  try {
    const exam = await db('exams')
      .where({ enrollment_code: req.params.code.toUpperCase() })
      .select('id', 'title', 'is_active')
      .first();
    if (!exam) return res.status(404).json({ error: 'No exam found for that code' });
    res.json(exam);
  } catch (err) {
    next(err);
  }
});

// "My exams" (lecturer, owner + co-marked) or institution-scoped (admin).
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { institution_id, mine } = req.query;

    if (institution_id) {
      if (!isPlatformOrInstitutionAdmin(req.user, institution_id)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const exams = await db('exams')
        .leftJoin('lecturer_profiles', 'lecturer_profiles.id', 'exams.lecturer_id')
        .where('exams.institution_id', institution_id)
        .select('exams.*', 'lecturer_profiles.full_name as lecturer_name')
        .orderBy('exams.created_at', 'desc');
      return res.json(exams);
    }

    if (mine) {
      if (!req.user || req.user.role !== 'lecturer') return res.status(401).json({ error: 'Unauthorized' });
      const coMarkedExamIds = await db('exam_lecturers')
        .where({ lecturer_email: req.user.email })
        .pluck('exam_id');
      const exams = await db('exams')
        .where('lecturer_id', req.user.id)
        .orWhereIn('id', coMarkedExamIds.length ? coMarkedExamIds : [''])
        .orderBy('created_at', 'desc');
      return res.json(exams);
    }

    // Platform-admin cross-tenant view — used for the overview dashboard's
    // exam counts and monthly trend chart. Requires an explicit opt-in query
    // param so a bare `GET /exams` from an unauthenticated caller 400s
    // instead of silently 403ing (matches the pattern above).
    if (req.query.all) {
      if (!isPlatformOrInstitutionAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
      let query = db('exams');
      if (req.query.created_at_gte) query = query.where('created_at', '>=', req.query.created_at_gte);
      if (req.query.created_at_lt) query = query.where('created_at', '<', req.query.created_at_lt);

      const select = req.query.select === 'created_at' ? ['created_at'] : ['*'];
      const exams = await query.select(select).orderBy('created_at', 'desc');
      return res.json(exams);
    }

    return res.status(400).json({ error: 'Provide institution_id, mine=1, or all=1' });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const exam = await db('exams').where({ id: req.params.id }).first();
    if (!exam) return res.status(404).json({ error: 'Not found' });

    const isOwnerOrCoMarker = await isExamOwnerOrCoMarker(db, req.user, exam);
    const isAdmin = isPlatformOrInstitutionAdmin(req.user, exam.institution_id);
    if (!exam.is_active && !isOwnerOrCoMarker && !isAdmin) {
      return res.status(403).json({ error: 'This exam is not active' });
    }
    res.json(exam);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, requireRole('lecturer'), async (req, res, next) => {
  try {
    const profile = await db('lecturer_profiles').where({ id: req.user.id }).first();
    const id = crypto.randomUUID();
    const body = req.body || {};

    await db('exams').insert({
      id,
      title: body.title,
      lecturer_id: req.user.id,
      institution_id: profile ? profile.institution_id : null,
      duration_minutes: body.duration_minutes ?? 60,
      total_marks: body.total_marks ?? 100,
      default_marks_per_question: body.default_marks_per_question ?? 1,
      allowed_violations: body.allowed_violations ?? 3,
      allowed_attempts: body.allowed_attempts ?? 1,
      enrollment_code: body.enrollment_code || generateEnrollmentCode(),
      exam_type: body.exam_type ?? 'mixed',
      subject_id: body.subject_id ?? null,
      exam_mode: body.exam_mode ?? 'closed_book',
      has_coding: Boolean(body.has_coding),
      coding_language: body.coding_language ?? null,
      is_active: Boolean(body.is_active),
    });

    const exam = await db('exams').where({ id }).first();
    res.status(201).json(exam);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireAuth, requireRole('lecturer'), async (req, res, next) => {
  try {
    const exam = await db('exams').where({ id: req.params.id }).first();
    if (!exam) return res.status(404).json({ error: 'Not found' });
    if (!isExamOwner(req.user, exam)) return res.status(403).json({ error: 'Forbidden' });

    const allowed = [
      'title', 'duration_minutes', 'is_active', 'total_marks', 'default_marks_per_question',
      'allowed_violations', 'allowed_attempts', 'enrollment_code', 'exam_type', 'subject_id',
      'exam_mode', 'has_coding', 'coding_language',
    ];
    const patch = {};
    for (const key of allowed) if (key in req.body) patch[key] = req.body[key];

    await db('exams').where({ id: exam.id }).update(patch);
    const updated = await db('exams').where({ id: exam.id }).first();
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAuth, requireRole('lecturer'), async (req, res, next) => {
  try {
    const exam = await db('exams').where({ id: req.params.id }).first();
    if (!exam) return res.status(404).json({ error: 'Not found' });
    if (!isExamOwner(req.user, exam)) return res.status(403).json({ error: 'Forbidden' });

    await db('exams').where({ id: exam.id }).delete();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Regenerate the enrollment code (owner only) — used by the "Manage
// enrollment & co-markers" dialog's regenerate action.
router.post('/:id/regenerate-code', requireAuth, requireRole('lecturer'), async (req, res, next) => {
  try {
    const exam = await db('exams').where({ id: req.params.id }).first();
    if (!exam) return res.status(404).json({ error: 'Not found' });
    if (!isExamOwner(req.user, exam)) return res.status(403).json({ error: 'Forbidden' });

    const enrollment_code = generateEnrollmentCode();
    await db('exams').where({ id: exam.id }).update({ enrollment_code });
    res.json({ enrollment_code });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
