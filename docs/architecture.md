# NovaRole Architecture Proposal

NovaRole is a free, open-source, local-first roleplay application. The current React/Vite/Tauri app is the first client slice; this proposal describes the destination for web, native mobile, sync, community, and NovaRole-owned generation services.

## Implemented Foundation

The repository includes a separate Fastify/PostgreSQL API in `api/server.ts`, an initial migration in `api/migrations/001_initial.sql`, and a local PostgreSQL Compose service. The browser client connects to the API for registration/login, session restoration, approved-public character search, character details, and pending submissions. The API also provides view counts, reports, and moderator approve/reject actions. It is self-hosted software, not a hosted service. Email verification, password recovery, refresh-token revocation, object storage, distributed rate limiting, chat sync, and native clients remain future work.

## Product and cost boundary

- Keep core chat, character creation, local storage, and local inference usable without an account or a hosted service.
- Publish the clients, API, and model-serving code under an open-source license selected before public release.
- Offer self-hosting as the dependable free path. Any community-operated hosted sync or inference is optional and best-effort; no project can promise unlimited hosted compute, storage, or frontier-model access at zero cost forever.
- NovaRole's text and image models are future first-party components. Until they exist, the desktop/web prototype uses a local Ollama adapter. The app must not imply that Ollama is NovaRole's own model or that a hosted router is currently available.

## Proposed stack

| Area | Recommendation | Rationale |
| --- | --- | --- |
| Web/PWA | React, TypeScript, Vite, service worker, IndexedDB | Reuses the current web client; offline-first and installable without a server. |
| Native mobile | Expo + React Native + TypeScript | iOS/Android delivery and shared domain/provider packages; native UI is separate from the web UI. |
| Desktop | Keep Tauri 2 | Reuses the current desktop shell and can use SQLite for large local libraries. |
| Shared client code | TypeScript workspace packages | Shared data contracts, validation, provider interfaces, and sync logic; platform-specific presentation remains native. |
| API | Node.js + Fastify, REST for CRUD and SSE for generation/sync events | Typed streaming, mature plugins, and deployable as a single self-hosted service. |
| Main database | PostgreSQL | Transactions, relational ownership/permissions, full-text search, and scalable indexes. Start with PostgreSQL search; add a search service only when measured load requires it. |
| Local databases | IndexedDB on web; SQLite on native/desktop | Offline-first operation and efficient conversation history. |
| Assets | S3-compatible object storage, with local filesystem/MinIO for self-hosting | Character images, audio, and clips stay outside relational rows. |
| Jobs and limits | PostgreSQL job/outbox tables initially; optional Redis-compatible queue later | Avoids requiring another service at launch; add a queue when inference and media jobs need it. |
| Models | Versioned NovaRole text/image inference services behind provider APIs | Model weights and inference can evolve without changing clients; can run on user-owned hardware or explicitly donated/hosted compute. |
| Identity | Optional anonymous local profile; account identity for sync/public publishing | Private local use does not require signup; server-side ownership is still authenticated. |

Do not make Supabase, Cloudflare, a commercial LLM API, or any free-tier quota a hard dependency. They can be deployment options, but the canonical implementation must be self-hostable with documented resource requirements.

## Service boundaries

1. **Client domain:** characters, personas, chats, messages, branches, settings, and local search. Local writes are authoritative until sync is configured.
2. **Sync API:** authenticated per-user change batches, revision checks, tombstones, and conflict records. Use stable UUIDs and monotonic per-record revisions; never silently overwrite divergent edits.
3. **Community API:** public character versions, creator profiles, follows, comments, reactions, discovery, content ratings, moderation reports, and visibility enforcement.
4. **Generation API:** authenticated requests with provider/model version, parameters, context selection, safety policy, and an SSE stream. Cancellation propagates to inference. The browser/mobile app depends on a `TextGenerationProvider` contract, not a specific model vendor.
5. **Media worker:** queued image/audio/video generation, asset moderation, thumbnails, and object-storage lifecycle. Expensive work is opt-in and reports resource requirements.

## Initial database schema

All IDs are UUIDs. Timestamps are UTC. JSONB is reserved for versioned settings or provider metadata, not primary relationships. Public content is published as immutable versions while editable drafts remain private.

