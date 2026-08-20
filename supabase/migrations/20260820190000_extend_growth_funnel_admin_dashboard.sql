-- Extend the authenticated growth dashboard with range totals and attribution.
-- The underlying analytics table remains service-only; the admin RPC is the
-- only browser-facing read path.
-- Apply after 20260820120000_add_onboarding_account_journey_analytics.sql.

create or replace function public.get_growth_funnel_dashboard(days_back integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    requester_email text;
    safe_days integer := greatest(1, least(coalesce(days_back, 30), 365));
begin
    requester_email := lower(auth.jwt() ->> 'email');

    if requester_email is null or not public.is_admin_email(requester_email) then
        raise exception 'Not authorized to view growth analytics';
    end if;

    return jsonb_build_object(
        'summary', jsonb_build_object(
            'active_devices', (
                select count(distinct anonymous_device_id)
                from public.prayer_analytics_events
                where occurred_at::date >= current_date - (safe_days - 1)
                  and event_type = 'app_active'
            ),
            'onboarding_starters', (
                select count(distinct anonymous_device_id)
                from public.prayer_analytics_events
                where occurred_at::date >= current_date - (safe_days - 1)
                  and event_type = 'onboarding_started'
            ),
            'onboarding_completers', (
                select count(distinct anonymous_device_id)
                from public.prayer_analytics_events
                where occurred_at::date >= current_date - (safe_days - 1)
                  and event_type = 'onboarding_completed'
            ),
            'onboarding_skippers', (
                select count(distinct anonymous_device_id)
                from public.prayer_analytics_events
                where occurred_at::date >= current_date - (safe_days - 1)
                  and event_type = 'onboarding_skipped'
            ),
            'paywall_viewers', (
                select count(distinct anonymous_device_id)
                from public.prayer_analytics_events
                where occurred_at::date >= current_date - (safe_days - 1)
                  and event_type = 'paywall_viewed'
            ),
            'purchase_starters', (
                select count(*)
                from public.prayer_analytics_events
                where occurred_at::date >= current_date - (safe_days - 1)
                  and event_type = 'purchase_started'
            ),
            'purchase_converters', (
                select count(*)
                from public.prayer_analytics_events
                where occurred_at::date >= current_date - (safe_days - 1)
                  and event_type = 'purchase_succeeded'
            ),
            'purchase_cancellations', (
                select count(*)
                from public.prayer_analytics_events
                where occurred_at::date >= current_date - (safe_days - 1)
                  and event_type = 'purchase_cancelled'
            ),
            'purchase_failures', (
                select count(*)
                from public.prayer_analytics_events
                where occurred_at::date >= current_date - (safe_days - 1)
                  and event_type = 'purchase_failed'
            ),
            'account_prompt_viewers', (
                select count(distinct anonymous_device_id)
                from public.prayer_analytics_events
                where occurred_at::date >= current_date - (safe_days - 1)
                  and event_type = 'account_prompt_viewed'
            ),
            'account_starters', (
                select count(distinct anonymous_device_id)
                from public.prayer_analytics_events
                where occurred_at::date >= current_date - (safe_days - 1)
                  and event_type = 'account_started'
            ),
            'account_successes', (
                select count(distinct anonymous_device_id)
                from public.prayer_analytics_events
                where occurred_at::date >= current_date - (safe_days - 1)
                  and event_type = 'account_succeeded'
            ),
            'account_failures', (
                select count(distinct anonymous_device_id)
                from public.prayer_analytics_events
                where occurred_at::date >= current_date - (safe_days - 1)
                  and event_type = 'account_failed'
            ),
            'trial_eligible_starts', (
                select count(*)
                from public.prayer_analytics_events
                where occurred_at::date >= current_date - (safe_days - 1)
                  and event_type = 'purchase_started'
                  and is_trial_eligible is true
            ),
            'trial_eligible_successes', (
                select count(*)
                from public.prayer_analytics_events
                where occurred_at::date >= current_date - (safe_days - 1)
                  and event_type = 'purchase_succeeded'
                  and is_trial_eligible is true
            ),
            'trial_ineligible_starts', (
                select count(*)
                from public.prayer_analytics_events
                where occurred_at::date >= current_date - (safe_days - 1)
                  and event_type = 'purchase_started'
                  and is_trial_eligible is false
            ),
            'trial_ineligible_successes', (
                select count(*)
                from public.prayer_analytics_events
                where occurred_at::date >= current_date - (safe_days - 1)
                  and event_type = 'purchase_succeeded'
                  and is_trial_eligible is false
            ),
            'trial_unknown_starts', (
                select count(*)
                from public.prayer_analytics_events
                where occurred_at::date >= current_date - (safe_days - 1)
                  and event_type = 'purchase_started'
                  and is_trial_eligible is null
            ),
            'trial_unknown_successes', (
                select count(*)
                from public.prayer_analytics_events
                where occurred_at::date >= current_date - (safe_days - 1)
                  and event_type = 'purchase_succeeded'
                  and is_trial_eligible is null
            )
        ),
        'freshness', jsonb_build_object(
            'latest_received_at', (
                select max(received_at)
                from public.prayer_analytics_events
                where occurred_at::date >= current_date - (safe_days - 1)
            )
        ),
        'daily', coalesce(
            (
                select jsonb_agg(to_jsonb(d) order by d.activity_date desc, d.platform)
                from public.growth_funnel_daily_counts d
                where d.activity_date >= current_date - (safe_days - 1)
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
                    where occurred_at::date >= current_date - (safe_days - 1)
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
                where p.activity_date >= current_date - (safe_days - 1)
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
                    where occurred_at::date >= current_date - (safe_days - 1)
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
                    where occurred_at::date >= current_date - (safe_days - 1)
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

revoke all on function public.get_growth_funnel_dashboard(integer) from public;
revoke all on function public.get_growth_funnel_dashboard(integer) from anon;
grant execute on function public.get_growth_funnel_dashboard(integer) to authenticated;
