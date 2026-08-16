import { Controller } from '@hotwired/stimulus'
import {
  assignSeriesClasses,
  currentStreak,
  formatDay,
  localDateString,
  renderRings,
  streakTier,
} from '../lib/chart'
import { HERO_EXCLUDED, REST_AFTER, RING_ACTIVITIES } from '../lib/config'
import { allEntries, deleteEntry, recentEntries } from '../lib/data'
import type { Activity, Best, Entry, Kind } from '../types'

const RECENT_LIMIT = 20
const STRIP_DAYS = 7

export default class DashboardController extends Controller {
  static targets = [
    'nudge',
    'rings',
    'today',
    'grandTotal',
    'list',
    'empty',
    'dayLabel',
    'recap',
    'recapRows',
    'recapLead',
    'error',
  ]

  declare readonly nudgeTarget: HTMLElement
  declare readonly dayLabelTarget: HTMLElement
  declare readonly ringsTarget: HTMLElement
  declare readonly todayTarget: HTMLElement
  declare readonly grandTotalTarget: HTMLElement
  declare readonly listTarget: HTMLUListElement
  declare readonly emptyTarget: HTMLElement
  declare readonly recapTarget: HTMLElement
  declare readonly recapRowsTarget: HTMLElement
  declare readonly recapLeadTarget: HTMLElement
  declare readonly errorTarget: HTMLElement

  private activities: Activity[] = []
  private byId = new Map<string, Activity>()
  private colors = new Map<string, string>()
  private best = new Map<string, Best>()
  private records = new Set<string>() // activities that set an all-time best today
  // last rendered totals, so a number that just grew can flash
  private previous = new Map<string, number>()
  private primed = false
  private renderedDay = ''
  private midnightTimer = 0
  private generation = 0

  connect() {
    window.addEventListener('activities:changed', this.onActivities)
    window.addEventListener('entries:changed', this.onEntries)
    // an installed PWA is resumed, not reloaded: without these the app can show
    // yesterday's rings — completion check and all — on a brand new morning
    document.addEventListener('visibilitychange', this.onWake)
    window.addEventListener('pageshow', this.onWake)
  }

  disconnect() {
    window.removeEventListener('activities:changed', this.onActivities)
    window.removeEventListener('entries:changed', this.onEntries)
    document.removeEventListener('visibilitychange', this.onWake)
    window.removeEventListener('pageshow', this.onWake)
    clearTimeout(this.midnightTimer)
  }

  private onWake = () => {
    if (document.visibilityState !== 'visible') return
    if (this.renderedDay && this.renderedDay !== localDateString(new Date())) void this.refresh()
  }

  // also covers the app being left open across midnight, where no resume fires
  private armMidnight() {
    clearTimeout(this.midnightTimer)
    const next = new Date()
    next.setHours(24, 0, 5, 0)
    this.midnightTimer = window.setTimeout(() => void this.refresh(), next.getTime() - Date.now())
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
      this.recapTarget.hidden = true
      return
    }

    // a slow response must never overwrite a newer one
    const generation = ++this.generation
    let entries: Entry[]
    let recent: Entry[]
    try {
      ;[entries, recent] = await this.fetchWithRetry()
    } catch (error) {
      if (generation !== this.generation) return
      // an empty dashboard and a failed fetch look identical — say which it is
      this.errorTarget.textContent = `Couldn't load your data — tap to retry (${(error as Error).message})`
      this.errorTarget.hidden = false
      return
    }
    if (generation !== this.generation) return
    this.errorTarget.hidden = true

    // per-activity, per-day totals: one aggregation feeds rings, rows, strips,
    // streaks, records and the matrix — the whole app reads from this
    const perDay = new Map<string, Map<string, number>>()
    for (const entry of entries) {
      let days = perDay.get(entry.activity_id)
      if (!days) perDay.set(entry.activity_id, (days = new Map()))
      days.set(entry.day, (days.get(entry.day) ?? 0) + entry.amount)
    }

