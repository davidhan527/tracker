import { Controller } from '@hotwired/stimulus'
import { supabase, supabaseConfigured } from '../lib/supabase'

export default class AuthController extends Controller {
  static targets = ['email', 'submit', 'status', 'codeForm', 'code']

  declare readonly emailTarget: HTMLInputElement
  declare readonly submitTarget: HTMLButtonElement
  declare readonly statusTarget: HTMLElement
  declare readonly codeFormTarget: HTMLFormElement
  declare readonly codeTarget: HTMLInputElement

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
    if (error) {
      this.statusTarget.textContent = `Could not send link: ${error.message}`
      return
    }
    // the emailed link can't reach an installed PWA (it always opens the browser),
    // so the code path is the reliable way in there
    this.codeFormTarget.hidden = false
    this.statusTarget.textContent =
      'Check your email — tap the link, or type the 6-digit code here (use the code inside the installed app).'
  }

  async verify(event: SubmitEvent) {
    event.preventDefault()
    const email = this.emailTarget.value.trim()
    const token = this.codeTarget.value.trim()
    if (!email || !token) return

    this.setCodeBusy(true)
    this.statusTarget.textContent = 'Verifying…'

    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })

    this.setCodeBusy(false)
    if (error) {
      this.statusTarget.textContent = `Could not verify: ${error.message}`
      return
    }
    // success: onAuthStateChange flips to the app
    this.codeTarget.value = ''
    this.statusTarget.textContent = ''
  }

  private setCodeBusy(busy: boolean) {
    for (const button of this.codeFormTarget.querySelectorAll('button')) button.disabled = busy
  }
}
