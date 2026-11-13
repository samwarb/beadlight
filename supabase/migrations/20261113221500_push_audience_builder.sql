ALTER TABLE public.beadlight_push_devices
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS revenuecat_app_user_id text,
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS subscription_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_verified_at timestamptz;
UPDATE public.beadlight_push_devices SET first_seen_at = created_at WHERE first_seen_at > created_at;
ALTER TABLE public.beadlight_push_devices DROP CONSTRAINT IF EXISTS beadlight_push_subscription_status_valid;
ALTER TABLE public.beadlight_push_devices ADD CONSTRAINT beadlight_push_subscription_status_valid
  CHECK (subscription_status IN ('unknown','free','trial','monthly','annual','lifetime','expired'));
CREATE INDEX IF NOT EXISTS push_device_activity_idx ON public.beadlight_push_devices (last_active_at);

CREATE TABLE IF NOT EXISTS public.beadlight_push_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 90),
  audience text NOT NULL DEFAULT 'general' CHECK (audience IN ('general','challenge')),
  challenge_slug text,
  subscription_filter text NOT NULL DEFAULT 'any'
    CHECK (subscription_filter IN ('any','free','trial','monthly','annual','lifetime','expired')),
  min_app_age_days int NOT NULL DEFAULT 0 CHECK (min_app_age_days BETWEEN 0 AND 3650),
  inactive_min_days int NOT NULL DEFAULT 0 CHECK (inactive_min_days BETWEEN 0 AND 3650),
  inactive_max_days int CHECK (inactive_max_days BETWEEN 0 AND 3650),
  min_subscription_days int NOT NULL DEFAULT 0 CHECK (min_subscription_days BETWEEN 0 AND 3650),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_segment_audience_valid CHECK (
    (audience='general' AND challenge_slug IS NULL) OR
    (audience='challenge' AND challenge_slug IS NOT NULL AND challenge_slug ~ '^[a-z0-9][a-z0-9-]{0,63}$')),
  CONSTRAINT push_segment_activity_range CHECK (
    inactive_max_days IS NULL OR inactive_min_days <= inactive_max_days)
);
CREATE TABLE IF NOT EXISTS public.beadlight_push_deliveries (
  campaign_id uuid NOT NULL REFERENCES public.beadlight_push_campaigns(id) ON DELETE CASCADE,
  installation_id uuid NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(campaign_id,installation_id)
);
CREATE INDEX IF NOT EXISTS push_delivery_frequency_idx ON public.beadlight_push_deliveries (installation_id,sent_at DESC);
ALTER TABLE public.beadlight_push_campaigns ADD COLUMN IF NOT EXISTS segment_id uuid REFERENCES public.beadlight_push_segments(id) ON DELETE SET NULL;
ALTER TABLE public.beadlight_push_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beadlight_push_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.beadlight_push_segments FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.beadlight_push_deliveries FROM PUBLIC,anon,authenticated;

-- Server-only evaluator. Unknown/stale RevenueCat data is never considered a confirmed subscription.
CREATE OR REPLACE FUNCTION public.beadlight_push_segment_candidates(p_segment_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH segment AS (
    SELECT * FROM public.beadlight_push_segments WHERE id=p_segment_id
  ), eligible AS (
    SELECT d.installation_id,d.apns_token,d.apns_environment
    FROM segment s CROSS JOIN public.beadlight_push_devices d
    WHERE ((s.audience='general' AND d.general_announcements)
            OR (s.audience='challenge' AND d.challenge_updates AND EXISTS (
               SELECT 1 FROM public.challenge_participations p
               WHERE p.installation_id=d.installation_id AND p.challenge_slug=s.challenge_slug)))
      AND (s.min_app_age_days=0 OR d.first_seen_at <= now()-(s.min_app_age_days*interval '1 day'))
      AND (s.inactive_min_days=0 OR d.last_active_at <= now()-(s.inactive_min_days*interval '1 day'))
      AND (s.inactive_max_days IS NULL OR d.last_active_at >= now()-(s.inactive_max_days*interval '1 day'))
      AND (s.subscription_filter='any' OR
           (d.subscription_status=s.subscription_filter AND d.subscription_verified_at > now()-interval '7 days'))
      AND (s.min_subscription_days=0 OR
           (d.subscription_verified_at > now()-interval '7 days' AND
            d.subscription_started_at <= now()-(s.min_subscription_days*interval '1 day')))
      AND NOT EXISTS (
        SELECT 1 FROM public.beadlight_push_deliveries sent
          JOIN public.beadlight_push_campaigns c ON c.id=sent.campaign_id
        WHERE sent.installation_id=d.installation_id AND sent.sent_at>now()-interval '7 days'
          AND c.is_test=false AND c.audience='general')
  ), limited AS (SELECT * FROM eligible ORDER BY installation_id LIMIT 151)
  SELECT jsonb_build_object(
    'total_count',(SELECT count(*) FROM eligible),
    'devices',coalesce((SELECT jsonb_agg(to_jsonb(limited)) FROM limited),'[]'::jsonb)
  )
$$;
REVOKE ALL ON FUNCTION public.beadlight_push_segment_candidates(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.beadlight_push_segment_candidates(uuid) TO service_role;