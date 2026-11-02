import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type AnalyticsEvent = {
  id: string;
  occurred_at: string;
  anonymous_device_id: string;
  app_session_id: string;
  event_type: string;
  mystery_set?: string | null;
  campaign_id?: string | null;
  partner_id?: string | null;
  step_id?: string | null;
  step_index?: number | null;
  prayer_kind?: string | null;
  decade_index?: number | null;
  app_version?: string | null;
  build_number?: string | null;
  platform?: string | null;
  is_premium_user?: boolean | null;
  source?: string | null;
  product_id?: string | null;
  offering_id?: string | null;
  is_trial_eligible?: boolean | null;
  onboarding_page_index?: number | null;
  event_schema_version?: number | null;
  flow_version?: string | null;
  onboarding_page_id?: string | null;
  onboarding_page_name?: string | null;
  paywall_exposure_id?: string | null;
  checkout_attempt_id?: string | null;
  auth_attempt_id?: string | null;
  outcome?: string | null;
  error_category?: string | null;
  entry_point?: string | null;
  account_action?: string | null;
  auth_provider?: string | null;
  prayer_session_id?: string | null;
  feature_id?: string | null;
  duration_ms?: number | null;
  event_environment?: string | null;
  trial_offer_available?: boolean | null;
  revenuecat_app_user_id?: string | null;
  purchase_error_code?: string | null;
  purchase_error_message?: string | null;
  store_error_code?: string | null;
  subscription_option_id?: string | null;
  purchase_environment?: string | null;
  purchase_period_type?: string | null;

};

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

const allowedEventTypes = new Set([
  "app_active",
  "rosary_started",
  "step_completed",
  "decade_completed",
  "rosary_completed",
  "paywall_viewed",
  "purchase_started",
  "purchase_succeeded",
  "purchase_cancelled",
  "purchase_failed",
  "purchase_pending",
  "onboarding_started",
  "onboarding_page_viewed",
  "onboarding_skipped",
  "onboarding_completed",
  "account_prompt_viewed",
  "account_started",
  "account_succeeded",
  "account_failed",
  "account_verification_started",
  "account_verification_succeeded",
  "account_verification_failed",
  "guided_mode_preview_started",
  "guided_mode_preview_completed",
  "audio_playback_started",
  "audio_playback_completed",
  "audio_playback_failed",
  "audio_listening_session_started",
  "audio_listening_session_ended",
  "hands_free_started",
  "hands_free_stopped",
  "reminder_permission_prompted",
  "reminder_permission_result",
  "reminder_scheduled",
  "reminder_opened",
  "prayer_session_started",
  "prayer_session_completed",
  "parish_install",
]);

