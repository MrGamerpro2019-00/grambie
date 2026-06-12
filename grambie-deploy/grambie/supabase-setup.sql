-- ============================================================
--  GRAMBIE — Supabase setup
--  Run this ONCE in your Supabase project:
--  Dashboard -> SQL Editor -> New query -> paste -> Run
-- ============================================================

-- ---------- TABLES ----------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (
    username ~ '^[a-z0-9._]{1,30}$'
    and username not like '.%'
    and username not like '%.'
    and username not like '%..%'
  ),
  name text not null default '',
  bio text not null default '',
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author uuid not null references public.profiles(id) on delete cascade,
  caption text not null default '' check (char_length(caption) <= 500),
  image_url text not null,
  created_at timestamptz not null default now()
);

create table public.likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 300),
  created_at timestamptz not null default now()
);

create table public.follows (
  follower uuid not null references public.profiles(id) on delete cascade,
  following uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, following),
  check (follower <> following)
);

create index posts_created_idx on public.posts (created_at desc);
create index posts_author_idx on public.posts (author);
create index comments_post_idx on public.comments (post_id);
create index follows_following_idx on public.follows (following);

-- ---------- ROW LEVEL SECURITY ----------
-- Everyone can read; people can only write rows that belong to them.

alter table public.profiles enable row level security;
alter table public.posts    enable row level security;
alter table public.likes    enable row level security;
alter table public.comments enable row level security;
alter table public.follows  enable row level security;

-- profiles
create policy "profiles are public"        on public.profiles for select using (true);
create policy "create own profile"         on public.profiles for insert with check (auth.uid() = id);
create policy "update own profile"         on public.profiles for update using (auth.uid() = id);

-- posts
create policy "posts are public"           on public.posts for select using (true);
create policy "create own posts"           on public.posts for insert with check (auth.uid() = author);
create policy "delete own posts"           on public.posts for delete using (auth.uid() = author);

-- likes
create policy "likes are public"           on public.likes for select using (true);
create policy "like as yourself"           on public.likes for insert with check (auth.uid() = user_id);
create policy "unlike as yourself"         on public.likes for delete using (auth.uid() = user_id);

-- comments
create policy "comments are public"        on public.comments for select using (true);
create policy "comment as yourself"        on public.comments for insert with check (auth.uid() = user_id);
create policy "delete own comments"        on public.comments for delete using (auth.uid() = user_id);

-- follows
create policy "follows are public"         on public.follows for select using (true);
create policy "follow as yourself"         on public.follows for insert with check (auth.uid() = follower);
create policy "unfollow as yourself"       on public.follows for delete using (auth.uid() = follower);

-- ---------- IMAGE STORAGE ----------
-- One public bucket; each user can only write inside their own folder.

insert into storage.buckets (id, name, public)
values ('images', 'images', true)
on conflict (id) do nothing;

create policy "anyone can view images"
  on storage.objects for select
  using (bucket_id = 'images');

create policy "users upload to own folder"
  on storage.objects for insert
  with check (
    bucket_id = 'images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "users update own images"
  on storage.objects for update
  using (
    bucket_id = 'images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "users delete own images"
  on storage.objects for delete
  using (
    bucket_id = 'images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
