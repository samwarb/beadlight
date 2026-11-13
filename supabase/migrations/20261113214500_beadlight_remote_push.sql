-- Beadlight remotely sent notifications. Private data: APNs device tokens.
-- Server writes only; neither anon nor authenticated users can query these tables.
create table if not exists public.beadlight_push_devices (
  installation_id uuid primary key,
  registration_secret_hash text not null check (registration_secret_hash ~ '^[0-9a-f]{64}$'),
  apns_token text not null unique check (apns_token ~ '^[0-9a-f]{64,256}$'),
  apns_environment text not null check (apns_environment in ('sandbox','production')),
  challenge_updates boolean not null default false,
  general_announcements boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists beadlight_push_devices_categories
on public.beadlight_push_devices (challenge_updates, general_announcements);
alter table public.beadlight_push_devices enable row level security;
revoke all on public.beadlight_push_devices from public, anon, authenticated;

create table if not exists public.beadlight_push_campaigns (
  id uuid primary key default gen_random_uuid(),
  audience text not null check (audience in ('challenge','general')),
  challenge_slug text,
  title text not null check (char_length(title) between 1 and 100),
  body text not null check (char_length(body) between 1 and 240),
  is_test boolean not null default false,
  intended_count integer not null default 0,
  delivered_count integer not null default 0,
  failed_count integer not null default 0,
  status text not null default 'sending' check (status in ('sending','sent','partial','failed')),
  created_by text not null,
  sent_at timestamptz not null default now(),
  constraint push_campaign_target_valid check (
    (audience = 'challenge' and challenge_slug is not null) or
    (audience = 'general' and challenge_slug is null)
  )
);
create index if not exists beadlight_push_campaigns_sent_at
on public.beadlight_push_campaigns (sent_at desc);
alter table public.beadlight_push_campaigns enable row level security;
revoke all on public.beadlight_push_campaigns from public, anon, authenticated;

comment on table public.beadlight_push_devices is
'Pseudonymous APNs tokens. Server-only, with separate challenge and promotional opt-ins.';
comment on table public.beadlight_push_campaigns is
'Aggregate send attempts, not per-user notification history. Admin-only Edge Function access.';
