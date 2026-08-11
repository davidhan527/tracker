import { Controller } from '@hotwired/stimulus'
import { supabase } from '../lib/supabase'
import {
  MAX_SERIES,
  formatDay,
  localDateString,
  renderPanelChart,
  seriesClass,
  stackedDailyTotals,
  type StackedDay,
} from '../lib/chart'
import type { Exercise } from '../types'

const MAX_DAYS = 30
const MIN_DAYS = 7

export default class ChartController extends Controller {
  static targets = ['container', 'tooltip', 'heading']

  declare readonly containerTarget: HTMLElement
  declare readonly tooltipTarget: HTMLElement
  declare readonly headingTarget: HTMLElement

  private exercises: Exercise[] = []
  private series: { name: string; unit: string }[] = []
  private days: StackedDay[] = []

  connect() {
    window.addEventListener('exercises:changed', this.onExercises)
    window.addEventListener('entries:changed', this.onEntries)
    this.containerTarget.addEventListener('pointerover', this.onPointer)
    this.containerTarget.addEventListener('pointermove', this.onPointer)
    this.containerTarget.addEventListener('pointerleave', this.hideTooltip)
  }

  disconnect() {
    window.removeEventListener('exercises:changed', this.onExercises)
    window.removeEventListener('entries:changed', this.onEntries)
  }

  private onExercises = (event: Event) => {
    this.exercises = (event as CustomEvent<{ exercises: Exercise[] }>).detail.exercises
    void this.refresh()
  }

  private onEntries = () => {
    void this.refresh()
  }

  private async refresh() {
    this.hideTooltip()
    if (this.exercises.length === 0) {
      this.days = []
      this.containerTarget.replaceChildren()
      return
    }

    const today = new Date()
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (MAX_DAYS - 1))
    const { data, error } = await supabase
      .from('entries')
      .select('reps, created_at, exercise_id')
      .gte('created_at', start.toISOString())
    if (error) return

    // series slot = position in the exercise list (stable), so colors never repaint
    const hasOther = this.exercises.length > MAX_SERIES
    const slotFor = new Map(this.exercises.map((exercise, i) => [exercise.id, Math.min(i, MAX_SERIES)]))
    this.series = this.exercises
      .slice(0, MAX_SERIES)
      .map((exercise) => ({ name: exercise.name, unit: exercise.unit }))
    if (hasOther) this.series.push({ name: 'Other', unit: '' }) // mixed units — leave unlabeled

    const rows = ((data ?? []) as { reps: number; created_at: string; exercise_id: string }[]).map(
      (row) => ({ reps: row.reps, created_at: row.created_at, series: slotFor.get(row.exercise_id) ?? -1 }),
    )

    // window grows with history (7 → 30 days) so young data isn't lost in empty space
    const days = this.windowFor(rows, today)
    this.headingTarget.textContent = `Last ${days} days`
    this.days = stackedDailyTotals(rows, this.series.length, days, today)

    // one panel per activity with data, each on its own scale
    const active = this.series
      .map(({ name, unit }, s) => ({
        name,
        unit,
        s,
        total: this.days.reduce((sum, day) => sum + day.values[s], 0),
      }))
      .filter((series) => series.total > 0)

    if (active.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'muted'
      empty.textContent = `No reps in the last ${MAX_DAYS} days.`
      this.containerTarget.replaceChildren(empty)
      return
    }

    this.containerTarget.replaceChildren(
      ...active.map(({ name, unit, s, total }, i) => {
        const panel = document.createElement('div')
        panel.className = 'panel'

        const head = document.createElement('div')
        head.className = 'panel-head'
        const swatch = document.createElement('span')
        swatch.className = `legend-swatch ${seriesClass(s)}`
        const title = document.createElement('span')
        title.className = 'panel-name'
        title.textContent = name // user-named — textContent, never innerHTML
        const sum = document.createElement('span')
        sum.className = 'panel-total muted'
        sum.textContent = `${total}${unit ? ` ${unit}` : ''} in ${this.days.length} days`
        head.append(swatch, title, sum)

        const chart = document.createElement('div')
        chart.className = 'panel-chart'
        chart.dataset.series = String(s)
        // svg markup is built from numbers and locale date strings only — no user content
        chart.innerHTML = renderPanelChart(
          this.days.map((day) => ({ date: day.date, total: day.values[s] })),
          seriesClass(s),
          i === active.length - 1, // date labels only on the bottom panel; x is shared
        )

        panel.append(head, chart)
        return panel
      }),
    )
  }

  private onPointer = (event: PointerEvent) => {
    const hit = (event.target as Element).closest?.('[data-index]')
    const wrapper = hit?.closest('.panel-chart') as HTMLElement | null
    if (!hit || !wrapper) {
      this.hideTooltip()
      return
    }
    const index = Number(hit.getAttribute('data-index'))
    const series = Number(wrapper.dataset.series)
    const day = this.days[index]
    if (!day) return

    // highlight the hovered day across every panel so the panels stay comparable
    for (const bar of this.containerTarget.querySelectorAll('.chart-bar')) {
      bar.classList.toggle('is-hover', bar.getAttribute('data-index') === String(index))
    }

    const isToday = day.date === localDateString(new Date())
    const unit = this.series[series]?.unit
    this.tooltipTarget.textContent = `${isToday ? 'Today' : formatDay(day.date)} · ${day.values[series]}${unit ? ` ${unit}` : ''}`

    const wrapRect = this.tooltipTarget.parentElement!.getBoundingClientRect()
    const slotRect = hit.getBoundingClientRect()
    const panelRect = wrapper.getBoundingClientRect()
    this.tooltipTarget.hidden = false
    const x = slotRect.left + slotRect.width / 2 - wrapRect.left
    const clamped = Math.min(
      Math.max(x, this.tooltipTarget.offsetWidth / 2),
      wrapRect.width - this.tooltipTarget.offsetWidth / 2,
    )
    this.tooltipTarget.style.left = `${clamped}px`
    this.tooltipTarget.style.top = `${Math.max(panelRect.top - wrapRect.top - this.tooltipTarget.offsetHeight - 2, 0)}px`
  }

  private windowFor(rows: { created_at: string }[], today: Date): number {
    if (rows.length === 0) return MAX_DAYS
    const earliest = rows.reduce(
      (min, row) => Math.min(min, new Date(row.created_at).getTime()),
      Infinity,
    )
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const span = Math.floor((startOfToday.getTime() - earliest) / 86_400_000) + 1
    return Math.min(Math.max(span, MIN_DAYS), MAX_DAYS)
  }

  private hideTooltip = () => {
    this.tooltipTarget.hidden = true
    for (const bar of this.containerTarget.querySelectorAll('.chart-bar.is-hover')) {
      bar.classList.remove('is-hover')
    }
  }
}
