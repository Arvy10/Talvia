import { Pool } from "pg";

const globalForDatabase = globalThis as typeof globalThis & {
  talviaDatabasePool?: Pool;
};

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to use the Talvia database.");
  }
  return new Pool({
    connectionString,
    // Validates Neon's certificate against Node's trusted CA store and
    // hostname — the previous `rejectUnauthorized: false` accepted any
    // certificate at all, so a DNS/network-level interception could
    // present a forged one and the driver would never notice.
    ssl: { rejectUnauthorized: true },
    max: 5,
  });
}

function getPool(): Pool {
  globalForDatabase.talviaDatabasePool ??= createPool();
  return globalForDatabase.talviaDatabasePool;
}

// Lazily creates the real pg Pool on first actual use rather than at
// import time. Next.js's build-time page-data collection imports every
// route module just to inspect it, which used to throw immediately
// whenever DATABASE_URL wasn't set in the build environment — even for
// routes that never touch the database during that collection pass.
export const database: Pool = new Proxy({} as Pool, {
  get(_target, property, _receiver) {
    const pool = getPool();
    const value = Reflect.get(pool, property, pool);
    return typeof value === "function" ? value.bind(pool) : value;
  },
});
