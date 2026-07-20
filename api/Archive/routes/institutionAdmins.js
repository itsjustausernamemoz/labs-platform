const express = require('express');
const crypto = require('crypto');
const db = require('../db/knex');
const { requireAuth, hashPassword } = require('../lib/auth');
const { isPlatformAdmin, isPlatformOrInstitutionAdmin, isActiveInstitutionAdminOf } = require('../lib/authz');
const { logAuditEvent } = require('../lib/auditLog');

const router = express.Router();

// Self-check only — the login-time "am I still an active institution admin"
// lookup. Declared before `/` so it isn't ambiguous with the query-param list.
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    if (req.params.id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const admin = await db('institution_admins').where({ id: req.params.id }).first();
    if (!admin) return res.status(404).json({ error: 'Not found' });
    res.json(admin);
  } catch (err) {
    next(err);
  }
});

// All admins of one institution — platform admin or that institution's own admin(s).
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { institution_id } = req.query;
    if (!institution_id) return res.status(400).json({ error: 'institution_id is required' });
    if (!isPlatformOrInstitutionAdmin(req.user, institution_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const rows = await db('institution_admins').where({ institution_id }).orderBy('full_name', 'asc');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Provisions a brand-new institution-admin account: an `auth_users` row +
// the matching `institution_admins` row, in one transaction. Unlike the
// lecturer "attach an existing unassigned account" pattern, the API creates
// the login itself here — it isn't constrained to a client-only anon key
// anymore. Allowed to platform admins, or an existing ACTIVE institution
// admin of the same institution (a suspended admin can't invite others in).
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {};
    const { institution_id, email, password, full_name } = body;
    if (!institution_id || !email || !password || !full_name) {
      return res.status(400).json({ error: 'institution_id, email, password and full_name are required' });
    }

    const allowed = isPlatformAdmin(req.user) || (await isActiveInstitutionAdminOf(db, req.user, institution_id));
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    const existing = await db('auth_users').where({ email }).first();
    if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

    const id = crypto.randomUUID();
    const password_hash = await hashPassword(password);

    await db.transaction(async (trx) => {
      await trx('auth_users').insert({ id, email, password_hash, role: 'institution_admin' });
      await trx('institution_admins').insert({ id, institution_id, full_name, email, active: true });
    });

    const admin = await db('institution_admins').where({ id }).first();
    await logAuditEvent(db, req.user, 'Invited institution admin', admin.full_name, institution_id);
    res.status(201).json(admin);
  } catch (err) {
    next(err);
  }
});

// Update `active`/`full_name` — not self-only: any admin of the institution
// can manage the others (matches the RLS policy's `is_institution_admin`
// check, which isn't self-scoped).
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const admin = await db('institution_admins').where({ id: req.params.id }).first();
    if (!admin) return res.status(404).json({ error: 'Not found' });
    if (!isPlatformOrInstitutionAdmin(req.user, admin.institution_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const allowed = ['active', 'full_name'];
    const patch = {};
    for (const key of allowed) if (key in req.body) patch[key] = req.body[key];
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No updatable fields provided' });

    await db('institution_admins').where({ id: admin.id }).update(patch);
    const updated = await db('institution_admins').where({ id: admin.id }).first();

    let action = 'Updated institution admin';
    if ('active' in patch && Boolean(patch.active) !== Boolean(admin.active)) {
      action = patch.active ? 'Reactivated institution admin' : 'Suspended institution admin';
    }
    await logAuditEvent(db, req.user, action, updated.full_name, admin.institution_id);

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Revokes institution-admin access only — deletes the institution_admins row
// but leaves auth_users intact (revoking access != deleting the person's
// login, matching SettingsTab.tsx's existing "Remove" semantics).
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const admin = await db('institution_admins').where({ id: req.params.id }).first();
    if (!admin) return res.status(404).json({ error: 'Not found' });
    if (!isPlatformOrInstitutionAdmin(req.user, admin.institution_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await logAuditEvent(db, req.user, 'Removed institution admin', admin.full_name, admin.institution_id);
    await db('institution_admins').where({ id: admin.id }).delete();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
