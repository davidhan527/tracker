import { Application } from '@hotwired/stimulus'
import { registerSW } from 'virtual:pwa-register'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import AuthController from './controllers/auth_controller'
import ExercisesController from './controllers/exercises_controller'
import LoggerController from './controllers/logger_controller'
import HistoryController from './controllers/history_controller'
import './style.css'

registerSW({ immediate: true })

const application = Application.start()
application.register('auth', AuthController)
application.register('exercises', ExercisesController)
application.register('logger', LoggerController)
application.register('history', HistoryController)

const authSection = document.getElementById('auth')!
const appMain = document.getElementById('app')!

let signedIn: boolean | null = null

function applySession(session: Session | null) {
  const next = session !== null
  if (next === signedIn) return
  signedIn = next
  authSection.hidden = next
  appMain.hidden = !next
  window.dispatchEvent(new CustomEvent('session:changed', { detail: { session } }))
}

// fires INITIAL_SESSION on load, so this also handles the first paint
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && location.hash) {
    // supabase-js consumes the magic-link tokens but leaves them in the URL
    history.replaceState(null, '', location.pathname + location.search)
  }
  applySession(session)
})

document.getElementById('signout')!.addEventListener('click', () => {
  void supabase.auth.signOut()
})
