import { Controller } from '@hotwired/stimulus'
import { localDateString, seriesClass } from '../lib/chart'
import { supabase } from '../lib/supabase'
import type { Activity, Entry } from '../types'

const RECENT_LIMIT = 20
const STREAK_WINDOW = 30

export default class HistoryController extends Controller {
  static targets = ['today', 'grandTotal', 'list', 'empty']

  declare readonly todayTarget: HTMLElement
  declare readonly grandTotalTarget: HTMLElement
  declare readonly listTarget: HTMLUListElement
  declare readonly emptyTarget: HTMLElement

  private activities: Activity[] = []
  private byId = new Map<string, Activity>()

  connect() {
    window.addEventListener('activities:changed', this.onActivities)
    window.addEventListener('entries:changed', this.onEntries)
  }

  disconnect() {
    window.removeEventListener('activities:changed', this.onActivities)
    window.removeEventListener('entries:changed', this.onEntries)
  }

  async delete(event: Event) {
    const { id } = (event as unknown as { params: { id: string } }).params
    const { error } = await supabase.from('entries').delete().eq('id', id)
    if (!error) window.dispatchEvent(new CustomEvent('entries:changed'))
  }

  private onActivities = (event: Event) => {
    const detail = (event as CustomEvent<{ activities: Activity[] }>).detail
    this.activities = detail.activities
    this.byId = new Map(detail.activities.map((activity) => [activity.id, activity]))
    void this.refresh()
  }

  private onEntries = () => {
    void this.refresh()
  }

  private async refresh() {
    if (this.activities.length === 0) {
      this.renderToday(new Map(), new Map(), new Map())
      this.renderList([])
      return
    }

    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const startOfYesterday = new Date(startOfToday)
    startOfYesterday.setDate(startOfYesterday.getDate() - 1)
    // wide window so habit streaks can be counted, not just today/yesterday
    const windowStart = new Date(startOfToday)
    windowStart.setDate(windowStart.getDate() - (STREAK_WINDOW - 1))

    const [window, recent] = await Promise.all([
      supabase
        .from('entries')
        .select('amount, activity_id, created_at')
        .gte('created_at', windowStart.toISOString()),
      supabase
        .from('entries')
        .select('id, activity_id, amount, created_at')
        .order('created_at', { ascending: false })
        .limit(RECENT_LIMIT),
    ])

    const byToday = new Map<string, number>()
    const byYesterday = new Map<string, number>()
    const daysDone = new Map<string, Set<string>>()
    for (const row of (window.data ?? []) as Pick<Entry, 'amount' | 'activity_id' | 'created_at'>[]) {
      const when = new Date(row.created_at)
      if (when >= startOfToday) {
        byToday.set(row.activity_id, (byToday.get(row.activity_id) ?? 0) + row.amount)
      } else if (when >= startOfYesterday) {
        byYesterday.set(row.activity_id, (byYesterday.get(row.activity_id) ?? 0) + row.amount)
      }
      let days = daysDone.get(row.activity_id)
      if (!days) daysDone.set(row.activity_id, (days = new Set()))
      days.add(localDateString(when))
    }
    this.renderToday(byToday, byYesterday, daysDone)
    this.renderList((recent.data ?? []) as Entry[])
  }

  // per-activity totals are the headline; the cross-activity sum is a small corner note
  private renderToday(
    byToday: Map<string, number>,
    byYesterday: Map<string, number>,
    daysDone: Map<string, Set<string>>,
  ) {
    if (this.activities.length === 0) {
      this.todayTarget.replaceChildren()
      this.grandTotalTarget.hidden = true
      return
    }

    this.todayTarget.replaceChildren(
      ...this.activities.map((activity, i) => {
        const today = byToday.get(activity.id) ?? 0
        const yesterday = byYesterday.get(activity.id) ?? 0
        const isHabit = activity.kind === 'habit'

        const row = document.createElement('div')
        row.className = 'today-row'
        const count = document.createElement('span')
        count.className = 'today-count'
        if (isHabit) {
          count.textContent = today > 0 ? '✓' : '—'
          count.style.color = today > 0 ? 'var(--progress-beat)' : 'var(--progress-zero)'
        } else {
          count.textContent = String(today)
          count.style.color = progressColor(today, yesterday)
        }
        const name = document.createElement('span')
        name.className = 'today-name'
        const swatch = document.createElement('span')
        swatch.className = `legend-swatch ${seriesClass(i)}`
        const text = document.createElement('span')
        text.textContent = activity.name // user-named — textContent, never innerHTML
        name.append(swatch, text)
        if (!isHabit && activity.unit !== 'reps') {
          const unit = document.createElement('span')
          unit.className = 'muted small'
          unit.textContent = activity.unit
          name.append(unit)
        }
        const delta = isHabit
          ? streakLabel(daysDone.get(activity.id) ?? new Set(), today > 0)
          : deltaLabel(today, yesterday)
        row.append(count, name, delta)
        return row
      }),
    )

    // summing across units is meaningless, so the corner total groups by unit;
    // habits are yes/no, not amounts, so they stay out of the sum
    const byUnit = new Map<string, number>()
    let active = 0
    for (const activity of this.activities) {
      const total = byToday.get(activity.id) ?? 0
      if (total === 0 || activity.kind === 'habit') continue
      active++
      byUnit.set(activity.unit, (byUnit.get(activity.unit) ?? 0) + total)
    }
    this.grandTotalTarget.textContent = [...byUnit.entries()]
      .map(([unit, total]) => `${total} ${unit}`)
      .join(' · ')
    this.grandTotalTarget.hidden = active < 2
  }

