// One-off bootstrap script — creates the very first platform admin account.
// Every platform admin after this one is invited through the Admin app
// itself (POST /platform-admins), which only a platform admin can call.
//
// Usage (run once, on the server or locally against the production DB):
//   cd api
//   node scripts/create-admin.js you@example.com "a strong password" "Your Name"

require('dotenv').config();
const crypto = require('crypto');
const db = require('../db/knex');
const { hashPassword } = require('../lib/auth');

async function main() {
  const [email, password, fullName] = process.argv.slice(2);
  if (!email || !password || !fullName) {
    console.error('Usage: node scripts/create-admin.js <email> <password> "<full name>"');
    process.exit(1);
  }

  const existing = await db('auth_users').where({ email }).first();
  if (existing) {
    console.error(`An account with ${email} already exists.`);
    process.exit(1);
  }

  const id = crypto.randomUUID();
  const password_hash = await hashPassword(password);

  await db.transaction(async (trx) => {
    await trx('auth_users').insert({ id, email, password_hash, role: 'platform_admin' });
    await trx('platform_admins').insert({ id, full_name: fullName, email, active: true });
  });

  console.log(`Platform admin created: ${email} (id: ${id})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
