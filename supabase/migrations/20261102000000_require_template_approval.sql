-- Require explicit clinician approval before a template becomes active.
-- Existing template statuses are not altered by this migration.

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
    when jsonb_typeof(p_template->'clinicianApproved') = 'boolean'
      and p_template->>'clinicianApproved' = 'true' then 'active'
    when p_template ? 'autoCapture' and p_template->'autoCapture'->>'stage' <> 'visit-completed' then 'draft'
    when p_template ? 'autoCapture' then 'draft'
    else 'draft'
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
