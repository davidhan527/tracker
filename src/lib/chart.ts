export interface StackedDay {
  date: string // YYYY-MM-DD, local
  values: number[] // reps per series, aligned to the caller's series order
}

// geometry in viewBox units; rendered ~1:1 at the app's max card width
const WIDTH = 400
const HEIGHT = 180
const TOP = 16
const BOTTOM = HEIGHT - 20
const LEFT = 30
const RIGHT = WIDTH - 6
const BAR_GAP = 2.5
const SEGMENT_GAP = 2
const CORNER = 3

export function localDateString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function stackedDailyTotals(
  rows: { reps: number; created_at: string; series: number }[],
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
    const bucket = buckets.get(localDateString(new Date(row.created_at)))
    if (bucket && row.series >= 0 && row.series < seriesCount) bucket[row.series] += row.reps
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

export function renderStackedChart(days: StackedDay[], seriesClasses: string[]): string {
  const totals = days.map(dayTotal)
  const axisMax = niceMax(Math.max(...totals))
  const plotWidth = RIGHT - LEFT
  const plotHeight = BOTTOM - TOP
  const slot = plotWidth / days.length
  const barWidth = Math.min(24, slot - BAR_GAP)
  const scale = plotHeight / axisMax

  const parts: string[] = []

  for (const tick of [axisMax / 2, axisMax]) {
    const y = (BOTTOM - tick * scale).toFixed(2)
    parts.push(`<line class="chart-grid" x1="${LEFT}" y1="${y}" x2="${RIGHT}" y2="${y}"/>`)
    parts.push(`<text class="chart-tick" x="${LEFT - 5}" y="${y}" dy="3" text-anchor="end">${tick}</text>`)
  }
  parts.push(`<line class="chart-grid" x1="${LEFT}" y1="${BOTTOM}" x2="${RIGHT}" y2="${BOTTOM}"/>`)

  const peak = totals.reduce((best, total, i) => (total > totals[best] ? i : best), 0)

  days.forEach((day, i) => {
    const cx = LEFT + slot * i + slot / 2
    const x = cx - barWidth / 2
    const topIndex = day.values.reduce((last, v, s) => (v > 0 ? s : last), -1)

    let bottom = BOTTOM
    day.values.forEach((value, s) => {
      if (value <= 0) return
      const isBottom = bottom === BOTTOM
      const top = bottom - value * scale
      // 2px surface gap separates stacked segments; upper segments give it up from their base
      const drawnBottom = isBottom ? bottom : bottom - SEGMENT_GAP
      const drawnTop = Math.min(top, drawnBottom - 1)
      if (s === topIndex) {
        parts.push(
          `<path class="chart-bar ${seriesClasses[s]}" data-index="${i}" d="${topRoundedPath(x, drawnTop, barWidth, drawnBottom)}"/>`,
        )
      } else {
        parts.push(
          `<rect class="chart-bar ${seriesClasses[s]}" data-index="${i}" x="${x.toFixed(2)}" y="${drawnTop.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${(drawnBottom - drawnTop).toFixed(2)}"/>`,
        )
      }
      bottom = top
    })

    // label roughly weekly, anchored so the newest day is always labeled
    if ((days.length - 1 - i) % 7 === 0) {
      // right-anchor the newest label so it doesn't clip at the viewBox edge
      const atEdge = cx > RIGHT - 16
      parts.push(
        `<text class="chart-tick" x="${(atEdge ? RIGHT : cx).toFixed(2)}" y="${BOTTOM + 13}" text-anchor="${atEdge ? 'end' : 'middle'}">${formatDay(day.date)}</text>`,
      )
    }
  })

  if (totals[peak] > 0) {
    const cx = LEFT + slot * peak + slot / 2
    const anchor = peak < 2 ? 'start' : peak > days.length - 3 ? 'end' : 'middle'
    parts.push(
      `<text class="chart-peak" x="${cx.toFixed(2)}" y="${(BOTTOM - totals[peak] * scale - 5).toFixed(2)}" text-anchor="${anchor}">${totals[peak]}</text>`,
    )
  }

  // full-height hover targets, one per day slot
  days.forEach((_, i) => {
    parts.push(
      `<rect class="chart-hit" data-index="${i}" x="${(LEFT + slot * i).toFixed(2)}" y="${TOP}" width="${slot.toFixed(2)}" height="${plotHeight}"/>`,
    )
  })

  const grand = totals.reduce((sum, t) => sum + t, 0)
  const label = `Daily reps across exercises over the last ${days.length} days. Total ${grand}. Best day ${formatDay(days[peak].date)} with ${totals[peak]}.`

  return `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
}
