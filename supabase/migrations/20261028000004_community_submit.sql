begin;
-- Only the isolated safety processor has EXECUTE. The public API cannot supply a
-- screening result to this function: it forwards raw input to that processor.
create function community_private.submit_screened(proof text,op text,args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=community_private.actor(proof); p uuid; c uuid; r uuid; k uuid; key_id uuid:=(args->>'requestKey')::uuid; saved record; result jsonb; delay_seconds double precision; begin
 if not community_private.ready() then raise exception 'Not configured' using errcode='55000'; end if;
 if key_id is null then raise exception 'Key required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(a::text||key_id::text,0));
 select * into saved from community_private.idempotency where member_id=a and key=key_id;
 if found then if saved.operation<>op then raise exception 'Key reused' using errcode='22023'; end if; return saved.response; end if;
 if op not in ('create_post','edit_post','create_comment','edit_comment') or coalesce(length(args->>'body'),0) not between 1 and 10000 or coalesce(args->>'state','') not in ('normal','held','error') or coalesce(args->>'tier','') not in ('normal','soon','urgent') then raise exception 'Invalid content' using errcode='22023'; end if;
 if op like '%post' and coalesce(length(args->>'title'),0) not between 1 and 200 then raise exception 'Invalid title' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements_text(coalesce(args->'tags','[]')) v where not exists(select 1 from community.tags where id=v::uuid and active)) then raise exception 'Invalid tag' using errcode='22023'; end if;
 if op='create_post' then insert into community.posts(author_id) values(a) returning id into p;
 elsif op='create_comment' then
  if not exists(select 1 from community.posts where id=(args->>'postId')::uuid and state='published') or (args->>'parentId' is not null and not exists(select 1 from community.comments where id=(args->>'parentId')::uuid and post_id=(args->>'postId')::uuid and state in ('published','removed'))) then raise exception 'Not found' using errcode='P0002'; end if;
  insert into community.comments(post_id,author_id,parent_id) values((args->>'postId')::uuid,a,(args->>'parentId')::uuid) returning id into c;
 elsif op='edit_post' then select id into p from community.posts where id=(args->>'id')::uuid and author_id=a and state<>'removed' for update;
 else select id into c from community.comments where id=(args->>'id')::uuid and author_id=a and state<>'removed' for update; end if;
 if p is null and c is null then raise exception 'Not found' using errcode='P0002'; end if;
 update community_private.revisions set state='superseded' where (post_id=p or comment_id=c) and state in ('normal','pending');
 delay_seconds:=(select (value->>'min')::double precision+random()*((value->>'max')::double precision-(value->>'min')::double precision) from community_private.settings where key='publication_delay_seconds');
 if delay_seconds is null or delay_seconds<0 then raise exception 'Invalid configuration' using errcode='55000'; end if;
 insert into community_private.revisions(post_id,comment_id,title,body,tags,state,tier,screening,publish_after) values(p,c,args->>'title',args->>'body',array(select jsonb_array_elements_text(coalesce(args->'tags','[]'))::uuid),args->>'state',args->>'tier',args->'screening',now()+make_interval(secs=>delay_seconds)) returning id into r;
 if args->>'state'='normal' and args->>'tier'='normal' then insert into community_private.jobs(kind,reference_id,dedup_key,due_at) values('publish',r,'publish:'||r,now()+make_interval(secs=>delay_seconds));
 else k:=community_private.open_case(p,c,case when args->>'tier'='urgent' then 'urgent' else 'soon' end,'content_review',a); end if;
 if args->>'state'='error' then insert into community_private.operations_alerts(code) values('screening_unavailable'); end if;
 result:=jsonb_build_object('id',coalesce(p,c),'state',case when args->>'state'='normal' then 'pending' else 'held' end);
 insert into community_private.idempotency values(a,key_id,op,result); return result;
end $$;
revoke all on function community_private.submit_screened(text,text,jsonb) from public,anon,authenticated,service_role,medbrief_community_runtime;
grant execute on function community_private.submit_screened(text,text,jsonb) to medbrief_community_worker;
commit;
