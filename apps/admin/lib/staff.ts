import { headers } from "next/headers";
import { cache } from "react";
import { notFound } from "next/navigation";
import { STAFF_EMAIL_HEADER } from "./access";
import { readPool } from "./db";
import { isSuperAdminEnabled } from "./super-admin";

export type Staff = { userId: string; email: string };

/** Anything with pg's `query`: a Pool, a Client, a transaction. */
export type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

/** Staff are users with the admin role. The email comes from the Access-verified header. */
export async function lookupStaff(db: Queryable, email: string): Promise<Staff | null> {
  const { rows } = await db.query(
    `SELECT id, lower(email) AS email FROM "user" WHERE lower(email) = lower($1) AND role = 'admin' LIMIT 1`,
    [email],
  );
  const row = rows[0];
  return row ? { userId: String(row.id), email: String(row.email) } : null;
}

/** The development bypass answers without a lookup; production always looks the email up. */
export async function resolveStaff(
  email: string | null,
  env: Record<string, string | undefined>,
  db: Queryable,
): Promise<Staff | null> {
  if (!email) return null;
  if (isSuperAdminEnabled(env)) return { userId: "dev", email };
  return lookupStaff(db, email);
}

/** One lookup per render: the layout, the page and its loaders share it. */
const staffForRequest = cache(async (): Promise<Staff | null> => {
  const email = (await headers()).get(STAFF_EMAIL_HEADER);
  return resolveStaff(email, process.env, readPool());
});

/** Call first in every page and server action. Throws a 404 page for anyone who is not staff. */
export async function requireStaff(): Promise<Staff> {
  const staff = await staffForRequest();
  if (!staff) notFound();
  return staff;
}
