-- ============================================================
-- Consultation Audio Pipeline — Phase 6 Schema Migration
-- Atomic Draft Review & Notes Persistence
-- Target: Supabase (PostgreSQL)
-- ============================================================

create or replace function review_consult_draft_atomic(
  p_session_id uuid,
  p_draft_id uuid default null,
  p_doctor_id uuid default null,
  p_action text default 'approve',
  p_edited_doctor_notes jsonb default null,
  p_notes_text text default null,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_session record;
  v_draft record;
  v_updated_draft jsonb;
  v_reasons text[];
begin
  -- 1. Validate session
  select id, appointment_id, doctor_id
  into v_session
  from consult_sessions
  where id = p_session_id;

  if not found then
    raise exception 'Session not found' using errcode = 'P0002';
  end if;

  if p_doctor_id is not null and v_session.doctor_id <> p_doctor_id then
    raise exception 'Only the attending doctor can review this draft' using errcode = '42501';
  end if;

  -- 2. Validate draft
  if p_draft_id is not null then
    select *
    into v_draft
    from consult_drafts
    where id = p_draft_id and session_id = p_session_id;

    if not found then
      raise exception 'Draft not found for this session' using errcode = 'P0002';
    end if;

    -- Check if newer draft exists (reject stale review)
    if exists (
      select 1 from consult_drafts
      where session_id = p_session_id
        and created_at > v_draft.created_at
    ) then
      raise exception 'Stale draft review: a newer draft exists' using errcode = '23505';
    end if;
  else
    select *
    into v_draft
    from consult_drafts
    where session_id = p_session_id
    order by created_at desc
    limit 1;

    if not found then
      raise exception 'No draft found to review' using errcode = 'P0002';
    end if;
  end if;

  -- 3. Idempotent repeated approval check
  if v_draft.status = 'approved' and p_action = 'approve' then
    select to_jsonb(v_draft) into v_updated_draft;
    return v_updated_draft;
  end if;

  -- 4. Process Action
  if p_action = 'approve' then
    -- Atomically upsert consultation notes
    if p_notes_text is not null then
      insert into consultation_notes (
        appointment_id,
        clinician_id,
        notes_text,
        updated_at
      ) values (
        v_session.appointment_id,
        v_session.doctor_id,
        p_notes_text,
        now()
      )
      on conflict (appointment_id)
      do update set
        notes_text = excluded.notes_text,
        clinician_id = excluded.clinician_id,
        updated_at = now();
    end if;

    -- Atomically update consult_drafts
    update consult_drafts
    set
      status = 'approved',
      doctor_notes = coalesce(p_edited_doctor_notes, doctor_notes),
      updated_at = now()
    where id = v_draft.id
    returning to_jsonb(consult_drafts.*) into v_updated_draft;

  elsif p_action = 'reject' then
    v_reasons := coalesce(v_draft.review_reasons, array[]::text[]);
    if p_rejection_reason is not null then
      v_reasons := array_append(v_reasons, 'rejected: ' || p_rejection_reason);
    end if;

    update consult_drafts
    set
      status = 'rejected',
      review_reasons = v_reasons,
      updated_at = now()
    where id = v_draft.id
    returning to_jsonb(consult_drafts.*) into v_updated_draft;
  else
    raise exception 'Invalid review action. Must be "approve" or "reject"' using errcode = '22023';
  end if;

  return v_updated_draft;
end;
$$;

grant execute on function review_consult_draft_atomic to authenticated, service_role;

-- Audio Retention Cleanup Tracking
alter table consult_sessions add column if not exists audio_cleaned_at timestamptz;
create index if not exists idx_consult_sessions_audio_cleanup on consult_sessions(audio_cleaned_at) where audio_cleaned_at is null;

