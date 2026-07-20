const express = require('express');
const crypto = require('crypto');
const db = require('../db/knex');
const { requireAuth, requireRole, hashPassword } = require('../lib/auth');
const { logAuditEvent } = require('../lib/auditLog');

const router = express.Router();

// Platform admin accounts are NOT self-serve: the very first one is created
// out-of-band (see api/scripts/create-admin.js), and every subsequent one is
// invited by an existing platform admin via POST / below.

// A user can read their own row only — used at login to check `active`.
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    if (req.params.id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const admin = await db('platform_admins').where({ id: req.params.id }).first();
    if (!admin) return res.status(404).json({ error: 'Not found' });
    res.json(admin);
  } catch (err) {
    next(err);
  }
});

router.get('/', requireAuth, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const admins = await db('platform_admins').orderBy('full_name', 'asc');
    res.json(admins);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const { email, password, full_name } = req.body || {};
    if (!email || !password || !full_name) {
      return res.status(400).json({ error: 'email, password, and full_name are required' });
    }

    const existing = await db('auth_users').where({ email }).first();
    if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

    const id = crypto.randomUUID();
    const password_hash = await hashPassword(password);

    await db.transaction(async (trx) => {
      await trx('auth_users').insert({ id, email, password_hash, role: 'platform_admin' });
      await trx('platform_admins').insert({ id, email, full_name, active: true });
    });

    await logAuditEvent(db, req.user, 'Invited platform admin', `${full_name} (${email})`, null);

    const admin = await db('platform_admins').where({ id }).first();
    res.status(201).json(admin);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireAuth, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const admin = await db('platform_admins').where({ id: req.params.id }).first();
    if (!admin) return res.status(404).json({ error: 'Not found' });

    const allowed = ['active', 'full_name'];
    const patch = {};
    for (const key of allowed) if (key in (req.body || {})) patch[key] = req.body[key];
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No updatable fields provided' });

    await db('platform_admins').where({ id: admin.id }).update(patch);
    const updated = await db('platform_admins').where({ id: admin.id }).first();

    const target = `${updated.full_name} (${updated.email})`;
    if ('active' in patch && patch.active !== admin.active) {
      await logAuditEvent(db, req.user, patch.active ? 'Reactivated platform admin' : 'Suspended platform admin', target, null);
    } else {
      await logAuditEvent(db, req.user, 'Updated platform admin', target, null);
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
