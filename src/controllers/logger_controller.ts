import { Controller } from '@hotwired/stimulus'
import { assignSeriesClasses, localDateString } from '../lib/chart'
import { logEntry } from '../lib/data'
import { suggestQuickActions } from '../lib/suggest'
import type { Activity, Stats } from '../types'

const SERIES_CLASSES = /\bchart-s[\w-]+/g

export default class LoggerController extends Controller {
  static targets = [
    'picker',
    'input',
    'status',
    'details',
    'date',
    'counted',
    'habitButton',
    'suggestions',
  ]

  declare readonly inputTarget: HTMLInputElement
  declare readonly statusTarget: HTMLElement
  declare readonly detailsTarget: HTMLDetailsElement
  declare readonly dateTarget: HTMLInputElement
  declare readonly countedTarget: HTMLElement
  declare readonly habitButtonTarget: HTMLButtonElement
  declare readonly suggestionsTarget: HTMLElement

  private activity: Activity | null = null
  private activities: Activity[] = []
  private colors = new Map<string, string>()

  connect() {
    window.addEventListener('activities:changed', this.onActivities)
    window.addEventListener('stats:changed', this.onStats)
    this.dateTarget.max = localDateString(new Date())
  }

  disconnect() {
    window.removeEventListener('activities:changed', this.onActivities)
    window.removeEventListener('stats:changed', this.onStats)
  }

  private onStats = (event: Event) => {
    const { entries } = (event as CustomEvent<Stats>).detail
    this.renderSuggestions(entries)
  }

  // one tap for the thing you log most: no picker, no typing
  private renderSuggestions(entries: Parameters<typeof suggestQuickActions>[0]) {
    const suggestions = suggestQuickActions(entries, this.activities)
    this.suggestionsTarget.replaceChildren(
      ...suggestions.map(({ activity, amount }) => {
        const chip = document.createElement('button')
        chip.type = 'button'
        chip.className = `suggest-chip ${this.colors.get(activity.id) ?? 'chart-s-other'}`
        chip.dataset.action = 'logger#logSuggestion'
        chip.dataset.loggerIdParam = activity.id
        chip.dataset.loggerAmountParam = String(amount)

        const value = document.createElement('span')
        value.className = 'suggest-amount'
        value.textContent = activity.kind === 'habit' ? '✓' : `+${amount}`
        const name = document.createElement('span')
        name.className = 'suggest-name'
        name.textContent = activity.name // user-named — textContent, never innerHTML
        chip.append(value, name)
        return chip
      }),
    )
    this.suggestionsTarget.hidden = suggestions.length === 0
  }

  logSuggestion(event: Event) {
    const { id, amount } = (event as unknown as { params: { id: string; amount: number } }).params
    const activity = this.activities.find((candidate) => candidate.id === id)
    if (!activity) return
    if (activity.kind === 'habit') void this.markDone(activity)
    else void this.log(amount, activity)
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
  async markDone(target?: Activity) {
    const activity = target ?? this.activity
    if (!activity) return
    const pastDay = this.dateTarget.value || null

    this.setBusy(true)
    const { error, conflict } = await logEntry(activity, 1, pastDay)
    this.setBusy(false)

    if (error) {
      this.statusTarget.textContent = `Could not mark: ${error}`
      return
    }
    if (conflict) {
      this.statusTarget.textContent = `${activity.name} already marked for ${pastDay ?? 'today'} ✓`
      return
    }
    this.statusTarget.textContent = pastDay
      ? `Marked ${activity.name} for ${pastDay} ✓`
      : `${activity.name} done ✓`
    window.dispatchEvent(new CustomEvent('entries:changed'))
  }

  toggleBackdate() {
    // closing the disclosure clears the date so quick-logs can't silently stay backdated
    if (!this.detailsTarget.open) this.dateTarget.value = ''
    // re-stamp on open: connect() ran once, and the app survives across midnight
    else this.dateTarget.max = localDateString(new Date())
  }

  private onActivities = (event: Event) => {
    const detail = (event as CustomEvent<{ activities: Activity[]; selectedId: string | null }>).detail
    this.activities = detail.activities
    this.activity = detail.activities.find((candidate) => candidate.id === detail.selectedId) ?? null
    // the quick buttons wear the selected activity's colour, so the sheet always
    // says what you are about to log
    const colors = assignSeriesClasses(detail.activities)
    this.colors = colors
    const cls = this.activity ? (colors.get(this.activity.id) ?? '') : ''
    this.element.className = `${this.element.className.replace(SERIES_CLASSES, '').trim()} ${cls}`.trim()
    const isHabit = this.activity?.kind === 'habit'
    this.countedTarget.hidden = isHabit
    this.habitButtonTarget.hidden = !isHabit
    const unit = this.activity?.unit ?? 'reps'
    const label = unit.charAt(0).toUpperCase() + unit.slice(1)
    this.inputTarget.placeholder = label
    this.inputTarget.setAttribute('aria-label', label)
  }

  private async log(amount: number, target?: Activity): Promise<boolean> {
    const activity = target ?? this.activity
    if (!activity) {
      this.statusTarget.textContent = 'Pick an activity first.'
      return false
    }

    const pastDay = this.dateTarget.value || null
    this.setBusy(true)
    const { error } = await logEntry(activity, amount, pastDay)
    this.setBusy(false)

    if (error) {
      this.statusTarget.textContent = `Could not log: ${error}`
      return false
    }
    // the sheet covers the dashboard, so always confirm the log in place
    this.statusTarget.textContent = pastDay
      ? `Logged ${amount} ${activity.name} for ${pastDay}`
      : `Logged ${amount} ${activity.name} ✓`
    window.dispatchEvent(new CustomEvent('entries:changed'))
    return true
  }

  private setBusy(busy: boolean) {
    for (const button of this.element.querySelectorAll('button')) button.disabled = busy
  }
}
