-- Login with password (back/src/auth.ts): BCrypt hash of each user's password. Null = cannot log in yet.
-- Set only with `npm run set-password` (back/scripts/set-password.js). Re-runnable.
alter table public.users add column if not exists "passwordHash" text;
