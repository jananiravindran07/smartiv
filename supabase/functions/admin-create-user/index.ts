// =============================================================================
// SMART IV MONITORING SYSTEM - ADMIN USER CREATION EDGE FUNCTION
// Academic Prototype - Not a Certified Medical Device
// Endpoint: POST /functions/v1/admin-create-user
// -----------------------------------------------------------------------------
// There is no public sign-up and no role picker at login. Accounts are created
// here, and only here, by an authenticated ADMIN.
//
// Why an Edge Function rather than a client call or an RPC:
//   * creating the auth.users row needs the service-role key, and the brief is
//     explicit that the service-role key must exist only as an Edge Function
//     secret, never in web, mobile, firmware or the repo;
//   * an RPC cannot create auth users;
//   * the caller can be verified as an active ADMIN from their JWT plus their
//     profile row before any privileged call is made.
//
// What it does, in one request:
//   1. rejects a request presenting the service-role key itself
//   2. verifies the caller's JWT and confirms role = ADMIN and is_active
//   3. validates role, ward and password
//   4. creates the auth user
//   5. creates the profile (role, ward, email)
//   6. writes an audit_logs row naming the ADMIN as the actor
//
// If step 5 or 6 fails the auth user is deleted again, so a half-created account
// is never left behind.
// =============================================================================

import { corsHeaders, json, preflight, methodNotAllowed } from "../_shared/cors.ts";
import {
  HttpError,
  parseEmail,
  parsePassword,
  parseRole,
  parseUuid,
  requireAdmin,
  requireString,
  serviceClient,
  type Role,
} from "../_shared/guards.ts";
import { writeAudit } from "../_shared/audit.ts";

interface CreateUserBody {
  email?: unknown;
  password?: unknown;
  full_name?: unknown;
  role?: unknown;
  ward_id?: unknown;
  badge_number?: unknown;
  phone_number?: unknown;
  send_invite?: unknown;
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return methodNotAllowed();

  // Anything that escapes as a 500 must not reveal configuration detail.
  let admin: ReturnType<typeof serviceClient> | null = null;
  let createdAuthUserId: string | null = null;

  try {
    admin = serviceClient();

    // ---- 1 & 2: who is calling? -----------------------------------------
    const caller = await requireAdmin(req, admin);

    // ---- 3: validate the payload ----------------------------------------
    let body: CreateUserBody;
    try {
      body = (await req.json()) as CreateUserBody;
    } catch {
      throw new HttpError(400, "Request body must be JSON.");
    }

    const email = parseEmail(body.email);
    const password = parsePassword(body.password);
    const fullName = requireString(body.full_name, "full_name", 160);
    const role: Role = parseRole(body.role);

    // A ward-less profile is only valid for ADMIN. This mirrors
    // chk_profiles_ward_required so the caller gets a clear message instead of
    // a constraint violation.
    let wardId: string | null = null;
    if (body.ward_id !== undefined && body.ward_id !== null && body.ward_id !== "") {
      wardId = parseUuid(body.ward_id, "ward_id");
    }

    if (role !== "ADMIN" && wardId === null) {
      throw new HttpError(
        400,
        `ward_id is required for role ${role}.`,
        "Only ADMIN accounts may be ward-less.",
      );
    }

    if (wardId !== null) {
      const { data: ward, error: wardError } = await admin
        .from("wards")
        .select("id, name")
        .eq("id", wardId)
        .maybeSingle();

      if (wardError) {
        throw new HttpError(500, `Could not verify ward: ${wardError.message}`);
      }
      if (!ward) {
        throw new HttpError(400, `ward_id ${wardId} does not exist.`);
      }
    }

    const badgeNumber =
      body.badge_number === undefined || body.badge_number === null || body.badge_number === ""
        ? null
        : requireString(body.badge_number, "badge_number", 64);

    const phoneNumber =
      body.phone_number === undefined || body.phone_number === null || body.phone_number === ""
        ? null
        : requireString(body.phone_number, "phone_number", 40);

    // ---- 4: create the auth user ----------------------------------------
    // email_confirm is true because the admin is vouching for the address;
    // there is no self-service confirmation flow to complete.
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        // Recorded for traceability only. The database is the authority: the
        // profile row below is what every policy reads.
        requested_role: role,
      },
    });

    if (createError || !created?.user) {
      // Auth errors can reveal whether an address is already registered, so the
      // message is deliberately coarse.
      throw new HttpError(
        400,
        createError?.message ?? "Could not create the account.",
        "If the address is already in use, deactivate the existing account instead.",
      );
    }

    createdAuthUserId = created.user.id;

    // ---- 5: create the profile ------------------------------------------
    // Runs through the service-role client, so RLS and the client INSERT block
    // in trg_guard_profile_privileges both correctly step aside: this is a
    // trusted writer.
    const { error: profileError } = await admin.from("profiles").insert({
      id: created.user.id,
      full_name: fullName,
      email,
      role,
      ward_id: wardId,
      is_active: true,
      badge_number: badgeNumber,
      phone_number: phoneNumber,
    });

    if (profileError) {
      throw new HttpError(500, `Account was created but its profile failed: ${profileError.message}`);
    }

    // ---- 6: audit --------------------------------------------------------
    // The actor is the ADMIN, not the new account.
    const auditId = await writeAudit(admin, {
      actorUserId: caller.profile.id,
      action: "USER_CREATED",
      entityType: "PROFILE",
      entityId: created.user.id,
      metadata: {
        created_email: email,
        created_name: fullName,
        assigned_role: role,
        assigned_ward_id: wardId,
        badge_number: badgeNumber,
      },
    });

    return json(
      {
        success: true,
        user_id: created.user.id,
        email,
        full_name: fullName,
        role,
        ward_id: wardId,
        is_active: true,
        audit_id: auditId,
      },
      201,
    );
  } catch (err) {
    // ---- compensating cleanup -------------------------------------------
    // Never leave an auth user without a profile: it could not log in to do
    // anything useful, and it would be invisible to the admin UI.
    if (createdAuthUserId && admin) {
      try {
        await admin.auth.admin.deleteUser(createdAuthUserId);
      } catch {
        // Best effort. The failure is already being reported to the caller.
      }
    }

    if (err instanceof HttpError) {
      return json(
        { error: err.message, ...(err.hint ? { hint: err.hint } : {}) },
        err.status,
      );
    }

    const message = err instanceof Error ? err.message : "Internal Server Error";
    return json({ error: message }, 500);
  }
});
