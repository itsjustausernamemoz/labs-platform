# Deploying the Mashoke API to cPanel

This replaces Supabase entirely: MySQL (via cPanel's MySQL Databases tool)
for storage, and this Node/Express app (via cPanel's Node.js Selector) for
auth, business logic, and AI grading. The frontend apps stay on Firebase
Hosting — only their `.env` changes, to point at this API instead of
Supabase.

Everything below assumes you already have the MySQL database + user shown in
your cPanel screenshot (`mashqzco_admin` / `mashqzco_academics`, full
privileges granted). If you don't, create one first: cPanel → **MySQL
Database Wizard** → create a database, create a user, add the user to the
database with **ALL PRIVILEGES**.

## 1. Import the schema

cPanel → **phpMyAdmin** → select `mashqzco_academics` → **Import** tab →
choose file → upload `api/db/schema.sql` → Go.

This creates all 21 tables + 1 view and seeds `feature_flags`/
`platform_settings` with defaults. It's safe to re-run (every statement uses
`IF NOT EXISTS`/`INSERT IGNORE`).

## 2. Create a subdomain for the API

cPanel → **Subdomains** → create `api` (→ `api.<yourdomain>`), document root
can point anywhere temporarily — the Node.js Selector will manage the actual
serving in the next step.

## 3. Set up the Node.js app

cPanel → **Setup Node.js App** → **Create Application**:
- **Node.js version**: the highest available 18.x or 20.x.
- **Application mode**: Production.
- **Application root**: a folder outside `public_html` is fine, e.g.
  `mashoke-api` — upload this repo's `api/` folder's contents there (see
  step 5).
- **Application URL**: the `api` subdomain you just created.
- **Application startup file**: `server.js`.

Click **Create**. cPanel will show you an `source /home/<user>/nodevenv/...`
activation command — note it, you'll need it if you ever want to run
commands (like the bootstrap script) via SSH/Terminal instead of the cPanel
UI.

## 4. Set environment variables

Still in the Node.js App screen, under **Environment variables**, add:

| Variable | Value |
|---|---|
| `DB_HOST` | `localhost` |
| `DB_PORT` | `3306` |
| `DB_USER` | `mashqzco_admin` |
| `DB_PASSWORD` | the password you set when creating that MySQL user |
| `DB_NAME` | `mashqzco_academics` |
| `JWT_SECRET` | a random 32+ byte secret — generate one locally with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `CORS_ORIGINS` | `https://slab-student.web.app,https://lab-lecturer.web.app,https://mashoke-admin.web.app,https://mashoke-institution-admin.web.app` |
| `GEMINI_API_KEY` | your Gemini API key (get one at https://aistudio.google.com/apikey) — needed for AI grading/focus reports |
| `OPENAI_API_KEY` | your OpenAI API key — used as a fallback if Gemini fails; at least one of the two keys is required |
| `SMTP_HOST` | *(optional)* mailbox host for password-reset emails — see step 7 |
| `SMTP_PORT` | *(optional)* usually `587` |
| `SMTP_USER` | *(optional)* the mailbox's login |
| `SMTP_PASS` | *(optional)* the mailbox's password |
| `SMTP_FROM` | *(optional)* defaults to `SMTP_USER` if unset |

Neither `GEMINI_API_KEY` nor `OPENAI_API_KEY` existed anywhere for me to
carry over — they only ever lived in Supabase's now-inaccessible secret
store, so you'll need to (re)generate them.

## 5. Upload the code

Zip the `api/` folder's contents (not the `api` folder itself — its
contents: `server.js`, `db/`, `lib/`, `routes/`, `scripts/`, `package.json`)
and upload via cPanel's **File Manager** into the Application root you set
in step 3, then extract. (Or use Git/SSH if your plan has them — see the
`nodevenv` activation command from step 3 to run `git clone`/`npm` manually.)

Do **not** upload `node_modules` or `.env` — the Node.js Selector installs
dependencies itself (next step), and secrets belong in the environment
variables screen, not a committed/uploaded file.

## 6. Install dependencies and start

Back in **Setup Node.js App**, find your app in the list and click **Run NPM
Install**. Once it finishes, click **Restart**.

Confirm it's alive: visit `https://api.<yourdomain>/health` — should return
`{"ok":true}`.

## 7. (Optional but recommended) Enable password-reset emails

Without SMTP configured, the API still works — `POST /auth/reset-password-request`
just logs a warning server-side and skips sending, so "forgot password"
silently no-ops rather than erroring. To make it real:

cPanel → **Email Accounts** → create a mailbox (e.g.
`noreply@<yourdomain>`) → note its password → set `SMTP_HOST` to
`mail.<yourdomain>` (or whatever your host's mail server hostname is, shown
on the Email Accounts page's "Connect Devices" link), `SMTP_PORT=587`,
`SMTP_USER`/`SMTP_PASS` to the mailbox's credentials → **Restart** the Node
app.

## 8. Point the frontends at the new API

In this repo, update the root `.env`:

```
VITE_API_BASE_URL=https://api.<yourdomain>
```

(The old `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` lines can be removed —
nothing reads them anymore.)

Then rebuild and redeploy the 4 Firebase-hosted apps as usual:

```bash
npm run build:all
firebase deploy --only hosting
```

## 9. Bootstrap the first platform admin

The very first platform-admin account can't be created through the Admin
app itself (it requires an existing platform admin to authorize it — a
deliberate chicken-and-egg gate). Run this once, either via cPanel's
**Terminal** feature (if your plan has one) or SSH, from the Application
root:

```bash
source /home/<cpanel-user>/nodevenv/<app-path>/<node-version>/bin/activate   # from step 3's setup screen
cd ~/mashoke-api   # or wherever you uploaded it
node scripts/create-admin.js you@example.com "a strong password" "Your Name"
```

If you have neither Terminal nor SSH, you can instead: install this same
`api/` folder locally, point its `.env` at the same production MySQL
database (temporarily enable **Remote MySQL** in cPanel for your current IP,
under cPanel → Remote MySQL), run the script from your own machine, then
disable Remote MySQL again.

You should now be able to sign in at `https://mashoke-admin.web.app` with
that email/password.

## Verifying everything end-to-end

1. `https://api.<yourdomain>/health` → `{"ok":true}`.
2. Student app → sign up with a student number → lands on the dashboard.
3. Lecturer app → sign up → sign in → create an exam.
4. Platform Admin app → sign in with the bootstrap account → create an
   institution.
5. Institution Admin app → sign in (once you've invited one from the
   Platform Admin app or `institution_admins.js`) → confirm data is scoped
   to that institution only.
6. Take a full exam as a student, grade it as a lecturer (including "Mark
   all with AI" — confirms `GEMINI_API_KEY`/`OPENAI_API_KEY` are working),
   and confirm the "resume violations" flow still works (it now polls every
   ~4s instead of updating instantly — a lecturer's "Resume" action should
   clear a kicked-out student's warning within a few seconds, not
   instantly).