```sql
create table users (
  id uuid primary key,
  handle text unique,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table personas (
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  name text not null,
  description text not null default '',
  avatar_asset_id uuid,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);

create table characters (
  id uuid primary key,
  creator_id uuid references users(id) on delete set null,
  current_version_id uuid,
  visibility text not null default 'private',
  created_at timestamptz not null default now(),
  check (visibility in ('private', 'unlisted', 'public'))
);

create table character_versions (
  id uuid primary key,
  character_id uuid not null references characters(id) on delete cascade,
  version integer not null,
  name text not null,
  tagline text not null default '',
  description text not null default '',
  personality text not null default '',
  backstory text not null default '',
  scenario text not null default '',
  greeting text not null default '',
  example_dialogues text not null default '',
  tags text[] not null default '{}',
  genre text not null default '',
  content_rating text not null default 'sfw',
  definition jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (character_id, version),
  check (content_rating in ('sfw', 'limited', 'mature'))
);
alter table characters add constraint characters_current_version_fk
  foreign key (current_version_id) references character_versions(id) on delete set null;

create table chats (
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  persona_id uuid references personas(id) on delete set null,
  title text not null default 'New conversation',
  visibility text not null default 'private',
  settings jsonb not null default '{}',
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (visibility in ('private', 'unlisted', 'public'))
);

create table chat_participants (
  chat_id uuid not null references chats(id) on delete cascade,
  character_version_id uuid not null references character_versions(id),
  position smallint not null,
  primary key (chat_id, character_version_id),
  unique (chat_id, position)
);

create table chat_branches (
  id uuid primary key,
  chat_id uuid not null references chats(id) on delete cascade,
  parent_branch_id uuid references chat_branches(id) on delete set null,
  fork_message_id uuid,
  name text not null default 'Main',
  created_at timestamptz not null default now()
);

create table messages (
  id uuid primary key,
  chat_id uuid not null references chats(id) on delete cascade,
  branch_id uuid not null references chat_branches(id) on delete cascade,
  parent_message_id uuid references messages(id) on delete set null,
  character_version_id uuid references character_versions(id) on delete set null,
  role text not null,
  content text not null,
  alternative_group uuid,
  alternative_index smallint not null default 0,
  generation jsonb not null default '{}',
  created_at timestamptz not null default now(),
  check (role in ('user', 'assistant', 'system'))
);

create table lorebooks (
  id uuid primary key,
  owner_id uuid references users(id) on delete cascade,
  character_id uuid references characters(id) on delete cascade,
  name text not null
);
create table lore_entries (
  id uuid primary key,
  lorebook_id uuid not null references lorebooks(id) on delete cascade,
  keywords text[] not null,
  content text not null,
  priority integer not null default 0,
  enabled boolean not null default true
);

create table memories (
  id uuid primary key,
  chat_id uuid not null references chats(id) on delete cascade,
  kind text not null,
  content text not null,
  pinned boolean not null default false,
  source_message_id uuid references messages(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (kind in ('summary', 'fact', 'permanent'))
);

create table follows (
  follower_id uuid not null references users(id) on delete cascade,
  creator_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, creator_id)
);
create table reactions (
  user_id uuid not null references users(id) on delete cascade,
  character_version_id uuid not null references character_versions(id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, character_version_id, kind)
);
create table comments (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  character_version_id uuid not null references character_versions(id) on delete cascade,
  parent_id uuid references comments(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table assets (
  id uuid primary key,
  owner_id uuid references users(id) on delete set null,
  storage_key text not null unique,
  media_type text not null,
  content_hash text not null,
  created_at timestamptz not null default now()
);

create index characters_public_created_idx on characters (created_at desc) where visibility = 'public';
create index character_versions_tags_idx on character_versions using gin (tags);
create index chats_owner_updated_idx on chats (owner_id, updated_at desc);
create index messages_chat_branch_created_idx on messages (chat_id, branch_id, created_at);
create index lore_entries_keywords_idx on lore_entries using gin (keywords);
```

In production, add an FTS index for character text, moderation/audit tables, sync device cursors, tombstones, and rate-limit buckets. Partition high-volume messages by time or tenant only after observing actual query pressure. Enforce private/public ownership in API queries and database row-level security where supported; never trust client-supplied creator IDs.

## Proposed repository layout

```text
apps/
  web/                 PWA, browser storage, responsive web UI
  mobile/              Expo iOS/Android application
  desktop/             Tauri host and native storage integration
packages/
  domain/              Shared types, validation, branching and memory rules
  generation/          Text/image/audio provider contracts and stream events
  data/                Local repositories, sync client, migrations
  design-tokens/       Theme packs and shared semantic tokens
services/
  api/                 Auth, sync, community, discovery, SSE generation gateway
  inference-text/      NovaRole text model serving (future first-party model)
  inference-image/     NovaRole image model serving (future first-party model)
  media-worker/        Moderation, transforms, queued media jobs
infra/
  compose/             Self-hostable PostgreSQL, API, object storage deployment
  migrations/          PostgreSQL schema migrations
docs/
  architecture.md
```

The existing `src/` app remains in place for this first milestone; moving it into the monorepo is a later extraction, not a prerequisite for a working local app.

## Delivery order

1. Local character/chat core, provider interface, streaming, and exportable local data.
2. Native Expo client and local SQLite/IndexedDB repositories.
3. Self-hostable auth, Postgres sync, revision conflicts, and device management.
4. Public character publishing, discovery/search, moderation, and creator interactions.
5. Branching/version history, lorebooks, personas, and memory controls.
6. First-party text and image models, deployment recipes, and optional media generation.

Each phase must keep local-only use functional. Community scale, hosted sync, inference capacity, and media generation depend on operator hardware and funding rather than a fictional unlimited free tier.