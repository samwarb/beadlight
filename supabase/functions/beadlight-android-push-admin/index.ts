const projectUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const webHeaders = {
  "Access-Control-Allow-Origin": "https://beadlight.app",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "OPTIONS,POST",
  "Cache-Control": "no-store",
};
const reply = (status: number, data: object) => Response.json(data, { status, headers: webHeaders });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const campaignSlug = /^[a-z0-9][a-z0-9-]{0,63}$/;
const historyFields = "id,audience,challenge_slug,title,body,is_test,intended_count,accepted_count,failed_count,status,sent_at";
const encoder = new TextEncoder();

type Provider = { project_id: string; client_email: string; private_key: string };
type Device = { installation_id: string; fcm_token: string };

async function db(path: string, method = "GET", body?: object) {
  const response = await fetch(projectUrl + "/rest/v1/" + path, {
    method,
    headers: {
      apikey: serviceKey, Authorization: "Bearer " + serviceKey,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return { ok: false, data: null };
  return { ok: true, data: await response.json().catch(() => null) };
}

async function authorise(request: Request): Promise<string | null> {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const response = await fetch(projectUrl + "/auth/v1/user", {
    headers: { apikey: anonKey, Authorization: authorization },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return null;
  const user = await response.json();
  if (typeof user.email !== "string" || typeof user.id !== "string" || !uuid.test(user.id)) return null;
  const email = user.email.trim().toLowerCase();
  // Escape LIKE wildcards and verify the returned address exactly.
  const filter = email.replace(/[\\%_]/g, "\\$&").replace(/[\x00-\x1f]/g, "");
  const row = await db("admin_users?email=ilike." + encodeURIComponent(filter) + "&select=email&limit=2");
  return row.ok && row.data?.some((item: { email: string }) => item.email.toLowerCase() === email)
    ? user.id : null;
}

function provider(): Provider | null {
  try {
    const value = JSON.parse(Deno.env.get("FCM_SERVICE_ACCOUNT_JSON") ?? "null");
    if (value?.type === "service_account" && value.project_id === "beadlight-android" &&
        typeof value.client_email === "string" && typeof value.private_key === "string") return value;
  } catch {
    // Report configuration status without exposing credentials.
  }
  return null;
}

function base64Url(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function accessToken(config: Provider): Promise<string> {
  const pkcs8 = config.private_key.replace(/-----[^-]+-----|\s/g, "");
  const key = await crypto.subtle.importKey(
    "pkcs8", Uint8Array.from(atob(pkcs8), (char) => char.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const url = "https://oauth2.googleapis.com/token";
  const encode = (value: object) => base64Url(encoder.encode(JSON.stringify(value)));
  const unsigned = encode({ alg: "RS256", typ: "JWT" }) + "." + encode({
    iss: config.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: url, iat: now, exp: now + 600,
  });
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  const result = await fetch(url, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: unsigned + "." + base64Url(new Uint8Array(signature)),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await result.json();
  if (!result.ok || typeof body.access_token !== "string") throw Error("Firebase credentials could not be authorised");
  return body.access_token;
}

async function send(
  config: Provider, token: string, device: Device,
  data: Record<string, string>,
): Promise<string | null> {
  try {
    const response = await fetch("https://fcm.googleapis.com/v1/projects/" + config.project_id + "/messages:send", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token: device.fcm_token,
          data,
          android: { priority: "high", ttl: "3600s", restricted_package_name: "com.merciandigital.beadlight" },
        },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (response.ok) return null;
    const error = (await response.json().catch(() => null))?.error;
    if (error?.details?.some((item: { errorCode?: string }) => item.errorCode === "UNREGISTERED")) {
      await db("beadlight_android_push_devices?installation_id=eq." + device.installation_id +
        "&fcm_token=eq." + encodeURIComponent(device.fcm_token), "PATCH",
        { challenge_updates: false, general_announcements: false });
      return "Unregistered device";
    }
    return "Firebase rejected the request (" + response.status + ")";
  } catch {
    return "Firebase did not respond";
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: webHeaders });
  if (request.method !== "POST") return reply(405, { error: "POST required" });
  try {
    const admin = await authorise(request);
    if (!admin) return reply(403, { error: "Beadlight admin login required" });
    const raw = await request.text();
    if (raw.length > 4000) return reply(413, { error: "Request too large" });
    let input;
    try { input = JSON.parse(raw); } catch { return reply(400, { error: "Invalid JSON" }); }
    const action = input?.action;
    if (action === "history") {
      const history = await db("beadlight_android_push_campaigns?select=" + historyFields + "&order=sent_at.desc&limit=30");
      return history.ok ? reply(200, { history: history.data }) : reply(503, { error: "Could not load history" });
    }
    if (!["preview", "test", "send"].includes(action) || !["challenge", "general"].includes(input.audience)) {
      return reply(400, { error: "Choose a valid action and audience" });
    }
    const slug = input.audience === "challenge" ? input.challenge_slug : null;
    if (input.audience === "challenge" && (typeof slug !== "string" || !campaignSlug.test(slug))) {
      return reply(400, { error: "Choose a challenge" });
    }
    if (slug && slug !== "daily") {
      const campaign = await db("rosary_challenges?slug=eq." + slug + "&is_published=eq.true&select=slug&limit=1");
      if (!campaign.ok || !campaign.data?.length) return reply(400, { error: "Challenge is not published" });
    }
    const config = provider();
    const testDevice = action === "test" ? input.test_installation_id : null;
    const params = { p_audience: input.audience, p_slug: slug, p_test_device: testDevice };
    if (action === "preview") {
      const [found, test] = await Promise.all([
        db("rpc/beadlight_android_push_candidates", "POST", params),
        db("beadlight_android_push_campaigns?is_test=eq.true&accepted_count=gt.0&select=id&limit=1"),
      ]);
      if (!found.ok || !test.ok) return reply(503, { error: "Could not preview this audience" });
      const count = found.data.length;
      const tested = Boolean(test.data.length);
      return reply(200, {
        eligible_devices: count, limited: count > 150, fcm_configured: Boolean(config),
        successful_test_recorded: tested, ready_to_send: Boolean(config && tested && count > 0 && count <= 150),
      });
    }
    if (action === "test" && (typeof testDevice !== "string" || !uuid.test(testDevice))) {
      return reply(400, { error: "Enter a valid Android test device ID" });
    }
    const title = typeof input.title === "string" ? input.title.trim() : "";
    const body = typeof input.body === "string" ? input.body.trim() : "";
    if (!title || title.length > 100 || !body || body.length > 240) {
      return reply(400, { error: "Enter a title up to 100 characters and a message up to 240 characters" });
    }
    if (input.confirmation_phrase !== "SEND" || typeof input.request_id !== "string" || !uuid.test(input.request_id)) {
      return reply(400, { error: "Explicit send confirmation is required" });
    }
    if (!config) return reply(409, { error: "Android Firebase sender credentials are missing" });

    const token = await accessToken(config).catch(() => null);
    if (!token) return reply(409, { error: "The Firebase sender could not obtain an access token" });
    const claim = await db("rpc/beadlight_claim_android_push", "POST", {
      ...params, p_id: input.request_id, p_title: title, p_body: body, p_admin: admin,
    });
    if (!claim.ok || !claim.data) return reply(503, { error: "Could not reserve this send. No notifications were sent." });
    if (claim.data.reason) {
      const reasons: Record<string, string> = {
        duplicate: "This request has already been recorded. Check the send history.",
        test_required: "Complete a successful Android device test before broadcasting.",
        empty: "No eligible Android devices. Check app opt-in and challenge membership.",
        limit: "The audience exceeds the 150-device send limit.",
      };
      return reply(409, { error: reasons[claim.data.reason] ?? "Could not reserve this send" });
    }
    const devices: Device[] = claim.data.devices;
    const data: Record<string, string> = {
      title, body, audience: input.audience, campaign_id: input.request_id, is_test: String(action === "test"),
    };
    if (slug) data.challenge_slug = slug;
    const outcomes: Array<string | null> = Array(devices.length);
    let nextDevice = 0;
    await Promise.all(Array.from({ length: Math.min(16, devices.length) }, async () => {
      while (nextDevice < devices.length) {
        const index = nextDevice++;
        outcomes[index] = await send(config, token, devices[index], data);
      }
    }));
    const errors: Record<string, number> = {};
    outcomes.forEach((error) => { if (error) errors[error] = (errors[error] ?? 0) + 1; });
    const accepted = outcomes.filter((error) => error === null).length;
    const failed = devices.length - accepted;
    const status = failed === 0 ? "sent" : accepted > 0 ? "partial" : "failed";
    const saved = await db("beadlight_android_push_campaigns?id=eq." + input.request_id, "PATCH", {
      status, accepted_count: accepted, failed_count: failed,
    });
    return reply(200, { status, accepted_by_fcm: accepted, failed, errors, history_saved: saved.ok });
  } catch {
    return reply(503, { error: "Android push request could not be completed. Check the send history." });
  }
});
