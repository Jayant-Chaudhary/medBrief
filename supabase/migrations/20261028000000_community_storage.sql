-- Storage only. No direct access granted to runtime roles or clients.
begin;
create table community.tags(id uuid primary key default gen_random_uuid(),slug text unique not null,name text not null,active boolean not null default true);
create table community.posts(id uuid primary key default gen_random_uuid(),author_id uuid not null references community.members,state text not null default 'pending' check(state in ('pending','published','held','removed')),published_revision_id uuid,published_at timestamptz,created_at timestamptz not null default now());
create table community.comments(id uuid primary key default gen_random_uuid(),post_id uuid not null references community.posts,author_id uuid not null references community.members,parent_id uuid,state text not null default 'pending' check(state in ('pending','published','held','removed')),published_revision_id uuid,published_at timestamptz,created_at timestamptz not null default now(),unique(id,post_id),foreign key(parent_id,post_id) references community.comments(id,post_id),check(parent_id is null or parent_id<>id));
create function community_private.immutable_parent() returns trigger language plpgsql set search_path='' as $$ begin
 if new.parent_id is distinct from old.parent_id or new.post_id<>old.post_id then raise exception 'Immutable parent'; end if; return new; end $$;
create trigger immutable_parent before update on community.comments for each row execute function community_private.immutable_parent();
create table community_private.revisions(id uuid primary key default gen_random_uuid(),post_id uuid references community.posts,comment_id uuid references community.comments,title text,body text not null,tags uuid[] not null default '{}',state text not null default 'pending' check(state in ('pending','normal','held','error','published','superseded')),tier text check(tier in ('normal','soon','urgent')),screening jsonb,publish_after timestamptz,created_at timestamptz not null default now(),check(num_nonnulls(post_id,comment_id)=1),unique(id,post_id),unique(id,comment_id));
alter table community.posts add foreign key(published_revision_id,id) references community_private.revisions(id,post_id);
alter table community.comments add foreign key(published_revision_id,id) references community_private.revisions(id,comment_id);
create table community.post_tags(post_id uuid references community.posts,tag_id uuid references community.tags,primary key(post_id,tag_id));
create index community_feed on community.posts(published_at desc,id) where state='published';
create index community_replies on community.comments(post_id,parent_id,published_at,id);
create index community_tag_posts on community.post_tags(tag_id,post_id);
create table community_private.reports(id uuid primary key default gen_random_uuid(),reporter_id uuid not null references community.members,post_id uuid references community.posts,comment_id uuid references community.comments,category text not null check(category in ('worried','abuse')),created_at timestamptz not null default now(),check(num_nonnulls(post_id,comment_id)=1));
create unique index one_post_report on community_private.reports(reporter_id,post_id) where post_id is not null;
create unique index one_comment_report on community_private.reports(reporter_id,comment_id) where comment_id is not null;
create table community_private.cases(id uuid primary key default gen_random_uuid(),subject_id uuid not null references community.members,post_id uuid references community.posts,comment_id uuid references community.comments,tier text not null check(tier in ('normal','soon','urgent')),reason text not null,status text not null default 'open' check(status in ('open','outreach','responded','closed')),assigned_id uuid references community.members,response_due timestamptz,responded_at timestamptz,created_at timestamptz not null default now(),closed_at timestamptz,closure_reason text,check(num_nonnulls(post_id,comment_id)=1));
create unique index open_post_case on community_private.cases(post_id) where status<>'closed' and post_id is not null;
create unique index open_comment_case on community_private.cases(comment_id) where status<>'closed' and comment_id is not null;
create table community_private.case_events(id uuid primary key default gen_random_uuid(),case_id uuid not null references community_private.cases,actor_id uuid references community.members,event text not null,created_at timestamptz not null default now());
create table community_private.care_threads(id uuid primary key default gen_random_uuid(),case_id uuid not null unique references community_private.cases,subject_id uuid not null references community.members,closed_at timestamptz);
create table community_private.care_participants(thread_id uuid references community_private.care_threads,professional_id uuid references community.members,revoked_at timestamptz,primary key(thread_id,professional_id));
create table community_private.messages(id uuid primary key default gen_random_uuid(),thread_id uuid not null references community_private.care_threads,sender_id uuid references community.members,sender_type text not null check(sender_type in ('system','mother','professional')),body text not null,screening jsonb,created_at timestamptz not null default now());
create table community_private.responses(id uuid primary key default gen_random_uuid(),case_id uuid not null references community_private.cases,kind text not null check(kind in ('opened','replied','okay','help')),created_at timestamptz not null default now());
create table community_private.receipts(message_id uuid references community_private.messages,recipient_id uuid references community.members,opened_at timestamptz not null default now(),primary key(message_id,recipient_id));
create table community_private.jobs(id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('publish','deadline','push')),reference_id uuid not null,dedup_key text unique not null,due_at timestamptz not null,state text not null default 'pending' check(state in ('pending','done','failed')),attempts integer not null default 0);
create table community_private.operations_alerts(id uuid primary key default gen_random_uuid(),job_id uuid unique references community_private.jobs,code text not null,resolved_at timestamptz,created_at timestamptz not null default now());
create table community_private.notification_outbox(id uuid primary key default gen_random_uuid(),recipient_id uuid not null references community.members,message_id uuid not null references community_private.messages,delivered_at timestamptz,unique(recipient_id,message_id));
create table community_private.devices(member_id uuid references community.members,token text not null primary key);
create table community_private.idempotency(member_id uuid references community.members,key uuid not null,operation text not null,response jsonb not null,primary key(member_id,key));
create table community_private.reveal_requests(id uuid primary key default gen_random_uuid(),case_id uuid not null references community_private.cases,status text not null default 'pending' check(status in ('pending','approved','denied','expired')),created_at timestamptz not null default now());
create unique index pending_reveal on community_private.reveal_requests(case_id) where status='pending';
create table community_private.reveal_decisions(request_id uuid references community_private.reveal_requests,approver_id uuid references community.members,decision text not null check(decision in ('approve','deny')),reason text not null check(length(trim(reason))>0),created_at timestamptz not null default now(),response_seen_at timestamptz,primary key(request_id,approver_id,created_at));
create table identity_private.reveal_reviewers(request_id uuid references community_private.reveal_requests,reviewer_id uuid references community.members,assigned_at timestamptz not null default now(),primary key(request_id,reviewer_id));
create table identity_private.reveal_grants(id uuid primary key default gen_random_uuid(),request_id uuid not null unique references community_private.reveal_requests,professional_id uuid not null references community.members,expires_at timestamptz not null,revoked_at timestamptz);
create table identity_private.reveal_audit(id uuid primary key default gen_random_uuid(),grant_id uuid not null references identity_private.reveal_grants,actor_id uuid not null references community.members,action text not null,created_at timestamptz not null default now());
-- Runtime configuration is supplied administratively, not inferred by code.
create table community_private.settings(key text primary key,value jsonb not null);
-- Random, short-lived internal capabilities. Only hashes are stored; never sent to clients.
create table identity_private.capabilities(token_hash bytea primary key,member_id uuid not null references community.members,expires_at timestamptz not null);
do $$ declare r record; begin
 for r in select schemaname,tablename from pg_tables where schemaname in ('community','community_private','identity_private') loop
  execute format('alter table %I.%I enable row level security',r.schemaname,r.tablename);
  execute format('alter table %I.%I force row level security',r.schemaname,r.tablename);
  execute format('revoke all on %I.%I from public,anon,authenticated,service_role',r.schemaname,r.tablename);
 end loop;
end $$;
revoke execute on all functions in schema community_private from public,anon,authenticated,service_role;
commit;
