// =============================================================================
// SMART IV MONITORING SYSTEM - EDGE FUNCTION SHARED: AUDIT WRITER
// Academic Prototype - Not a Certified Medical Device
// -----------------------------------------------------------------------------
// audit_logs is append-only and has no INSERT policy for any client role
// (migration 00500), so it can only be written from SECURITY DEFINER code or
// from the service role. This helper is the service-role path.
//
// Every call must record the ADMIN who performed the action as user_id, never
// the account being acted upon.
// =============================================================================

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface AuditInput {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function writeAudit(admin: SupabaseClient, entry: AuditInput): Promise<string> {
  const { data, error } = await admin
    .from("audit_logs")
    .insert({
      user_id: entry.actorUserId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      metadata: { source: "edge_function", ...(entry.metadata ?? {}) },
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`audit write failed: ${error.message}`);
  }

  return data.id as string;
}
