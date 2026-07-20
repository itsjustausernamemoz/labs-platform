const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db/knex');
const { requireAuth, requireRole } = require('../lib/auth');
const { sendMail } = require('../lib/mail');
const { logAuditEvent } = require('../lib/auditLog');

const router = express.Router();

// Cross-tenant user directory + generic suspend/reactivate/assign dispatcher,
// mirroring admin/src/pages/AdminUsers.tsx's ROLE_TABLE dispatch pattern —
// one route handles three different underlying tables.
const ROLE_TABLE = {
  lecturer: 'lecturer_profiles',
  student: 'students',
  institution_admin: 'institution_admins',
};

// Combined directory: union of lecturer_profiles, students, and
// institution_admins, each normalized to the same shape. Done as three plain
// Knex queries + a JS flatten rather than a raw SQL UNION — this is an
// admin-only endpoint on a small table, simplicity wins over a marginal
// perf gain.
router.get('/', requireAuth, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const [lecturerUsers, studentUsers, adminUsers] = await Promise.all([
      db('lecturer_profiles')
        .select('id', 'full_name', 'email', 'institution_id', 'active', 'updated_at')
        .then((rows) =>
          rows.map((l) => ({
            id: l.id,
            name: l.full_name,
            email: l.email,
            role: 'lecturer',
            institution_id: l.institution_id,
            active: l.active,
            last_active: l.updated_at,
          }))
        ),
      db('students')
        .select('id', 'full_name', 'student_number', 'institution_id', 'active', 'created_at')
        .then((rows) =>
          rows.map((s) => ({
            id: s.id,
            name: s.full_name || s.student_number,
            email: null,
            role: 'student',
            institution_id: s.institution_id,
            active: s.active,
            last_active: s.created_at,
          }))
        ),
      db('institution_admins')
        .select('id', 'full_name', 'email', 'institution_id', 'active', 'created_at')
        .then((rows) =>
          rows.map((a) => ({
            id: a.id,
            name: a.full_name,
            email: a.email,
            role: 'institution_admin',
            institution_id: a.institution_id,
            active: a.active,
            last_active: a.created_at,
          }))
        ),
    ]);

    res.json([lecturerUsers, studentUsers, adminUsers].flat());
  } catch (err) {
    next(err);
  }
});

// Suspend/reactivate a user, or (lecturer only) assign them to an
// institution — the "assign an unassigned lecturer" action AdminUsers.tsx
// needs.
router.patch('/:role/:id', requireAuth, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const { role, id } = req.params;
    const table = ROLE_TABLE[role];
    if (!table) return res.status(400).json({ error: 'Invalid role' });

    const row = await db(table).where({ id }).first();
    if (!row) return res.status(404).json({ error: 'Not found' });

    const allowed = ['active'];
    if (role === 'lecturer') allowed.push('institution_id');

    const patch = {};
    for (const key of allowed) if (key in (req.body || {})) patch[key] = req.body[key];
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No updatable fields provided' });

    await db(table).where({ id }).update(patch);
    const updated = await db(table).where({ id }).first();

    const name = updated.full_name || updated.student_number;
    const target = updated.email ? `${name} (${updated.email})` : name;

    if ('active' in patch && patch.active !== row.active) {
      await logAuditEvent(
        db,
        req.user,
        patch.active ? 'Reactivated user' : 'Suspended user',
        target,
        updated.institution_id ?? null
      );
    }
    if ('institution_id' in patch && patch.institution_id !== row.institution_id) {
      await logAuditEvent(db, req.user, 'Assigned lecturer to institution', updated.full_name, patch.institution_id);
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Triggers the same reset-email flow as POST /auth/reset-password-request,
// on behalf of a platform admin acting on someone else's account. The
// handler in routes/auth.js isn't reusable as a function (it's wired
// directly onto its own router), so the ~4 lines of token-generation +
// email logic are duplicated here, kept identical so both paths produce
// tokens POST /auth/reset-password-confirm can consume the same way.
router.post('/:role/:id/reset-password', requireAuth, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const { role, id } = req.params;
    if (role === 'student') {
      return res.status(400).json({ error: 'Students do not have a resettable password' });
    }
    const table = ROLE_TABLE[role];
    if (!table) return res.status(400).json({ error: 'Invalid role' });

    const row = await db(table).where({ id }).first();
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!row.email) return res.status(400).json({ error: 'This user has no email on file' });

    const resetToken = jwt.sign({ id: row.id, purpose: 'password_reset' }, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });
    const base = process.env.CORS_ORIGINS?.split(',')[0] || '';
    const link = `${base}/reset-password?token=${resetToken}`;
    sendMail({
      to: row.email,
      subject: 'Reset your Mashoke Labs password',
      text: `Reset your password: ${link}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
    }).catch((err) => console.error('[mail] reset email failed:', err.message));

    await logAuditEvent(db, req.user, 'Triggered password reset', `${row.full_name} (${row.email})`, row.institution_id ?? null);

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
