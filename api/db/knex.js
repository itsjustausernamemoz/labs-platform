const knex = require('knex');

const db = knex({
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    typeCast: function (field, next) {
      // MySQL has no native boolean type; TINYINT(1) columns come back as 0/1.
      // Cast them to real booleans so the API's JSON responses match what the
      // frontend previously got from Postgres (which returns actual booleans).
      if (field.type === 'TINY' && field.length === 1) {
        const value = field.string();
        return value === null ? null : value === '1';
      }
      return next();
    },
  },
  pool: { min: 0, max: 10 },
});

module.exports = db;
