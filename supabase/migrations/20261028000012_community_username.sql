begin;
-- Runtime callers may change only their own public pseudonym. No mapping access.
create function community_private.choose_username(proof text,args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 actor_id uuid:=community_private.actor(proof);
 chosen text:=lower(trim(args->>'username'));
 old_name text;
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
 select username into old_name from community.members where community_id=actor_id for update;
 if chosen<>old_name then
  perform pg_advisory_xact_lock(hashtextextended('username:'||chosen,0));
  if exists(select 1 from community.members where username=chosen)
     or exists(select 1 from community_private.username_history where previous_username=chosen)
  then raise exception 'Username unavailable' using errcode='23505'; end if;
  insert into community_private.username_history(previous_username,community_id,reason_code)
   values(old_name,actor_id,'member_request');
  update community.members set username=chosen,username_changed_at=now() where community_id=actor_id;
 end if;
 result:=jsonb_build_object('username',chosen);
 insert into community_private.idempotency values(actor_id,key_id,'choose_username',result);
 return result;
end $$;
revoke all on function community_private.choose_username(text,jsonb)
 from public,anon,authenticated,service_role,medbrief_reveal_service,medbrief_community_worker;
grant execute on function community_private.choose_username(text,jsonb) to medbrief_community_runtime;
commit;