    const todayKey = localDateString(new Date())
    this.best = new Map()
    this.records = new Set()
    for (const [id, days] of perDay) {
      if (this.byId.get(id)?.kind === 'habit') continue // a habit day is always 1
      let best: Best | null = null
      let bestBefore = 0
      for (const [day, amount] of days) {
        // compare days explicitly: Map order is row-arrival order, not chronological,
        // so a tie must be broken on the date itself (YYYY-MM-DD sorts correctly)
        if (!best || amount > best.amount || (amount === best.amount && day > best.day)) {
          best = { day, amount }
        }
        if (day !== todayKey && amount > bestBefore) bestBefore = amount
      }
      if (best) this.best.set(id, best)
      // a first-ever day isn't a record — there was nothing to beat
      const todayAmount = days.get(todayKey) ?? 0
      if (bestBefore > 0 && todayAmount > bestBefore) this.records.add(id)
    }

    // the matrix reads the same aggregation rather than fetching its own copy
    window.dispatchEvent(
      new CustomEvent('stats:changed', { detail: { perDay, best: this.best } }),
    )

    this.renderRingCluster(perDay)
    this.renderNudge(perDay)
    this.renderToday(perDay)
    this.renderRecap(perDay)
    this.renderList(recent)
    this.primed = true
    this.renderedDay = todayKey
    this.armMidnight()
  }

  retry() {
    void this.refresh()
  }

  // a cold start can race the token refresh and 401 once; one quiet retry
  // covers that without the user ever seeing a failure
  private async fetchWithRetry(): Promise<[Entry[], Entry[]]> {
    try {
      return await Promise.all([allEntries(), recentEntries(RECENT_LIMIT)])
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1200))
      return await Promise.all([allEntries(), recentEntries(RECENT_LIMIT)])
    }
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

  // the best day that is not today — what a record has to beat
  private bestBefore(perDay: Map<string, Map<string, number>>, id: string): number {
    const todayKey = localDateString(new Date())
    let best = 0
    for (const [day, amount] of perDay.get(id) ?? []) {
      if (day !== todayKey && amount > best) best = amount
    }
    return best
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

  // one line, highest-leverage: a record beats a streak in danger beats a
  // near-target beats silence
  private renderNudge(perDay: Map<string, Map<string, number>>) {
    let text = ''
    // a resting activity is off the hero entirely — it must not speak here either
    const muted = new Set([...HERO_EXCLUDED, ...this.restingNames(perDay)])

    for (const activity of this.activities) {
      if (!this.records.has(activity.id) || muted.has(activity.name)) continue
      const previous = this.bestBefore(perDay, activity.id)
      text = `Personal best — ${this.amountOn(perDay, activity.id, 0)} ${activity.unit} of ${activity.name}, past ${previous}`
      break
    }

    if (text) {
      this.nudgeTarget.textContent = text
      this.nudgeTarget.hidden = false
      return
    }

    for (const activity of this.activities) {
      if (activity.kind !== 'habit' || muted.has(activity.name)) continue
      if (this.amountOn(perDay, activity.id, 0) > 0) continue
      let streak = 0
      while (this.amountOn(perDay, activity.id, streak + 1) > 0) streak++
      if (streak >= 2) {
        text = `${activity.name}: ${streak}-day streak on the line`
        break
      }
    }

    if (!text) {
      let best: { activity: Activity; remaining: number; ratio: number } | null = null
      for (const activity of this.activities) {
        if (activity.kind === 'habit' || muted.has(activity.name)) continue
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
        const isRecord = this.records.has(activity.id)
        if (isRecord) row.classList.add('is-record')
        if (isRecord || delta.up) sub.classList.add('up')
        sub.textContent = isRecord ? 'personal best' : delta.text
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
      .map(([unit, total]) => `${total} ${unitLabel(total, unit)}`)
      .join(' · ')
    this.grandTotalTarget.hidden = active < 2
  }

  // a Monday ritual: the seven days ending yesterday, against the seven before that
  private renderRecap(perDay: Map<string, Map<string, number>>) {
    if (new Date().getDay() !== 1) {
      this.recapTarget.hidden = true
      return
    }

    const total = (id: string, from: number, to: number) => {
      let sum = 0
      for (let offset = from; offset <= to; offset++) sum += this.amountOn(perDay, id, offset)
      return sum
    }

    let beaten = 0
    let compared = 0
    const rows = this.activities.flatMap((activity) => {
      const last = total(activity.id, 1, 7)
      const prior = total(activity.id, 8, 14)
      if (last === 0 && prior === 0) return []
      if (prior > 0) {
        compared++
        if (last > prior) beaten++
      }

      const row = document.createElement('div')
      row.className = 'recap-row'
      const swatch = document.createElement('span')
      swatch.className = `legend-swatch ${this.colorOf(activity)}`
      const name = document.createElement('span')
      name.className = 'recap-name'
      name.textContent = activity.name // user-named — textContent, never innerHTML
      const value = document.createElement('span')
      value.className = 'recap-value'
      value.textContent =
        activity.kind === 'habit'
          ? `${last} ${unitLabel(last, 'days')}`
          : `${last} ${unitLabel(last, activity.unit)}`
      const delta = document.createElement('span')
      delta.className = 'recap-delta'
      if (prior === 0) {
        delta.textContent = 'new'
      } else {
        const change = Math.round(((last - prior) / prior) * 100)
        delta.textContent = change > 0 ? `+${change}%` : `${change}%`
        if (change > 0) delta.classList.add('up')
      }
      row.append(swatch, name, value, delta)
      return [row]
    })

    if (rows.length === 0) {
      this.recapTarget.hidden = true
      return
    }

    this.recapLeadTarget.textContent =
      compared === 0
        ? 'Your first week on the board.'
        : beaten === compared
          ? `You beat the week before on all ${compared}.`
          : `You beat the week before on ${beaten} of ${compared}.`
    this.recapRowsTarget.replaceChildren(...rows)
    this.recapTarget.hidden = false
  }

  // 7 day-cells, oldest→today, with consecutive days joined into one capsule
  private renderStrip(perDay: Map<string, Map<string, number>>, activity: Activity): HTMLElement {
    const track = document.createElement('span')
    track.className = `track ${this.colorOf(activity)}`

    const streak = currentStreak(perDay.get(activity.id))
    const tier = streakTier(streak.length)
    if (tier > 0) track.classList.add(`streak-t${tier}`)

    const strip = document.createElement('span')
    strip.className = 'strip'
    const amounts: number[] = []
    const keys: string[] = []
    for (let offset = STRIP_DAYS - 1; offset >= 0; offset--) {
      amounts.push(this.amountOn(perDay, activity.id, offset))
      keys.push(this.dayKey(offset))
    }
    const max = Math.max(...amounts)
    amounts.forEach((amount, i) => {
      const cell = document.createElement('span')
      if (amount === 0) {
        cell.className = 'strip-cell off'
      } else if (activity.kind === 'habit') {
        cell.className = 'strip-cell lvl-3'
      } else {
        const ratio = amount / max
        cell.className = `strip-cell lvl-${ratio < 0.5 ? 1 : ratio < 0.85 ? 2 : 3}`
      }
      if (amount > 0) {
        if (amounts[i - 1] > 0) cell.classList.add('run-l')
        if (amounts[i + 1] > 0) cell.classList.add('run-r')
        if (streak.keys.has(keys[i])) cell.classList.add('is-live')
      }
      strip.appendChild(cell)
    })
    track.appendChild(strip)

    // the number is the thing you don't want to reset
    if (streak.length >= 2) {
      const badge = document.createElement('span')
      badge.className = 'streak-badge'
      badge.textContent = String(streak.length)
      badge.title = `${streak.length}-day streak`
      track.appendChild(badge)
    }
    return track
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
          ? `${entry.amount} ${unitLabel(entry.amount, activity.unit)} · ${activity.name}`
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

// units are stored plural; only the display needs the singular
function unitLabel(amount: number, unit: string): string {
  return amount === 1 && unit.endsWith('s') ? unit.slice(0, -1) : unit
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
