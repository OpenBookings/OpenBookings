const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf-8');
const envVars = {};
env.split('\n').forEach(line => {
  if(line.includes('=') && !line.startsWith('#')) {
    const parts = line.split('=');
    envVars[parts[0]] = parts.slice(1).join('=').replace(/^"|"$/g, '').replace(/^'|'$/g, '');
  }
});

const { Pool } = require('pg');
const pool = new Pool({ connectionString: envVars.DATABASE_URL_DIRECT || envVars.DATABASE_URL });

async function checkDb() {
  try {
    const res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'property_images'");
    console.log("property_images columns:");
    console.table(res.rows);
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
checkDb();
