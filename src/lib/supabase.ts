import { createClient } from '@supabase/supabase-js'

// implicit flow keeps auth tokens in the URL hash, so magic links work on a
// static-host subpath and in a different browser than the one that requested them
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { flowType: 'implicit' } },
)

export const supabaseConfigured = !import.meta.env.VITE_SUPABASE_URL.includes('YOUR-PROJECT')
