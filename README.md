# Rep Tracker

A small installable web app for logging exercise reps — pushups today, pullups tomorrow.

**Live:** https://davidhan527.github.io/tracker/

## Stack

- [Vite](https://vite.dev/) + TypeScript
- [Stimulus](https://stimulus.hotwired.dev/) — HTML-first controllers, no virtual DOM
- [Supabase](https://supabase.com/) — Postgres + magic-link auth, free tier
- [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) — installable, app-shell precache
- GitHub Pages via Actions ([deploy.yml](.github/workflows/deploy.yml))

## Development

```sh
npm install
npm run dev       # http://localhost:5173/tracker/
npm run build     # typecheck + production build
npm run preview   # serve dist/ at http://localhost:4173/tracker/
npm run lint
```

## Supabase setup

1. Create a free project at [supabase.com](https://supabase.com/) and put its URL and publishable key in [.env](.env). The publishable key is public by design; row-level security enforces data access.
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the project's SQL editor.
3. Authentication → URL Configuration: set Site URL to `https://davidhan527.github.io/tracker/` and add `http://localhost:5173/tracker/` and `http://localhost:4173/tracker/` as additional redirect URLs.
4. Optional — nicer PWA sign-in: editing email templates requires custom SMTP (free tiers: Resend, Brevo, or Gmail). With SMTP set up, add `{{ .Token }}` to the Magic Link template body so the email carries a 6-digit code the sign-in screen accepts. Without SMTP, the built-in template is link-only; inside the installed PWA (where the link opens the browser instead of the app), long-press the emailed link → Copy Link and paste it into the sign-in screen — the app verifies its `token` hash directly. The pasted link must not have been opened first (single-use).

Each vertical owns its tables — `exercises`/`exercise_entries` (with a unit: reps, minutes, km), `books`/`book_entries` (pages), `habits`/`habit_entries` (yes/no per day, enforced by `unique(habit_id, done_on)`) — all RLS-scoped via `user_id default auth.uid()`. The UI consolidates them client-side in [src/lib/data.ts](src/lib/data.ts). A "Pushups" exercise is seeded on first sign-in. Databases on the older unified schema need the migration commented at the bottom of [supabase/schema.sql](supabase/schema.sql).

## Architecture notes

- Auth uses the implicit flow (`flowType: 'implicit'`): tokens travel in the URL hash, which works on a static-host subpath and when the magic link opens in a different browser than the one that requested it.
- Controllers communicate through window CustomEvents (`session:changed`, `exercises:changed`, `entries:changed`) — no shared state container.
- The service worker only precaches the app shell; data always comes from Supabase (offline logging is a possible future addition).
