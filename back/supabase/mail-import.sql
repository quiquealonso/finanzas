-- Import from e-mail (back/src/mail-import.ts): per-user memory of the last import, and per-user "already imported"
-- marks. Re-runnable: every statement is idempotent.

-- Last import of each user: when, up to which e-mail date, and which banks were picked (next import starts there).
create table if not exists public.mail_import_state (
  "userId"       text        primary key default public.app_user(),
  "lastImportAt" timestamptz,
  "lastMailDate" date,
  banks          text[]      not null default '{}'
);
alter table public.mail_import_state enable row level security;
drop policy if exists app_user_rows on public.mail_import_state;
create policy app_user_rows on public.mail_import_state for all to finanzas_app
  using ("userId" = public.app_user()) with check ("userId" = public.app_user());
grant select, insert, update, delete on public.mail_import_state to finanzas_app;

-- "Already imported" marks of e-mails (external_operations, source 'mail') were one per e-mail for everybody: the
-- second user importing the same e-mail could not save its own mark (2026-11-24 duplicates in user1). From now on the
-- key starts with the user ("user2|MyInvestor|2026-01-05|..."). Existing marks get their owner's prefix.
update public.external_operations e
   set "externalId" = a."userId" || '|' || e."externalId"
  from public.assets a
 where a.id = e."assetId" and e.source = 'mail' and e."externalId" !~ '^user[0-9]+\|';
