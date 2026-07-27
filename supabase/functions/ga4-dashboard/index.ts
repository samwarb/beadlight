import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function base64Url(value: Uint8Array | string) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  bytes.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToBytes(pem: string) {
  const raw = atob(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, ""));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function accessToken(credentials: Record<string, string>) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ iss: credentials.client_email, scope: "https://www.googleapis.com/auth/analytics.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const key = await crypto.subtle.importKey("pkcs8", pemToBytes(credentials.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${payload}`));
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${payload}.${base64Url(new Uint8Array(signature))}` }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || "Google authentication failed");
  return data.access_token as string;
}

async function report(token: string, property: string, body: unknown) {
  const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Google Analytics report failed");
  return data;
}

function rows(data: any) { return (data.rows || []).map((row: any) => ({ dimensions: (row.dimensionValues || []).map((value: any) => value.value), metrics: (row.metricValues || []).map((value: any) => value.value) })); }

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = request.headers.get("Authorization");
    if (!auth) return json({ error: "Sign-in required" }, 401);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user?.email) return json({ error: "Sign-in required" }, 401);
    const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin_email", { check_email: user.email.toLowerCase() });
    if (adminError || isAdmin !== true) return json({ error: "Administrator access required" }, 403);

    const credentials = JSON.parse(Deno.env.get("GA4_SERVICE_ACCOUNT_JSON")!);
    const property = Deno.env.get("GA4_PROPERTY_ID")!;
    const token = await accessToken(credentials);
    const dateRanges = [{ startDate: "30daysAgo", endDate: "today" }];
    const [totals, sources, pages, locations, devices, clicks] = await Promise.all([
      report(token, property, { dateRanges, metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "screenPageViews" }, { name: "eventCount" }] }),
      report(token, property, { dateRanges, dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }], metrics: [{ name: "sessions" }, { name: "activeUsers" }], limit: 10, orderBys: [{ metric: { metricName: "sessions" }, desc: true }] }),
      report(token, property, { dateRanges, dimensions: [{ name: "pagePath" }], metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }], limit: 10, orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }] }),
      report(token, property, { dateRanges, dimensions: [{ name: "country" }, { name: "region" }], metrics: [{ name: "activeUsers" }], limit: 10, orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }] }),
      report(token, property, { dateRanges, dimensions: [{ name: "deviceCategory" }, { name: "operatingSystem" }], metrics: [{ name: "activeUsers" }], limit: 10, orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }] }),
      report(token, property, { dateRanges, dimensions: [{ name: "eventName" }], metrics: [{ name: "eventCount" }], dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: ["click", "ios_store_click", "android_store_click"] } } } })
    ]);
    return json({ range: "Last 30 days", totals: rows(totals)[0]?.metrics || [], sources: rows(sources), pages: rows(pages), locations: rows(locations), devices: rows(devices), clicks: rows(clicks) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Analytics unavailable" }, 500);
  }
});
