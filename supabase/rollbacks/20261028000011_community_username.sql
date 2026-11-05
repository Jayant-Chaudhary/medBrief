begin;
-- Removes the capability, preserving current usernames and reserved history.
drop function community_private.choose_username(text,jsonb);
commit;
