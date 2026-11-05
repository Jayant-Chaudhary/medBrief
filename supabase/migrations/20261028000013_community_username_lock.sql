begin;
-- A member gets one choice per identity period. Only approved reveal rotation
-- opens a new period; reports, flags, requests, denials and contact reads do not.
alter table community.members add column username_choice_available boolean not null default true;

-- Preserve already chosen names when upgrading from the earlier chooser.
-- Ambiguous/tied legacy history is locked conservatively until the next reveal.
update community.members m set username_choice_available=false
where exists(select 1 from community_private.username_history h where h.community_id=m.community_id and h.reason_code='member_request')
and not (
 m.username ~ '^mother_[a-f0-9]{24}$'
 and exists(select 1 from community_private.username_history h
  where h.community_id=m.community_id and h.reason_code='approved_reveal'
   and h.retired_at>(select max(c.retired_at) from community_private.username_history c where c.community_id=m.community_id and c.reason_code='member_request'))
);

create function community_private.apply_username_choice_policy() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.reason_code in ('member_request','approved_reveal') then
  update community.members set username_choice_available=(new.reason_code='approved_reveal')
   where community_id=new.community_id;
 end if;
 return new;
end $$;
revoke all on function community_private.apply_username_choice_policy() from public,anon,authenticated,service_role,medbrief_community_runtime,medbrief_community_worker,medbrief_reveal_service;
create trigger username_choice_policy after insert on community_private.username_history
 for each row execute function community_private.apply_username_choice_policy();

create function community_private.username_status(proof text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=community_private.actor(proof); begin
 return (select jsonb_build_object('canChooseUsername',username_choice_available)
  from community.members where community_id=actor_id);
end $$;
revoke all on function community_private.username_status(text) from public,anon,authenticated,service_role,medbrief_community_worker,medbrief_reveal_service;
grant execute on function community_private.username_status(text) to medbrief_community_runtime;

create or replace function community_private.choose_username(proof text,args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 actor_id uuid:=community_private.actor(proof);
 chosen text:=lower(trim(args->>'username'));
 old_name text;
 choice_available boolean;
 key_id uuid:=(args->>'requestKey')::uuid;
 saved record;
 result jsonb;
begin
 if key_id is null or chosen is null or chosen !~ '^[a-z][a-z0-9_]{2,31}$'
    or chosen ~ '[0-9]{7}' or chosen ~ '^(admin|doctor|dr_|therapist|moderator|medbrief)'
 then raise exception 'Invalid username' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor_id::text||key_id::text,0));
 select * into saved from community_private.idempotency where member_id=actor_id and key=key_id;
 if found then
  if saved.operation<>'choose_username' then raise exception 'Key reused' using errcode='22023'; end if;
  return saved.response;
 end if;
 select username,username_choice_available into old_name,choice_available
  from community.members where community_id=actor_id for update;
 if chosen<>old_name then
  if not choice_available then raise exception 'Username locked' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('username:'||chosen,0));
  if exists(select 1 from community.members where username=chosen)
     or exists(select 1 from community_private.username_history where previous_username=chosen)
  then raise exception 'Username unavailable' using errcode='23505'; end if;
  insert into community_private.username_history(previous_username,community_id,reason_code)
   values(old_name,actor_id,'member_request');
  update community.members set username=chosen,username_changed_at=now() where community_id=actor_id;
 elsif choice_available then
  -- Explicitly confirming the current name also consumes the initial choice.
  update community.members set username_choice_available=false where community_id=actor_id;
 end if;
 result:=jsonb_build_object('username',chosen);
 insert into community_private.idempotency values(actor_id,key_id,'choose_username',result);
 return result;
end $$;
commit;
