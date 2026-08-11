import { Controller } from '@hotwired/stimulus'
import { supabase } from '../lib/supabase'
import {
  dayTotal,
  formatDay,
  localDateString,
  renderStackedChart,
  stackedDailyTotals,
  type StackedDay,
} from '../lib/chart'
import type { Exercise } from '../types'

const DAYS = 30
const MAX_SERIES = 6 // palette slots; exercises beyond this fold into "Other"

export default class ChartController extends Controller {
  static targets = ['container', 'tooltip', 'legend']

  declare readonly containerTarget: HTMLElement
  declare readonly tooltipTarget: HTMLElement
  declare readonly legendTarget: HTMLElement

  private exercises: Exercise[] = []
  private seriesNames: string[] = []
  private seriesClasses: string[] = []
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
      this.legendTarget.replaceChildren()
      return
    }

    const today = new Date()
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (DAYS - 1))
    const { data, error } = await supabase
      .from('entries')
      .select('reps, created_at, exercise_id')
      .gte('created_at', start.toISOString())
    if (error) return

    // series slot = position in the exercise list (stable), so colors never repaint
    const hasOther = this.exercises.length > MAX_SERIES
    const slotFor = new Map(this.exercises.map((exercise, i) => [exercise.id, Math.min(i, MAX_SERIES)]))
    this.seriesNames = this.exercises.slice(0, MAX_SERIES).map((exercise) => exercise.name)
    this.seriesClasses = this.seriesNames.map((_, i) => `chart-s${i + 1}`)
    if (hasOther) {
      this.seriesNames.push('Other')
      this.seriesClasses.push('chart-s-other')
    }

    const rows = ((data ?? []) as { reps: number; created_at: string; exercise_id: string }[]).map(
      (row) => ({ reps: row.reps, created_at: row.created_at, series: slotFor.get(row.exercise_id) ?? -1 }),
    )
    this.days = stackedDailyTotals(rows, this.seriesNames.length, DAYS, today)

    if (this.days.every((day) => dayTotal(day) === 0)) {
      const empty = document.createElement('p')
      empty.className = 'muted'
      empty.textContent = `No reps in the last ${DAYS} days.`
      this.containerTarget.replaceChildren(empty)
      this.legendTarget.replaceChildren()
      return
    }

    // svg markup is built from numbers and locale date strings only — no user content
    this.containerTarget.innerHTML = renderStackedChart(this.days, this.seriesClasses)
    this.renderLegend()
  }

  private renderLegend() {
    const active = this.seriesNames
      .map((name, s) => ({ name, s, total: this.days.reduce((sum, day) => sum + day.values[s], 0) }))
      .filter((series) => series.total > 0)
    this.legendTarget.replaceChildren(
      ...active.map(({ name, s }) => {
        const item = document.createElement('span')
        item.className = 'legend-item'
        const swatch = document.createElement('span')
        swatch.className = `legend-swatch ${this.seriesClasses[s]}`
        const text = document.createElement('span')
        text.textContent = name // user-named — textContent, never innerHTML
        item.append(swatch, text)
        return item
      }),
    )
    this.legendTarget.hidden = active.length < 2
  }

  private onPointer = (event: PointerEvent) => {
    const hit = (event.target as Element).closest?.('[data-index]')
    if (!hit) {
      this.hideTooltip()
      return
    }
    const index = Number(hit.getAttribute('data-index'))
    const day = this.days[index]
    if (!day) return

    for (const bar of this.containerTarget.querySelectorAll('.chart-bar')) {
      bar.classList.toggle('is-hover', bar.getAttribute('data-index') === String(index))
    }

    this.renderTooltip(day)
    const wrap = this.containerTarget.getBoundingClientRect()
    const slot = hit.getBoundingClientRect()
    const x = slot.left + slot.width / 2 - wrap.left
    this.tooltipTarget.hidden = false
    const clamped = Math.min(
      Math.max(x, this.tooltipTarget.offsetWidth / 2),
      wrap.width - this.tooltipTarget.offsetWidth / 2,
    )
    this.tooltipTarget.style.left = `${clamped}px`
  }

  private renderTooltip(day: StackedDay) {
    const isToday = day.date === localDateString(new Date())
    const header = document.createElement('div')
    header.className = 'tt-date'
    header.textContent = isToday ? 'Today' : formatDay(day.date)

    const rows = day.values
      .map((value, s) => ({ value, s }))
      .filter(({ value }) => value > 0)
      .map(({ value, s }) => {
        const row = document.createElement('div')
        row.className = 'tt-row'
        const swatch = document.createElement('span')
        swatch.className = `legend-swatch ${this.seriesClasses[s]}`
        const name = document.createElement('span')
        name.className = 'tt-name'
        name.textContent = this.seriesNames[s]
        const val = document.createElement('span')
        val.className = 'tt-val'
        val.textContent = String(value)
        row.append(swatch, name, val)
        return row
      })

    const children: HTMLElement[] = [header, ...rows]
    if (rows.length > 1) {
      const total = document.createElement('div')
      total.className = 'tt-row tt-total'
      const name = document.createElement('span')
      name.className = 'tt-name'
      name.textContent = 'Total'
      const val = document.createElement('span')
      val.className = 'tt-val'
      val.textContent = String(dayTotal(day))
      total.append(name, val)
      children.push(total)
    }
    if (rows.length === 0) {
      const rest = document.createElement('div')
      rest.className = 'tt-row'
      rest.textContent = 'No reps'
      children.push(rest)
    }
    this.tooltipTarget.replaceChildren(...children)
  }

  private hideTooltip = () => {
    this.tooltipTarget.hidden = true
    for (const bar of this.containerTarget.querySelectorAll('.chart-bar.is-hover')) {
      bar.classList.remove('is-hover')
    }
  }
}
