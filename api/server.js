require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser tools (curl, server-to-server) with no Origin header.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`Origin not allowed: ${origin}`));
    },
    credentials: false,
  })
);
app.use(express.json({ limit: '5mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/auth', require('./routes/auth'));
app.use('/students', require('./routes/students'));
app.use('/exams', require('./routes/exams'));
app.use('/questions', require('./routes/questions'));
app.use('/enrollments', require('./routes/enrollments'));
app.use('/submissions', require('./routes/submissions'));
app.use('/violations', require('./routes/violations'));
app.use('/subjects', require('./routes/subjects'));
app.use('/co-markers', require('./routes/coMarkers'));
app.use('/lecturer-profiles', require('./routes/lecturerProfiles'));
app.use('/institutions', require('./routes/institutions'));
app.use('/institution-admins', require('./routes/institutionAdmins'));
app.use('/platform-admins', require('./routes/platformAdmins'));
app.use('/cohorts', require('./routes/cohorts'));
app.use('/issues', require('./routes/issues'));
app.use('/billing', require('./routes/billing'));
app.use('/settings', require('./routes/settings'));
app.use('/audit-log', require('./routes/auditLog'));
app.use('/ai', require('./routes/aiGrading'));
app.use('/users', require('./routes/users'));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => console.log(`Mashoke API listening on :${port}`));
