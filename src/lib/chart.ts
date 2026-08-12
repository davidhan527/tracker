import { COLOR_OVERRIDES } from './config'

export const MAX_SERIES = 7 // palette slots; activities beyond this share the neutral slot

export function seriesClass(index: number): string {
  return index < MAX_SERIES ? `chart-s${index + 1}` : 'chart-s-other'
}

// Pinned names claim their slot first, so pinning one activity never shifts the
// colors of the others; everyone else takes the next free slot in order.
export function assignSeriesClasses(
  activities: { id: string; name: string }[],
): Map<string, string> {
  const used = new Set<number>()
  const assigned = new Map<string, string>()

  for (const activity of activities) {
    const slot = COLOR_OVERRIDES[activity.name]
    if (slot && slot <= MAX_SERIES && !used.has(slot)) {
      used.add(slot)
      assigned.set(activity.id, `chart-s${slot}`)
    }
  }

  let next = 1
  for (const activity of activities) {
    if (assigned.has(activity.id)) continue
    while (next <= MAX_SERIES && used.has(next)) next++
    assigned.set(activity.id, next <= MAX_SERIES ? `chart-s${next}` : 'chart-s-other')
    used.add(next)
  }
  return assigned
}

export function localDateString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function formatDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

// Concentric rings, outermost first; pct is pre-capped to 0..100.
// The band always spans the same annulus, so two rings look as substantial as
// three instead of leaving a hollow centre.
const RING_SIZE = 150
const RING_INNER = 30 // radius of the hole
const RING_GAP = 4
const RING_MIN_STROKE = 9
const RING_MAX_STROKE = 18

export function renderRings(rings: { cls: string; pct: number }[], centerPct: number): string {
  const cx = RING_SIZE / 2
  const outer = cx - 1
  const band = outer - RING_INNER
  const stroke = Math.min(
    Math.max((band - RING_GAP * (rings.length - 1)) / rings.length, RING_MIN_STROKE),
    RING_MAX_STROKE,
  )

  const parts: string[] = []
  let radius = outer - stroke / 2
  rings.forEach((ring, i) => {
    const circumference = 2 * Math.PI * radius
    const filled = (circumference * ring.pct) / 100
    parts.push(
      `<circle class="ring-track ${ring.cls}" cx="${cx}" cy="${cx}" r="${radius.toFixed(1)}" stroke-width="${stroke.toFixed(1)}"/>`,
    )
    if (ring.pct > 0) {
      // dasharray/dashoffset idiom so CSS can animate the arc drawing itself on
      parts.push(
        `<circle class="ring-arc ${ring.cls}" cx="${cx}" cy="${cx}" r="${radius.toFixed(1)}" stroke-width="${stroke.toFixed(1)}" stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${(circumference - filled).toFixed(1)}" style="--dash:${circumference.toFixed(1)}px;--i:${i}" transform="rotate(-90 ${cx} ${cx})"/>`,
      )
    }
    radius -= stroke + RING_GAP
  })

  const complete = rings.length > 0 && rings.every((ring) => ring.pct >= 100)
  const empty = centerPct === 0
  if (complete) {
    const r = RING_INNER * 0.62
    parts.push(
      `<path class="ring-check" d="M${(cx - r).toFixed(1)} ${cx.toFixed(1)} l${(r * 0.62).toFixed(1)} ${(r * 0.66).toFixed(1)} l${(r * 1.4).toFixed(1)} ${(-r * 1.45).toFixed(1)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
  } else {
    parts.push(
      `<text class="ring-center" x="${cx}" y="${cx + 2}" text-anchor="middle">${empty ? 'Start' : `${centerPct}%`}</text>`,
    )
    if (!empty) {
      parts.push(`<text class="ring-sub" x="${cx}" y="${cx + 18}" text-anchor="middle">today</text>`)
    }
  }

  const label = complete
    ? 'Every ring closed for today'
    : `Today's progress rings: ${centerPct}% overall`
  return `<svg class="${complete ? 'is-complete' : ''}" viewBox="0 0 ${RING_SIZE} ${RING_SIZE}" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
}
