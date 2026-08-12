import { Application } from '@hotwired/stimulus'
import { registerSW } from 'virtual:pwa-register'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import ActivitiesController from './controllers/activities_controller'
import AuthController from './controllers/auth_controller'
import ChartController from './controllers/chart_controller'
import DashboardController from './controllers/dashboard_controller'
import LoggerController from './controllers/logger_controller'
import './style.css'

registerSW({ immediate: true })

const application = Application.start()
application.register('activities', ActivitiesController)
application.register('auth', AuthController)
application.register('chart', ChartController)
application.register('dashboard', DashboardController)
application.register('logger', LoggerController)

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
  // local scope: sign out this device only — the default 'global' revokes every device
  void supabase.auth.signOut({ scope: 'local' })
})

const logSheet = document.getElementById('log-sheet') as HTMLDialogElement
document.getElementById('open-log')!.addEventListener('click', () => logSheet.showModal())
document.getElementById('close-log')!.addEventListener('click', () => logSheet.close())
// clicking the dimmed backdrop closes the sheet; inside the panel event targets are children
logSheet.addEventListener('click', (event) => {
  if (event.target === logSheet) logSheet.close()
})
