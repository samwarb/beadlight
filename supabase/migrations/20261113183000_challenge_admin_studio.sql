-- Beadlight Challenge Studio (GitHub Pages /admin/challenges/)
-- Additive setup. Supports the fields read by Beadlight iOS 1.7.5.
-- Only approved admins can edit. The iPhone app reads published rows.
-- Existing admin_users and is_admin_email() come from the main Beadlight admin setup.

create table if not exists public.rosary_challenges (
  slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  title_en text not null check (length(trim(title_en)) > 0),
  title_es text not null default '',
  description_en text not null default '',
  description_es text not null default '',
  starts_on date not null,
  ends_on date not null,
  reflections_en jsonb not null default '[]'::jsonb,
  reflections_es jsonb not null default '[]'::jsonb,
  sort_order integer not null default 100,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  banner_image_path text,
  detail_image_path text,
  daily_image_paths jsonb not null default '[]'::jsonb,
  accent_color_hex text,
  reminder_title_en text,
  reminder_title_es text,
  reminder_body_en text,
  reminder_body_es text
);

-- Works for existing users of the original iOS challenge setup SQL too.
alter table public.rosary_challenges
  add column if not exists banner_image_path text,
  add column if not exists detail_image_path text,
  add column if not exists daily_image_paths jsonb not null default '[]'::jsonb,
  add column if not exists accent_color_hex text,
  add column if not exists reminder_title_en text,
  add column if not exists reminder_title_es text,
  add column if not exists reminder_body_en text,
  add column if not exists reminder_body_es text;

do $$
begin
  if not exists (select 1 from pg_constraint
       where conrelid='public.rosary_challenges'::regclass and conname='beadlight_challenge_length') then
    alter table public.rosary_challenges add constraint beadlight_challenge_length
      check (ends_on >= starts_on and ends_on - starts_on <= 89);
  end if;
  if not exists (select 1 from pg_constraint
       where conrelid='public.rosary_challenges'::regclass and conname='beadlight_challenge_reflections_en') then
    alter table public.rosary_challenges add constraint beadlight_challenge_reflections_en
      check (jsonb_typeof(reflections_en)='array'
        and (jsonb_array_length(reflections_en)=0 or jsonb_array_length(reflections_en)=ends_on-starts_on+1));
  end if;
  if not exists (select 1 from pg_constraint
       where conrelid='public.rosary_challenges'::regclass and conname='beadlight_challenge_reflections_es') then
    alter table public.rosary_challenges add constraint beadlight_challenge_reflections_es
      check (jsonb_typeof(reflections_es)='array'
        and (jsonb_array_length(reflections_es)=0 or jsonb_array_length(reflections_es)=ends_on-starts_on+1));
  end if;
  if not exists (select 1 from pg_constraint
       where conrelid='public.rosary_challenges'::regclass and conname='beadlight_challenge_daily_images') then
    alter table public.rosary_challenges add constraint beadlight_challenge_daily_images
      check (jsonb_typeof(daily_image_paths)='array'
        and (jsonb_array_length(daily_image_paths)=0 or jsonb_array_length(daily_image_paths)=ends_on-starts_on+1));
  end if;
  if not exists (select 1 from pg_constraint
       where conrelid='public.rosary_challenges'::regclass and conname='beadlight_challenge_accent') then
    alter table public.rosary_challenges add constraint beadlight_challenge_accent
      check (accent_color_hex is null or accent_color_hex ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end $$;

create or replace function public.touch_rosary_challenge_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists touch_rosary_challenge_updated_at on public.rosary_challenges;
create trigger touch_rosary_challenge_updated_at before update
on public.rosary_challenges for each row
execute function public.touch_rosary_challenge_updated_at();

alter table public.rosary_challenges enable row level security;
revoke all on table public.rosary_challenges from anon, authenticated;
grant select on table public.rosary_challenges to anon;
grant select, insert, update, delete on table public.rosary_challenges to authenticated;

drop policy if exists "Published Rosary challenges are public" on public.rosary_challenges;
create policy "Published Rosary challenges are public"
  on public.rosary_challenges for select to anon, authenticated
  using (is_published = true);

drop policy if exists "Beadlight admins can view challenge drafts" on public.rosary_challenges;
create policy "Beadlight admins can view challenge drafts"
  on public.rosary_challenges for select to authenticated
  using ((select public.is_admin_email(auth.jwt() ->> 'email')));

drop policy if exists "Beadlight admins can create challenges" on public.rosary_challenges;
create policy "Beadlight admins can create challenges"
  on public.rosary_challenges for insert to authenticated
  with check ((select public.is_admin_email(auth.jwt() ->> 'email')));

drop policy if exists "Beadlight admins can edit challenges" on public.rosary_challenges;
create policy "Beadlight admins can edit challenges"
  on public.rosary_challenges for update to authenticated
  using ((select public.is_admin_email(auth.jwt() ->> 'email')))
  with check ((select public.is_admin_email(auth.jwt() ->> 'email')));

drop policy if exists "Beadlight admins can delete challenges" on public.rosary_challenges;
create policy "Beadlight admins can delete challenges"
  on public.rosary_challenges for delete to authenticated
  using ((select public.is_admin_email(auth.jwt() ->> 'email')));

-- Artwork is public because it appears in the app.
-- Never upload private images to this bucket.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('challenge-images','challenge-images',true,5242880,
        array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Beadlight admins can list challenge images" on storage.objects;
create policy "Beadlight admins can list challenge images"
  on storage.objects for select to authenticated
  using (bucket_id='challenge-images'
    and (select public.is_admin_email(auth.jwt() ->> 'email')));

drop policy if exists "Beadlight admins can upload challenge images" on storage.objects;
create policy "Beadlight admins can upload challenge images"
  on storage.objects for insert to authenticated
  with check (bucket_id='challenge-images'
    and (select public.is_admin_email(auth.jwt() ->> 'email')));

drop policy if exists "Beadlight admins can update challenge images" on storage.objects;
create policy "Beadlight admins can update challenge images"
  on storage.objects for update to authenticated
  using (bucket_id='challenge-images'
    and (select public.is_admin_email(auth.jwt() ->> 'email')))
  with check (bucket_id='challenge-images'
    and (select public.is_admin_email(auth.jwt() ->> 'email')));

drop policy if exists "Beadlight admins can delete challenge images" on storage.objects;
create policy "Beadlight admins can delete challenge images"
  on storage.objects for delete to authenticated
  using (bucket_id='challenge-images'
    and (select public.is_admin_email(auth.jwt() ->> 'email')));

-- App versions that do not include the dynamic challenge client will not show these challenges.
-- App Store In-App Events still require submission in App Store Connect.
