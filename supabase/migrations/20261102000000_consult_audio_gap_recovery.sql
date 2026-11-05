-- Recovery evidence uses the same private, participant-readable table.
-- Clients write through scoped, authenticated Node routes only.
alter table public.consult_audio_gaps drop constraint consult_audio_gaps_reason_code_check;
alter table public.consult_audio_gaps add constraint consult_audio_gaps_reason_code_check check (
  reason_code in ('phone_call', 'focus_lost', 'permission_revoked', 'recorder_error',
                  'unknown', 'retention_expired', 'storage_lost', 'user_discarded')
);
drop policy if exists "Participants can insert session gaps" on public.consult_audio_gaps;
revoke insert, update, delete on public.consult_audio_gaps from anon, authenticated;
