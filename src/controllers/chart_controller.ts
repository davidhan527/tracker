import { Controller } from '@hotwired/stimulus'
import { assignSeriesClasses, formatDay, localDateString } from '../lib/chart'
import { RING_ACTIVITIES } from '../lib/config'
import { entriesSince } from '../lib/data'
import type { Activity } from '../types'

const MAX_DAYS = 30
const MIN_DAYS = 21 // wider than the 7-day strips in the hero, so the two say different things
const MIN_CELL = 11 // px per column including its gap, used only to pick the day count
const LABEL = 64

export default class ChartController extends Controller {
  static targets = ['container', 'tooltip', 'heading']

  declare readonly containerTarget: HTMLElement
  declare readonly tooltipTarget: HTMLElement
  declare readonly headingTarget: HTMLElement

  private activities: Activity[] = []
  private colors = new Map<string, string>()
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
    const detail = (event as CustomEvent<{ activities: Activity[] }>).detail
    this.activities = detail.activities
    this.colors = assignSeriesClasses(detail.activities)
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

  // rings first, in ring order, so the matrix mirrors the hero card
  private orderedActivities(): Activity[] {
    const lead = RING_ACTIVITIES.map((name) => this.activities.find((a) => a.name === name)).filter(
      (a): a is Activity => a !== undefined,
    )
    return [...lead, ...this.activities.filter((a) => !lead.includes(a))]
  }

  private render() {
    const capacity = Math.floor((this.containerTarget.clientWidth - LABEL - 4) / MIN_CELL)
    if (capacity < 1) return
    const days = Math.max(Math.min(capacity, MAX_DAYS), Math.min(MIN_DAYS, capacity))
    this.headingTarget.textContent = `Last ${days} days`

    const keys: string[] = []
    for (let offset = days - 1; offset >= 0; offset--) {
      const d = new Date()
      d.setDate(d.getDate() - offset)
      keys.push(localDateString(d))
    }

    const ordered = this.orderedActivities()
    const rows: HTMLElement[] = []

    ordered.forEach((activity, index) => {
      const amounts = keys.map((key) => this.perDay.get(activity.id)?.get(key) ?? 0)
      const max = Math.max(...amounts, 1)
      rows.push(
        this.buildRow(activity.name, this.colors.get(activity.id) ?? 'chart-s-other', index, keys, (key, i) => {
          const amount = amounts[i]
          if (activity.kind === 'habit') {
            return {
              level: amount > 0 ? 3 : 0,
              tip: `${formatDay(key)} · ${amount > 0 ? 'done' : 'not done'} · ${activity.name}`,
            }
          }
          const ratio = amount / max
          return {
            level: amount === 0 ? 0 : ratio < 0.5 ? 1 : ratio < 0.85 ? 2 : 3,
            tip: `${formatDay(key)} · ${amount} ${activity.unit} · ${activity.name}`,
          }
        }),
      )
    })

    // summary last: it reads as a footer over the rows it sums, not a header
    const counts = keys.map(
      (key) => ordered.filter((a) => (this.perDay.get(a.id)?.get(key) ?? 0) > 0).length,
    )
    rows.push(
      this.buildRow('All', 'mx-all', ordered.length, keys, (key, i) => ({
        level: counts[i] === 0 ? 0 : counts[i] === 1 ? 1 : counts[i] < ordered.length ? 2 : 3,
        tip: `${formatDay(key)} · ${counts[i]} of ${ordered.length} active`,
      })),
    )

    rows.push(this.buildTicks(keys))
    this.containerTarget.replaceChildren(...rows)
  }

  private buildRow(
    name: string,
    colorClass: string,
    rowIndex: number,
    keys: string[],
    cellFor: (key: string, i: number) => { level: number; tip: string },
  ): HTMLElement {
    const row = document.createElement('div')
    row.className = `mx-row ${colorClass}`
    row.style.setProperty('--row', String(rowIndex))
    const label = document.createElement('span')
    label.className = 'mx-label'
    label.textContent = name // user-named — textContent, never innerHTML
    row.appendChild(label)
    keys.forEach((key, i) => {
      const { level, tip } = cellFor(key, i)
      const cell = document.createElement('span')
      cell.className = level === 0 ? 'mx-cell off' : `mx-cell lvl-${level}`
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
    keys.forEach((key, i) => {
      const fromEnd = keys.length - 1 - i
      const tick = document.createElement('span')
      tick.className = 'mx-tick'
      // weekly, anchored at today, so the newest column is always labelled
      if (fromEnd % 7 === 0) {
        const text = document.createElement('span')
        text.textContent = formatDay(key)
        text.className = fromEnd === 0 ? 'mx-tick-text end' : 'mx-tick-text'
        tick.appendChild(text)
      }
      row.appendChild(tick)
    })
    return row
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
