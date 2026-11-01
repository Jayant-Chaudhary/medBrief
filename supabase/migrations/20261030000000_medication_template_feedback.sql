-- Clinician-authored medication templates and recommendation feedback.
-- No clinical templates or synthetic patient/feedback rows are seeded here.

create table if not exists medication_templates (
  id uuid primary key default gen_random_uuid(),
  clinician_id uuid not null references profiles(id) on delete restrict,
  title text not null check (length(trim(title)) between 1 and 160),
  indication_key text check (indication_key is null or length(trim(indication_key)) between 1 and 120),
  indication_display text check (indication_display is null or length(trim(indication_display)) between 1 and 200),
  min_gestational_week numeric(4,1) check (min_gestational_week between 0 and 45),
  max_gestational_week numeric(4,1) check (max_gestational_week between 0 and 45),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  version integer not null default 1 check (version > 0),
  approved_by uuid references profiles(id) on delete restrict,
  approved_at timestamptz,
  reviewed_at timestamptz,
  template_content jsonb not null default '{}'::jsonb check (jsonb_typeof(template_content) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (min_gestational_week is null or max_gestational_week is null or min_gestational_week <= max_gestational_week),
  check ((status = 'active' and approved_by is not null and approved_at is not null) or status <> 'active')
);

create index if not exists medication_templates_clinician_status_idx
  on medication_templates(clinician_id, status, indication_key);

create table if not exists medication_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references medication_templates(id) on delete cascade,
  ingredient_key text check (ingredient_key is null or length(trim(ingredient_key)) between 1 and 160),
  display_name text not null check (length(trim(display_name)) between 1 and 200),
  dosage_text text,
  dose_text text,
  strength_text text,
  item_kind text not null default 'medicine' check (item_kind in ('medicine', 'injection', 'vaccination')),
  route_text text,
  frequency_text text,
  duration_text text,
  instructions text,
  allergy_substance_keys text[] not null default '{}',
  is_optional boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists medication_template_items_template_idx
  on medication_template_items(template_id, sort_order);

-- Curated medicine catalog and known allergen associations. This schema ships
-- empty: a verified, licensed source must be selected before importing data.
create table if not exists medication_substances (
  medication_key text primary key check (length(trim(medication_key)) between 1 and 160),
  display_name text not null check (length(trim(display_name)) between 1 and 200),
  synonyms text[] not null default '{}',
  source_name text,
  source_reference text,
  reviewed_by uuid references profiles(id) on delete restrict,
  reviewed_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  alter table medication_template_items
    add constraint medication_template_items_ingredient_key_fkey
    foreign key (ingredient_key) references medication_substances(medication_key) on delete restrict;
exception when duplicate_object then null;
end $$;

create table if not exists medication_allergen_associations (
  id uuid primary key default gen_random_uuid(),
  medication_key text not null references medication_substances(medication_key) on delete cascade,
  allergen_key text not null check (length(trim(allergen_key)) between 1 and 160),
  allergen_display text not null check (length(trim(allergen_display)) between 1 and 200),
  association_type text not null default 'ingredient' check (association_type in ('ingredient', 'excipient', 'class', 'cross_reactivity')),
  source_name text not null,
  source_reference text,
  reviewed_by uuid references profiles(id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(medication_key, allergen_key, association_type)
);

create index if not exists medication_allergen_associations_allergen_idx
  on medication_allergen_associations(allergen_key, medication_key);

create table if not exists prescription_drafts (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references appointments(id) on delete cascade,
  patient_id uuid not null references profiles(id) on delete restrict,
  clinician_id uuid not null references profiles(id) on delete restrict,
  draft_content jsonb not null default '{"medications":[],"instructions":"","followUp":""}'::jsonb,
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(draft_content) = 'object')
);

create index if not exists prescription_drafts_clinician_updated_idx
  on prescription_drafts(clinician_id, updated_at desc);

create table if not exists prescription_factor_catalogs (
  clinician_id uuid primary key references profiles(id) on delete restrict,
  definitions jsonb not null default '[]'::jsonb check (jsonb_typeof(definitions) = 'array'),
  updated_at timestamptz not null default now()
);

create table if not exists prescription_factor_states (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references appointments(id) on delete cascade,
  patient_id uuid not null references profiles(id) on delete restrict,
  clinician_id uuid not null references profiles(id) on delete restrict,
  overrides jsonb not null default '{}'::jsonb check (jsonb_typeof(overrides) = 'object'),
  updated_at timestamptz not null default now()
);

-- Patient-level review status is separate from the list of known allergies.
create table if not exists patient_allergy_reviews (
  patient_id uuid primary key references profiles(id) on delete cascade,
  status text not null default 'not_assessed' check (status in ('not_assessed', 'none_known', 'allergies_documented')),
  reviewed_by uuid references profiles(id) on delete restrict,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((status = 'not_assessed' and reviewed_at is null) or status <> 'not_assessed')
);

create table if not exists patient_allergies (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references profiles(id) on delete cascade,
  substance_key text not null check (length(trim(substance_key)) between 1 and 160),
  substance_display text not null check (length(trim(substance_display)) between 1 and 200),
  reaction text,
  recorded_by uuid references profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(patient_id, substance_key)
);

create index if not exists patient_allergies_patient_idx on patient_allergies(patient_id);

-- One event captures the exact point-in-time inputs and candidates shown.
create table if not exists medication_recommendation_events (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete restrict,
  patient_id uuid not null references profiles(id) on delete restrict,
  clinician_id uuid not null references profiles(id) on delete restrict,
  indication_key text,
  indication_display text,
  gestational_week numeric(4,1),
  feature_snapshot jsonb not null default '{}'::jsonb,
  candidates jsonb not null default '[]'::jsonb,
  matcher_version text not null default 'rules-v1',
  created_at timestamptz not null default now(),
  check (jsonb_typeof(feature_snapshot) = 'object'),
  check (jsonb_typeof(candidates) = 'array')
);

create index if not exists medication_recommendation_events_appointment_idx
  on medication_recommendation_events(appointment_id, created_at desc);
create index if not exists medication_recommendation_events_patient_idx
  on medication_recommendation_events(patient_id, created_at desc);

create table if not exists medication_feedback_events (
  id uuid primary key default gen_random_uuid(),
  recommendation_event_id uuid not null references medication_recommendation_events(id) on delete restrict,
  template_id uuid not null references medication_templates(id) on delete restrict,
  template_version integer not null check (template_version > 0),
  clinician_id uuid not null references profiles(id) on delete restrict,
  action text not null check (action in ('accepted', 'edited', 'rejected', 'deferred')),
  reason_key text,
  clinician_comment text,
  final_items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(final_items) = 'array')
);

alter table medication_feedback_events
  drop constraint if exists medication_feedback_events_recommendation_event_id_template_id_key;

create index if not exists medication_feedback_events_template_idx
  on medication_feedback_events(template_id, created_at desc);

-- Service-role API access is explicitly checked in access.service.js.
-- RLS remains enabled and direct client access is denied by default.
alter table medication_templates enable row level security;
alter table medication_template_items enable row level security;
alter table medication_substances enable row level security;
alter table medication_allergen_associations enable row level security;
alter table patient_allergy_reviews enable row level security;
alter table patient_allergies enable row level security;
alter table prescription_drafts enable row level security;
alter table prescription_factor_states enable row level security;
alter table prescription_factor_catalogs enable row level security;
alter table medication_recommendation_events enable row level security;
alter table medication_feedback_events enable row level security;

-- The API uses service-role credentials only after its auth, role and
-- appointment checks. Keep the multi-row template write atomic in Postgres.
create or replace function save_medication_template(p_clinician_id uuid, p_template jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_template_id uuid := (p_template->>'id')::uuid;
  v_status text;
  v_title text := trim(coalesce(p_template->>'name', ''));
  v_purpose text := nullif(trim(coalesce(p_template->>'purpose', '')), '');
  v_content jsonb;
begin
  if v_title = '' or jsonb_typeof(p_template->'medications') <> 'array' then
    raise exception 'invalid medication template';
  end if;

  v_status := case
    when coalesce((p_template->>'archived')::boolean, false) then 'archived'
    when p_template->>'clinicianApproved' = 'true' then 'active'
    when p_template ? 'autoCapture' and p_template->'autoCapture'->>'stage' <> 'visit-completed' then 'draft'
    when p_template ? 'autoCapture' then 'draft'
    else 'active'
  end;
  v_content := p_template - 'factorSnapshot';
  if v_content ? 'autoCapture' then
    v_content := jsonb_set(v_content, '{autoCapture}', (v_content->'autoCapture') - 'signature', true);
  end if;

  insert into medication_templates (
    id, clinician_id, title, indication_key, indication_display,
    min_gestational_week, max_gestational_week, status, version,
    approved_by, approved_at, template_content, updated_at
  ) values (
    v_template_id, p_clinician_id, v_title,
    case when v_purpose is null then null else lower(regexp_replace(v_purpose, '[^a-zA-Z0-9]+', '-', 'g')) end,
    v_purpose,
    nullif(p_template->>'minGestationalWeek', '')::numeric,
    nullif(p_template->>'maxGestationalWeek', '')::numeric,
    v_status, 1,
    case when v_status = 'active' then p_clinician_id else null end,
    case when v_status = 'active' then now() else null end,
    v_content, now()
  )
  on conflict (id) do update set
    title = excluded.title,
    indication_key = excluded.indication_key,
    indication_display = excluded.indication_display,
    min_gestational_week = excluded.min_gestational_week,
    max_gestational_week = excluded.max_gestational_week,
    status = excluded.status,
    version = medication_templates.version + 1,
    approved_by = excluded.approved_by,
    approved_at = excluded.approved_at,
    template_content = excluded.template_content,
    updated_at = now()
  where medication_templates.clinician_id = p_clinician_id
  returning id into v_id;

  if v_id is null then raise exception 'template not found'; end if;

  delete from medication_template_items where template_id = v_id;
  insert into medication_template_items (
    id, template_id, ingredient_key, display_name, dosage_text, dose_text,
    strength_text, item_kind, route_text, frequency_text, duration_text,
    instructions, allergy_substance_keys, sort_order
  )
  select
    coalesce(nullif(item->>'id', '')::uuid, gen_random_uuid()), v_id,
    nullif(trim(item->>'ingredientKey'), ''), trim(coalesce(item->>'name', '')),
    nullif(item->>'dose', ''), nullif(item->>'dose', ''),
    nullif(item->>'strength', ''), coalesce(nullif(item->>'kind', ''), 'medicine'),
    nullif(item->>'route', ''), nullif(item->>'frequency', ''),
    nullif(item->>'duration', ''), nullif(item->>'instructions', ''),
    coalesce((select array_agg(a.allergen_key order by a.allergen_key)
      from medication_allergen_associations a
      where a.medication_key = nullif(trim(item->>'ingredientKey'), '') and a.reviewed_at is not null), '{}'),
    ordinality::integer - 1
  from jsonb_array_elements(p_template->'medications') with ordinality as items(item, ordinality)
  where trim(coalesce(item->>'name', '')) <> '';

  return jsonb_build_object('id', v_id, 'status', v_status,
    'version', (select version from medication_templates where id = v_id));
end;
$$;

revoke all on function save_medication_template(uuid, jsonb) from public, anon, authenticated;
grant execute on function save_medication_template(uuid, jsonb) to service_role;

create or replace function save_patient_allergies(p_appointment_id uuid, p_clinician_id uuid, p_status text, p_allergies jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient_id uuid;
  v_reviewed_at timestamptz;
begin
  select patient_id into v_patient_id from appointments
  where id = p_appointment_id and clinician_id = p_clinician_id;
  if v_patient_id is null then raise exception 'appointment access denied'; end if;
  if p_status not in ('not_assessed', 'none_known', 'allergies_documented') or jsonb_typeof(p_allergies) <> 'array' then
    raise exception 'invalid allergy review';
  end if;
  if (p_status = 'allergies_documented' and jsonb_array_length(p_allergies) = 0)
    or (p_status <> 'allergies_documented' and jsonb_array_length(p_allergies) > 0) then
    raise exception 'allergy review status does not match allergy list';
  end if;
  v_reviewed_at := case when p_status = 'not_assessed' then null else now() end;

  insert into patient_allergy_reviews(patient_id, status, reviewed_by, reviewed_at, updated_at)
  values(v_patient_id, p_status, case when v_reviewed_at is null then null else p_clinician_id end, v_reviewed_at, now())
  on conflict(patient_id) do update set status = excluded.status, reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at, updated_at = now();
  delete from patient_allergies where patient_id = v_patient_id;
  insert into patient_allergies(patient_id, substance_key, substance_display, reaction, recorded_by)
  select v_patient_id, trim(item->>'substance_key'), trim(item->>'substance_display'), nullif(trim(item->>'reaction'), ''), p_clinician_id
  from jsonb_array_elements(p_allergies) as x(item)
  where length(trim(coalesce(item->>'substance_key', ''))) > 0
    and length(trim(coalesce(item->>'substance_display', ''))) > 0;
  return jsonb_build_object('patientId', v_patient_id, 'status', p_status, 'reviewedAt', v_reviewed_at);
end;
$$;

revoke all on function save_patient_allergies(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function save_patient_allergies(uuid, uuid, text, jsonb) to service_role;

