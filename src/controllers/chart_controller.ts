import { Controller } from '@hotwired/stimulus'
import { formatDay, localDateString, seriesClass } from '../lib/chart'
import { entriesSince } from '../lib/data'
import type { Activity } from '../types'

const MAX_DAYS = 30
const MIN_DAYS = 7
const CELL = 9 // px, matches .mx-cell
const GAP = 2
const LABEL = 64

export default class ChartController extends Controller {
  static targets = ['container', 'tooltip', 'heading']

  declare readonly containerTarget: HTMLElement
  declare readonly tooltipTarget: HTMLElement
  declare readonly headingTarget: HTMLElement

  private activities: Activity[] = []
  private perDay = new Map<string, Map<string, number>>()
  private hasData = false

  connect() {
    window.addEventListener('activities:changed', this.onActivities)
    window.addEventListener('entries:changed', this.onEntries)
    window.addEventListener('resize', this.onResize)
    this.containerTarget.addEventListener('pointerover', this.onPointer)
    this.containerTarget.addEventListener('pointerleave', this.hideTooltip)
  }

  disconnect() {
    window.removeEventListener('activities:changed', this.onActivities)
    window.removeEventListener('entries:changed', this.onEntries)
    window.removeEventListener('resize', this.onResize)
  }

  private onActivities = (event: Event) => {
    this.activities = (event as CustomEvent<{ activities: Activity[] }>).detail.activities
    void this.refresh()
  }

  private onEntries = () => {
    void this.refresh()
  }

  private onResize = () => {
    if (this.hasData) this.render()
  }

  private async refresh() {
    this.hideTooltip()
    if (this.activities.length === 0) {
      this.hasData = false
      this.containerTarget.replaceChildren()
      return
    }

    const today = new Date()
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (MAX_DAYS - 1))
    const entries = await entriesSince(start)

    this.perDay = new Map()
    for (const entry of entries) {
      let days = this.perDay.get(entry.activity_id)
      if (!days) this.perDay.set(entry.activity_id, (days = new Map()))
      days.set(entry.day, (days.get(entry.day) ?? 0) + entry.amount)
    }
    this.hasData = true
    this.render()
  }

  private render() {
    // window adapts to both the data span and the width the cells actually have
    const capacity = Math.floor((this.containerTarget.clientWidth - LABEL - 4) / (CELL + GAP))
    if (capacity < 1) return
    const span = this.dataSpan()
    const days = Math.max(Math.min(span, capacity, MAX_DAYS), Math.min(MIN_DAYS, capacity))
    this.headingTarget.textContent = `Last ${days} days`

    const keys: string[] = []
    for (let offset = days - 1; offset >= 0; offset--) {
      const d = new Date()
      d.setDate(d.getDate() - offset)
      keys.push(localDateString(d))
    }

    const rows: HTMLElement[] = []

    // "All" summary row: how many activities were touched each day
    const counts = keys.map(
      (key) => this.activities.filter((a) => (this.perDay.get(a.id)?.get(key) ?? 0) > 0).length,
    )
    rows.push(
      this.buildRow('All', 'mx-all', keys, counts, Math.max(...counts, 1), (key, count) => {
        const label = `${formatDay(key)} · ${count} of ${this.activities.length} active`
        return { level: count === 0 ? 0 : count === 1 ? 1 : count < this.activities.length ? 2 : 3, tip: label }
      }),
    )

    for (const [i, activity] of this.activities.entries()) {
      const amounts = keys.map((key) => this.perDay.get(activity.id)?.get(key) ?? 0)
      const max = Math.max(...amounts, 1)
      rows.push(
        this.buildRow(activity.name, seriesClass(i), keys, amounts, max, (key, amount) => {
          if (activity.kind === 'habit') {
            return { level: amount > 0 ? 3 : 0, tip: `${formatDay(key)} · ${amount > 0 ? 'done ✓' : 'not done'} · ${activity.name}` }
          }
          const ratio = amount / max
          return {
            level: amount === 0 ? 0 : ratio < 0.5 ? 1 : ratio < 0.85 ? 2 : 3,
            tip: `${formatDay(key)} · ${amount} ${activity.unit} · ${activity.name}`,
          }
        }),
      )
    }

    rows.push(this.buildTicks(keys))
    this.containerTarget.replaceChildren(...rows)
  }

  private buildRow(
    name: string,
    colorClass: string,
    keys: string[],
    values: number[],
    _max: number,
    cellFor: (key: string, value: number) => { level: number; tip: string },
  ): HTMLElement {
    const row = document.createElement('div')
    row.className = 'mx-row'
    const label = document.createElement('span')
    label.className = 'mx-label'
    label.textContent = name // user-named — textContent, never innerHTML
    row.appendChild(label)
    keys.forEach((key, i) => {
      const { level, tip } = cellFor(key, values[i])
      const cell = document.createElement('span')
      cell.className = level === 0 ? 'mx-cell off' : `mx-cell ${colorClass}`
      if (level === 1) cell.style.opacity = '0.4'
      if (level === 2) cell.style.opacity = '0.7'
      cell.dataset.tip = tip
      row.appendChild(cell)
    })
    return row
  }

  private buildTicks(keys: string[]): HTMLElement {
    const row = document.createElement('div')
    row.className = 'mx-row mx-ticks'
    const pad = document.createElement('span')
    pad.className = 'mx-label'
    row.appendChild(pad)
    // weekly, anchored at the newest day: 7 cells ≈ 77px, always clear of collisions
    const step = 7
    keys.forEach((key, i) => {
      const fromEnd = keys.length - 1 - i
      const tick = document.createElement('span')
      tick.className = 'mx-tick'
      tick.style.width = `${CELL + GAP}px`
      if (fromEnd % step === 0) {
        const text = document.createElement('span')
        text.textContent = formatDay(key)
        text.className = fromEnd === 0 ? 'mx-tick-text end' : 'mx-tick-text'
        tick.appendChild(text)
      }
      row.appendChild(tick)
    })
    return row
  }

  private dataSpan(): number {
    let earliest: string | null = null
    for (const days of this.perDay.values()) {
      for (const day of days.keys()) {
        if (!earliest || day < earliest) earliest = day
      }
    }
    if (!earliest) return MIN_DAYS
    const [year, month, day] = earliest.split('-').map(Number)
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    return (
      Math.floor((startOfToday.getTime() - new Date(year, month - 1, day).getTime()) / 86_400_000) + 1
    )
  }

  private onPointer = (event: PointerEvent) => {
    const cell = (event.target as Element).closest?.('.mx-cell') as HTMLElement | null
    if (!cell?.dataset.tip) {
      this.hideTooltip()
      return
    }
    this.tooltipTarget.textContent = cell.dataset.tip
    const wrapRect = this.tooltipTarget.parentElement!.getBoundingClientRect()
    const cellRect = cell.getBoundingClientRect()
    this.tooltipTarget.hidden = false
    const x = cellRect.left + cellRect.width / 2 - wrapRect.left
    const clamped = Math.min(
      Math.max(x, this.tooltipTarget.offsetWidth / 2),
      wrapRect.width - this.tooltipTarget.offsetWidth / 2,
    )
    this.tooltipTarget.style.left = `${clamped}px`
    this.tooltipTarget.style.top = `${Math.max(cellRect.top - wrapRect.top - this.tooltipTarget.offsetHeight - 4, 0)}px`
  }

  private hideTooltip = () => {
    this.tooltipTarget.hidden = true
  }
}
