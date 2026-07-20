const crypto = require('crypto');

/**
 * Replaces the `log_audit_event` SECURITY DEFINER RPC. Call this from inside
 * route handlers after a sensitive mutation — never expose a raw insert
 * endpoint for audit_log, or actor identity could be spoofed by the client.
 *
 * `actor` is `req.user` (or null/undefined for an anonymous/system action).
 */
async function logAuditEvent(db, actor, action, target, institutionId = null) {
  const actorId = actor ? actor.id : null;
  let actorName = 'System';
  let actorRole = 'System';

  if (actor) {
    if (actor.role === 'platform_admin') {
      const row = await db('platform_admins').where({ id: actor.id }).first();
      actorName = row ? row.full_name : 'Unknown';
      actorRole = 'platform_admin';
    } else if (actor.role === 'institution_admin') {
      const row = await db('institution_admins').where({ id: actor.id }).first();
      actorName = row ? row.full_name : 'Unknown';
      actorRole = 'institution_admin';
    } else if (actor.role === 'lecturer') {
      const row = await db('lecturer_profiles').where({ id: actor.id }).first();
      actorName = row ? row.full_name : 'Unknown';
      actorRole = 'lecturer';
    }
  }

  await db('audit_log').insert({
    id: crypto.randomUUID(),
    actor_id: actorId,
    actor_name: actorName,
    actor_role: actorRole,
    institution_id: institutionId,
    action,
    target,
  });
}

module.exports = { logAuditEvent };
