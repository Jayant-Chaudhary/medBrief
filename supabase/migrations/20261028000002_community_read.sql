begin;
create function community_private.read_api(proof text,op text,args jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=community_private.actor(proof); t uuid; bucket integer; begin
 if not community_private.ready() then raise exception 'Not configured' using errcode='55000'; end if;
 if op='me' then return (select jsonb_build_object('username',username,'professional',community_private.is_professional(a),'moderator',community_private.is_moderator(a),'consentVersion',(select value from community_private.settings where key='consent_version')) from community.members where community_id=a); end if;
 if op='tags' then return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'slug',slug) order by name) from community.tags where active),'[]'); end if;
 bucket:=(select (value #>> '{}')::integer from community_private.settings where key='timestamp_bucket_seconds');
 if bucket is null or bucket<=0 then raise exception 'Invalid configuration' using errcode='55000'; end if;
 if op in ('feed','post') then
  return coalesce((select jsonb_agg(x.payload order by x.published_at desc,x.id desc) from (
   select p.id,p.published_at,jsonb_build_object('id',p.id,'title',r.title,'body',r.body,'username',m.username,'owned',p.author_id=a,
    'publishedAt',to_timestamp(floor(extract(epoch from p.published_at)/bucket)*bucket),
    'tags',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name)) from community.post_tags pt join community.tags g on g.id=pt.tag_id where pt.post_id=p.id),'[]'),
    'badges',coalesce((select jsonb_agg(role) from community_private.role_grants where community_id=p.author_id and verification_status='verified' and revoked_at is null),'[]'),
    'replyCount',(select count(*) from community.comments where post_id=p.id and state='published')) payload
   from community.posts p join community_private.revisions r on r.id=p.published_revision_id join community.members m on m.community_id=p.author_id
   where p.state='published' and (op<>'post' or p.id=(args->>'id')::uuid)
    and (args->>'tag' is null or exists(select 1 from community.post_tags where post_id=p.id and tag_id=(args->>'tag')::uuid))
    and (args->>'before' is null or (p.published_at,p.id)<(select published_at,id from community.posts where id=(args->>'before')::uuid and state='published'))
   order by p.published_at desc,p.id desc limit 20) x),'[]');
 end if;
 if op='comments' then
  if not exists(select 1 from community.posts where id=(args->>'postId')::uuid and state='published') then raise exception 'Not found' using errcode='P0002'; end if;
  return coalesce((select jsonb_agg(x.payload order by x.created_at,x.id) from (
   select c.id,c.created_at,jsonb_build_object('id',c.id,'parentId',c.parent_id,'body',case when c.state='removed' then 'Comment removed' else r.body end,'username',case when c.state='removed' then null else m.username end,'owned',c.author_id=a,'removed',c.state='removed','hasReplies',exists(select 1 from community.comments z where z.parent_id=c.id and z.state in ('published','removed'))) payload
   from community.comments c left join community_private.revisions r on r.id=c.published_revision_id join community.members m on m.community_id=c.author_id
   where c.post_id=(args->>'postId')::uuid and c.state in ('published','removed') and c.parent_id is not distinct from (args->>'parentId')::uuid
   and (args->>'before' is null or (c.created_at,c.id)>(select created_at,id from community.comments where id=(args->>'before')::uuid and post_id=c.post_id and state in ('published','removed')))
   order by c.created_at,c.id limit 20) x),'[]');
 end if;
 if op='threads' then return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'closed',x.closed_at is not null,'username',m.username)) from community_private.care_threads x join community.members m on m.community_id=x.subject_id where community_private.can_thread(a,x.id)),'[]'); end if;
 if op='messages' then
  t:=(args->>'id')::uuid;
  if not community_private.can_thread(a,t) then raise exception 'Forbidden' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(x.payload order by x.created_at,x.id) from (
   select z.id,z.created_at,jsonb_build_object('id',z.id,'body',z.body,'senderType',z.sender_type,'username',case when z.sender_type='professional' then coalesce((select display_name from community_private.role_grants where community_id=z.sender_id and role in ('doctor','therapist') and verification_status='verified' and revoked_at is null and display_name is not null limit 1),m.username) else m.username end,'createdAt',z.created_at) payload from community_private.messages z left join community.members m on m.community_id=z.sender_id
   where z.thread_id=t and (args->>'before' is null or (z.created_at,z.id)>(select created_at,id from community_private.messages where id=(args->>'before')::uuid and thread_id=t)) order by z.created_at,z.id limit 50) x),'[]');
 end if;
 if op in ('cases','review') then
  if not community_private.is_professional(a) then raise exception 'Forbidden' using errcode='42501'; end if;
  if op='review' then return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'title',r.title,'body',r.body,'state',r.state,'tier',r.tier)) from community_private.revisions r join community_private.cases z on (z.post_id=r.post_id or z.comment_id=r.comment_id) where z.id=(args->>'id')::uuid and z.assigned_id=a and r.state in ('held','error')),'[]'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',z.id,'username',m.username,'tier',z.tier,'status',z.status,'reason',z.reason,'postId',z.post_id,'commentId',z.comment_id,'threadId',x.id,'respondedAt',z.responded_at,'responseDue',z.response_due,'revealRequestId',rr.id)) from community_private.cases z join community.members m on m.community_id=z.subject_id join community_private.care_threads x on x.case_id=z.id left join community_private.reveal_requests rr on rr.case_id=z.id and rr.status in ('pending','approved') where z.assigned_id=a and z.status<>'closed'),'[]');
 end if;
 if op='queue' then
  if not community_private.is_professional(a) or not exists(select 1 from community_private.settings where key='on_call' and value @> to_jsonb(array[a::text])) then raise exception 'Forbidden' using errcode='42501'; end if;
  -- Unassigned queue exposes no subject, text, post, username or thread information.
  return coalesce((select jsonb_agg(jsonb_build_object('id',id,'tier',tier) order by case tier when 'urgent' then 0 when 'soon' then 1 else 2 end,created_at) from community_private.cases where assigned_id is null and status<>'closed'),'[]');
 end if;
 raise exception 'Unknown operation' using errcode='22023';
end $$;
revoke all on function community_private.read_api(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function community_private.read_api(text,text,jsonb) to medbrief_community_runtime;
commit;
