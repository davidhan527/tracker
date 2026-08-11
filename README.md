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
4. Authentication → Email Templates → Magic Link: make sure the body includes `{{ .Token }}` (e.g. `<p>Or enter this code: {{ .Token }}</p>`) alongside the link. The sign-in screen accepts this 6-digit code — the only way to sign in inside the installed PWA, where the emailed link opens the browser instead of the app.

Each user only sees their own exercises and entries (RLS, `user_id default auth.uid()`). A "Pushups" exercise is seeded on first sign-in; more can be added in the UI.

## Architecture notes

- Auth uses the implicit flow (`flowType: 'implicit'`): tokens travel in the URL hash, which works on a static-host subpath and when the magic link opens in a different browser than the one that requested it.
- Controllers communicate through window CustomEvents (`session:changed`, `exercises:changed`, `entries:changed`) — no shared state container.
- The service worker only precaches the app shell; data always comes from Supabase (offline logging is a possible future addition).
