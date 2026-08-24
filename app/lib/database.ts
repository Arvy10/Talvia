import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to use the Talvia database.");
}

const globalForDatabase = globalThis as typeof globalThis & {
  talviaDatabasePool?: Pool;
};

export const database = globalForDatabase.talviaDatabasePool ?? new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.talviaDatabasePool = database;
}
