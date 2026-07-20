const express = require('express');
const crypto = require('crypto');
const db = require('../db/knex');
const { optionalAuth, requireAuth, requireRole } = require('../lib/auth');
const { isExamOwnerOrCoMarker } = require('../lib/authz');

const router = express.Router();

const GRADING_FIELDS = ['score', 'graded', 'marking_details', 'is_manual', 'marked_by_email', 'marked_by_name'];
const STUDENT_WRITABLE_FIELDS = ['answers', 'status', 'total_marks'];

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}

async function canGrade(req, exam) {
  return req.user && req.user.role === 'lecturer' && (await isExamOwnerOrCoMarker(db, req.user, exam));
}

// Anon-safe upsert: draft autosave and final submit, one call site (mirrors
// the old `.upsert(payload, {onConflict:'exam_id,student_id,attempt_number'})`
// pattern). Grading columns can never be set here — enforced below, replacing
// the old `guard_submission_grading_columns` trigger.
router.post('/', optionalAuth, async (req, res, next) => {
  try {
    const body = req.body || {};
    const { exam_id, student_id, attempt_number = 1 } = body;
    if (!exam_id || !student_id) return res.status(400).json({ error: 'exam_id and student_id are required' });

    for (const field of GRADING_FIELDS) {
      if (field in body) return res.status(403).json({ error: `Cannot set ${field} from this endpoint` });
    }

    const exam = await db('exams').where({ id: exam_id }).first();
    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    const existing = await db('submissions').where({ exam_id, student_id, attempt_number }).first();

    if (!existing) {
      if (!exam.is_active) return res.status(403).json({ error: 'This exam is not active' });
      const id = crypto.randomUUID();
      await db('submissions').insert({
        id,
        exam_id,
        student_id,
        attempt_number,
        answers: JSON.stringify(body.answers ?? {}),
        marking_details: JSON.stringify({}),
        total_marks: body.total_marks ?? 0,
        status: body.status ?? 'submitted',
      });
      return res.status(201).json(await db('submissions').where({ id }).first());
    }

    if (existing.status !== 'draft') {
      return res.status(403).json({ error: 'This submission is already finalized' });
    }
    const patch = pick(body, STUDENT_WRITABLE_FIELDS);
    if ('answers' in patch) patch.answers = JSON.stringify(patch.answers);
    await db('submissions').where({ id: existing.id }).update(patch);
    res.json(await db('submissions').where({ id: existing.id }).first());
  } catch (err) {
    next(err);
  }
});

// List — kept permissive on read (documented, accepted status quo: no
// student session token exists to scope by, matching the original RLS
// posture). Lecturers additionally get institution/ownership-filtered views.
// Adds nested `exams`/`students` objects to each row — mirrors the handful
// of Supabase nested-select joins the frontend relies on (`exams(title,...)`,
// `student:students(student_number)`), since this hand-written API has no
// generic join syntax to translate automatically.
function withJoins(query) {
  return query
    .leftJoin('exams', 'exams.id', 'submissions.exam_id')
    .leftJoin('students', 'students.id', 'submissions.student_id')
    .select(
      'submissions.*',
      'exams.title as exam_title',
      'exams.exam_type as exam_exam_type',
      'exams.institution_id as exam_institution_id',
      'students.student_number as student_student_number'
    );
}

function shapeRow(row) {
  if (!row) return row;
  const { exam_title, exam_exam_type, exam_institution_id, student_student_number, ...submission } = row;
  return {
    ...submission,
    exams: { id: submission.exam_id, title: exam_title, exam_type: exam_exam_type, institution_id: exam_institution_id },
    students: { student_number: student_student_number },
  };
}

router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { exam_id, student_id } = req.query;
    let query = withJoins(db('submissions'));

    if (exam_id) query = query.where('submissions.exam_id', exam_id);
    if (student_id) query = query.where('submissions.student_id', student_id);
    if (!exam_id && !student_id) return res.status(400).json({ error: 'Provide exam_id and/or student_id' });

    const rows = await query.orderBy('submissions.submitted_at', 'desc');
    res.json(rows.map(shapeRow));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const row = await withJoins(db('submissions')).where('submissions.id', req.params.id).first();
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(shapeRow(row));
  } catch (err) {
    next(err);
  }
});

