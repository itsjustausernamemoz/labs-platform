const express = require('express');
const db = require('../db/knex');
const { requireAuth } = require('../lib/auth');

const router = express.Router();

// Public read, matching the original "Public can view lecturer profiles"
// policy — used to resolve a lecturer's name in admin/institution-admin
// views and exam listings. No sensitive fields on this table.
router.get('/:id', async (req, res, next) => {
  try {
    const profile = await db('lecturer_profiles').where({ id: req.params.id }).first();
    if (!profile) return res.status(404).json({ error: 'Not found' });
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

// List unassigned lecturers (institution_id IS NULL) — used by the
// institution-admin "add lecturer" flow.
// With no `institution_id` filter, returns every lecturer (platform admin
// use — cross-tenant counts/directories); otherwise scoped as before.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { institution_id } = req.query;
    let query = db('lecturer_profiles');
    if (institution_id === 'null') query = query.whereNull('institution_id');
    else if (institution_id) query = query.where({ institution_id });
    res.json(await query.orderBy('full_name', 'asc'));
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    if (req.params.id !== req.user.id && req.user.role !== 'platform_admin' && req.user.role !== 'institution_admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const allowed = req.params.id === req.user.id ? ['full_name'] : ['active', 'institution_id'];
    const patch = {};
    for (const key of allowed) if (key in (req.body || {})) patch[key] = req.body[key];
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No updatable fields provided' });

    await db('lecturer_profiles').where({ id: req.params.id }).update(patch);
    res.json(await db('lecturer_profiles').where({ id: req.params.id }).first());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
