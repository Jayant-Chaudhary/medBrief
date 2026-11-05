begin;
alter table community_private.role_grants add column display_name text;
create function community_private.manage_tags(proof text,args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=community_private.actor(proof); item uuid; begin
 if not community_private.is_moderator(a) then raise exception 'Forbidden' using errcode='42501'; end if;
 if args='{}'::jsonb then return coalesce((select jsonb_agg(jsonb_build_object('id',id,'slug',slug,'name',name,'active',active) order by name) from community.tags),'[]'); end if;
 if coalesce(args->>'slug','') !~ '^[a-z0-9-]{1,60}$' or coalesce(length(trim(args->>'name')),0) not between 1 and 80 then raise exception 'Invalid tag' using errcode='22023'; end if;
 insert into community.tags(slug,name,active) values(args->>'slug',args->>'name',coalesce((args->>'active')::boolean,true)) on conflict(slug) do update set name=excluded.name,active=excluded.active returning id into item;
 return jsonb_build_object('id',item);
end $$;
create function community_private.own_posts(proof text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=community_private.actor(proof); begin
 return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'body',x.body,'state',x.state,'username',x.username,'owned',true,'tags',to_jsonb(x.tags),'replyCount',0) order by x.created_at desc) from (
 select p.id,p.created_at,r.title,r.body,r.state,m.username,array(select jsonb_build_object('id',g.id,'name',g.name) from community.tags g where g.id=any(r.tags)) tags
 from community.posts p join community.members m on m.community_id=p.author_id join lateral(select * from community_private.revisions where post_id=p.id order by created_at desc,id desc limit 1) r on true
 where p.author_id=a and p.state<>'removed' order by p.created_at desc limit 50) x),'[]');
end $$;
revoke all on function community_private.manage_tags(text,jsonb),community_private.own_posts(text) from public,anon,authenticated,service_role;
grant execute on function community_private.manage_tags(text,jsonb),community_private.own_posts(text) to medbrief_community_runtime;
commit;
