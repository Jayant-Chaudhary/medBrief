-- ============================================================
-- Consultation Audio Pipeline — Phase 1 Schema Migration
-- Target: Supabase (PostgreSQL)
-- ============================================================

-- 1. CONSULT SESSIONS
create table consult_sessions (
  id                    uuid primary key default gen_random_uuid(),
  appointment_id        uuid not null references appointments(id) on delete cascade,
  doctor_id             uuid not null references profiles(id),
  patient_id            uuid references profiles(id),
  status                text not null default 'created' check (
    status in ('created', 'waiting', 'ready', 'recording', 'ending', 'processing', 'draft_ready', 'cancelled', 'failed')
  ),
  room_code             text unique,
  room_code_expires_at  timestamptz,
  patient_required      boolean not null default true,
  language_code         text,
  started_at            timestamptz,
  ended_at              timestamptz,
  end_deadline_at       timestamptz,
  created_at            timestamptz not null default now()
);

create index idx_consult_sessions_appointment on consult_sessions(appointment_id);
create index idx_consult_sessions_doctor on consult_sessions(doctor_id);
create index idx_consult_sessions_patient on consult_sessions(patient_id);
create index idx_consult_sessions_room_code on consult_sessions(room_code) where room_code is not null;

-- 2. SESSION CONSENTS
create table session_consents (
  id                    uuid primary key default gen_random_uuid(),
  session_id            uuid not null references consult_sessions(id) on delete cascade,
  role                  text not null check (role in ('doctor', 'patient')),
  user_id               uuid not null references profiles(id),
  consent_text_version  text not null,
  accepted_at           timestamptz not null default now(),
  constraint uq_session_consents_session_role unique (session_id, role)
);

create index idx_session_consents_session on session_consents(session_id);

-- 3. SESSION DEVICES
create table session_devices (
  id                     uuid primary key default gen_random_uuid(),
  session_id             uuid not null references consult_sessions(id) on delete cascade,
  device                 text not null check (device in ('doctor', 'patient')),
  status                 text not null default 'joined' check (
    status in ('joined', 'ready', 'recording', 'flushed', 'gone')
  ),
  offset_ms              bigint not null default 0,
  rtt_ms                 integer not null default 0,
  capture_zero_device_ms bigint,
  expected_chunks        integer,
  final_received_at      timestamptz,
  joined_at              timestamptz not null default now(),
  constraint uq_session_devices_session_device unique (session_id, device)
);

create index idx_session_devices_session on session_devices(session_id);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

alter table consult_sessions enable row level security;
alter table session_consents enable row level security;
alter table session_devices enable row level security;

-- Policies for consult_sessions
create policy "Doctors can view own consult sessions" on consult_sessions
  for select using (auth.uid() = doctor_id);

create policy "Patients can view own consult sessions" on consult_sessions
  for select using (auth.uid() = patient_id);

create policy "Doctors can update own consult sessions" on consult_sessions
  for update using (auth.uid() = doctor_id);

-- Policies for session_consents
create policy "Participants can view session consents" on session_consents
  for select using (
    exists (
      select 1 from consult_sessions cs
      where cs.id = session_consents.session_id
        and (cs.doctor_id = auth.uid() or cs.patient_id = auth.uid())
    )
  );

create policy "Users can record own session consent" on session_consents
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from consult_sessions cs
      where cs.id = session_consents.session_id
        and (cs.doctor_id = auth.uid() or cs.patient_id = auth.uid())
    )
  );

-- Policies for session_devices
create policy "Participants can view session devices" on session_devices
  for select using (
    exists (
      select 1 from consult_sessions cs
      where cs.id = session_devices.session_id
        and (cs.doctor_id = auth.uid() or cs.patient_id = auth.uid())
    )
  );
