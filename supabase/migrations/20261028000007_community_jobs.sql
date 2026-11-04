begin;
alter table community_private.jobs drop constraint jobs_state_check;
alter table community_private.jobs add check(state in ('pending','running','done','failed'));
create function community_private.worker_tick() returns jsonb language plpgsql security definer set search_path='' as $$
declare j record; r record; z record; outgoing jsonb:='[]'; begin
 if not community_private.ready() then return outgoing; end if;
 -- A crashed push delivery is surfaced rather than silently discarded.
 with expired as (update community_private.jobs set state='failed' where state='running' and due_at<now() returning id)
 insert into community_private.operations_alerts(job_id,code) select id,'delivery_interrupted' from expired on conflict(job_id) do nothing;
 for j in select * from community_private.jobs where state='pending' and due_at<=now() order by due_at for update skip locked limit 30 loop
  begin
   if j.kind='publish' then
    select * into r from community_private.revisions where id=j.reference_id for update;
    if r.state='normal' and r.publish_after<=now() and not exists(select 1 from community_private.revisions n where (n.post_id=r.post_id or n.comment_id=r.comment_id) and (n.created_at,n.id)>(r.created_at,r.id)) then
     if r.post_id is not null then
      update community.posts set published_revision_id=r.id,state='published',published_at=coalesce(published_at,now()) where id=r.post_id and state<>'removed';
      if found then delete from community.post_tags where post_id=r.post_id; insert into community.post_tags select r.post_id,v from unnest(r.tags) v on conflict do nothing; end if;
     else update community.comments set published_revision_id=r.id,state='published',published_at=coalesce(published_at,now()) where id=r.comment_id and state<>'removed'; end if;
     update community_private.revisions set state='published' where id=r.id;
    end if;
   elsif j.kind='deadline' then
    select * into z from community_private.cases where id=j.reference_id for update;
    if z.status<>'closed' and z.responded_at is null and z.response_due<=now() then
     if z.reveal_eligible then insert into community_private.reveal_requests(case_id) values(z.id) on conflict do nothing; end if;
     insert into community_private.case_events(case_id,event) values(z.id,'no_response_review_required');
    end if;
   elsif j.kind='push' then
    update community_private.jobs set state='running',due_at=now()+interval '2 minutes',attempts=attempts+1 where id=j.id;
    outgoing:=outgoing||jsonb_build_array(jsonb_build_object('jobId',j.id,'tokens',coalesce((select jsonb_agg(distinct d.token) from community_private.notification_outbox n join community_private.devices d on d.member_id=n.recipient_id where n.id=j.reference_id),'[]')));
    continue;
   end if;
   update community_private.jobs set state='done',attempts=attempts+1 where id=j.id;
  exception when others then
   update community_private.jobs set state='failed',attempts=attempts+1 where id=j.id;
   insert into community_private.operations_alerts(job_id,code) values(j.id,'job_failed') on conflict(job_id) do nothing;
  end;
 end loop; return outgoing;
end $$;
create function community_private.finish_push(job uuid,delivered boolean) returns void language plpgsql security definer set search_path='' as $$
declare message uuid; begin
 update community_private.jobs set state=case when delivered then 'done' else 'failed' end where id=job and kind='push' and state='running' returning reference_id into message;
 if not found then return; end if;
 if delivered then update community_private.notification_outbox set delivered_at=now() where id=message;
 else insert into community_private.operations_alerts(job_id,code) values(job,'delivery_failed') on conflict(job_id) do nothing; end if;
end $$;
create function community_private.read_alerts(proof text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=community_private.actor(proof); begin
 if not community_private.is_professional(a) or not exists(select 1 from community_private.settings where key='on_call' and value @> to_jsonb(array[a::text])) then raise exception 'Forbidden' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'code',code,'createdAt',created_at)) from community_private.operations_alerts where resolved_at is null),'[]');
end $$;
revoke all on function community_private.worker_tick(),community_private.finish_push(uuid,boolean),community_private.read_alerts(text) from public,anon,authenticated,service_role;
grant execute on function community_private.worker_tick(),community_private.finish_push(uuid,boolean) to medbrief_community_worker;
grant execute on function community_private.read_alerts(text) to medbrief_community_runtime;
commit;
