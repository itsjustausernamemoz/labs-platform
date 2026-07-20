// Minimal SMTP sender for password-reset emails. Uses whatever mailbox the
// user creates in cPanel's "Email Accounts" tool — see the deployment runbook.
// If SMTP isn't configured, reset emails are skipped (logged, not thrown) so
// local/dev use doesn't require a mail server.

let nodemailerPromise;
function getNodemailer() {
  if (!nodemailerPromise) nodemailerPromise = import('nodemailer');
  return nodemailerPromise;
}

async function sendMail({ to, subject, text }) {
  if (!process.env.SMTP_HOST) {
    console.warn(`[mail] SMTP not configured — skipping email to ${to}: ${subject}`);
    return;
  }
  const { default: nodemailer } = await getNodemailer();
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
  });
}

module.exports = { sendMail };
