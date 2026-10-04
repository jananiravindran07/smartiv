// =============================================================================
// SMART IV MONITORING SYSTEM - EDGE FUNCTION SHARED: CORS
// Academic Prototype - Not a Certified Medical Device
// =============================================================================

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function preflight(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response("ok", { headers: corsHeaders }) : null;
}

export function methodNotAllowed(allowed = "POST"): Response {
  return json({ error: "Method not allowed" }, 405);
}
