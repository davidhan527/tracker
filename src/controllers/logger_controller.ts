import { Controller } from '@hotwired/stimulus'
import { localDateString } from '../lib/chart'
import { supabase } from '../lib/supabase'
import type { Activity } from '../types'

export default class LoggerController extends Controller {
  static targets = ['picker', 'input', 'status', 'details', 'date', 'counted', 'habitButton']

  declare readonly inputTarget: HTMLInputElement
  declare readonly statusTarget: HTMLElement
  declare readonly detailsTarget: HTMLDetailsElement
  declare readonly dateTarget: HTMLInputElement
  declare readonly countedTarget: HTMLElement
  declare readonly habitButtonTarget: HTMLButtonElement

  private activityId: string | null = null
  private isHabit = false

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

  toggleBackdate() {
    // closing the disclosure clears the date so quick-logs can't silently stay backdated
    if (!this.detailsTarget.open) this.dateTarget.value = ''
  }

  private onActivities = (event: Event) => {
    const detail = (event as CustomEvent<{ activities: Activity[]; selectedId: string | null }>).detail
    this.activityId = detail.selectedId
    const activity = detail.activities.find((candidate) => candidate.id === this.activityId)
    this.isHabit = activity?.kind === 'habit'
    this.countedTarget.hidden = this.isHabit
    this.habitButtonTarget.hidden = !this.isHabit
    const unit = activity?.unit ?? 'reps'
    const label = unit.charAt(0).toUpperCase() + unit.slice(1)
    this.inputTarget.placeholder = label
    this.inputTarget.setAttribute('aria-label', label)
  }

  // habits are yes/no per day: at most one entry, so marking twice is a no-op
  async markDone() {
    if (!this.activityId) return
    const day = this.dateTarget.value || localDateString(new Date())
    const [year, month, dayOfMonth] = day.split('-').map(Number)
    const dayStart = new Date(year, month - 1, dayOfMonth)
    const dayEnd = new Date(year, month - 1, dayOfMonth + 1)

    this.setBusy(true)
    const existing = await supabase
      .from('entries')
      .select('id')
      .eq('activity_id', this.activityId)
      .gte('created_at', dayStart.toISOString())
      .lt('created_at', dayEnd.toISOString())
      .limit(1)
    if ((existing.data ?? []).length > 0) {
      this.setBusy(false)
      this.statusTarget.textContent = `Already marked for ${this.dateTarget.value ? day : 'today'} ✓`
      return
    }
    this.setBusy(false)

    if (await this.log(1)) {
      this.statusTarget.textContent = this.dateTarget.value ? `Marked ${day} done ✓` : 'Done ✓'
    }
  }

  private async log(amount: number): Promise<boolean> {
    if (!this.activityId) {
      this.statusTarget.textContent = 'Pick an activity first.'
      return false
    }

    const row: { activity_id: string; amount: number; created_at?: string } = {
      activity_id: this.activityId,
      amount,
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
    this.statusTarget.textContent = pastDay ? `Logged ${amount} for ${pastDay}.` : ''
    window.dispatchEvent(new CustomEvent('entries:changed'))
    return true
  }

  private setBusy(busy: boolean) {
    for (const button of this.element.querySelectorAll('button')) button.disabled = busy
  }
}
