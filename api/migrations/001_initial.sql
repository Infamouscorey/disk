create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  handle text not null unique,
  display_name text not null,
  password_hash text not null,
  role text not null default 'member' check (role in ('member', 'moderator', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists characters (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references users(id) on delete cascade,
  current_version_id uuid,
  visibility text not null default 'public' check (visibility in ('private', 'unlisted', 'public')),
  moderation_status text not null default 'pending' check (moderation_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create table if not exists character_versions (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references characters(id) on delete cascade,
  version integer not null default 1,
  name text not null,
  nickname text not null default '',
  tagline text not null default '',
  description text not null default '',
  personality text not null default '',
  backstory text not null default '',
  scenario text not null default '',
  greeting text not null default '',
  example_dialogues text not null default '',
  avatar_url text not null default '',
  tags text[] not null default '{}',
  genre text not null default '',
  pov text not null default 'Third person',
  gender text not null default 'Unspecified',
  content_rating text not null default 'sfw' check (content_rating in ('sfw', 'limited', 'limitless', 'mature')),
  definition jsonb not null default '{}',
  view_count bigint not null default 0,
  created_at timestamptz not null default now(),
  unique (character_id, version)
);

alter table characters drop constraint if exists characters_current_version_fk;
alter table characters add constraint characters_current_version_fk
  foreign key (current_version_id) references character_versions(id) on delete set null;

create table if not exists moderation_reports (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references characters(id) on delete cascade,
  reporter_id uuid references users(id) on delete set null,
  reason text not null,
  details text not null default '',
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now()
);

create table if not exists moderation_events (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references characters(id) on delete cascade,
  moderator_id uuid not null references users(id) on delete restrict,
  action text not null check (action in ('approve', 'reject')),
  reason text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists characters_public_approved_idx
  on characters (created_at desc, id desc)
  where visibility = 'public' and moderation_status = 'approved';
create index if not exists character_versions_tags_idx on character_versions using gin (tags);
create index if not exists character_versions_recent_idx on character_versions (created_at desc, id desc);
create index if not exists character_versions_popular_idx on character_versions (view_count desc, created_at desc, id desc);
create index if not exists character_versions_featured_idx on character_versions ((coalesce((definition->>'featured')::boolean, false)), created_at desc, id desc);
create index if not exists character_versions_search_idx on character_versions using gin (
  to_tsvector('simple', name || ' ' || tagline || ' ' || description || ' ' || array_to_string(tags, ' '))
);
create index if not exists moderation_reports_open_idx on moderation_reports (created_at desc) where status = 'open';
