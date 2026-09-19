/**
 * Enable PostGIS on the CI test database.
 *
 * properties.location is geography(point, 4326) and the ARI/search queries call
 * ST_DWithin, ST_MakePoint and ST_X/ST_Y, but no migration in ./drizzle declares
 * the extension — production had it enabled out of band. drizzle-kit push
 * therefore fails on the properties table against a database without it.
 *
 * Uses the pg dependency this package already has, so it needs nothing from the
 * runner beyond `bun install`.
 */
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("Set DATABASE_URL before enabling PostGIS");
}

const pool = new Pool({ connectionString });

try {
  await pool.query("CREATE EXTENSION IF NOT EXISTS postgis");
  const { rows } = await pool.query<{ extversion: string }>(
    "SELECT extversion FROM pg_extension WHERE extname = 'postgis'",
  );
  console.log(`PostGIS ready (version ${rows[0]?.extversion ?? "unknown"})`);
} finally {
  await pool.end();
}
