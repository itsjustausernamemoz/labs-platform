const express = require('express');
const crypto = require('crypto');
const db = require('../db/knex');
const { requireAuth } = require('../lib/auth');
const { isPlatformAdmin, isPlatformOrInstitutionAdmin } = require('../lib/authz');
const { logAuditEvent } = require('../lib/auditLog');

const router = express.Router();

// Two shapes:
//  - ?institution_id=X            — that institution's own issues (admin of
//    that institution, or platform admin).
//  - ?status=in.escalated,resolved — cross-tenant Support queue (platform
//    admin only), joined with the institution's name. This is a shallow port
//    of the one PostgREST filter shape the old frontend used (`in.a,b`) — no
//    general query-param parser is needed, just this one.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { institution_id, status } = req.query;

    if (institution_id) {
      if (!isPlatformOrInstitutionAdmin(req.user, institution_id)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const issues = await db('issues').where({ institution_id }).orderBy('created_at', 'desc');
      return res.json(issues);
    }

    if (status && status.startsWith('in.')) {
      if (!isPlatformAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });

      const statuses = status.slice(3).split(',').map((s) => s.trim()).filter(Boolean);
      const rows = await db('issues as i')
        .join('institutions as inst', 'inst.id', 'i.institution_id')
        .whereIn('i.status', statuses)
        .select('i.*', 'inst.name as institution_name')
        .orderBy('i.created_at', 'desc');
      return res.json(rows);
    }

    return res.status(400).json({ error: 'Provide either institution_id or status=in.<a,b>' });
  } catch (err) {
    next(err);
  }
});

// Anyone can file an issue — matches the original "anyone can file an issue"
// posture (lecturers, students via anon, or institution admins all report
// problems). status defaults to 'open', but callers may pass 'escalated'
// directly — used by the institution-admin "Request seat increase" flow.
router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const { institution_id, title, category, body: issueBody, reporter_name, reporter_role } = body;
    if (!institution_id || !title || !category || !issueBody || !reporter_name || !reporter_role) {
      return res.status(400).json({ error: 'institution_id, title, category, body, reporter_name, and reporter_role are required' });
    }

    const id = crypto.randomUUID();
    await db('issues').insert({
      id,
      institution_id,
      title,
      category,
      body: issueBody,
      reporter_name,
      reporter_role,
      status: body.status === 'escalated' ? 'escalated' : 'open',
    });

    const issue = await db('issues').where({ id }).first();
    res.status(201).json(issue);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const issue = await db('issues').where({ id: req.params.id }).first();
    if (!issue) return res.status(404).json({ error: 'Not found' });
    if (!isPlatformOrInstitutionAdmin(req.user, issue.institution_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const patch = {};
    if ('status' in req.body) {
      patch.status = req.body.status;
      if (req.body.status === 'resolved') patch.resolved_at = db.fn.now();
    }

    await db('issues').where({ id: issue.id }).update(patch);
    const updated = await db('issues').where({ id: issue.id }).first();

    let action = 'Updated issue';
    if (patch.status === 'resolved') action = 'Resolved issue';
    else if (patch.status === 'escalated') action = 'Escalated issue';
    await logAuditEvent(db, req.user, action, issue.title, issue.institution_id);

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
