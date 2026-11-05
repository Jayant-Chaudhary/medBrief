-- Disposable test database only, before migration 12 is reapplied.
insert into community.members(community_id,username) values
 ('80000000-0000-4000-8000-000000000001','fixed_garden'),
 ('80000000-0000-4000-8000-000000000002','mother_aaaaaaaaaaaaaaaaaaaaaaaa'),
 ('80000000-0000-4000-8000-000000000003','mother_bbbbbbbbbbbbbbbbbbbbbbbb'),
 ('80000000-0000-4000-8000-000000000004','mother_cccccccccccccccccccccccc');
insert into community_private.username_history(previous_username,community_id,reason_code,retired_at) values
 ('original_garden','80000000-0000-4000-8000-000000000001','member_request',now()-interval '2 hours'),
 ('original_meadow','80000000-0000-4000-8000-000000000003','member_request',now()-interval '2 hours'),
 ('exposed_meadow','80000000-0000-4000-8000-000000000003','approved_reveal',now()-interval '1 hour'),
 ('original_cloud','80000000-0000-4000-8000-000000000004','member_request','2026-01-01 00:00:00Z'),
 ('exposed_cloud','80000000-0000-4000-8000-000000000004','approved_reveal','2026-01-01 00:00:00Z');
\ir ../migrations/20261028000012_community_username_lock.sql
do $$ begin
 if (select username_choice_available from community.members where username='fixed_garden') then raise exception 'Legacy choice was unlocked'; end if;
 if not (select username_choice_available from community.members where username='mother_aaaaaaaaaaaaaaaaaaaaaaaa') then raise exception 'First choice was locked'; end if;
 if not (select username_choice_available from community.members where username='mother_bbbbbbbbbbbbbbbbbbbbbbbb') then raise exception 'Revealed legacy member was not unlocked'; end if;
 if (select username_choice_available from community.members where username='mother_cccccccccccccccccccccccc') then raise exception 'Ambiguous history was unlocked'; end if;
end $$;
delete from community_private.username_history where community_id in
 ('80000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000004');
delete from community.members where community_id in
 ('80000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000004');
\echo 'Username lock upgrade/backfill passed.'
