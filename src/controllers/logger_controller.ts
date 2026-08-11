import { Controller } from '@hotwired/stimulus'
import { supabase } from '../lib/supabase'

export default class LoggerController extends Controller {
  static targets = ['picker', 'input', 'status']

  declare readonly inputTarget: HTMLInputElement
  declare readonly statusTarget: HTMLElement

  private exerciseId: string | null = null

  connect() {
    window.addEventListener('exercises:changed', this.onExercises)
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

  private onExercises = (event: Event) => {
    this.exerciseId = (event as CustomEvent<{ selectedId: string | null }>).detail.selectedId
  }

  private async log(reps: number): Promise<boolean> {
    if (!this.exerciseId) {
      this.statusTarget.textContent = 'Pick an exercise first.'
      return false
    }

    this.setBusy(true)
    const { error } = await supabase.from('entries').insert({ exercise_id: this.exerciseId, reps })
    this.setBusy(false)

    if (error) {
      this.statusTarget.textContent = `Could not log: ${error.message}`
      return false
    }
    this.statusTarget.textContent = ''
    window.dispatchEvent(new CustomEvent('entries:changed'))
    return true
  }

  private setBusy(busy: boolean) {
    for (const button of this.element.querySelectorAll('button')) button.disabled = busy
  }
}
