import { Controller } from '@hotwired/stimulus'
import { supabase } from '../lib/supabase'
import {
  MAX_SERIES,
  formatDay,
  localDateString,
  renderHabitStrip,
  renderPanelChart,
  seriesClass,
  stackedDailyTotals,
  type StackedDay,
} from '../lib/chart'
import type { Activity } from '../types'

const MAX_DAYS = 30
const MIN_DAYS = 7

export default class ChartController extends Controller {
  static targets = ['container', 'tooltip', 'heading']

  declare readonly containerTarget: HTMLElement
  declare readonly tooltipTarget: HTMLElement
  declare readonly headingTarget: HTMLElement

  private activities: Activity[] = []
  private series: { name: string; unit: string; kind: string }[] = []
  private days: StackedDay[] = []

  connect() {
    window.addEventListener('activities:changed', this.onActivities)
    window.addEventListener('entries:changed', this.onEntries)
    this.containerTarget.addEventListener('pointerover', this.onPointer)
    this.containerTarget.addEventListener('pointermove', this.onPointer)
    this.containerTarget.addEventListener('pointerleave', this.hideTooltip)
  }

  disconnect() {
    window.removeEventListener('activities:changed', this.onActivities)
    window.removeEventListener('entries:changed', this.onEntries)
  }

  private onActivities = (event: Event) => {
    this.activities = (event as CustomEvent<{ activities: Activity[] }>).detail.activities
    void this.refresh()
  }

  private onEntries = () => {
    void this.refresh()
  }

  private async refresh() {
    this.hideTooltip()
    if (this.activities.length === 0) {
      this.days = []
      this.containerTarget.replaceChildren()
      return
    }

    const today = new Date()
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (MAX_DAYS - 1))
    const { data, error } = await supabase
      .from('entries')
      .select('amount, created_at, activity_id')
      .gte('created_at', start.toISOString())
    if (error) return

    // series slot = position in the activity list (stable), so colors never repaint
    const hasOther = this.activities.length > MAX_SERIES
    const slotFor = new Map(this.activities.map((activity, i) => [activity.id, Math.min(i, MAX_SERIES)]))
    this.series = this.activities
      .slice(0, MAX_SERIES)
      .map((activity) => ({ name: activity.name, unit: activity.unit, kind: activity.kind }))
    if (hasOther) this.series.push({ name: 'Other', unit: '', kind: 'exercise' }) // mixed — leave unlabeled

    const rows = ((data ?? []) as { amount: number; created_at: string; activity_id: string }[]).map(
      (row) => ({ amount: row.amount, created_at: row.created_at, series: slotFor.get(row.activity_id) ?? -1 }),
    )

    // window grows with history (7 → 30 days) so young data isn't lost in empty space
    const days = this.windowFor(rows, today)
    this.headingTarget.textContent = `Last ${days} days`
    this.days = stackedDailyTotals(rows, this.series.length, days, today)

    // one panel per activity with data, each on its own scale
    const active = this.series
      .map(({ name, unit, kind }, s) => ({
        name,
        unit,
        kind,
        s,
        total: this.days.reduce((sum, day) => sum + day.values[s], 0),
        daysDone: this.days.filter((day) => day.values[s] > 0).length,
      }))
      .filter((series) => series.total > 0)

    if (active.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'muted'
      empty.textContent = `No activity in the last ${MAX_DAYS} days.`
      this.containerTarget.replaceChildren(empty)
      return
    }

    this.containerTarget.replaceChildren(
      ...active.map(({ name, unit, kind, s, total, daysDone }, i) => {
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
        sum.textContent =
          kind === 'habit'
            ? `${daysDone} of ${this.days.length} days`
            : `${total}${unit ? ` ${unit}` : ''} in ${this.days.length} days`
        head.append(swatch, title, sum)

        const chart = document.createElement('div')
        chart.className = 'panel-chart'
        chart.dataset.series = String(s)
        const perDay = this.days.map((day) => ({ date: day.date, total: day.values[s] }))
        const showDates = i === active.length - 1 // date labels only on the bottom panel; x is shared
        // svg markup is built from numbers and locale date strings only — no user content
        chart.innerHTML =
          kind === 'habit'
            ? renderHabitStrip(perDay, seriesClass(s), showDates)
            : renderPanelChart(perDay, seriesClass(s), showDates)

        panel.append(head, chart)
        return panel
      }),
    )
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
    const dayLabel = isToday ? 'Today' : formatDay(day.date)
    const { unit, kind } = this.series[series] ?? { unit: '', kind: 'exercise' }
    this.tooltipTarget.textContent =
      kind === 'habit'
        ? `${dayLabel} · ${day.values[series] > 0 ? 'done ✓' : 'not done'}`
        : `${dayLabel} · ${day.values[series]}${unit ? ` ${unit}` : ''}`

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

  private hideTooltip = () => {
    this.tooltipTarget.hidden = true
    for (const bar of this.containerTarget.querySelectorAll('.chart-bar.is-hover')) {
      bar.classList.remove('is-hover')
    }
  }
}
