export interface DayTotal {
  date: string // YYYY-MM-DD, local
  total: number
}

// geometry in viewBox units; rendered ~1:1 at the app's max card width
const WIDTH = 400
const HEIGHT = 180
const TOP = 16
const BOTTOM = HEIGHT - 20
const LEFT = 30
const RIGHT = WIDTH - 6
const BAR_GAP = 2.5
const CORNER = 3

export function localDateString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function dailyTotals(
  rows: { reps: number; created_at: string }[],
  days: number,
  today: Date = new Date(),
): DayTotal[] {
  const totals = new Map<string, number>()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    totals.set(localDateString(d), 0)
  }
  for (const row of rows) {
    const key = localDateString(new Date(row.created_at))
    if (totals.has(key)) totals.set(key, (totals.get(key) ?? 0) + row.reps)
  }
  return [...totals.entries()].map(([date, total]) => ({ date, total }))
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

// bar with rounded top corners, square baseline
function barPath(x: number, y: number, width: number, height: number): string {
  const r = Math.min(CORNER, height / 2, width / 2)
  const right = x + width
  return [
    `M${x.toFixed(2)} ${(y + height).toFixed(2)}`,
    `V${(y + r).toFixed(2)}`,
    `Q${x.toFixed(2)} ${y.toFixed(2)} ${(x + r).toFixed(2)} ${y.toFixed(2)}`,
    `H${(right - r).toFixed(2)}`,
    `Q${right.toFixed(2)} ${y.toFixed(2)} ${right.toFixed(2)} ${(y + r).toFixed(2)}`,
    `V${(y + height).toFixed(2)}`,
    'Z',
  ].join('')
}

export function renderColumnChart(days: DayTotal[]): string {
  const max = Math.max(...days.map((d) => d.total))
  const axisMax = niceMax(max)
  const plotWidth = RIGHT - LEFT
  const plotHeight = BOTTOM - TOP
  const slot = plotWidth / days.length
  const barWidth = Math.min(24, slot - BAR_GAP)
  const yFor = (value: number) => BOTTOM - (value / axisMax) * plotHeight

  const parts: string[] = []

  for (const tick of [axisMax / 2, axisMax]) {
    const y = yFor(tick).toFixed(2)
    parts.push(`<line class="chart-grid" x1="${LEFT}" y1="${y}" x2="${RIGHT}" y2="${y}"/>`)
    parts.push(`<text class="chart-tick" x="${LEFT - 5}" y="${y}" dy="3" text-anchor="end">${tick}</text>`)
  }
  parts.push(`<line class="chart-grid" x1="${LEFT}" y1="${BOTTOM}" x2="${RIGHT}" y2="${BOTTOM}"/>`)

  const peak = days.reduce((best, d, i) => (d.total > days[best].total ? i : best), 0)

  days.forEach((day, i) => {
    const cx = LEFT + slot * i + slot / 2
    if (day.total > 0) {
      const y = yFor(day.total)
      parts.push(
        `<path class="chart-bar" data-index="${i}" d="${barPath(cx - barWidth / 2, y, barWidth, BOTTOM - y)}"/>`,
      )
    }
    // label roughly weekly, anchored so the newest day is always labeled
    if ((days.length - 1 - i) % 7 === 0) {
      // right-anchor the newest label so it doesn't clip at the viewBox edge
      const atEdge = cx > RIGHT - 16
      parts.push(
        `<text class="chart-tick" x="${(atEdge ? RIGHT : cx).toFixed(2)}" y="${BOTTOM + 13}" text-anchor="${atEdge ? 'end' : 'middle'}">${formatDay(day.date)}</text>`,
      )
    }
  })

  if (days[peak].total > 0) {
    const cx = LEFT + slot * peak + slot / 2
    const anchor = peak < 2 ? 'start' : peak > days.length - 3 ? 'end' : 'middle'
    parts.push(
      `<text class="chart-peak" x="${cx.toFixed(2)}" y="${(yFor(days[peak].total) - 5).toFixed(2)}" text-anchor="${anchor}">${days[peak].total}</text>`,
    )
  }

  // full-height hover targets, one per day slot
  days.forEach((_, i) => {
    parts.push(
      `<rect class="chart-hit" data-index="${i}" x="${(LEFT + slot * i).toFixed(2)}" y="${TOP}" width="${slot.toFixed(2)}" height="${plotHeight}"/>`,
    )
  })

  const total = days.reduce((sum, d) => sum + d.total, 0)
  const label = `Daily reps over the last ${days.length} days. Total ${total}. Best day ${formatDay(days[peak].date)} with ${days[peak].total}.`

  return `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
}
