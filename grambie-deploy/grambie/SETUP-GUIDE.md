# Grambie — Setup Guide (from zero to your custom domain)

Follow these steps in order. No coding needed — just copy, paste, and click.
Total time: about 30–45 minutes. Total cost: $0 (you already bought the domain).

---

## Part 1 — Supabase (your database) · ~10 min

Supabase stores your users, posts, likes, comments, follows, and photos.

1. Go to **supabase.com** → Sign up (the free plan is all you need).
2. Click **New project**.
   - Name: `grambie`
   - Database password: make one up and save it somewhere (you won't need it day-to-day).
   - Region: pick the one closest to you (e.g. East US).
   - Click **Create new project** and wait ~2 minutes while it provisions.
3. **Create the database tables:**
   - In the left sidebar, click **SQL Editor** → **New query**.
   - Open the file `supabase-setup.sql` from this project, copy ALL of it, paste it in, and click **Run**.
   - You should see "Success. No rows returned." That's correct.
4. **Turn off email confirmation** (this is what makes "no email required" work):
   - Left sidebar → **Authentication** → **Sign In / Up** (on some versions it's under **Providers → Email**).
   - Find the **"Confirm email"** toggle and turn it **OFF**, then **Save**.
   - While you're there, make sure the **Email** provider itself is enabled (it is by default).
5. **Copy your two keys:**
   - Left sidebar → ⚙️ **Project Settings** → **API** (or **Data API**).
   - Copy the **Project URL** (looks like `https://abcdefgh.supabase.co`).
   - Copy the **anon / public** key (a long string — NOT the service_role key).
   - Keep these handy for Part 3.

> Why no email? Grambie logs people in with username + password. Under the
> hood each username maps to a synthetic address like `username@users.grambie.app`
> that never receives mail — which is why confirmation must be off.

---

## Part 2 — Put the code on GitHub · ~5 min

Vercel deploys straight from GitHub, so the code needs to live there.

1. Go to **github.com** → Sign up (free) if you don't have an account.
2. Click **+** (top right) → **New repository**.
   - Name: `grambie` · keep it **Public** or **Private** (either works) → **Create repository**.
3. On the new repo page, click the **"uploading an existing file"** link.
4. Drag in everything from this project folder **except** any `node_modules` folder:
   - `package.json`, `vite.config.js`, `index.html`, `.gitignore`, `.env.example`, `supabase-setup.sql`, `README.md`
   - the whole `src` folder (drag the folder itself — GitHub keeps the structure)
5. Click **Commit changes**.

> Comfortable with the terminal instead? `git init && git add . && git commit -m "grambie" `
> then push to the repo GitHub gives you. Same result.

---

## Part 3 — Vercel (free hosting) · ~5 min

1. Go to **vercel.com** → **Sign up** → choose **Continue with GitHub**.
2. Click **Add New… → Project** → find your `grambie` repo → **Import**.
3. Vercel auto-detects Vite. Before deploying, open **Environment Variables** and add both:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | your Project URL from Part 1, step 5 |
   | `VITE_SUPABASE_ANON_KEY` | your anon public key from Part 1, step 5 |

4. Click **Deploy**. After ~1 minute you'll get a live URL like `grambie.vercel.app`.
5. **Test it now:** open that URL, sign up with a username + password, post a photo.
   If that works, everything works — the domain is just a label on top.

---

## Part 4 — Connect your Porkbun domain · ~10 min (+ DNS wait)

1. In Vercel: your project → **Settings → Domains** → type your domain
   (e.g. `grambie.com`) → **Add**. Vercel will show you the DNS records it
   wants — usually an **A record** (`76.76.21.21`) for the root domain and a
   **CNAME** (`cname.vercel-dns.com`) for `www`. Keep this page open.
2. In Porkbun: **Account → Domain Management** → click your domain → **DNS Records** (the "DNS" button).
3. **Delete Porkbun's parking records first** — there are usually two default
   records pointing at `pixie.porkbun.com` (an ALIAS/A on the root and a CNAME on
   `www`). Trash both, or your domain will keep showing Porkbun's parking page.
4. Add the records Vercel asked for (copy the exact values from the Vercel page):
   - Type **A** · Host: *(leave blank for root)* · Answer: `76.76.21.21`
   - Type **CNAME** · Host: `www` · Answer: `cname.vercel-dns.com`
5. Back in Vercel, the domain page will flip from "Invalid configuration" to a
   green checkmark once DNS propagates — usually 5–30 minutes, occasionally a
   few hours. HTTPS (the padlock) is added automatically; nothing to do.

🎉 That's it — Grambie is live on your own domain.

---

## Updating the app later

Edit a file on GitHub (or ask Claude for changes and re-upload the file) →
commit → Vercel redeploys automatically in about a minute.

## Troubleshooting

- **"Almost there — turn OFF Confirm email" when signing up** → Part 1, step 4 wasn't saved. Toggle it off and retry.
- **Blank page on Vercel** → Environment variables missing or typo'd. Check Settings → Environment Variables, then **Redeploy** (Deployments → ⋯ → Redeploy).
- **Photos won't upload** → The storage section of `supabase-setup.sql` didn't run. Re-run just that bottom section in the SQL Editor.
- **Domain still shows Porkbun parking page** → The default `pixie.porkbun.com` records weren't deleted (Part 4, step 3), or DNS is still propagating — give it time.
- **Lost password** → There's no reset flow (no emails!). As the owner you can delete the user in Supabase → Authentication → Users so the username can re-register.

## Good to know

- You're running a real public site: anyone can sign up and post images. You're
  the moderator — you can delete any user or post from the Supabase dashboard
  (Table Editor → posts/profiles).
- Free-tier limits (Supabase: 500 MB database + 1 GB storage; Vercel: 100 GB
  bandwidth/month) are far more than enough to start. You'd only pay if Grambie
  genuinely takes off — a good problem.
- Nice upgrades to ask Claude for later: realtime feed updates, DMs, an activity
  tab, password reset via optional email, image moderation.
