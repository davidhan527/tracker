import { Controller } from '@hotwired/stimulus'
import { localDateString } from '../lib/chart'
import { supabase } from '../lib/supabase'

export default class LoggerController extends Controller {
  static targets = ['picker', 'input', 'status', 'details', 'date']

  declare readonly inputTarget: HTMLInputElement
  declare readonly statusTarget: HTMLElement
  declare readonly detailsTarget: HTMLDetailsElement
  declare readonly dateTarget: HTMLInputElement

  private exerciseId: string | null = null

  connect() {
    window.addEventListener('exercises:changed', this.onExercises)
    this.dateTarget.max = localDateString(new Date())
  }

  disconnect() {
    window.removeEventListener('exercises:changed', this.onExercises)
  }

  quick(event: Event) {
    const { reps } = (event as unknown as { params: { reps: number } }).params
    void this.log(reps)
  }

  async add(event: SubmitEvent) {
    event.preventDefault()
    const reps = Number.parseInt(this.inputTarget.value, 10)
    if (!Number.isFinite(reps) || reps < 1) return
    if (await this.log(reps)) this.inputTarget.value = ''
  }

  toggleBackdate() {
    // closing the disclosure clears the date so quick-logs can't silently stay backdated
    if (!this.detailsTarget.open) this.dateTarget.value = ''
  }

  private onExercises = (event: Event) => {
    this.exerciseId = (event as CustomEvent<{ selectedId: string | null }>).detail.selectedId
  }

  private async log(reps: number): Promise<boolean> {
    if (!this.exerciseId) {
      this.statusTarget.textContent = 'Pick an exercise first.'
      return false
    }

    const row: { exercise_id: string; reps: number; created_at?: string } = {
      exercise_id: this.exerciseId,
      reps,
    }
    const pastDay = this.dateTarget.value
    if (pastDay) {
      const [year, month, day] = pastDay.split('-').map(Number)
      // noon local keeps the entry on the picked calendar day in nearby timezones
      row.created_at = new Date(year, month - 1, day, 12).toISOString()
    }

    this.setBusy(true)
    const { error } = await supabase.from('entries').insert(row)
    this.setBusy(false)

    if (error) {
      this.statusTarget.textContent = `Could not log: ${error.message}`
      return false
    }
    // backdated entries may not show in the recent list, so confirm explicitly
    this.statusTarget.textContent = pastDay ? `Logged ${reps} reps for ${pastDay}.` : ''
    window.dispatchEvent(new CustomEvent('entries:changed'))
    return true
  }

  private setBusy(busy: boolean) {
    for (const button of this.element.querySelectorAll('button')) button.disabled = busy
  }
}
