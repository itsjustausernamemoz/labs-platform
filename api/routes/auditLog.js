const express = require('express');
const db = require('../db/knex');
const { requireAuth } = require('../lib/auth');
const { isPlatformAdmin } = require('../lib/authz');

const router = express.Router();

// Read-only. Rows are written exclusively via api/lib/auditLog.js from
// inside other route handlers — never accept a write here, that would let a
// client spoof actor identity and defeat the point of centralizing writes.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 200);

    let query = db('audit_log').orderBy('occurred_at', 'desc').limit(limit);

    if (isPlatformAdmin(req.user)) {
      // no institution filter — all rows
    } else if (req.user.role === 'institution_admin') {
      query = query.where({ institution_id: req.user.institution_id });
    } else {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const rows = await query;
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
