import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

const ALLOWED_PRODUCTION_APPS = new Set([
  "app0bda452d8d", // Beadlight (Play Store)
  "app5cac88adf6", // Beadlight (App Store)
]);
const ALLOWED_EVENT_TYPES = new Set(["INITIAL_PURCHASE", "RENEWAL"]);

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function safeCampaignAttribute(attributes: Record<string, unknown>, name: string) {
  const raw = attributes[name] ?? attributes[`$${name}`];
  const value = raw && typeof raw === "object" && "value" in raw
    ? (raw as { value?: unknown }).value
    : raw;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,79}$/.test(normalized) ? normalized : null;
}

function isoTimestamp(value: unknown) {
  const milliseconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null;
  try {
    return new Date(milliseconds).toISOString();
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expectedToken = Deno.env.get("RC_PARISH_WEBHOOK_TOKEN");
  if (!expectedToken) return json({ error: "Webhook authentication is not configured" }, 503);
  const authorization = request.headers.get("Authorization") || "";
  if (!constantTimeEqual(authorization, `Bearer ${expectedToken}`)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const contentLength = Number(request.headers.get("Content-Length") || "0");
  if (contentLength > 1_000_000) return json({ error: "Payload too large" }, 413);
  const rawBody = await request.text();
  if (rawBody.length > 1_000_000) return json({ error: "Payload too large" }, 413);

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const event = payload?.event as Record<string, unknown> | undefined;
  if (!event || typeof event !== "object") return json({ received: true, ignored: true });
  const eventType = String(event.type || "").toUpperCase();
  const appId = String(event.app_id || "");
  const environment = String(event.environment || "").toUpperCase();
  if (
    !ALLOWED_EVENT_TYPES.has(eventType)
    || !ALLOWED_PRODUCTION_APPS.has(appId)
    || environment !== "PRODUCTION"
    || event.is_sandbox === true
  ) return json({ received: true, ignored: true });

  const eventId = typeof event.id === "string" ? event.id.trim() : "";
  const eventTimestamp = isoTimestamp(event.event_timestamp_ms);
  if (!eventId || eventId.length > 255 || !eventTimestamp) {
    return json({ error: "RevenueCat event is missing a valid id or timestamp" }, 400);
  }

  const attributes = event.subscriber_attributes && typeof event.subscriber_attributes === "object"
    ? event.subscriber_attributes as Record<string, unknown>
    : {};
  const campaignId = safeCampaignAttribute(attributes, "campaign_id");
  const partnerId = safeCampaignAttribute(attributes, "partner_id");
  if (!campaignId && !partnerId) return json({ received: true, attributed: false });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Event storage is not configured" }, 503);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await supabase.from("revenuecat_subscription_events").upsert({
    event_id: eventId,
    event_type: eventType,
    app_id: appId,
    environment,
    period_type: typeof event.period_type === "string" ? event.period_type.toUpperCase().slice(0, 30) : null,
    campaign_id: campaignId,
    partner_id: partnerId,
    is_trial_conversion: event.is_trial_conversion === true,
    is_sandbox: false,
    event_timestamp_at: eventTimestamp,
    purchased_at: isoTimestamp(event.purchased_at_ms),
  }, { onConflict: "event_id", ignoreDuplicates: true });

  if (error) return json({ error: "Could not store attributed RevenueCat event" }, 503);
  return json({ received: true, attributed: true });
});
