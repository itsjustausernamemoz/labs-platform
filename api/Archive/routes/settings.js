const express = require('express');
const db = require('../db/knex');
const { requireAuth, requireRole } = require('../lib/auth');
const { logAuditEvent } = require('../lib/auditLog');

const router = express.Router();

// Public — no auth. Powers the announcement banner on student/lecturer
// dashboards, so it must be reachable with no auth.
router.get('/platform', async (_req, res, next) => {
  try {
    const settings = await db('platform_settings').where({ id: 1 }).first();
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

// platform_settings is a singleton — always target id=1, never let the
// caller change which row gets updated.
router.put('/platform', requireAuth, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const allowed = ['standard_price', 'enterprise_price', 'announcement', 'announcement_published'];
    const patch = {};
    for (const key of allowed) if (key in req.body) patch[key] = req.body[key];

    await db('platform_settings').where({ id: 1 }).update(patch);
    const settings = await db('platform_settings').where({ id: 1 }).first();
    await logAuditEvent(db, req.user, 'Updated platform settings', 'Platform settings', null);
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

// Public — same reasoning as GET /platform: student/lecturer apps need to
// read flags to gate features like open-book mode or the coding sandbox.
router.get('/feature-flags', async (_req, res, next) => {
  try {
    const flags = await db('feature_flags').orderBy('label', 'asc');
    res.json(flags);
  } catch (err) {
    next(err);
  }
});

router.patch('/feature-flags/:key', requireAuth, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const flag = await db('feature_flags').where({ key: req.params.key }).first();
    if (!flag) return res.status(404).json({ error: 'Not found' });

    const { enabled } = req.body || {};
    await db('feature_flags').where({ key: flag.key }).update({ enabled: Boolean(enabled) });

    const updated = await db('feature_flags').where({ key: flag.key }).first();
    await logAuditEvent(
      db,
      req.user,
      `Toggled feature flag: ${flag.label}`,
      enabled ? 'Enabled' : 'Disabled',
      null
    );
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
