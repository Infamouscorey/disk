create table if not exists account_workspaces (
  user_id uuid primary key references users(id) on delete cascade,
  workspace jsonb not null,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);
