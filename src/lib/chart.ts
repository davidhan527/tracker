export interface StackedDay {
  date: string // YYYY-MM-DD, local
  values: number[] // reps per series, aligned to the caller's series order
}

export const MAX_SERIES = 6 // palette slots; activities beyond this fold into "Other"

export function seriesClass(index: number): string {
  return index < MAX_SERIES ? `chart-s${index + 1}` : 'chart-s-other'
}

// panel geometry in viewBox units; rendered ~1:1 at the app's max card width
const WIDTH = 400
const TOP = 16
const BOTTOM = 80
const LEFT = 30
const RIGHT = WIDTH - 6
const DATE_ROW = 16
const BAR_GAP = 2.5
const CORNER = 3

export function localDateString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function stackedDailyTotals(
  rows: { amount: number; day: string; series: number }[],
  seriesCount: number,
  days: number,
  today: Date = new Date(),
): StackedDay[] {
  const buckets = new Map<string, number[]>()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    buckets.set(localDateString(d), new Array(seriesCount).fill(0))
  }
  for (const row of rows) {
    const bucket = buckets.get(row.day)
    if (bucket && row.series >= 0 && row.series < seriesCount) bucket[row.series] += row.amount
  }
  return [...buckets.entries()].map(([date, values]) => ({ date, values }))
}

export function formatDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

// smallest "clean" axis max >= value
function niceMax(value: number): number {
  if (value <= 10) return 10
  const power = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (step * power >= value) return step * power
  }
  return 10 * power
}

// bar with rounded top corners, square bottom
function topRoundedPath(x: number, top: number, width: number, bottom: number): string {
  const r = Math.min(CORNER, (bottom - top) / 2, width / 2)
  const right = x + width
  return [
    `M${x.toFixed(2)} ${bottom.toFixed(2)}`,
    `V${(top + r).toFixed(2)}`,
    `Q${x.toFixed(2)} ${top.toFixed(2)} ${(x + r).toFixed(2)} ${top.toFixed(2)}`,
    `H${(right - r).toFixed(2)}`,
    `Q${right.toFixed(2)} ${top.toFixed(2)} ${right.toFixed(2)} ${(top + r).toFixed(2)}`,
    `V${bottom.toFixed(2)}`,
    'Z',
  ].join('')
}

export function dayTotal(day: StackedDay): number {
  return day.values.reduce((sum, v) => sum + v, 0)
}

// concentric progress rings, outermost first; pct is pre-capped to 0..100
const RING_SIZE = 150
const RING_STROKE = 11
const RING_GAP = 3

export function renderRings(rings: { cls: string; pct: number }[], centerPct: number): string {
  const cx = RING_SIZE / 2
  let radius = cx - RING_STROKE / 2 - 1
  const parts: string[] = []
  for (const ring of rings) {
    const circumference = 2 * Math.PI * radius
    parts.push(
      `<circle class="ring-track" cx="${cx}" cy="${cx}" r="${radius.toFixed(1)}" stroke-width="${RING_STROKE}"/>`,
    )
    if (ring.pct > 0) {
      parts.push(
        `<circle class="ring-arc ${ring.cls}" cx="${cx}" cy="${cx}" r="${radius.toFixed(1)}" stroke-width="${RING_STROKE}" stroke-dasharray="${((circumference * ring.pct) / 100).toFixed(1)} ${circumference.toFixed(1)}" transform="rotate(-90 ${cx} ${cx})"/>`,
      )
    }
    radius -= RING_STROKE + RING_GAP
  }
  parts.push(
    `<text class="ring-center" x="${cx}" y="${cx - 1}" text-anchor="middle">${centerPct}%</text>`,
    `<text class="ring-sub" x="${cx}" y="${cx + 15}" text-anchor="middle">today</text>`,
  )
  return `<svg viewBox="0 0 ${RING_SIZE} ${RING_SIZE}" role="img" aria-label="Today's progress rings: ${centerPct}% overall">${parts.join('')}</svg>`
}

// habit-tracker strip: one square per day, filled when done — no magnitude axis
const STRIP_TOP = 8
const STRIP_BOTTOM = 34

