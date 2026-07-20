const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_EXPIRES_IN = '7d';

function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function signToken(user) {
  const payload = { id: user.id, email: user.email, role: user.role };
  if (user.role === 'institution_admin') payload.institution_id = user.institution_id;
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

/** Signed, single-purpose token for the password-reset/invite-accept link. */
function signResetToken(id, expiresIn = '1h') {
  return jwt.sign({ id, purpose: 'password_reset' }, process.env.JWT_SECRET, { expiresIn });
}

/** Rejects the request unless a valid JWT is present; attaches req.user. */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/** Attaches req.user if a valid JWT is present, but never rejects. */
function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      req.user = verifyToken(token);
    } catch {
      // ignore — treated as anonymous
    }
  }
  next();
}

/** Must follow requireAuth. Restricts to one or more roles. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

module.exports = {
  hashPassword,
  comparePassword,
  signToken,
  signResetToken,
  verifyToken,
  requireAuth,
  optionalAuth,
  requireRole,
};
