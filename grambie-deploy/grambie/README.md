# Grambie

An Instagram-style social app: username-only accounts (no email), posts with
photos, likes, comments, followers/following, profiles, search, and an explore
grid. Built with React + Vite + Tailwind, backed by Supabase (auth, Postgres,
image storage). Deploys free on Vercel.

**New here? Open `SETUP-GUIDE.md` and follow it top to bottom.**

## Quick reference

```bash
npm install        # install dependencies
cp .env.example .env   # then paste in your Supabase URL + anon key
npm run dev        # local dev server
npm run build      # production build (Vercel runs this for you)
```

Database schema + security policies live in `supabase-setup.sql` — run it once
in the Supabase SQL Editor.
