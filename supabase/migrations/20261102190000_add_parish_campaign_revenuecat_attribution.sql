-- Store only campaign attribution from production RevenueCat purchase events.
-- Customer identifiers and transaction details remain unset by the webhook.

alter table public.revenuecat_subscription_events
  add column if not exists campaign_id text,
  add column if not exists partner_id text,
  add column if not exists is_trial_conversion boolean;

create index if not exists revenuecat_subscription_events_campaign_time_idx
  on public.revenuecat_subscription_events (event_timestamp_at)
  where campaign_id is not null or partner_id is not null;

comment on column public.revenuecat_subscription_events.campaign_id is
  'Campaign attribution label copied from RevenueCat subscriber attributes.';
comment on column public.revenuecat_subscription_events.partner_id is
  'Parish or partner label copied from RevenueCat subscriber attributes.';
comment on column public.revenuecat_subscription_events.is_trial_conversion is
  'RevenueCat renewal event flag indicating conversion from a free trial.';

create or replace function public.get_parish_campaign_revenuecat(
  p_start_date date,
  p_end_date date,
  p_timezone text default 'Europe/London'
)
returns table (
  partner_id text,
  campaign_id text,
  trial_starts bigint,
  trial_to_paid bigint
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
    count(*) filter (
      where upper(e.event_type) = 'INITIAL_PURCHASE'
        and upper(coalesce(e.period_type, '')) = 'TRIAL'
    )::bigint as trial_starts,
    count(*) filter (
      where upper(e.event_type) = 'RENEWAL'
        and coalesce(e.is_trial_conversion, false)
    )::bigint as trial_to_paid
  from public.revenuecat_subscription_events e
  where upper(coalesce(e.environment, '')) = 'PRODUCTION'
    and coalesce(e.is_sandbox, false) = false
    and (e.partner_id is not null or e.campaign_id is not null)
    and (e.event_timestamp_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
  group by e.partner_id, e.campaign_id
  order by e.partner_id nulls last, e.campaign_id nulls last;
end;
$$;

revoke all on function public.get_parish_campaign_revenuecat(date, date, text) from public, anon;
grant execute on function public.get_parish_campaign_revenuecat(date, date, text) to authenticated;
