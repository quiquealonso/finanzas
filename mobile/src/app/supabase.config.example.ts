// Copy to supabase.config.ts (ignored by git) and fill in with the values of your Supabase project
// (Project settings > API). The anon (public) key is meant to ship in clients: the data is protected by the login
// plus the owner check inside the RPC functions (back/supabase/mobile.sql). Never put the service_role key or the
// database password here.
export const SUPABASE_URL = 'https://<proyecto>.supabase.co';
export const SUPABASE_ANON_KEY = '<anon-key>';
