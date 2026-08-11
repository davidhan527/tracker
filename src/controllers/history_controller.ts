import { Controller } from '@hotwired/stimulus'
import { seriesClass } from '../lib/chart'
import { supabase } from '../lib/supabase'
import type { Entry, Exercise } from '../types'

const RECENT_LIMIT = 20

export default class HistoryController extends Controller {
  static targets = ['today', 'grandTotal', 'list', 'empty']

  declare readonly todayTarget: HTMLElement
  declare readonly grandTotalTarget: HTMLElement
  declare readonly listTarget: HTMLUListElement
  declare readonly emptyTarget: HTMLElement

  private exercises: Exercise[] = []
  private byId = new Map<string, Exercise>()

  connect() {
    window.addEventListener('exercises:changed', this.onExercises)
    window.addEventListener('entries:changed', this.onEntries)
  }

  disconnect() {
    window.removeEventListener('exercises:changed', this.onExercises)
    window.removeEventListener('entries:changed', this.onEntries)
  }

  async delete(event: Event) {
    const { id } = (event as unknown as { params: { id: string } }).params
    const { error } = await supabase.from('entries').delete().eq('id', id)
    if (!error) window.dispatchEvent(new CustomEvent('entries:changed'))
  }

  private onExercises = (event: Event) => {
    const detail = (event as CustomEvent<{ exercises: Exercise[] }>).detail
    this.exercises = detail.exercises
    this.byId = new Map(detail.exercises.map((exercise) => [exercise.id, exercise]))
    void this.refresh()
  }

  private onEntries = () => {
    void this.refresh()
  }

  private async refresh() {
    if (this.exercises.length === 0) {
      this.renderToday(new Map(), new Map())
      this.renderList([])
      return
    }

    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const startOfYesterday = new Date(startOfToday)
    startOfYesterday.setDate(startOfYesterday.getDate() - 1)

    const [twoDays, recent] = await Promise.all([
      supabase
        .from('entries')
        .select('reps, exercise_id, created_at')
        .gte('created_at', startOfYesterday.toISOString()),
      supabase
        .from('entries')
        .select('id, exercise_id, reps, created_at')
        .order('created_at', { ascending: false })
        .limit(RECENT_LIMIT),
    ])

    const byToday = new Map<string, number>()
    const byYesterday = new Map<string, number>()
    for (const row of (twoDays.data ?? []) as Pick<Entry, 'reps' | 'exercise_id' | 'created_at'>[]) {
      const bucket = new Date(row.created_at) >= startOfToday ? byToday : byYesterday
      bucket.set(row.exercise_id, (bucket.get(row.exercise_id) ?? 0) + row.reps)
    }
    this.renderToday(byToday, byYesterday)
    this.renderList((recent.data ?? []) as Entry[])
  }

  // per-exercise totals are the headline; the cross-exercise sum is a small corner note
  private renderToday(byToday: Map<string, number>, byYesterday: Map<string, number>) {
    if (this.exercises.length === 0) {
      this.todayTarget.replaceChildren()
      this.grandTotalTarget.hidden = true
      return
    }

    this.todayTarget.replaceChildren(
      ...this.exercises.map((exercise, i) => {
        const today = byToday.get(exercise.id) ?? 0
        const yesterday = byYesterday.get(exercise.id) ?? 0

        const row = document.createElement('div')
        row.className = 'today-row'
        const count = document.createElement('span')
        count.className = 'today-count'
        count.textContent = String(today)
        count.style.color = progressColor(today, yesterday)
        const name = document.createElement('span')
        name.className = 'today-name'
        const swatch = document.createElement('span')
        swatch.className = `legend-swatch ${seriesClass(i)}`
        const text = document.createElement('span')
        text.textContent = exercise.name // user-named — textContent, never innerHTML
        name.append(swatch, text)
        if (exercise.unit !== 'reps') {
          const unit = document.createElement('span')
          unit.className = 'muted small'
          unit.textContent = exercise.unit
          name.append(unit)
        }
        row.append(count, name, deltaLabel(today, yesterday))
        return row
      }),
    )

    // summing across units is meaningless, so the corner total groups by unit
    const byUnit = new Map<string, number>()
    let active = 0
    for (const exercise of this.exercises) {
      const total = byToday.get(exercise.id) ?? 0
      if (total === 0) continue
      active++
      byUnit.set(exercise.unit, (byUnit.get(exercise.unit) ?? 0) + total)
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
    const exercise = this.byId.get(entry.exercise_id)
    label.textContent =
      exercise && exercise.unit !== 'reps'
        ? `${entry.reps} ${exercise.unit} · ${exercise.name}`
        : `${entry.reps} × ${exercise?.name ?? '?'}`

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
