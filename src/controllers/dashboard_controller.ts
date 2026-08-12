import { Controller } from '@hotwired/stimulus'
import { assignSeriesClasses, formatDay, localDateString, renderRings } from '../lib/chart'
import { HERO_EXCLUDED, REST_AFTER, RING_ACTIVITIES } from '../lib/config'
import { deleteEntry, entriesSince, recentEntries } from '../lib/data'
import type { Activity, Entry, Kind } from '../types'

const RECENT_LIMIT = 20
const WINDOW = 30
const STRIP_DAYS = 7

export default class DashboardController extends Controller {
  static targets = ['nudge', 'rings', 'today', 'grandTotal', 'list', 'empty', 'dayLabel']

  declare readonly nudgeTarget: HTMLElement
  declare readonly dayLabelTarget: HTMLElement
  declare readonly ringsTarget: HTMLElement
  declare readonly todayTarget: HTMLElement
  declare readonly grandTotalTarget: HTMLElement
  declare readonly listTarget: HTMLUListElement
  declare readonly emptyTarget: HTMLElement

  private activities: Activity[] = []
  private byId = new Map<string, Activity>()
  private colors = new Map<string, string>()
  // last rendered totals, so a number that just grew can flash
  private previous = new Map<string, number>()
  private primed = false

  connect() {
    window.addEventListener('activities:changed', this.onActivities)
    window.addEventListener('entries:changed', this.onEntries)
  }

  disconnect() {
    window.removeEventListener('activities:changed', this.onActivities)
    window.removeEventListener('entries:changed', this.onEntries)
  }

  async delete(event: Event) {
    const { id, kind } = (event as unknown as { params: { id: string; kind: Kind } }).params
    if (await deleteEntry(kind, id)) window.dispatchEvent(new CustomEvent('entries:changed'))
  }

  private onActivities = (event: Event) => {
    const detail = (event as CustomEvent<{ activities: Activity[] }>).detail
    this.activities = detail.activities
    this.byId = new Map(detail.activities.map((activity) => [activity.id, activity]))
    this.colors = assignSeriesClasses(detail.activities)
    void this.refresh()
  }

  private onEntries = () => {
    void this.refresh()
  }

  private colorOf(activity: Activity): string {
    return this.colors.get(activity.id) ?? 'chart-s-other'
  }

