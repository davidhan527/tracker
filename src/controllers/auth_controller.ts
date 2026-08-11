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
    // so pasting the unclicked link (or a code, with custom SMTP) is the way in there
    this.codeFormTarget.hidden = false
    this.statusTarget.textContent =
      'Check your email — tap the link, or copy it and paste it here without opening it.'
  }

  async verify(event: SubmitEvent) {
    event.preventDefault()
    const email = this.emailTarget.value.trim()
    const raw = this.codeTarget.value.trim()
    if (!raw) return

    let params: { email: string; token: string; type: 'email' } | { token_hash: string; type: 'email' }
    if (/^\d{6,8}$/.test(raw)) {
      if (!email) return
      params = { email, token: raw, type: 'email' }
    } else {
      // emailed verify URL: https://<ref>.supabase.co/auth/v1/verify?token=<hash>&…
      // the link is single-use — this only works if it wasn't opened in a browser first
      const tokenHash = extractTokenHash(raw)
      if (!tokenHash) {
        this.statusTarget.textContent = 'Paste the full sign-in link from the email, or its 6-digit code.'
        return
      }
      params = { token_hash: tokenHash, type: 'email' }
    }

    this.setCodeBusy(true)
    this.statusTarget.textContent = 'Verifying…'

    const { error } = await supabase.auth.verifyOtp(params)

    this.setCodeBusy(false)
    if (error) {
      this.statusTarget.textContent = `Could not verify: ${error.message} (the link only works if it wasn't opened first — send a fresh one if needed)`
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

function extractTokenHash(raw: string): string | null {
  try {
    const url = new URL(raw)
    return url.searchParams.get('token') ?? url.searchParams.get('token_hash')
  } catch {
    return null
  }
}
