import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error(
    "Missing Supabase config. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY as environment variables."
  );
}

export const supabase = createClient(url, anonKey);

// Logins use a stable hidden key (not the username) so usernames can be
// changed later without breaking the account. Supabase requires an email
// under the hood; this synthetic address never receives mail.
export const emailForKey = (key) => `${key}@users.grambie.app`;

export const newLoginKey = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2))
    .replace(/-/g, "");
