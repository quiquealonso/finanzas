-- Mail templates created by the users (back/src/mail-templates.ts): how to read the trade confirmations of a bank
-- that the app did not know (MyInvestor and BBVA stay in the code). Shared by every user: a template one user creates
-- helps everybody with that bank. Each one keeps who created it. Re-runnable.
create table if not exists public.mail_templates (
  id           text        primary key default gen_random_uuid()::text,
  -- Shown name and the regular expression that recognises the bank's name in the app (case-insensitive).
  label        text        not null,
  "bankPattern" text       not null,
  -- Gmail search without the date (the scan adds "after:").
  query        text        not null,
  -- One regular expression per field (see mail-templates.ts → TemplateFields).
  fields       jsonb       not null,
  what         text        not null default 'confirmaciones de operaciones',
  status       text        not null default 'active',
  -- How it was made: e-mails it was tested on and the AI model that proposed it.
  samples      int         not null default 0,
  model        text,
  uses         int         not null default 0,
  "lastUsedAt" timestamptz,
  "createdBy"  text        not null default public.app_user() references public.users(id),
  "createdAt"  timestamptz not null default now()
);
create index if not exists mail_templates_label on public.mail_templates (lower(label));
alter table public.mail_templates enable row level security;
drop policy if exists read_all on public.mail_templates;
drop policy if exists insert_own on public.mail_templates;
drop policy if exists change_own on public.mail_templates;
drop policy if exists delete_own on public.mail_templates;
drop policy if exists use_all on public.mail_templates;
create policy read_all on public.mail_templates for select to finanzas_app using (true);
create policy insert_own on public.mail_templates for insert to finanzas_app with check ("createdBy" = public.app_user());
-- Any user may bump the use counter; only the creator can delete it.
create policy use_all on public.mail_templates for update to finanzas_app using (true) with check (true);
create policy delete_own on public.mail_templates for delete to finanzas_app using ("createdBy" = public.app_user());
revoke update on public.mail_templates from finanzas_app;
grant select, insert, delete on public.mail_templates to finanzas_app;
-- Updates: only the use counters (any user that imports with it), never the template itself.
grant update (uses, "lastUsedAt") on public.mail_templates to finanzas_app;
