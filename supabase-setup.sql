-- Beadlight Roadmap Supabase setup
-- Run this in Supabase: SQL Editor → New query → paste → Run
-- IMPORTANT: replace the email below with your own admin email before running.

create table if not exists public.admin_users (
  email text primary key,
  created_at timestamptz not null default now()
);

insert into public.admin_users (email)
values ('swgwarburton@gmail.com')
on conflict (email) do nothing;

create table if not exists public.roadmap_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null default '',
  status text not null default 'under-consideration' check (status in ('under-consideration', 'planned', 'in-progress', 'released', 'not-planned')),
  tag text not null default '',
  priority text not null default 'Medium',
  sort_order integer not null default 100,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_roadmap_items_updated_at on public.roadmap_items;
create trigger set_roadmap_items_updated_at
before update on public.roadmap_items
for each row execute function public.set_updated_at();

alter table public.admin_users enable row level security;
alter table public.roadmap_items enable row level security;

-- Public visitors can read visible roadmap items only.
drop policy if exists "Public can read visible roadmap items" on public.roadmap_items;
create policy "Public can read visible roadmap items"
on public.roadmap_items
for select
to anon, authenticated
using (is_public = true);

-- Admin users can read all roadmap items, including hidden drafts.
drop policy if exists "Admins can read all roadmap items" on public.roadmap_items;
create policy "Admins can read all roadmap items"
on public.roadmap_items
for select
to authenticated
using (exists (
  select 1 from public.admin_users
  where admin_users.email = (auth.jwt() ->> 'email')
));

-- Admin users can create items.
drop policy if exists "Admins can create roadmap items" on public.roadmap_items;
create policy "Admins can create roadmap items"
on public.roadmap_items
for insert
to authenticated
with check (exists (
  select 1 from public.admin_users
  where admin_users.email = (auth.jwt() ->> 'email')
));

-- Admin users can update items.
drop policy if exists "Admins can update roadmap items" on public.roadmap_items;
create policy "Admins can update roadmap items"
on public.roadmap_items
for update
to authenticated
using (exists (
  select 1 from public.admin_users
  where admin_users.email = (auth.jwt() ->> 'email')
))
with check (exists (
  select 1 from public.admin_users
  where admin_users.email = (auth.jwt() ->> 'email')
));

-- Admin users can delete items.
drop policy if exists "Admins can delete roadmap items" on public.roadmap_items;
create policy "Admins can delete roadmap items"
on public.roadmap_items
for delete
to authenticated
using (exists (
  select 1 from public.admin_users
  where admin_users.email = (auth.jwt() ->> 'email')
));

-- Optional starter roadmap items. Delete/edit these later from the admin page.
insert into public.roadmap_items (title, summary, status, tag, priority, sort_order)
values
  ('Android version', 'Bring Beadlight to Android devices.', 'planned', 'Platform', 'High', 10),
  ('Prayer completion stats', 'Track completed prayers so Beadlight can celebrate milestones over time.', 'under-consideration', 'Stats', 'Medium', 20),
  ('Improved guided audio', 'Refine the guided Rosary experience with clearer flow and better pacing.', 'in-progress', 'Audio', 'High', 30),
  ('More visual themes', 'Add a small set of calm themes while keeping the app distraction-free.', 'under-consideration', 'Design', 'Low', 40)
on conflict do nothing;
