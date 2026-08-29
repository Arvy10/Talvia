import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const migrationPath = resolve(process.cwd(), "db/migrations/013_acquisition_email.sql");

describe("acquisition email migration", () => {
  test("creates isolated, idempotent acquisition persistence", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).toContain("create table beta_leads");
    expect(migration).toContain("unique(email_normalized)");
    expect(migration).toContain("unique(lead_id,email_type)");
    expect(migration).toContain("unique(provider_event_id)");
    expect(migration).not.toContain("workspace_id uuid not null");
  });
});