const allowedMysterySets = new Set(["joyful", "luminous", "sorrowful", "glorious"]);
const allowedEnvironments = new Set(["production", "sandbox", "internal", "unknown"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const campaignValuePattern = /^[a-z0-9][a-z0-9._-]{0,79}$/;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return jsonResponse({ ok: true });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  if (!isAllowedPublishableKey(request.headers.get("apikey"))) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabaseURL = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = getSupabaseAdminKey();
  if (!supabaseURL || !serviceRoleKey) {
    return jsonResponse({ error: "Function is not configured" }, 500);
  }

  let body: { events?: AnalyticsEvent[] };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const events = body?.events;
  if (!Array.isArray(events) || events.length === 0 || events.length > 500) {
    return jsonResponse({ error: "Expected 1 to 500 events" }, 400);
  }

  const rows = events.map(normalizeEvent);
  if (rows.some((row) => row === null)) {
    return jsonResponse({ error: "Invalid event payload" }, 400);
  }

  const supabase = createClient(supabaseURL, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { error } = await supabase
    .from("prayer_analytics_events")
    .upsert(rows, { onConflict: "id", ignoreDuplicates: true });

  if (error) {
    return jsonResponse({ error: "Could not store analytics events" }, 500);
  }

  return jsonResponse({ accepted: rows.length, idempotency: "event_id" });
});

function normalizeEvent(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const event = input as AnalyticsEvent;
  if (!isUUID(event.id) || !isUUID(event.anonymous_device_id) || !isUUID(event.app_session_id)) {
    return null;
  }

  if (!allowedEventTypes.has(event.event_type)) return null;
  const isParishInstall = event.event_type === "parish_install";
  const campaignId = isParishInstall ? safeCampaignValue(event.campaign_id) : null;
  const partnerId = isParishInstall ? safeCampaignValue(event.partner_id) : null;
  if (isParishInstall) {
    if (event.platform !== "Android" || event.mystery_set != null || !campaignId || !partnerId) return null;
  } else if (!event.mystery_set || !allowedMysterySets.has(event.mystery_set)) {
    return null;
  }

  if (typeof event.occurred_at !== "string" || !event.occurred_at.trim()) return null;
  const occurredAt = new Date(event.occurred_at);
  if (Number.isNaN(occurredAt.getTime())) return null;
  if (!isOptionalUUID(event.paywall_exposure_id) || !isOptionalUUID(event.checkout_attempt_id) || !isOptionalUUID(event.auth_attempt_id) || !isOptionalUUID(event.prayer_session_id)) {
    return null;
  }

  if (!isOptionalNonNegativeInteger(event.step_index) || !isOptionalIntegerInRange(event.decade_index, 0, 4)) {
    return null;
  }
  if (!isOptionalIntegerInRange(event.onboarding_page_index, 0, 9)) return null;
  if (!isOptionalNonNegativeInteger(event.duration_ms) || (event.duration_ms ?? 0) > 86_400_000) return null;

  const schemaVersion = event.event_schema_version ?? 1;
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 99) return null;

  const environment = limitString(event.event_environment, 20) ?? "unknown";
  if (!allowedEnvironments.has(environment)) return null;
  if (event.purchase_environment != null && !["production", "sandbox"].includes(event.purchase_environment)) return null;
  if (event.purchase_period_type != null && !["trial", "intro", "normal", "prepaid"].includes(event.purchase_period_type)) return null;

  return {
    id: event.id,
    occurred_at: occurredAt.toISOString(),
    anonymous_device_id: event.anonymous_device_id,
    app_session_id: event.app_session_id,
    event_type: event.event_type,
    mystery_set: isParishInstall ? null : event.mystery_set,
    campaign_id: campaignId,
    partner_id: partnerId,
    step_id: limitString(event.step_id, 120),
    step_index: event.step_index ?? null,
    prayer_kind: limitString(event.prayer_kind, 80),
    decade_index: event.decade_index ?? null,
    app_version: limitString(event.app_version, 40),
    build_number: limitString(event.build_number, 40),
    platform: limitString(event.platform, 20) ?? "unknown",
    is_premium_user: event.is_premium_user === true,
    source: limitString(event.source, 80),
    product_id: limitString(event.product_id, 160),
    offering_id: limitString(event.offering_id, 160),
    is_trial_eligible: typeof event.is_trial_eligible === "boolean" ? event.is_trial_eligible : null,
    onboarding_page_index: event.onboarding_page_index ?? null,
    event_schema_version: schemaVersion,
    flow_version: limitString(event.flow_version, 80),
    onboarding_page_id: limitString(event.onboarding_page_id, 80),
    onboarding_page_name: limitString(event.onboarding_page_name, 120),
    paywall_exposure_id: event.paywall_exposure_id ?? null,
    checkout_attempt_id: event.checkout_attempt_id ?? null,
    auth_attempt_id: event.auth_attempt_id ?? null,
    outcome: limitString(event.outcome, 40),
    error_category: limitString(event.error_category, 80),
    entry_point: limitString(event.entry_point, 80),
    account_action: limitString(event.account_action, 40),
    auth_provider: limitString(event.auth_provider, 40),
    prayer_session_id: event.prayer_session_id ?? null,
    feature_id: limitString(event.feature_id, 80),
    duration_ms: event.duration_ms ?? null,
    event_environment: environment,
    trial_offer_available: typeof event.trial_offer_available === "boolean" ? event.trial_offer_available : null,
    revenuecat_app_user_id: limitString(event.revenuecat_app_user_id, 160),
    purchase_error_code: limitString(event.purchase_error_code, 80),
    purchase_error_message: limitString(event.purchase_error_message, 300),
    store_error_code: limitString(event.store_error_code, 80),
    subscription_option_id: limitString(event.subscription_option_id, 160),
    purchase_environment: limitString(event.purchase_environment, 20),
    purchase_period_type: limitString(event.purchase_period_type, 20),

  };
}

function isAllowedPublishableKey(value: string | null): boolean {
  if (!value) return false;
  if (Deno.env.get("SUPABASE_ANON_KEY") === value) return true;
  if (Deno.env.get("SUPABASE_PUBLISHABLE_KEY") === value) return true;

  const publishableKeysJSON = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (!publishableKeysJSON) return false;
  try {
    const publishableKeys = JSON.parse(publishableKeysJSON) as Record<string, string>;
    return Object.values(publishableKeys).includes(value);
  } catch {
    return false;
  }
}

function getSupabaseAdminKey(): string | null {
  const legacyServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacyServiceRoleKey) return legacyServiceRoleKey;
  const secretKey = Deno.env.get("SUPABASE_SECRET_KEY");
  if (secretKey) return secretKey;

  const secretKeysJSON = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!secretKeysJSON) return null;
  try {
    const secretKeys = JSON.parse(secretKeysJSON) as Record<string, string>;
    return secretKeys.default ?? Object.values(secretKeys)[0] ?? null;
  } catch {
    return null;
  }
}

function isUUID(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function safeCampaignValue(value: unknown): string | null {
  return typeof value === "string" && campaignValuePattern.test(value) ? value : null;
}

function isOptionalUUID(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || isUUID(value);
}

function isOptionalNonNegativeInteger(value: unknown): value is number | null | undefined {
  return value === null || value === undefined || (Number.isInteger(value) && Number(value) >= 0);
}

function isOptionalIntegerInRange(value: unknown, minimum: number, maximum: number): value is number | null | undefined {
  return value === null || value === undefined || (Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum);
}

function limitString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