  private renderList(entries: Entry[]) {
    this.emptyTarget.hidden = entries.length > 0
    this.listTarget.replaceChildren(...entries.map((entry) => this.renderEntry(entry)))
  }

  private renderEntry(entry: Entry): HTMLLIElement {
    const item = document.createElement('li')

    const label = document.createElement('span')
    label.className = 'entry-label'
    const activity = this.byId.get(entry.activity_id)
    label.textContent =
      activity?.kind === 'habit'
        ? `✓ ${activity.name}`
        : activity && activity.unit !== 'reps'
          ? `${entry.amount} ${activity.unit} · ${activity.name}`
          : `${entry.amount} × ${activity?.name ?? '?'}`

    const time = document.createElement('time')
    time.className = 'muted'
    time.dateTime = entry.created_at
    time.textContent = timeAgo(entry.created_at)

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'ghost'
    remove.textContent = '−'
    remove.setAttribute('aria-label', 'Delete entry')
    remove.dataset.action = 'history#delete'
    remove.dataset.historyIdParam = entry.id

    item.append(label, time, remove)
    return item
  }
}

// yellow at 0 → blue when matching yesterday → green the moment yesterday is beaten,
// deepening with the margin (full depth at 2×); mixed in OKLab so the ramp stays
// perceptually even, and resolved from CSS vars so both themes get their own
// contrast-checked endpoints
function progressColor(today: number, yesterday: number): string {
  if (today === 0) return 'var(--progress-zero)'
  if (today < yesterday) {
    const ratio = today / yesterday
    return `color-mix(in oklab, var(--progress-match) ${Math.round(ratio * 100)}%, var(--progress-zero))`
  }
  if (today === yesterday) return 'var(--progress-match)'
  const excess = yesterday === 0 ? 1 : Math.min((today - yesterday) / yesterday, 1)
  return `color-mix(in oklab, var(--progress-beat-deep) ${Math.round(excess * 100)}%, var(--progress-beat))`
}

// habit motivation is the streak: growing when done today, "on the line" when not
function streakLabel(daysDone: Set<string>, doneToday: boolean): HTMLElement {
  const label = document.createElement('span')
  label.className = 'today-delta'

  let streak = 0
  const cursor = new Date()
  if (!doneToday) cursor.setDate(cursor.getDate() - 1)
  while (daysDone.has(localDateString(cursor))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }

  if (doneToday) {
    label.classList.add('up')
    label.textContent = streak > 1 ? `${streak}-day streak` : 'done today'
  } else if (streak > 0) {
    label.textContent = streak > 1 ? `${streak}-day streak on the line` : 'done yesterday'
  } else {
    label.textContent = ''
  }
  return label
}

// goal-framed: behind reads as a target to chase, never a deficit
function deltaLabel(today: number, yesterday: number): HTMLElement {
  const delta = document.createElement('span')
  delta.className = 'today-delta'
  const diff = today - yesterday
  if (today === 0 && yesterday === 0) {
    delta.textContent = ''
  } else if (diff > 0) {
    delta.classList.add('up')
    delta.textContent = `+${diff} vs yesterday`
  } else if (diff < 0) {
    delta.textContent = `${-diff} to match yesterday`
  } else {
    delta.textContent = 'matched yesterday'
  }
  return delta
}

function timeAgo(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
