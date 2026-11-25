-- Demo user: a fictitious portfolio (scripts/demo-seed.js) whose API answers are saved as the data of the demo mode of
-- the front (front/public/demo/, scripts/demo-fixtures.js). Nobody logs in as "demo": it has no password and the
-- login screen does not list it. Re-runnable.
insert into public.users (id, name) values ('demo', 'Demo') on conflict (id) do nothing;