  private async refresh() {
    // the hero's title is the day itself — the app has no other masthead
    this.dayLabelTarget.textContent = new Date().toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    })

    if (this.activities.length === 0) {
      this.renderToday(new Map())
      this.renderList([])
      this.ringsTarget.hidden = true
      this.nudgeTarget.hidden = true
      return
    }

    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const windowStart = new Date(startOfToday)
    windowStart.setDate(windowStart.getDate() - (WINDOW - 1))

    const [window_, recent] = await Promise.all([entriesSince(windowStart), recentEntries(RECENT_LIMIT)])

    // per-activity, per-day totals: one aggregation feeds rings, rows, strips, streaks
    const perDay = new Map<string, Map<string, number>>()
    for (const entry of window_) {
      let days = perDay.get(entry.activity_id)
      if (!days) perDay.set(entry.activity_id, (days = new Map()))
      days.set(entry.day, (days.get(entry.day) ?? 0) + entry.amount)
    }

    this.renderRingCluster(perDay)
    this.renderNudge(perDay)
    this.renderToday(perDay)
    this.renderList(recent)
    this.primed = true
  }

  private dayKey(offset: number): string {
    const d = new Date()
    d.setDate(d.getDate() - offset)
    return localDateString(d)
  }

  private amountOn(perDay: Map<string, Map<string, number>>, id: string, offset: number): number {
    return perDay.get(id)?.get(this.dayKey(offset)) ?? 0
  }

  // ring target: your typical active day over the trailing week (mean of nonzero
  // days, yesterday back 7) — rest days don't dilute it, hot days raise it
  private ringTarget(perDay: Map<string, Map<string, number>>, id: string): number {
    const amounts: number[] = []
    for (let offset = 1; offset <= 7; offset++) {
      const amount = this.amountOn(perDay, id, offset)
      if (amount > 0) amounts.push(amount)
    }
    if (amounts.length === 0) return 0
    return Math.round(amounts.reduce((sum, v) => sum + v, 0) / amounts.length)
  }

  private restingNames(perDay: Map<string, Map<string, number>>): Set<string> {
    const resting = new Set<string>()
    for (const rule of REST_AFTER) {
      const habit = this.activities.find((a) => a.name === rule.habit)
      if (habit && this.amountOn(perDay, habit.id, 1) > 0) resting.add(rule.skip)
    }
    return resting
  }

  private ringActivities(perDay: Map<string, Map<string, number>>): Activity[] {
    const resting = this.restingNames(perDay)
    return RING_ACTIVITIES.filter((name) => !resting.has(name))
      .map((name) => this.activities.find((a) => a.name === name))
      .filter((a): a is Activity => a !== undefined)
  }

  private renderRingCluster(perDay: Map<string, Map<string, number>>) {
    const rings = this.ringActivities(perDay).map((activity) => {
      const today = this.amountOn(perDay, activity.id, 0)
      const target = activity.kind === 'habit' ? 1 : this.ringTarget(perDay, activity.id)
      const pct =
        target === 0 ? (today > 0 ? 100 : 0) : Math.min(Math.round((today / target) * 100), 100)
      return { cls: this.colorOf(activity), pct }
    })

    if (rings.length === 0) {
      this.ringsTarget.hidden = true
      return
    }
    const overall = Math.round(rings.reduce((sum, ring) => sum + ring.pct, 0) / rings.length)
    // markup is built from numbers only — no user content
    this.ringsTarget.innerHTML = renderRings(rings, overall)
    this.ringsTarget.hidden = false
  }

  // one line, highest-leverage: a streak in danger beats a near-target beats silence
  private renderNudge(perDay: Map<string, Map<string, number>>) {
    let text = ''

    for (const activity of this.activities) {
      if (activity.kind !== 'habit' || HERO_EXCLUDED.includes(activity.name)) continue
      if (this.amountOn(perDay, activity.id, 0) > 0) continue
      let streak = 0
      while (this.amountOn(perDay, activity.id, streak + 1) > 0) streak++
      if (streak >= 2) {
        text = `${activity.name}: ${streak}-day streak on the line`
        break
      }
    }

    if (!text) {
      const resting = this.restingNames(perDay)
      let best: { activity: Activity; remaining: number; ratio: number } | null = null
      for (const activity of this.activities) {
        if (activity.kind === 'habit' || resting.has(activity.name)) continue
        const today = this.amountOn(perDay, activity.id, 0)
        const yesterday = this.amountOn(perDay, activity.id, 1)
        if (yesterday === 0 || today >= yesterday) continue
        const remaining = yesterday - today
        const ratio = remaining / yesterday
        if (!best || ratio < best.ratio) best = { activity, remaining, ratio }
      }
      // only nudge when the finish line is close enough to feel reachable
      if (best && best.ratio <= 0.5) {
        text = `${best.remaining} more ${best.activity.unit} beats yesterday — ${best.activity.name}`
      }
    }

    this.nudgeTarget.textContent = text
    this.nudgeTarget.hidden = !text
  }

  // per-activity totals are the headline; ring members lead, in ring order
  private renderToday(perDay: Map<string, Map<string, number>>) {
    if (this.activities.length === 0) {
      this.todayTarget.replaceChildren()
      this.grandTotalTarget.hidden = true
      return
    }

    const resting = this.restingNames(perDay)
    const hidden = new Set([...HERO_EXCLUDED, ...resting])
    const ringMembers = this.ringActivities(perDay)
    const ordered = [
      ...ringMembers,
      ...this.activities.filter((a) => !ringMembers.includes(a) && !hidden.has(a.name)),
    ]

    this.todayTarget.replaceChildren(
      ...ordered.map((activity) => {
        const today = this.amountOn(perDay, activity.id, 0)
        const yesterday = this.amountOn(perDay, activity.id, 1)
        const isHabit = activity.kind === 'habit'

        const row = document.createElement('div')
        row.className = 'today-row'
        // only flash after the first paint, so a page load isn't a fanfare
        if (this.primed && today > (this.previous.get(activity.id) ?? 0)) row.classList.add('is-gain')
        this.previous.set(activity.id, today)

        const count = document.createElement('span')
        count.className = 'today-count'
        if (isHabit) {
          count.textContent = today > 0 ? '✓' : '—'
          count.style.color = today > 0 ? 'var(--progress-beat)' : 'var(--progress-zero)'
        } else {
          count.textContent = String(today)
          count.style.color = progressColor(today, yesterday)
        }

        const meta = document.createElement('div')
        meta.className = 'today-meta'
        const name = document.createElement('p')
        name.className = 'today-name'
        name.textContent = activity.name // user-named — textContent, never innerHTML
        // the unit rides the name so the sub-line stays short enough not to wrap
        if (!isHabit && activity.unit !== 'reps') {
          const unit = document.createElement('span')
          unit.className = 'today-unit'
          unit.textContent = ` ${activity.unit}`
          name.append(unit)
        }
        const sub = document.createElement('p')
        sub.className = 'today-sub'
        const delta = isHabit
          ? streakText(perDay.get(activity.id) ?? new Map(), today > 0)
          : deltaText(today, yesterday)
        if (delta.up) sub.classList.add('up')
        sub.textContent = delta.text
        meta.append(name, sub)

        row.append(count, meta, this.renderStrip(perDay, activity))
        return row
      }),
    )

    // summing across units is meaningless, so the corner total groups by unit;
    // habits are yes/no, not amounts, so they stay out of the sum
    const byUnit = new Map<string, number>()
    let active = 0
    for (const activity of this.activities) {
      const total = this.amountOn(perDay, activity.id, 0)
      if (total === 0 || activity.kind === 'habit') continue
      active++
      byUnit.set(activity.unit, (byUnit.get(activity.unit) ?? 0) + total)
    }
    this.grandTotalTarget.textContent = [...byUnit.entries()]
      .map(([unit, total]) => `${total} ${unit}`)
      .join(' · ')
    this.grandTotalTarget.hidden = active < 2
  }

  // 7 day-cells, oldest→today, height scaled to the activity's own best of the week
  private renderStrip(perDay: Map<string, Map<string, number>>, activity: Activity): HTMLElement {
    const strip = document.createElement('span')
    strip.className = `strip ${this.colorOf(activity)}`
    const amounts: number[] = []
    for (let offset = STRIP_DAYS - 1; offset >= 0; offset--) {
      amounts.push(this.amountOn(perDay, activity.id, offset))
    }
    const max = Math.max(...amounts)
    for (const amount of amounts) {
      const cell = document.createElement('span')
      if (amount === 0) {
        cell.className = 'strip-cell off'
      } else if (activity.kind === 'habit') {
        cell.className = 'strip-cell lvl-3'
      } else {
        const ratio = amount / max
        cell.className = `strip-cell lvl-${ratio < 0.5 ? 1 : ratio < 0.85 ? 2 : 3}`
      }
      strip.appendChild(cell)
    }
    return strip
  }

  private renderList(entries: Entry[]) {
    this.emptyTarget.hidden = entries.length > 0
    this.listTarget.replaceChildren(...entries.map((entry) => this.renderEntry(entry)))
  }

  private renderEntry(entry: Entry): HTMLLIElement {
    const item = document.createElement('li')
    const activity = this.byId.get(entry.activity_id)

    const dot = document.createElement('span')
    dot.className = `legend-swatch ${activity ? this.colorOf(activity) : 'chart-s-other'}`

    const label = document.createElement('span')
    label.className = 'entry-label'
    label.textContent =
      entry.kind === 'habit'
        ? `${activity?.name ?? '?'}`
        : activity && activity.unit !== 'reps'
          ? `${entry.amount} ${activity.unit} · ${activity.name}`
          : `${entry.amount} × ${activity?.name ?? '?'}`

    const time = document.createElement('time')
    time.className = 'muted'
    time.dateTime = entry.created_at
    // a backdated habit mark belongs to its day, not to when it was tapped
    time.textContent =
      entry.kind === 'habit' && entry.day !== localDateString(new Date())
        ? formatDay(entry.day)
        : timeAgo(entry.created_at)

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'ghost'
    remove.textContent = '−'
    remove.setAttribute('aria-label', 'Delete entry')
    remove.dataset.action = 'dashboard#delete'
    remove.dataset.dashboardIdParam = entry.id
    remove.dataset.dashboardKindParam = entry.kind

    item.append(dot, label, time, remove)
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
function streakText(days: Map<string, number>, doneToday: boolean): { text: string; up: boolean } {
  let streak = 0
  const cursor = new Date()
  if (!doneToday) cursor.setDate(cursor.getDate() - 1)
  while ((days.get(localDateString(cursor)) ?? 0) > 0) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }

  if (doneToday) return { text: streak > 1 ? `${streak}-day streak` : 'done today', up: true }
  if (streak > 0) {
    return { text: streak > 1 ? `${streak}-day streak on the line` : 'done yesterday', up: false }
  }
  return { text: '', up: false }
}

// goal-framed: behind reads as a target to chase, never a deficit
function deltaText(today: number, yesterday: number): { text: string; up: boolean } {
  const diff = today - yesterday
  if (today === 0 && yesterday === 0) return { text: '', up: false }
  if (diff > 0) return { text: `+${diff} vs yesterday`, up: true }
  if (diff < 0) return { text: `${-diff} to match yesterday`, up: false }
  return { text: 'matched yesterday', up: false }
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
