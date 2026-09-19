-- Date-aware overload for the prayer analytics dashboard.
-- The existing no-argument and timezone-only overloads remain available.

create or replace function public.get_prayer_analytics_dashboard(
  p_start_date date,
  p_end_date date,
  p_timezone text default 'UTC'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_email text;
  reporting_timezone text;
  safe_start_date date;
  safe_end_date date;
  local_today date;
  week_start_local timestamp without time zone;
  week_end_local timestamp without time zone;
begin
  requester_email := lower(auth.jwt() ->> 'email');

  if requester_email is null or not public.is_admin_email(requester_email) then
    raise exception 'Not authorized to view prayer analytics';
  end if;

  reporting_timezone := coalesce(nullif(trim(p_timezone), ''), 'UTC');

  if not exists (
    select 1
    from pg_catalog.pg_timezone_names
    where name = reporting_timezone
  ) then
    reporting_timezone := 'UTC';
  end if;

  local_today := (now() at time zone reporting_timezone)::date;
  safe_end_date := least(coalesce(p_end_date, local_today), local_today);
  safe_start_date := coalesce(p_start_date, safe_end_date - 29);

  if safe_start_date > safe_end_date then
    raise exception 'Invalid analytics date range';
  end if;

  week_start_local := date_trunc('week', now() at time zone reporting_timezone);
  week_end_local := week_start_local + interval '7 days';

  return (
    with combined as (
      select
        completed_at,
        mystery_set,
        prayer_count,
        rosary_count,
        user_id,
        null::uuid as anonymous_device_id,
        'account'::text as source
      from public.prayer_sessions
      where (completed_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date

      union all

      select
        completed_at,
        mystery_set,
        prayer_count,
        rosary_count,
        null::uuid as user_id,
        anonymous_device_id,
        'anonymous'::text as source
      from public.anonymous_prayer_sessions
      where (completed_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
    ),
    totals as (
      select
        coalesce(sum(prayer_count), 0)::integer as completed_steps,
        coalesce((sum(prayer_count) / 10), 0)::integer as completed_decades,
        coalesce(sum(rosary_count), 0)::integer as completed_rosaries,
        coalesce(sum(prayer_count), 0)::integer as prayers_in_range,
        coalesce(sum(rosary_count), 0)::integer as rosaries_in_range,
        count(distinct anonymous_device_id) filter (where source = 'anonymous')::integer as anonymous_devices,
        count(distinct user_id) filter (where source = 'account')::integer as account_users,
        coalesce(
          sum(prayer_count) filter (
            where (completed_at at time zone reporting_timezone) >= week_start_local
              and (completed_at at time zone reporting_timezone) < week_end_local
          ),
          0
        )::integer as prayers_this_week,
        coalesce(
          sum(rosary_count) filter (
            where (completed_at at time zone reporting_timezone) >= week_start_local
              and (completed_at at time zone reporting_timezone) < week_end_local
          ),
          0
        )::integer as rosaries_this_week
      from combined
    ),
    daily as (
      select
        (completed_at at time zone reporting_timezone)::date as prayer_date,
        coalesce(sum(prayer_count), 0)::integer as completed_steps,
        coalesce((sum(prayer_count) / 10), 0)::integer as completed_decades,
        coalesce(sum(rosary_count), 0)::integer as completed_rosaries,
        count(distinct anonymous_device_id) filter (where source = 'anonymous')::integer as anonymous_devices,
        count(distinct user_id) filter (where source = 'account')::integer as account_users
      from combined
      group by (completed_at at time zone reporting_timezone)::date
      order by prayer_date desc
    ),
    mysteries as (
      select
        coalesce(mystery_set, 'unknown') as mystery_set,
        coalesce(sum(prayer_count), 0)::integer as completed_steps,
        coalesce((sum(prayer_count) / 10), 0)::integer as completed_decades,
        coalesce(sum(rosary_count), 0)::integer as completed_rosaries
      from combined
      group by coalesce(mystery_set, 'unknown')
      order by mystery_set
    )
    select jsonb_build_object(
      'reporting_timezone', reporting_timezone,
      'range_start', safe_start_date,
      'range_end', safe_end_date,
      'totals', coalesce((select to_jsonb(t) from totals t), '{}'::jsonb),
      'daily', coalesce((select jsonb_agg(to_jsonb(d) order by d.prayer_date desc) from daily d), '[]'::jsonb),
      'mysteries', coalesce((select jsonb_agg(to_jsonb(m) order by m.mystery_set) from mysteries m), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.get_prayer_analytics_dashboard(date, date, text) from public;
revoke all on function public.get_prayer_analytics_dashboard(date, date, text) from anon;
grant execute on function public.get_prayer_analytics_dashboard(date, date, text) to authenticated;


-- Add date-range overloads for the admin analytics dashboards.
-- The underlying analytics tables remain service-only; the admin RPCs are the
-- only browser-facing read paths.
-- Keep the existing day-count overloads available for backwards compatibility.

create or replace function public.get_growth_funnel_dashboard(p_start_date date, p_end_date date, p_timezone text default 'UTC')
returns jsonb
language plpgsql
security definer
set search_path = public
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
        raise exception 'Not authorized to view growth analytics';
    end if;

    reporting_timezone := coalesce(nullif(trim(p_timezone), ''), 'UTC');

    if not exists (
        select 1
        from pg_catalog.pg_timezone_names
        where name = reporting_timezone
    ) then
        reporting_timezone := 'UTC';
    end if;

    local_today := (now() at time zone reporting_timezone)::date;
    safe_end_date := least(coalesce(p_end_date, local_today), local_today);
    safe_start_date := coalesce(p_start_date, safe_end_date - 29);

    if safe_start_date > safe_end_date then
        raise exception 'Invalid analytics date range';
    end if;

    return jsonb_build_object(
        'summary', jsonb_build_object(
            'active_devices', (
                select count(distinct anonymous_device_id)
                from public.prayer_analytics_events
                where (occurred_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
                  and event_type = 'app_active'
            ),
            'onboarding_starters', (
                select count(distinct anonymous_device_id)
                from public.prayer_analytics_events
                where (occurred_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
                  and event_type = 'onboarding_started'
            ),
            'onboarding_completers', (
                select count(distinct anonymous_device_id)
                from public.prayer_analytics_events
                where (occurred_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
                  and event_type = 'onboarding_completed'
            ),
            'onboarding_skippers', (
                select count(distinct anonymous_device_id)
                from public.prayer_analytics_events
                where (occurred_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
                  and event_type = 'onboarding_skipped'
            ),
            'paywall_viewers', (
                select count(distinct anonymous_device_id)
                from public.prayer_analytics_events
                where (occurred_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
                  and event_type = 'paywall_viewed'
            ),
            'purchase_starters', (
                select count(*)
                from public.prayer_analytics_events
                where (occurred_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
                  and event_type = 'purchase_started'
            ),
            'purchase_converters', (
                select count(*)
                from public.prayer_analytics_events
                where (occurred_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
                  and event_type = 'purchase_succeeded'
            ),
            'purchase_cancellations', (
                select count(*)
                from public.prayer_analytics_events
                where (occurred_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
                  and event_type = 'purchase_cancelled'
            ),
            'purchase_failures', (
                select count(*)
                from public.prayer_analytics_events
                where (occurred_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
                  and event_type = 'purchase_failed'
            ),
            'account_prompt_viewers', (
                select count(distinct anonymous_device_id)
                from public.prayer_analytics_events
                where (occurred_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
                  and event_type = 'account_prompt_viewed'
            ),
            'account_starters', (
                select count(distinct anonymous_device_id)
                from public.prayer_analytics_events
                where (occurred_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
                  and event_type = 'account_started'
            ),
            'account_successes', (
                select count(distinct anonymous_device_id)
                from public.prayer_analytics_events
                where (occurred_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
                  and event_type = 'account_succeeded'
            ),
            'account_failures', (
                select count(distinct anonymous_device_id)
                from public.prayer_analytics_events
                where (occurred_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
                  and event_type = 'account_failed'
            ),
            'trial_eligible_starts', (
                select count(*)
                from public.prayer_analytics_events
                where (occurred_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
                  and event_type = 'purchase_started'
                  and is_trial_eligible is true
            ),
            'trial_eligible_successes', (
                select count(*)
                from public.prayer_analytics_events
                where (occurred_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
                  and event_type = 'purchase_succeeded'
                  and is_trial_eligible is true
            ),
            'trial_ineligible_starts', (
                select count(*)
                from public.prayer_analytics_events
                where (occurred_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
                  and event_type = 'purchase_started'
                  and is_trial_eligible is false
            ),
            'trial_ineligible_successes', (
                select count(*)
                from public.prayer_analytics_events
                where (occurred_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
                  and event_type = 'purchase_succeeded'
                  and is_trial_eligible is false
            ),
            'trial_unknown_starts', (
                select count(*)
                from public.prayer_analytics_events
                where (occurred_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
                  and event_type = 'purchase_started'
                  and is_trial_eligible is null
            ),
            'trial_unknown_successes', (
                select count(*)
                from public.prayer_analytics_events
                where (occurred_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
                  and event_type = 'purchase_succeeded'
                  and is_trial_eligible is null
            )
        ),
        'range_start', safe_start_date,
        'range_end', safe_end_date,
        'freshness', jsonb_build_object(
            'latest_received_at', (
                select max(received_at)
                from public.prayer_analytics_events
                where (occurred_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
            )
        ),
        'daily', coalesce(
            (
                select jsonb_agg(to_jsonb(d) order by d.activity_date desc, d.platform)
                from public.growth_funnel_daily_counts d
                where d.activity_date between safe_start_date and safe_end_date
            ),
            '[]'::jsonb
        ),
        'products', coalesce(
            (
                select jsonb_agg(to_jsonb(p) order by p.purchase_starts desc, p.product_id, p.platform)
                from (
                    select
                        coalesce(product_id, 'unknown') as product_id,
                        coalesce(platform, 'unknown') as platform,
                        count(*) filter (where event_type = 'purchase_started') as purchase_starts,
                        count(*) filter (where event_type = 'purchase_succeeded') as purchase_successes,
                        count(*) filter (where event_type = 'purchase_cancelled') as purchase_cancellations,
                        count(*) filter (where event_type = 'purchase_failed') as purchase_failures,
                        count(*) filter (where event_type = 'purchase_started' and is_trial_eligible is true) as trial_eligible_starts,
                        count(*) filter (where event_type = 'purchase_succeeded' and is_trial_eligible is true) as trial_eligible_successes,
                        count(*) filter (where event_type = 'purchase_started' and is_trial_eligible is false) as trial_ineligible_starts,
                        count(*) filter (where event_type = 'purchase_succeeded' and is_trial_eligible is false) as trial_ineligible_successes,
                        count(*) filter (where event_type = 'purchase_started' and is_trial_eligible is null) as trial_unknown_starts,
                        count(*) filter (where event_type = 'purchase_succeeded' and is_trial_eligible is null) as trial_unknown_successes
                    from public.prayer_analytics_events
                    where (occurred_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
                      and event_type like 'purchase_%'
                    group by coalesce(product_id, 'unknown'), coalesce(platform, 'unknown')
                ) p
            ),
            '[]'::jsonb
        ),
        'onboarding_pages', coalesce(
            (
                select jsonb_agg(
                    to_jsonb(p)
                    order by p.activity_date desc, p.platform, p.onboarding_page_index
                )
                from public.growth_funnel_onboarding_page_counts p
                where p.activity_date between safe_start_date and safe_end_date
            ),
            '[]'::jsonb
        ),
        'onboarding_page_totals', coalesce(
            (
                select jsonb_agg(to_jsonb(p) order by p.platform, p.onboarding_page_index)
                from (
                    select
                        coalesce(platform, 'unknown') as platform,
                        onboarding_page_index,
                        count(distinct anonymous_device_id) as page_viewers,
                        count(*) as page_view_events
                    from public.prayer_analytics_events
                    where (occurred_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
                      and event_type = 'onboarding_page_viewed'
                      and onboarding_page_index is not null
                    group by coalesce(platform, 'unknown'), onboarding_page_index
                ) p
            ),
            '[]'::jsonb
        ),
        'sources', coalesce(
            (
                select jsonb_agg(to_jsonb(s) order by s.paywall_viewers desc, s.source, s.platform)
                from (
                    select
                        coalesce(source, 'unknown') as source,
                        coalesce(platform, 'unknown') as platform,
                        count(distinct anonymous_device_id) filter (where event_type = 'paywall_viewed') as paywall_viewers,
                        count(*) filter (where event_type = 'purchase_started') as purchase_starts,
                        count(*) filter (where event_type = 'purchase_succeeded') as purchase_successes,
                        count(*) filter (where event_type = 'purchase_cancelled') as purchase_cancellations,
                        count(*) filter (where event_type = 'purchase_failed') as purchase_failures,
                        count(distinct anonymous_device_id) filter (where event_type = 'account_prompt_viewed') as account_prompt_viewers,
                        count(distinct anonymous_device_id) filter (where event_type = 'account_started') as account_starters,
                        count(distinct anonymous_device_id) filter (where event_type = 'account_succeeded') as account_successes,
                        count(distinct anonymous_device_id) filter (where event_type = 'account_failed') as account_failures
                    from public.prayer_analytics_events
                    where (occurred_at at time zone reporting_timezone)::date between safe_start_date and safe_end_date
                      and event_type in (
                          'paywall_viewed',
                          'purchase_started',
                          'purchase_succeeded',
                          'purchase_cancelled',
                          'purchase_failed',
                          'account_prompt_viewed',
                          'account_started',
                          'account_succeeded',
                          'account_failed'
                      )
                    group by coalesce(source, 'unknown'), coalesce(platform, 'unknown')
                ) s
            ),
            '[]'::jsonb
        )
    );
end;
$$;

revoke all on function public.get_growth_funnel_dashboard(date, date, text) from public;
revoke all on function public.get_growth_funnel_dashboard(date, date, text) from anon;
grant execute on function public.get_growth_funnel_dashboard(date, date, text) to authenticated;
