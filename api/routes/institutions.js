const express = require('express');
const crypto = require('crypto');
const db = require('../db/knex');
const { optionalAuth, requireAuth, requireRole } = require('../lib/auth');
const { isPlatformAdmin, isPlatformOrInstitutionAdmin } = require('../lib/authz');
const { logAuditEvent } = require('../lib/auditLog');

const router = express.Router();

// Accepts both a plain value and the PostgREST-style `eq.` prefix the old
// Supabase client calls used (`?status=eq.active`), so either query shape works.
function parseFilterValue(value) {
  if (typeof value !== 'string') return value;
  return value.startsWith('eq.') ? value.slice(3) : value;
}

// Seat-usage counts for every institution in one call (AdminDashboard).
// Must be declared before `/:id` so it isn't swallowed by that param route.
router.get('/stats', requireAuth, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const rows = await db('institution_stats').select('*');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Single institution's stats row — platform admin or that institution's own admin.
router.get('/:id/stats', requireAuth, async (req, res, next) => {
  try {
    if (!isPlatformOrInstitutionAdmin(req.user, req.params.id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const stats = await db('institution_stats').where({ institution_id: req.params.id }).first();
    if (!stats) return res.status(404).json({ error: 'Not found' });
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// `?status=eq.active` (or `?status=active`) — public, used by the student
// signup institution picker. No filter at all — full list, platform-admin-only,
// matching AdminDashboard's "manage every institution" view.
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    if (req.query.status) {
      const status = parseFilterValue(req.query.status);
      const rows = await db('institutions').where({ status }).orderBy('name', 'asc');
      return res.json(rows);
    }

    if (!isPlatformAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
    let query = db('institutions');
    if (req.query.created_at_gte) query = query.where('created_at', '>=', req.query.created_at_gte);
    if (req.query.created_at_lt) query = query.where('created_at', '<', req.query.created_at_lt);

    const rows = await query.orderBy('created_at', 'desc');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Public read by id — institution name/plan/seat-limits carry no PII, and
// students/lecturers with no admin session need to resolve institution names.
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const institution = await db('institutions').where({ id: req.params.id }).first();
    if (!institution) return res.status(404).json({ error: 'Not found' });
    res.json(institution);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.name || !body.contact_email) {
      return res.status(400).json({ error: 'name and contact_email are required' });
    }

    const id = crypto.randomUUID();
    await db('institutions').insert({
      id,
      name: body.name,
      contact_email: body.contact_email,
      plan: body.plan ?? 'trial',
      lecturer_seat_limit: body.lecturer_seat_limit ?? 5,
      student_seat_limit: body.student_seat_limit ?? 200,
    });

    const institution = await db('institutions').where({ id }).first();
    await logAuditEvent(db, req.user, 'Created institution', institution.name, institution.id);
    res.status(201).json(institution);
  } catch (err) {
    next(err);
  }
});

// Platform admin (any field) OR that institution's own admin (any field) —
// mirrors "Institution admins update own institution" RLS policy, which had
// no column restriction.
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const institution = await db('institutions').where({ id: req.params.id }).first();
    if (!institution) return res.status(404).json({ error: 'Not found' });
    if (!isPlatformOrInstitutionAdmin(req.user, institution.id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const allowed = ['name', 'contact_email', 'plan', 'lecturer_seat_limit', 'student_seat_limit', 'status', 'self_serve_signup'];
    const patch = {};
    for (const key of allowed) if (key in req.body) patch[key] = req.body[key];
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No updatable fields provided' });

    await db('institutions').where({ id: institution.id }).update(patch);
    const updated = await db('institutions').where({ id: institution.id }).first();

    let action = 'Updated institution';
    if ('status' in patch && patch.status !== institution.status) {
      action = patch.status === 'suspended' ? 'Suspended institution' : 'Reactivated institution';
    } else if ('lecturer_seat_limit' in patch || 'student_seat_limit' in patch) {
      action = 'Updated seat limits';
    }
    await logAuditEvent(db, req.user, action, updated.name, institution.id);

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAuth, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const institution = await db('institutions').where({ id: req.params.id }).first();
    if (!institution) return res.status(404).json({ error: 'Not found' });

    // Log before deleting — the FK cascade removes dependent rows, and we
    // need the institution's name for the audit target.
    await logAuditEvent(db, req.user, 'Removed institution', institution.name, institution.id);
    await db('institutions').where({ id: institution.id }).delete();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
