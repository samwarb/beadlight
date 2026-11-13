-- Anonymous opt-in challenge participation analytics; no names, emails, or prayer history.
-- Counters are per installation rather than a verified person. Visibility defaults OFF.
create table if not exists public.challenge_participations (
  challenge_slug text not null check (challenge_slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  installation_id uuid not null,
  joined_at timestamptz not null default now(),
  primary key (challenge_slug, installation_id)
);
create index if not exists challenge_participations_by_slug on public.challenge_participations (challenge_slug);

create table if not exists public.challenge_count_settings (
  challenge_slug text primary key check (challenge_slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  show_to_users boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.challenge_participations enable row level security;
alter table public.challenge_count_settings enable row level security;
revoke all on public.challenge_participations from public, anon, authenticated;
revoke all on public.challenge_count_settings from public, anon, authenticated;

-- This is the ONLY browser/mobile write endpoint, callable without a login
-- because the core Rosary experience does not require an account.
-- It writes a single installation/challenge membership, never user content.
create or replace function public.set_challenge_participation(
  p_slug text, p_installation_id uuid, p_joined boolean
)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{0,63}$'
     or p_installation_id is null or p_joined is null then
    raise exception 'Invalid challenge registration' using errcode = '22023';
  end if;
  if p_joined then
    if p_slug <> 'daily' and not exists (
      select 1 from public.rosary_challenges c
      where c.slug = p_slug and c.is_published
    ) then
      raise exception 'Challenge is not available' using errcode = '22023';
    end if;
    insert into public.challenge_participations(challenge_slug, installation_id)
      values(p_slug, p_installation_id)
      on conflict (challenge_slug, installation_id) do nothing;
  else
    delete from public.challenge_participations
      where challenge_slug = p_slug and installation_id = p_installation_id;
  end if;
end;
$$;
revoke all on function public.set_challenge_participation(text,uuid,boolean) from public, anon, authenticated;
grant execute on function public.set_challenge_participation(text,uuid,boolean) to anon, authenticated;

-- Customers only receive counts for challenges you have explicitly enabled.
-- A private count is not returned at all, even if the REST RPC is called directly.
create or replace function public.get_public_challenge_signup_counts()
returns table(challenge_slug text, signup_count bigint)
language sql stable security definer set search_path = ''
as $$
  select s.challenge_slug,
         (select count(*) from public.challenge_participations p
            where p.challenge_slug = s.challenge_slug)::bigint as signup_count
  from public.challenge_count_settings s
  where s.show_to_users
    and (s.challenge_slug = 'daily' or exists (
      select 1 from public.rosary_challenges c
      where c.slug = s.challenge_slug and c.is_published
    ));
$$;
revoke all on function public.get_public_challenge_signup_counts() from public, anon, authenticated;
grant execute on function public.get_public_challenge_signup_counts() to anon, authenticated;

-- Admin-only aggregate includes daily and every catalogue challenge, even 0 signups.
create or replace function public.get_admin_challenge_signup_counts()
returns table(challenge_slug text, signup_count bigint, show_to_users boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not coalesce(public.is_admin_email(auth.jwt() ->> 'email'), false) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  return query
    with catalogue as (
      select 'daily'::text as slug
      union
      select c.slug from public.rosary_challenges c
    )
    select c.slug,
           (select count(*) from public.challenge_participations p
              where p.challenge_slug = c.slug)::bigint,
           coalesce(s.show_to_users, false)
    from catalogue c
      left join public.challenge_count_settings s on s.challenge_slug = c.slug
    order by case when c.slug = 'daily' then 0 else 1 end, c.slug;
end;
$$;
revoke all on function public.get_admin_challenge_signup_counts() from public, anon, authenticated;
grant execute on function public.get_admin_challenge_signup_counts() to authenticated;

create or replace function public.set_challenge_count_visibility(
 p_slug text, p_show_to_users boolean
)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not coalesce(public.is_admin_email(auth.jwt() ->> 'email'), false) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_slug is null or p_show_to_users is null
     or (p_slug <> 'daily' and not exists (
       select 1 from public.rosary_challenges c where c.slug = p_slug
     )) then
    raise exception 'Unknown challenge' using errcode = '22023';
  end if;
  insert into public.challenge_count_settings(challenge_slug,show_to_users)
   values (p_slug,p_show_to_users)
  on conflict(challenge_slug) do update
    set show_to_users = excluded.show_to_users, updated_at = now();
end;
$$;
revoke all on function public.set_challenge_count_visibility(text,boolean) from public, anon, authenticated;
grant execute on function public.set_challenge_count_visibility(text,boolean) to authenticated;

-- Removing a campaign must not leave stale registrations that a future
-- campaign with the same slug would accidentally inherit.
create or replace function public.remove_deleted_challenge_signups()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.challenge_participations p
   where p.challenge_slug = old.slug;
  delete from public.challenge_count_settings s
   where s.challenge_slug = old.slug;
  return old;
end;
$$;
drop trigger if exists remove_deleted_challenge_signups on public.rosary_challenges;
create trigger remove_deleted_challenge_signups
after delete on public.rosary_challenges
for each row execute function public.remove_deleted_challenge_signups();
revoke all on function public.remove_deleted_challenge_signups() from public, anon, authenticated;
