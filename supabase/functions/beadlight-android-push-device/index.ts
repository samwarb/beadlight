const projectUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const reply = (status: number, data: object) => Response.json(data, {
  status, headers: { "Cache-Control": "no-store" },
});
async function hashSecret(proof: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(proof));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return reply(405, { error: "POST required" });
  let input;
  try {
    const raw = await request.text();
    if (raw.length > 6000) return reply(413, { error: "Request too large" });
    input = JSON.parse(raw);
  } catch {
    return reply(400, { error: "Invalid request" });
  }
  if (!input || typeof input.installation_id !== "string" || !uuid.test(input.installation_id) ||
      typeof input.registration_secret !== "string" || !/^[a-f0-9]{64}$/.test(input.registration_secret) ||
      typeof input.token !== "string" || !/^[A-Za-z0-9_:\-.]{20,4096}$/.test(input.token) ||
      !Number.isSafeInteger(input.revision) || input.revision <= 0 ||
      typeof input.challenge_updates !== "boolean" || typeof input.general_announcements !== "boolean") {
    return reply(400, { error: "Invalid device registration" });
  }
  try {
    const saved = await fetch(projectUrl + "/rest/v1/rpc/beadlight_register_android_push", {
      method: "POST",
      headers: {
        apikey: serviceKey, Authorization: "Bearer " + serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_installation: input.installation_id,
        p_proof_hash: await hashSecret(input.registration_secret),
        p_token: input.token,
        p_revision: input.revision,
        p_challenge_updates: input.challenge_updates,
        p_general_announcements: input.general_announcements,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!saved.ok) return reply(saved.status === 409 ? 409 : 503, { error: "Could not register device" });
    if (await saved.json() !== true) return reply(403, { error: "Registration proof mismatch" });
    return reply(200, { registered: true });
  } catch {
    return reply(503, { error: "Registration unavailable" });
  }
});
