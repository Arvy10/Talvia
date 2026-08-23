import { headers } from "next/headers";
import type { PoolClient } from "pg";

import { auth } from "./auth";
import { database } from "./database";

export type WorkspaceContext = {
  authUserId: string;
  userId: string;
  workspaceId: string;
  role: "owner" | "admin" | "member";
};

type AuthUser = { id: string; email: string; name: string };

export class UnauthorizedError extends Error {}

function splitName(name: string) {
  const values = name.trim().split(/\s+/).filter(Boolean);
  return { firstName: values[0] ?? "", lastName: values.slice(1).join(" ") };
}

function workspaceSlug(user: AuthUser) {
  const source = user.name || user.email.split("@")[0] || "talvia";
  const base = source.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "talvia";
  return `${base.slice(0, 42)}-${user.id.slice(0, 8)}`;
}

async function provisionWorkspace(client: PoolClient, authUser: AuthUser): Promise<WorkspaceContext> {
  const { firstName, lastName } = splitName(authUser.name);
  const userResult = await client.query<{ id: string }>(
    `insert into users (email, first_name, last_name, auth_user_id)
     values ($1, $2, $3, $4)
     on conflict (auth_user_id) do update set updated_at = now()
     returning id`,
    [authUser.email.trim().toLowerCase(), firstName, lastName, authUser.id],
  );
  const userId = userResult.rows[0]!.id;
  const membershipResult = await client.query<{ workspace_id: string; role: WorkspaceContext["role"] }>(
    `select workspace_id, role from workspace_members
     where user_id = $1 and status = 'active'
     order by joined_at asc limit 1`,
    [userId],
  );
  const existingMembership = membershipResult.rows[0];
  if (existingMembership) {
    return { authUserId: authUser.id, userId, workspaceId: existingMembership.workspace_id, role: existingMembership.role };
  }

  const workspaceResult = await client.query<{ id: string }>(
    `insert into workspaces (name, slug, owner_user_id)
     values ($1, $2, $3) returning id`,
    [`Espace de ${firstName || authUser.email.split("@")[0]}`, workspaceSlug(authUser), userId],
  );
  const workspaceId = workspaceResult.rows[0]!.id;
  await client.query(
    `insert into workspace_members (workspace_id, user_id, role, status)
     values ($1, $2, 'owner', 'active')`,
    [workspaceId, userId],
  );
  return { authUserId: authUser.id, userId, workspaceId, role: "owner" };
}

export async function ensureWorkspaceForUser(authUser: AuthUser): Promise<WorkspaceContext> {
  const client = await database.connect();
  try {
    await client.query("begin");
    const context = await provisionWorkspace(client, authUser);
    await client.query("commit");
    return context;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function getCurrentWorkspace(): Promise<WorkspaceContext> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    throw new UnauthorizedError("Authentication required.");
  }
  return ensureWorkspaceForUser({ id: session.user.id, email: session.user.email, name: session.user.name });
}