export function renderHabitStrip(
  days: { date: string; total: number }[],
  seriesCls: string,
  showDates: boolean,
): string {
  const height = showDates ? STRIP_BOTTOM + DATE_ROW + 4 : STRIP_BOTTOM + 4
  const slot = (RIGHT - LEFT) / days.length
  const size = Math.min(24, slot - BAR_GAP)
  const tickStep = days.length >= 21 ? 7 : days.length >= 10 ? 3 : 1

  const parts: string[] = []

  days.forEach((day, i) => {
    const cx = LEFT + slot * i + slot / 2
    const x = (cx - size / 2).toFixed(2)
    const cls = day.total > 0 ? `chart-bar ${seriesCls}` : 'chart-miss'
    parts.push(
      `<rect class="${cls}" data-index="${i}" x="${x}" y="${STRIP_TOP}" width="${size.toFixed(2)}" height="${STRIP_BOTTOM - STRIP_TOP}" rx="6"/>`,
    )
    if (showDates && (days.length - 1 - i) % tickStep === 0) {
      const atEdge = cx > RIGHT - 16
      parts.push(
        `<text class="chart-tick" x="${(atEdge ? RIGHT : cx).toFixed(2)}" y="${STRIP_BOTTOM + 13}" text-anchor="${atEdge ? 'end' : 'middle'}">${formatDay(day.date)}</text>`,
      )
    }
  })

  // hover targets on top so they win pointer events
  days.forEach((_, i) => {
    parts.push(
      `<rect class="chart-hit" data-index="${i}" x="${(LEFT + slot * i).toFixed(2)}" y="${STRIP_TOP}" width="${slot.toFixed(2)}" height="${STRIP_BOTTOM - STRIP_TOP}"/>`,
    )
  })

  const done = days.filter((day) => day.total > 0).length
  const label = `Days done over the last ${days.length} days: ${done} of ${days.length}.`

  return `<svg viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
}

// one activity's window on its own y-scale, so its trend reads relative to itself
export function renderPanelChart(
  days: { date: string; total: number }[],
  seriesCls: string,
  showDates: boolean,
): string {
  const height = showDates ? BOTTOM + DATE_ROW + 4 : BOTTOM + 4
  const axisMax = niceMax(Math.max(...days.map((d) => d.total)))
  const plotHeight = BOTTOM - TOP
  const slot = (RIGHT - LEFT) / days.length
  const barWidth = Math.min(24, slot - BAR_GAP)
  const scale = plotHeight / axisMax

  const parts: string[] = []

  // per-panel scale: the max tick makes each panel's own yardstick explicit
  parts.push(`<line class="chart-grid" x1="${LEFT}" y1="${TOP}" x2="${RIGHT}" y2="${TOP}"/>`)
  parts.push(`<text class="chart-tick" x="${LEFT - 5}" y="${TOP}" dy="3" text-anchor="end">${axisMax}</text>`)
  parts.push(`<line class="chart-grid" x1="${LEFT}" y1="${BOTTOM}" x2="${RIGHT}" y2="${BOTTOM}"/>`)

  const peak = days.reduce((best, d, i) => (d.total > days[best].total ? i : best), 0)
  // tick cadence tracks the window: weekly at 21+, every 3rd day at 10+, daily below
  const tickStep = days.length >= 21 ? 7 : days.length >= 10 ? 3 : 1

  days.forEach((day, i) => {
    const cx = LEFT + slot * i + slot / 2
    if (day.total > 0) {
      const top = BOTTOM - day.total * scale
      parts.push(
        `<path class="chart-bar ${seriesCls}" data-index="${i}" d="${topRoundedPath(cx - barWidth / 2, top, barWidth, BOTTOM)}"/>`,
      )
    }
    // anchored from the newest day, so today is always labeled
    if (showDates && (days.length - 1 - i) % tickStep === 0) {
      // right-anchor the newest label so it doesn't clip at the viewBox edge
      const atEdge = cx > RIGHT - 16
      parts.push(
        `<text class="chart-tick" x="${(atEdge ? RIGHT : cx).toFixed(2)}" y="${BOTTOM + 13}" text-anchor="${atEdge ? 'end' : 'middle'}">${formatDay(day.date)}</text>`,
      )
    }
  })

  const valueLabel = (index: number) => {
    const cx = LEFT + slot * index + slot / 2
    const anchor = index < 2 ? 'start' : index > days.length - 3 ? 'end' : 'middle'
    return `<text class="chart-peak" x="${cx.toFixed(2)}" y="${(BOTTOM - days[index].total * scale - 4).toFixed(2)}" text-anchor="${anchor}">${days[index].total}</text>`
  }

  if (days[peak].total > 0) parts.push(valueLabel(peak))
  // emphasize the newest bar too, unless the peak label already sits at the edge
  const last = days.length - 1
  if (last !== peak && days[last].total > 0 && last - peak > 2) parts.push(valueLabel(last))

  // full-height hover targets, one per day slot
  days.forEach((_, i) => {
    parts.push(
      `<rect class="chart-hit" data-index="${i}" x="${(LEFT + slot * i).toFixed(2)}" y="${TOP}" width="${slot.toFixed(2)}" height="${plotHeight}"/>`,
    )
  })

  const total = days.reduce((sum, d) => sum + d.total, 0)
  const label = `Daily reps over the last ${days.length} days. Total ${total}. Best day ${formatDay(days[peak].date)} with ${days[peak].total}.`

  return `<svg viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
}