// Grading update — lecturer/co-marker only. This is the one place the
// grading columns can be written outside of the AI-grading routes.
router.patch('/:id', requireAuth, requireRole('lecturer'), async (req, res, next) => {
  try {
    const submission = await db('submissions').where({ id: req.params.id }).first();
    if (!submission) return res.status(404).json({ error: 'Not found' });
    const exam = await db('exams').where({ id: submission.exam_id }).first();
    if (!(await canGrade(req, exam))) return res.status(403).json({ error: 'Forbidden' });

    const allowed = [...GRADING_FIELDS, 'status', 'total_marks'];
    const patch = pick(req.body || {}, allowed);
    if ('marking_details' in patch) patch.marking_details = JSON.stringify(patch.marking_details);

    await db('submissions').where({ id: submission.id }).update(patch);
    res.json(await db('submissions').where({ id: submission.id }).first());
  } catch (err) {
    next(err);
  }
});

// Delete — archives to deleted_submissions first (replaces the
// `archive_submission_on_delete` trigger), then wipes related violations
// (matches Results.tsx's delete/wipe flow).
router.delete('/:id', requireAuth, requireRole('lecturer'), async (req, res, next) => {
  try {
    const submission = await db('submissions').where({ id: req.params.id }).first();
    if (!submission) return res.status(404).json({ error: 'Not found' });
    const exam = await db('exams').where({ id: submission.exam_id }).first();
    if (!(await canGrade(req, exam))) return res.status(403).json({ error: 'Forbidden' });

    await db.transaction(async (trx) => {
      await trx('deleted_submissions')
        .insert({
          id: submission.id,
          exam_id: submission.exam_id,
          student_id: submission.student_id,
          answers: JSON.stringify(submission.answers),
          score: submission.score,
          total_marks: submission.total_marks,
          graded: submission.graded,
          is_manual: submission.is_manual,
          status: submission.status,
          marking_details: JSON.stringify(submission.marking_details),
          marked_by_email: submission.marked_by_email,
          marked_by_name: submission.marked_by_name,
          submitted_at: submission.submitted_at,
          updated_at: submission.updated_at,
        })
        .onConflict('id')
        .merge();
      await trx('violations').where({ exam_id: submission.exam_id, student_id: submission.student_id }).delete();
      await trx('submissions').where({ id: submission.id }).delete();
    });

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Restore from trash — reinsert into submissions, remove from the archive.
router.post('/:id/restore', requireAuth, requireRole('lecturer'), async (req, res, next) => {
  try {
    const trashed = await db('deleted_submissions').where({ id: req.params.id }).first();
    if (!trashed) return res.status(404).json({ error: 'Not found in trash' });
    const exam = await db('exams').where({ id: trashed.exam_id }).first();
    if (!(await canGrade(req, exam))) return res.status(403).json({ error: 'Forbidden' });

    await db.transaction(async (trx) => {
      await trx('submissions')
        .insert({
          id: trashed.id,
          exam_id: trashed.exam_id,
          student_id: trashed.student_id,
          answers: JSON.stringify(trashed.answers ?? {}),
          score: trashed.score ?? 0,
          total_marks: trashed.total_marks ?? 0,
          graded: trashed.graded ?? false,
          is_manual: trashed.is_manual ?? false,
          status: trashed.status ?? 'submitted',
          marking_details: JSON.stringify(trashed.marking_details ?? {}),
          marked_by_email: trashed.marked_by_email,
          marked_by_name: trashed.marked_by_name,
        })
        .onConflict('id')
        .merge();
      await trx('deleted_submissions').where({ id: trashed.id }).delete();
    });

    res.json(await db('submissions').where({ id: trashed.id }).first());
  } catch (err) {
    next(err);
  }
});

// Permanent delete from trash.
router.delete('/trash/:id', requireAuth, requireRole('lecturer'), async (req, res, next) => {
  try {
    const trashed = await db('deleted_submissions').where({ id: req.params.id }).first();
    if (!trashed) return res.status(404).json({ error: 'Not found' });
    const exam = await db('exams').where({ id: trashed.exam_id }).first();
    if (!(await canGrade(req, exam))) return res.status(403).json({ error: 'Forbidden' });

    await db('deleted_submissions').where({ id: trashed.id }).delete();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get('/trash/list', requireAuth, requireRole('lecturer'), async (req, res, next) => {
  try {
    const { exam_id } = req.query;
    if (!exam_id) return res.status(400).json({ error: 'exam_id is required' });
    const exam = await db('exams').where({ id: exam_id }).first();
    if (!exam || !(await canGrade(req, exam))) return res.status(403).json({ error: 'Forbidden' });

    const rows = await db('deleted_submissions')
      .leftJoin('students', 'students.id', 'deleted_submissions.student_id')
      .where('deleted_submissions.exam_id', exam_id)
      .select('deleted_submissions.*', 'students.student_number as student_student_number')
      .orderBy('deleted_at', 'desc');
    res.json(
      rows.map(({ student_student_number, ...row }) => ({
        ...row,
        student: { student_number: student_student_number },
      }))
    );
  } catch (err) {
    next(err);
  }
});

module.exports = router;
