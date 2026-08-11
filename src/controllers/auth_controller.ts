import { Controller } from '@hotwired/stimulus'
import { supabase, supabaseConfigured } from '../lib/supabase'

export default class AuthController extends Controller {
  static targets = ['email', 'submit', 'status']

  declare readonly emailTarget: HTMLInputElement
  declare readonly submitTarget: HTMLButtonElement
  declare readonly statusTarget: HTMLElement

  connect() {
    if (!supabaseConfigured) {
      this.statusTarget.textContent =
        'Supabase is not configured yet: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env, then rebuild.'
    }
  }

  async send(event: SubmitEvent) {
    event.preventDefault()
    const email = this.emailTarget.value.trim()
    if (!email) return

    this.submitTarget.disabled = true
    this.statusTarget.textContent = 'Sending magic link…'

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin + import.meta.env.BASE_URL },
    })

    this.submitTarget.disabled = false
    this.statusTarget.textContent = error
      ? `Could not send link: ${error.message}`
      : 'Check your email for the sign-in link.'
  }
}
