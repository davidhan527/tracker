export const MAX_SERIES = 6 // palette slots; activities beyond this fold into "Other"

export function seriesClass(index: number): string {
  return index < MAX_SERIES ? `chart-s${index + 1}` : 'chart-s-other'
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
