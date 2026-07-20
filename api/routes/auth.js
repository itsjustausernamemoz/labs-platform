const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db/knex');
const { hashPassword, comparePassword, signToken, signResetToken, requireAuth } = require('../lib/auth');
const { sendMail } = require('../lib/mail');

const router = express.Router();

const PROFILE_TABLE = {
  lecturer: 'lecturer_profiles',
  platform_admin: 'platform_admins',
  institution_admin: 'institution_admins',
};

// Lecturer self-signup. Platform/institution admins are provisioned manually
// (see api/scripts/create-admin.js) or invited by an existing admin — no
// self-serve signup for those roles, matching the original design.
router.post('/signup', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const existing = await db('auth_users').where({ email }).first();
    if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

    const id = crypto.randomUUID();
    const password_hash = await hashPassword(password);

    await db.transaction(async (trx) => {
      await trx('auth_users').insert({ id, email, password_hash, role: 'lecturer' });
      await trx('lecturer_profiles').insert({
        id,
        email,
        full_name: email.split('@')[0],
        institution_id: null,
        active: true,
      });
    });

    const user = { id, email, role: 'lecturer' };
    res.status(201).json({ user, token: signToken(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/signin', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const account = await db('auth_users').where({ email }).first();
    if (!account) return res.status(401).json({ error: 'Invalid email or password' });

    const ok = await comparePassword(password, account.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

    const profile = await db(PROFILE_TABLE[account.role]).where({ id: account.id }).first();
    if (!profile || profile.active === false) {
      return res.status(403).json({ error: 'This account is inactive' });
    }

    const user = {
      id: account.id,
      email: account.email,
      role: account.role,
      ...(account.role === 'institution_admin' ? { institution_id: profile.institution_id } : {}),
    };
    res.json({ user, token: signToken(user) });
  } catch (err) {
    next(err);
  }
});

// Stateless JWTs — nothing to invalidate server-side, kept for symmetry with
// the frontend's existing `auth.signOut()` call shape.
router.post('/signout', (_req, res) => res.status(204).end());

router.get('/user', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.put('/password', requireAuth, async (req, res, next) => {
  try {
    const { password } = req.body || {};
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const password_hash = await hashPassword(password);
    await db('auth_users').where({ id: req.user.id }).update({ password_hash });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password-request', async (req, res, next) => {
  try {
    const { email, appUrl } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const account = await db('auth_users').where({ email }).first();
    // Always 200, whether or not the email exists — don't leak account existence.
    if (account) {
      const resetToken = signResetToken(account.id, '1h');
      // `appUrl`, when passed, is already the full reset-page URL (e.g.
      // ".../reset-password") — don't append the path again on top of it.
      const base = appUrl || `${process.env.CORS_ORIGINS?.split(',')[0] || ''}/reset-password`;
      const link = `${base}?token=${resetToken}`;
      sendMail({
        to: email,
        subject: 'Reset your Mashoke Labs password',
        text: `Reset your password: ${link}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
      }).catch((err) => console.error('[mail] reset email failed:', err.message));
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password-confirm', async (req, res, next) => {
  try {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required' });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(400).json({ error: 'Reset link is invalid or expired' });
    }
    if (decoded.purpose !== 'password_reset') return res.status(400).json({ error: 'Invalid reset token' });

    const password_hash = await hashPassword(newPassword);
    await db('auth_users').where({ id: decoded.id }).update({ password_hash });
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
