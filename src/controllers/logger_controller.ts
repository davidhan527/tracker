import { Controller } from '@hotwired/stimulus'
import { localDateString } from '../lib/chart'
import { logEntry } from '../lib/data'
import type { Activity } from '../types'

export default class LoggerController extends Controller {
  static targets = ['picker', 'input', 'status', 'details', 'date', 'counted', 'habitButton']

  declare readonly inputTarget: HTMLInputElement
  declare readonly statusTarget: HTMLElement
  declare readonly detailsTarget: HTMLDetailsElement
  declare readonly dateTarget: HTMLInputElement
  declare readonly countedTarget: HTMLElement
  declare readonly habitButtonTarget: HTMLButtonElement

  private activity: Activity | null = null

  connect() {
    window.addEventListener('activities:changed', this.onActivities)
    this.dateTarget.max = localDateString(new Date())
  }

  disconnect() {
    window.removeEventListener('activities:changed', this.onActivities)
  }

  quick(event: Event) {
    const { reps } = (event as unknown as { params: { reps: number } }).params
    void this.log(reps)
  }

  async add(event: SubmitEvent) {
    event.preventDefault()
    const amount = Number.parseInt(this.inputTarget.value, 10)
    if (!Number.isFinite(amount) || amount < 1) return
    if (await this.log(amount)) this.inputTarget.value = ''
  }

  // idempotence is the DB's job now: unique(habit_id, done_on) reports a conflict
  async markDone() {
    if (!this.activity) return
    const pastDay = this.dateTarget.value || null

    this.setBusy(true)
    const { error, conflict } = await logEntry(this.activity, 1, pastDay)
    this.setBusy(false)

    if (error) {
      this.statusTarget.textContent = `Could not mark: ${error}`
      return
    }
    if (conflict) {
      this.statusTarget.textContent = `Already marked for ${pastDay ?? 'today'} ✓`
      return
    }
    this.statusTarget.textContent = pastDay ? `Marked ${pastDay} done ✓` : 'Done ✓'
    window.dispatchEvent(new CustomEvent('entries:changed'))
  }

  toggleBackdate() {
    // closing the disclosure clears the date so quick-logs can't silently stay backdated
    if (!this.detailsTarget.open) this.dateTarget.value = ''
  }

  private onActivities = (event: Event) => {
    const detail = (event as CustomEvent<{ activities: Activity[]; selectedId: string | null }>).detail
    this.activity = detail.activities.find((candidate) => candidate.id === detail.selectedId) ?? null
    const isHabit = this.activity?.kind === 'habit'
    this.countedTarget.hidden = isHabit
    this.habitButtonTarget.hidden = !isHabit
    const unit = this.activity?.unit ?? 'reps'
    const label = unit.charAt(0).toUpperCase() + unit.slice(1)
    this.inputTarget.placeholder = label
    this.inputTarget.setAttribute('aria-label', label)
  }

  private async log(amount: number): Promise<boolean> {
    if (!this.activity) {
      this.statusTarget.textContent = 'Pick an activity first.'
      return false
    }

    const pastDay = this.dateTarget.value || null
    this.setBusy(true)
    const { error } = await logEntry(this.activity, amount, pastDay)
    this.setBusy(false)

    if (error) {
      this.statusTarget.textContent = `Could not log: ${error}`
      return false
    }
    // the sheet covers the dashboard, so always confirm the log in place
    this.statusTarget.textContent = pastDay ? `Logged ${amount} for ${pastDay}.` : `Logged ${amount} ✓`
    window.dispatchEvent(new CustomEvent('entries:changed'))
    return true
  }

  private setBusy(busy: boolean) {
    for (const button of this.element.querySelectorAll('button')) button.disabled = busy
  }
}
