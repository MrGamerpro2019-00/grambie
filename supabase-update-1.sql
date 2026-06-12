-- ============================================================
--  GRAMBIE — Update 1: admin panel, bans, warnings, notices,
--  verification, settings (username/password changes)
--
--  SAFE TO RUN ON YOUR LIVE DATABASE — it only ADDS things.
--  No existing accounts, posts, likes, follows or images are
--  touched. Run ONCE in: Dashboard -> SQL Editor -> Run.
-- ============================================================

-- ---------- new profile columns ----------

alter table public.profiles add column if not exists verified boolean not null default false;
alter table public.profiles add column if not exists banned_until timestamptz;
alter table public.profiles add column if not exists ban_reason text;
alter table public.profiles add column if not exists login_email text;

-- Existing accounts keep working: their login email is derived
-- from the username they signed up with.
update public.profiles
set login_email = username || '@users.grambie.app'
where login_email is null;

-- ---------- helper functions ----------

-- The account with username 'admin' is the moderator.
create or replace function public.is_admin()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and username = 'admin'
  );
$$;

create or replace function public.is_banned(uid uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = uid and banned_until is not null and banned_until > now()
  );
$$;

-- ---------- notices (warnings, ban notices, username changes) ----------

create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'info',          -- info | warning | ban | username
  message text not null,
  acknowledged boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notices enable row level security;

drop policy if exists "read own notices" on public.notices;
create policy "read own notices" on public.notices
  for select using (auth.uid() = user_id);

drop policy if exists "ack own notices" on public.notices;
create policy "ack own notices" on public.notices
  for update using (auth.uid() = user_id);

drop policy if exists "admin sends notices" on public.notices;
create policy "admin sends notices" on public.notices
  for insert with check (public.is_admin());

-- ---------- admin powers via policies ----------

-- Admin can edit any profile (rename, clear bio/photo, verify, ban).
drop policy if exists "update own profile" on public.profiles;
drop policy if exists "update own profile or admin" on public.profiles;
create policy "update own profile or admin" on public.profiles
  for update using (auth.uid() = id or public.is_admin());

-- Admin can delete any post.
drop policy if exists "delete own posts" on public.posts;
drop policy if exists "delete own posts or admin" on public.posts;
create policy "delete own posts or admin" on public.posts
  for delete using (auth.uid() = author or public.is_admin());

-- ---------- protect moderation fields from regular users ----------
-- Without this, a user could verify themselves or lift their own ban.

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    new.verified     := old.verified;
    new.banned_until := old.banned_until;
    new.ban_reason   := old.ban_reason;
    new.login_email  := old.login_email;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_columns on public.profiles;
create trigger protect_profile_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- ---------- banned users can't write anything ----------

drop policy if exists "create own posts" on public.posts;
create policy "create own posts" on public.posts
  for insert with check (auth.uid() = author and not public.is_banned(auth.uid()));

drop policy if exists "like as yourself" on public.likes;
create policy "like as yourself" on public.likes
  for insert with check (auth.uid() = user_id and not public.is_banned(auth.uid()));

drop policy if exists "comment as yourself" on public.comments;
create policy "comment as yourself" on public.comments
  for insert with check (auth.uid() = user_id and not public.is_banned(auth.uid()));

drop policy if exists "follow as yourself" on public.follows;
create policy "follow as yourself" on public.follows
  for insert with check (auth.uid() = follower and not public.is_banned(auth.uid()));
