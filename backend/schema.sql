-- NSU Attendance — базовая схема PostgreSQL (подходит для Neon / Supabase / Railway)

create table if not exists teacher_tokens (
  token text primary key,
  expires_at timestamptz not null
);

create index if not exists idx_teacher_tokens_expires on teacher_tokens(expires_at);

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
  is_one_time boolean not null default false,
  parent_qr_token text -- для одноразовых: какой QR-токен использовался при проверке (лимит устройств на один код)
);

create table if not exists attendances (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  fingerprint text not null,
  student_name text not null,
  student_group text not null,
  created_at timestamptz not null default now()
);

-- Миграция: лимит устройств на один QR-код (защита от пересылки ссылки)
alter table qr_tokens add column if not exists parent_qr_token text;

create index if not exists idx_attendances_session_id on attendances(session_id);
create index if not exists idx_attendances_session_fp on attendances(session_id, fingerprint);
create index if not exists idx_qr_tokens_parent_one_time on qr_tokens(parent_qr_token) where is_one_time = true;
create index if not exists idx_qr_tokens_session_one_time_expires on qr_tokens(session_id, is_one_time, expires_at);

-- Защита от дублей при конкурентных вставках
create unique index if not exists uq_attendances_session_fingerprint on attendances(session_id, fingerprint);
create unique index if not exists uq_attendances_session_student_lower
  on attendances(session_id, lower(student_name), lower(student_group));
create unique index if not exists uq_qr_tokens_session_parent_fingerprint
  on qr_tokens(session_id, parent_qr_token, fingerprint)
  where is_one_time = true and parent_qr_token is not null;

