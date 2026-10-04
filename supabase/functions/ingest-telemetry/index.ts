// =============================================================================
// SMART IV MONITORING SYSTEM - TELEMETRY INGESTION EDGE FUNCTION
// Supabase Deno Edge Function
// Endpoint: POST /functions/v1/ingest-telemetry
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-id, x-device-secret",
};

interface IngestPayload {
  device_identifier: string;
  device_secret: string;
  raw_mass_g: number;
  battery_level?: number;
  wifi_rssi?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: IngestPayload = await req.json();

    // Fallback support for header-based auth if preferred in firmware
    const deviceId = body.device_identifier || req.headers.get("x-device-id");
    const deviceSecret = body.device_secret || req.headers.get("x-device-secret");

    if (!deviceId || !deviceSecret || typeof body.raw_mass_g !== "number") {
      return new Response(
        JSON.stringify({ error: "Missing required fields: device_identifier, device_secret, raw_mass_g" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase admin client using server-side environment variables
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Call Postgres secure ingestion RPC
    const { data, error } = await supabase.rpc("ingest_telemetry_secure", {
      p_device_identifier: deviceId,
      p_device_secret: deviceSecret,
      p_raw_mass_g: body.raw_mass_g,
      p_battery_level: body.battery_level ?? null,
      p_wifi_rssi: body.wifi_rssi ?? null,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (data?.success === false) {
      return new Response(JSON.stringify(data), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
