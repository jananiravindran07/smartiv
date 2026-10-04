// =============================================================================
// SMART IV MONITORING SYSTEM - EDGE FUNCTION SHARED: CALLER AUTHORISATION
// Academic Prototype - Not a Certified Medical Device
// -----------------------------------------------------------------------------
// Every admin Edge Function must answer one question before it touches the
// service-role client: "is the person on the other end of this request an
// active ADMIN?"
//
// The check is deliberately done twice:
//   1. the JWT is decoded and its `role` claim inspected, so a request
//      presenting the service-role key itself is rejected outright rather than
//      being treated as a superuser;
//   2. the JWT is then verified with Supabase Auth (signature, expiry,
//      revocation), and the caller's profile row is read to confirm
//      role = ADMIN and is_active = true.
//
// Checking the profile row rather than a claim is the important half: the role
// lives in the database, so a deactivated or demoted admin loses access on the
// next request without needing a new token.
// =============================================================================

import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

export type Role = "NURSE" | "WARD_SISTER" | "ADMIN";

export interface CallerProfile {
  id: string;
  full_name: string;
  email: string | null;
  role: Role;
  ward_id: string | null;
  is_active: boolean;
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public hint?: string) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Server-side client using the service-role key.
 *
 * The key is read from the Edge Function's own environment. It is never sent to
 * a browser, never returned in a response body, and never written to the repo.
 * Every call made through this client bypasses RLS, so every one of them must
 * be preceded by an authorisation decision made in this file.
 */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new HttpError(
      500,
      "Server misconfigured: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set as Edge Function secrets.",
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

interface JwtClaims {
  sub?: string;
  role?: string;
  email?: string;
  exp?: number;
}

function decodeJwtClaims(req: Request): JwtClaims {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!token) {
    throw new HttpError(401, "Missing Authorization: Bearer <jwt> header.");
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new HttpError(401, "Malformed JWT.");
  }

  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(padded)) as JwtClaims;
  } catch {
    throw new HttpError(401, "Malformed JWT payload.");
  }
}

export interface Caller {
  user: User;
  profile: CallerProfile;
}

/**
 * Verify the request and return the calling user together with their profile.
 * Throws HttpError(401) for anything unauthenticated and HttpError(403) for an
 * authenticated user who is deactivated.
 */
export async function requireUser(req: Request, admin: SupabaseClient): Promise<Caller> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  const claims = decodeJwtClaims(req);

  // A request carrying the service-role key must never be mistaken for a user.
  // Without this, anybody who obtained the key could call this function and be
  // treated as an administrator.
  if (claims.role === "service_role") {
    throw new HttpError(
      401,
      "This endpoint cannot be called with the service-role key.",
      "Service-role credentials are for server-side use only.",
    );
  }

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    throw new HttpError(401, "Invalid or expired session.");
  }

  const user = data.user;

  const { data: row, error: profileError } = await admin
    .from("profiles")
    .select("id, full_name, email, role, ward_id, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw new HttpError(500, `Could not read caller profile: ${profileError.message}`);
  }

  if (!row) {
    throw new HttpError(
      403,
      "This account has no profile and therefore no access.",
      "Accounts are created by an administrator.",
    );
  }

  const profile = row as CallerProfile;

  // Deactivated users get no access anywhere, including here.
  if (!profile.is_active) {
    throw new HttpError(403, "This account has been deactivated.");
  }

  return { user, profile };
}

/** requireUser, plus the ADMIN requirement. */
export async function requireAdmin(req: Request, admin: SupabaseClient): Promise<Caller> {
  const caller = await requireUser(req, admin);

  if (caller.profile.role !== "ADMIN") {
    throw new HttpError(
      403,
      `This action requires the ADMIN role. You are signed in as ${caller.profile.role}.`,
    );
  }

  return caller;
}

const VALID_ROLES: Role[] = ["NURSE", "WARD_SISTER", "ADMIN"];

export function parseRole(value: unknown): Role {
  if (typeof value !== "string" || !VALID_ROLES.includes(value as Role)) {
    throw new HttpError(
      400,
      `role must be one of ${VALID_ROLES.join(", ")}.`,
      "There is no self-service role: an administrator assigns it.",
    );
  }
  return value as Role;
}

export function requireString(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `${field} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpError(400, `${field} must be ${maxLength} characters or fewer.`);
  }
  return trimmed;
}

/** Basic shape check only. The authoritative email validation is Auth's. */
export function parseEmail(value: unknown): string {
  const email = requireString(value, "email", 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "email is not a valid address.");
  }
  return email;
}

export function parsePassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 8) {
    throw new HttpError(400, "password must be at least 8 characters.");
  }
  if (value.length > 200) {
    throw new HttpError(400, "password must be 200 characters or fewer.");
  }
  return value;
}

export function parseUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, `${field} must be a UUID.`);
  }
  return value;
}
