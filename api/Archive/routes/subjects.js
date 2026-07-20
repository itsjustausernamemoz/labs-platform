const express = require('express');
const crypto = require('crypto');
const db = require('../db/knex');
const { requireAuth, requireRole } = require('../lib/auth');

const router = express.Router();

router.get('/', requireAuth, requireRole('lecturer'), async (req, res, next) => {
  try {
    const rows = await db('subjects').where({ lecturer_id: req.user.id }).orderBy('name', 'asc');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, requireRole('lecturer'), async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const profile = await db('lecturer_profiles').where({ id: req.user.id }).first();

    const id = crypto.randomUUID();
    await db('subjects').insert({ id, name, lecturer_id: req.user.id, institution_id: profile?.institution_id ?? null });
    res.status(201).json(await db('subjects').where({ id }).first());
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAuth, requireRole('lecturer'), async (req, res, next) => {
  try {
    const subject = await db('subjects').where({ id: req.params.id }).first();
    if (!subject) return res.status(404).json({ error: 'Not found' });
    if (subject.lecturer_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    await db('subjects').where({ id: subject.id }).delete();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
