import { Controller } from '@hotwired/stimulus'
import { assignSeriesClasses, formatDay, localDateString } from '../lib/chart'
import { RING_ACTIVITIES } from '../lib/config'
import type { Activity, Best, Stats } from '../types'

const MAX_DAYS = 35
const MIN_WEEKS = 2
const CELL_PX = 8 // budget per column, used only to choose how many weeks fit
const WEEK_GAP = 6
const LABEL = 74
const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export default class ChartController extends Controller {
  static targets = ['container', 'tooltip', 'heading']

  declare readonly containerTarget: HTMLElement
  declare readonly tooltipTarget: HTMLElement
  declare readonly headingTarget: HTMLElement

  private activities: Activity[] = []
  private colors = new Map<string, string>()
  private perDay = new Map<string, Map<string, number>>()
  private best = new Map<string, Best>()
  private hasData = false
  private expandedId: string | null = null

  connect() {
    window.addEventListener('activities:changed', this.onActivities)
    window.addEventListener('stats:changed', this.onStats)
    window.addEventListener('resize', this.onResize)
    // touch devices get tap-to-expand instead; a hover tooltip there fights the tap
    if (window.matchMedia('(hover: hover)').matches) {
      this.containerTarget.addEventListener('pointerover', this.onPointer)
      this.containerTarget.addEventListener('pointerleave', this.hideTooltip)
    }
  }

  disconnect() {
    window.removeEventListener('activities:changed', this.onActivities)
    window.removeEventListener('stats:changed', this.onStats)
    window.removeEventListener('resize', this.onResize)
  }

  toggleRow(event: Event) {
    const { id } = (event as unknown as { params: { id: string } }).params
    this.expandedId = this.expandedId === id ? null : id
    if (this.hasData) this.render()
  }

  private onActivities = (event: Event) => {
    const detail = (event as CustomEvent<{ activities: Activity[] }>).detail
    this.activities = detail.activities
    this.colors = assignSeriesClasses(detail.activities)
    if (this.hasData) this.render()
  }

  private onStats = (event: Event) => {
    const detail = (event as CustomEvent<Stats>).detail
    this.perDay = detail.perDay
    this.best = detail.best
    this.hasData = true
    this.hideTooltip()
    if (this.activities.length > 0) this.render()
  }

  private onResize = () => {
    if (this.hasData) this.render()
  }

  // rings first, in ring order, so the matrix mirrors the hero card
  private orderedActivities(): Activity[] {
    const lead = RING_ACTIVITIES.map((name) => this.activities.find((a) => a.name === name)).filter(
      (a): a is Activity => a !== undefined,
    )
    return [...lead, ...this.activities.filter((a) => !lead.includes(a))]
  }

  // whole weeks ending today, so a column is always the same weekday
  private windowKeys(): string[] {
    const available = this.containerTarget.clientWidth - LABEL - 4
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const daysThisWeek = today.getDay() + 1

    let weeks = Math.floor((MAX_DAYS - daysThisWeek) / 7)
    while (
      weeks > MIN_WEEKS &&
      (weeks * 7 + daysThisWeek) * CELL_PX + weeks * WEEK_GAP > available
    ) {
      weeks--
    }

    const total = weeks * 7 + daysThisWeek
    const keys: string[] = []
    for (let offset = total - 1; offset >= 0; offset--) {
      const d = new Date(today)
      d.setDate(d.getDate() - offset)
      keys.push(localDateString(d))
    }
    return keys
  }

  private static dayOfWeek(key: string): number {
    const [year, month, day] = key.split('-').map(Number)
    return new Date(year, month - 1, day).getDay()
  }

  // week boundaries get a wider gap, which is what makes the columns readable
  private appendCells(
    row: HTMLElement,
    keys: string[],
    make: (key: string, index: number) => HTMLElement,
  ) {
    keys.forEach((key, index) => {
      if (index > 0 && ChartController.dayOfWeek(key) === 0) {
        const gap = document.createElement('span')
        gap.className = 'mx-gap'
        row.appendChild(gap)
      }
      row.appendChild(make(key, index))
    })
  }

  private render() {
    if (this.containerTarget.clientWidth === 0) return
    const keys = this.windowKeys()
    this.headingTarget.textContent = `Last ${keys.length} days`

    const ordered = this.orderedActivities()
    const rows: HTMLElement[] = []

    rows.push(this.buildWeekdayHeader(keys))

    for (const activity of ordered) {
      const days = this.perDay.get(activity.id)
      const amounts = keys.map((key) => days?.get(key) ?? 0)
      const max = Math.max(...amounts, 1)
      // only the single best day is marked; ties would scatter the badge
      const bestDay = this.best.get(activity.id)?.day

      const row = document.createElement('div')
      row.className = `mx-row mx-activity ${this.colors.get(activity.id) ?? 'chart-s-other'}`
      if (this.expandedId === activity.id) row.classList.add('is-open')
      row.dataset.action = 'click->chart#toggleRow'
      row.dataset.chartIdParam = activity.id

      const label = document.createElement('span')
      label.className = 'mx-label'
      label.textContent = activity.name // user-named — textContent, never innerHTML
      row.appendChild(label)

      this.appendCells(row, keys, (key, i) => {
        const amount = amounts[i]
        const cell = document.createElement('span')
        if (amount === 0) {
          cell.className = 'mx-cell off'
        } else if (activity.kind === 'habit') {
          cell.className = 'mx-cell lvl-3'
        } else {
          const ratio = amount / max
          cell.className = `mx-cell lvl-${ratio < 0.5 ? 1 : ratio < 0.85 ? 2 : 3}`
          if (key === bestDay) cell.classList.add('is-record')
        }
        cell.dataset.tip =
          activity.kind === 'habit'
            ? `${formatDay(key)} · ${amount > 0 ? 'done' : 'not done'} · ${activity.name}`
            : `${formatDay(key)} · ${amount} ${activity.unit} · ${activity.name}`
        return cell
      })

      rows.push(row)
      if (this.expandedId === activity.id) rows.push(this.buildDetail(activity, keys, amounts))
    }

    // summary last: it reads as a footer over the rows it sums
    const counts = keys.map(
      (key) => ordered.filter((a) => (this.perDay.get(a.id)?.get(key) ?? 0) > 0).length,
    )
    const summary = document.createElement('div')
    summary.className = 'mx-row mx-all'
    const summaryLabel = document.createElement('span')
    summaryLabel.className = 'mx-label'
    summaryLabel.textContent = 'All'
    summary.appendChild(summaryLabel)
    this.appendCells(summary, keys, (key, i) => {
      const cell = document.createElement('span')
      const count = counts[i]
      const level = count === 0 ? 0 : count === 1 ? 1 : count < ordered.length ? 2 : 3
      cell.className = level === 0 ? 'mx-cell off' : `mx-cell lvl-${level}`
      cell.dataset.tip = `${formatDay(key)} · ${count} of ${ordered.length} active`
      return cell
    })
    rows.push(summary)

    rows.push(this.buildTicks(keys))
    this.containerTarget.replaceChildren(...rows)
  }

  private buildWeekdayHeader(keys: string[]): HTMLElement {
    const row = document.createElement('div')
    row.className = 'mx-row mx-weekdays'
    const pad = document.createElement('span')
    pad.className = 'mx-label'
    row.appendChild(pad)
    this.appendCells(row, keys, (key) => {
      const cell = document.createElement('span')
      cell.className = 'mx-weekday'
      cell.textContent = WEEKDAY[ChartController.dayOfWeek(key)]
      return cell
    })
    return row
  }

  private buildTicks(keys: string[]): HTMLElement {
    const row = document.createElement('div')
    row.className = 'mx-row mx-ticks'
    const pad = document.createElement('span')
    pad.className = 'mx-label'
    row.appendChild(pad)
    this.appendCells(row, keys, (key) => {
      const tick = document.createElement('span')
      tick.className = 'mx-tick'
      // every week starts on a Sunday now, so the dates line up with the gaps
      if (ChartController.dayOfWeek(key) === 0) {
        const text = document.createElement('span')
        text.className = 'mx-tick-text'
        text.textContent = formatDay(key)
        tick.appendChild(text)
      }
      return tick
    })
    return row
  }

  private buildDetail(activity: Activity, keys: string[], amounts: number[]): HTMLElement {
    const detail = document.createElement('div')
    detail.className = `mx-detail ${this.colors.get(activity.id) ?? 'chart-s-other'}`

    const total = amounts.reduce((sum, v) => sum + v, 0)
    const active = amounts.filter((v) => v > 0).length
    const best = this.best.get(activity.id)

    let streak = 0
    const days = this.perDay.get(activity.id)
    const cursor = new Date()
    if ((days?.get(localDateString(cursor)) ?? 0) === 0) cursor.setDate(cursor.getDate() - 1)
    while ((days?.get(localDateString(cursor)) ?? 0) > 0) {
      streak++
      cursor.setDate(cursor.getDate() - 1)
    }

    const chips: [string, string][] = [
      ['Active', `${active} of ${keys.length} days`],
      ['Streak', streak === 1 ? '1 day' : `${streak} days`],
      [
        'Window',
        activity.kind === 'habit' ? `${total} days` : `${total} ${activity.unit}`,
      ],
    ]
    if (best && activity.kind !== 'habit') {
      chips.push(['Best', `${best.amount} on ${formatDay(best.day)}`])
    }

    for (const [label, value] of chips) {
      const chip = document.createElement('span')
      chip.className = 'mx-chip'
      const k = document.createElement('span')
      k.className = 'mx-chip-key'
      k.textContent = label
      const v = document.createElement('span')
      v.textContent = value
      chip.append(k, v)
      detail.appendChild(chip)
    }
    return detail
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
