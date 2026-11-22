create table public.beadlight_android_push_devices (
    installation_id uuid primary key,
    registration_secret_hash text not null check (registration_secret_hash ~ '^[a-f0-9]{64}$'),
    fcm_token text not null unique check (char_length(fcm_token) between 20 and 4096),
    revision bigint not null check (revision > 0),
    challenge_updates boolean not null,
    general_announcements boolean not null,
    last_general_attempt_at timestamptz
);

create table public.beadlight_android_push_campaigns (
    id uuid primary key,
    audience text not null check (audience in ('challenge', 'general')),
    challenge_slug text,
    title text not null check (char_length(title) between 1 and 100),
    body text not null check (char_length(body) between 1 and 240),
    is_test boolean not null,
    intended_count integer not null check (intended_count between 1 and 150),
    accepted_count integer not null default 0,
    failed_count integer not null default 0,
    status text not null default 'sending' check (status in ('sending', 'sent', 'partial', 'failed')),
    created_by uuid not null,
    sent_at timestamptz not null default now(),
    check ((audience = 'challenge') = (challenge_slug is not null))
);

alter table public.beadlight_android_push_devices enable row level security;
alter table public.beadlight_android_push_campaigns enable row level security;
revoke all on public.beadlight_android_push_devices, public.beadlight_android_push_campaigns
    from public, anon, authenticated;
grant select, insert, update on public.beadlight_android_push_devices, public.beadlight_android_push_campaigns
    to service_role;

create function public.beadlight_android_push_candidates(
    p_audience text, p_slug text, p_test_device uuid
)
returns table(installation_id uuid, fcm_token text)
language sql stable
set search_path = ''
as $$
    select d.installation_id, d.fcm_token
    from public.beadlight_android_push_devices d
    where
      (p_test_device is null or d.installation_id = p_test_device)
      and case p_audience
        when 'challenge' then d.challenge_updates and (
          p_test_device is not null or exists (
            select 1 from public.challenge_participations c
            where c.challenge_slug = p_slug and c.installation_id = d.installation_id
          )
        )
        when 'general' then d.general_announcements and (
          p_test_device is not null or d.last_general_attempt_at is null
          or d.last_general_attempt_at <= now() - interval '7 days'
        )
        else false
      end
    order by d.installation_id
    limit 151;
$$;

create function public.beadlight_claim_android_push(
    p_id uuid, p_audience text, p_slug text, p_test_device uuid,
    p_title text, p_body text, p_admin uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
    recipients jsonb;
    recipient_count integer;
begin
    perform pg_catalog.pg_advisory_xact_lock(714533902);
    if exists (select 1 from public.beadlight_android_push_campaigns where id = p_id) then
        return jsonb_build_object('reason', 'duplicate');
    end if;
    if p_test_device is null and not exists (
        select 1 from public.beadlight_android_push_campaigns where is_test and accepted_count > 0
    ) then
        return jsonb_build_object('reason', 'test_required');
    end if;
    select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb), count(*) into recipients, recipient_count
    from public.beadlight_android_push_candidates(p_audience, p_slug, p_test_device) d;
    if recipient_count = 0 or recipient_count > 150 then
        return jsonb_build_object('reason', case when recipient_count = 0 then 'empty' else 'limit' end);
    end if;
    insert into public.beadlight_android_push_campaigns (
        id, audience, challenge_slug, title, body, is_test, intended_count, created_by
    ) values (
        p_id, p_audience, p_slug, p_title, p_body, p_test_device is not null, recipient_count, p_admin
    );
    if p_audience = 'general' and p_test_device is null then
        update public.beadlight_android_push_devices as d
        set last_general_attempt_at = now()
        where d.installation_id in (
            select (row ->> 'installation_id')::uuid from jsonb_array_elements(recipients) row
        );
    end if;
    return jsonb_build_object('devices', recipients);
end;
$$;

revoke all on function public.beadlight_android_push_candidates(text, text, uuid)
    from public, anon, authenticated;
revoke all on function public.beadlight_claim_android_push(uuid, text, text, uuid, text, text, uuid)
    from public, anon, authenticated;
grant execute on function public.beadlight_android_push_candidates(text, text, uuid) to service_role;
grant execute on function public.beadlight_claim_android_push(uuid, text, text, uuid, text, text, uuid) to service_role;

create function public.beadlight_register_android_push(
    p_installation uuid, p_proof_hash text, p_token text, p_revision bigint,
    p_challenge_updates boolean, p_general_announcements boolean
)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
    -- Keep the newest consent decision even when the first update arrives out of order.
    insert into public.beadlight_android_push_devices as d (
        installation_id, registration_secret_hash, fcm_token, revision,
        challenge_updates, general_announcements
    ) values (
        p_installation, p_proof_hash, p_token, p_revision,
        p_challenge_updates, p_general_announcements
    )
    on conflict (installation_id) do update set
        fcm_token = excluded.fcm_token,
        revision = excluded.revision,
        challenge_updates = excluded.challenge_updates,
        general_announcements = excluded.general_announcements
    where d.registration_secret_hash = excluded.registration_secret_hash
      and d.revision < excluded.revision;
    return exists (
        select 1 from public.beadlight_android_push_devices
        where installation_id = p_installation and registration_secret_hash = p_proof_hash
    );
end;
$$;

revoke all on function public.beadlight_register_android_push(uuid, text, text, bigint, boolean, boolean)
    from public, anon, authenticated;
grant execute on function public.beadlight_register_android_push(uuid, text, text, bigint, boolean, boolean)
    to service_role;
