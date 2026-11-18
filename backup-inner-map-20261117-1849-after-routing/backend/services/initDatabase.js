// Optional helper: `npm run db:init` creates inner_map_db and its tables by
// running database/inner_map_db.sql against the MySQL server in .env.
// (You can also import that file through phpMyAdmin instead.)
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { db } = require('../config/env');

(async () => {
  const sqlFile = path.join(__dirname, '..', '..', 'database', 'inner_map_db.sql');
  const sql = fs.readFileSync(sqlFile, 'utf8');
  const conn = await mysql.createConnection({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    multipleStatements: true,
  });
  try {
    await conn.query(sql);
    console.log('[db:init] inner_map_db is ready.');
  } finally {
    await conn.end();
  }
})().catch((err) => {
  console.error('[db:init] Failed:', err.message);
  process.exit(1);
});
