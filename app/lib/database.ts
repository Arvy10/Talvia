import { Pool } from "pg";

const globalForDatabase = globalThis as typeof globalThis & {
  talviaDatabasePool?: Pool;
};

const connectionString = process.env.DATABASE_URL;

// Better Auth's database adapter needs a genuine pg.Pool instance — an
// earlier version of this file wrapped a lazily-created Pool in a Proxy so
// importing this module never threw when DATABASE_URL was missing at
// Next.js build time. That broke sign-in/sign-up in production: the proxy
// target was a plain object, so `instanceof Pool` (which Better Auth's
// adapter relies on internally) failed against it, and adapter init
// silently failed for every real request.
//
// A real Pool's constructor never connects to anything — it's harmless to
// create one even with a placeholder connection string. Only an actual
// query fails if DATABASE_URL was genuinely missing, which is what we
// want: the module itself stays importable during build-time page-data
// collection, without pretending to be something it isn't at runtime.
export const database: Pool = globalForDatabase.talviaDatabasePool ?? new Pool({
  connectionString: connectionString ?? "postgresql://unset/unset",
  // Validates Neon's certificate against Node's trusted CA store and
  // hostname when a real connection string is configured.
  ssl: connectionString ? { rejectUnauthorized: true } : undefined,
  max: 5,
});

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.talviaDatabasePool = database;
}
