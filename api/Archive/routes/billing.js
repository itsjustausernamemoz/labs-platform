const express = require('express');
const crypto = require('crypto');
const db = require('../db/knex');
const { requireAuth, requireRole } = require('../lib/auth');
const { isPlatformAdmin, isInstitutionAdminOf } = require('../lib/authz');
const { logAuditEvent } = require('../lib/auditLog');

const router = express.Router();

// GET /subscriptions?institution_id=X -> the one subscription row for that
// institution (or null if none exists yet — institutions don't get one
// auto-created). GET /subscriptions (no filter) -> platform admin only, ALL
// subscriptions left-joined with institution name/plan, for the platform
// Admin Billing page's full institution list.
router.get('/subscriptions', requireAuth, async (req, res, next) => {
  try {
    const { institution_id } = req.query;

    if (institution_id) {
      if (!isPlatformAdmin(req.user) && !isInstitutionAdminOf(req.user, institution_id)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const subscription = await db('subscriptions').where({ institution_id }).first();
      return res.json(subscription || null);
    }

    if (!isPlatformAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });

    const rows = await db('institutions')
      .leftJoin('subscriptions', 'subscriptions.institution_id', 'institutions.id')
      .select(
        'institutions.id as institution_id',
        'institutions.name as institution_name',
        'institutions.plan as institution_plan',
        'subscriptions.id as subscription_id',
        'subscriptions.plan as subscription_plan',
        'subscriptions.price_per_month',
        'subscriptions.cycle',
        'subscriptions.next_invoice_date',
        'subscriptions.status'
      )
      .orderBy('institutions.name', 'asc');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Upsert (find-or-create-or-update) — not every institution has a
// subscription row yet.
router.put('/subscriptions/:institution_id', requireAuth, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const { institution_id } = req.params;
    const { plan, price_per_month, cycle, next_invoice_date, status } = req.body || {};

    await db('subscriptions')
      .insert({
        id: crypto.randomUUID(),
        institution_id,
        plan,
        price_per_month,
        cycle,
        next_invoice_date,
        status,
      })
      .onConflict('institution_id')
      .merge(['plan', 'price_per_month', 'cycle', 'next_invoice_date', 'status']);

    const subscription = await db('subscriptions').where({ institution_id }).first();
    const institution = await db('institutions').where({ id: institution_id }).first();
    await logAuditEvent(db, req.user, 'Updated subscription', institution ? institution.name : institution_id, institution_id);
    res.json(subscription);
  } catch (err) {
    next(err);
  }
});

router.get('/invoices', requireAuth, async (req, res, next) => {
  try {
    const { institution_id } = req.query;
    if (!institution_id) return res.status(400).json({ error: 'institution_id is required' });
    if (!isPlatformAdmin(req.user) && !isInstitutionAdminOf(req.user, institution_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const invoices = await db('invoices').where({ institution_id }).orderBy('invoice_date', 'desc');
    res.json(invoices);
  } catch (err) {
    next(err);
  }
});

router.post('/invoices', requireAuth, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const { institution_id, invoice_date, amount, status } = req.body || {};
    const id = crypto.randomUUID();

    await db('invoices').insert({ id, institution_id, invoice_date, amount, status });

    const invoice = await db('invoices').where({ id }).first();
    const institution = await db('institutions').where({ id: institution_id }).first();
    await logAuditEvent(db, req.user, 'Recorded invoice', institution ? institution.name : institution_id, institution_id);
    res.status(201).json(invoice);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
