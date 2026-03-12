-- NSU Attendance — базовая схема PostgreSQL (подходит для Supabase / Neon / Railway)

create table if not exists sessions (
  id text primary key,
  subject text not null,
  qr_interval integer not null default 15,
  geo_lat double precision,
  geo_lng double precision,
  geo_radius integer,
  fingerprint_required boolean not null default true,
  geo_required boolean not null default false,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists qr_tokens (
  token text primary key,
  session_id text not null references sessions(id) on delete cascade,
  expires_at timestamptz not null,
  fingerprint text, -- заполняется только для одноразового токена формы
  is_one_time boolean not null default false
);

create table if not exists attendances (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  fingerprint text not null,
  student_name text not null,
  student_group text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_attendances_session_id on attendances(session_id);
create index if not exists idx_attendances_session_fp on attendances(session_id, fingerprint);

