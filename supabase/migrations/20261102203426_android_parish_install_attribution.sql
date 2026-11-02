-- Store anonymous, first-open events attributed through Google Play's install referrer.
-- No user identifiers beyond the existing anonymous app device/session IDs are added.

alter table public.prayer_analytics_events
  add column if not exists campaign_id text,
  add column if not exists partner_id text,
  alter column mystery_set drop not null;

alter table public.prayer_analytics_events
  drop constraint if exists prayer_analytics_events_event_type_check;

alter table public.prayer_analytics_events
  add constraint prayer_analytics_events_event_type_check
  check (event_type = any (array[
    'app_active',
    'rosary_started',
    'step_completed',
    'decade_completed',
    'rosary_completed',
    'paywall_viewed',
    'purchase_started',
    'purchase_succeeded',
    'purchase_cancelled',
    'purchase_failed',
    'purchase_pending',
    'onboarding_started',
    'onboarding_page_viewed',
    'onboarding_skipped',
    'onboarding_completed',
    'account_prompt_viewed',
    'account_started',
    'account_succeeded',
    'account_failed',
    'account_verification_started',
    'account_verification_succeeded',
    'account_verification_failed',
    'guided_mode_preview_started',
    'guided_mode_preview_completed',
    'audio_playback_started',
    'audio_playback_completed',
    'audio_playback_failed',
    'audio_listening_session_started',
    'audio_listening_session_ended',
    'hands_free_started',
    'hands_free_stopped',
    'reminder_permission_prompted',
    'reminder_permission_result',
    'reminder_scheduled',
    'reminder_opened',
    'prayer_session_started',
    'prayer_session_completed',
    'parish_install'
  ]::text[]));

comment on column public.prayer_analytics_events.campaign_id is
  'Campaign label from Google Play Install Referrer for parish_install events.';
comment on column public.prayer_analytics_events.partner_id is
  'Parish or partner label from Google Play Install Referrer for parish_install events.';
comment on column public.prayer_analytics_events.mystery_set is
  'Rosary mystery for prayer events; null for non-prayer events such as parish_install.';

create index if not exists prayer_analytics_events_parish_install_idx
  on public.prayer_analytics_events (partner_id, campaign_id, occurred_at)
  where event_type = 'parish_install'
    and platform = 'Android'
    and event_environment = 'production'
    and partner_id is not null
    and campaign_id is not null;

create or replace function public.get_parish_campaign_android_installs(
  p_start_date date,
  p_end_date date,
  p_timezone text default 'Europe/London'
)
returns table (
  partner_id text,
  campaign_id text,
  android_installs bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester_email text;
  reporting_timezone text;
  safe_start_date date;
  safe_end_date date;
  local_today date;
begin
  requester_email := lower(auth.jwt() ->> 'email');
  if requester_email is null or not public.is_admin_email(requester_email) then
    raise exception 'Not authorized to view parish campaign analytics';
  end if;

  reporting_timezone := coalesce(nullif(trim(p_timezone), ''), 'Europe/London');
  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = reporting_timezone
  ) then
    reporting_timezone := 'Europe/London';
  end if;

  local_today := (now() at time zone reporting_timezone)::date;
  safe_end_date := least(coalesce(p_end_date, local_today), local_today);
  safe_start_date := coalesce(p_start_date, safe_end_date - 29);
  if safe_start_date > safe_end_date then
    raise exception 'Invalid parish campaign date range';
  end if;

  return query
  select
    e.partner_id,
    e.campaign_id,
    count(*)::bigint as android_installs
  from public.prayer_analytics_events e
  where e.event_type = 'parish_install'
    and e.platform = 'Android'
    and e.event_environment = 'production'
    and e.partner_id is not null
    and e.campaign_id is not null
    and (e.occurred_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
  group by e.partner_id, e.campaign_id
  order by e.partner_id, e.campaign_id;
end;
$$;

revoke all on function public.get_parish_campaign_android_installs(date, date, text) from public, anon;
grant execute on function public.get_parish_campaign_android_installs(date, date, text) to authenticated;
