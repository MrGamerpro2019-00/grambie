import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error(
    "Missing Supabase config. Create a .env file (copy .env.example) with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or add them as environment variables in Vercel."
  );
}

export const supabase = createClient(url, anonKey);

// Usernames are the login identity; Supabase requires an email under the
// hood, so each username maps to a synthetic address it never sends mail to.
export const usernameToEmail = (username) => `${username}@users.grambie.app`;
