-- Login with password (back/src/auth.ts): BCrypt hash of each user's password. Null = cannot log in yet.
-- Set only with `npm run set-password` (back/scripts/set-password.js). Re-runnable.
alter table public.users add column if not exists "passwordHash" text;

-- User name to log in (case-insensitive, unique). The owner's users log in with their id until it is changed.
alter table public.users add column if not exists username text;
create unique index if not exists users_username_key on public.users (lower(coalesce(username, id)));
-- Set when somebody registers from the web (REGISTER_CODE, at most REGISTER_MAX accounts: src/auth.ts).
alter table public.users add column if not exists "registeredAt" timestamptz;

-- Supabase's public roles (Data API) get nothing here; these two functions return no data but are closed anyway.
revoke execute on function public.app_user() from public, anon, authenticated;
grant execute on function public.app_user() to finanzas_app;
do $$ begin
  if to_regprocedure('public.yield_price(text, date)') is not null then
    revoke execute on function public.yield_price(text, date) from public, anon, authenticated;
    grant execute on function public.yield_price(text, date) to finanzas_app;
  end if;
end $$;
