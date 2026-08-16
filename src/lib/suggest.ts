import { localDateString } from './chart'
import type { Activity, Entry } from '../types'

const WINDOW_DAYS = 14
const MAX_CHIPS = 4
const MAX_PER_ACTIVITY = 2

export interface Suggestion {
  activity: Activity
  amount: number
  count: number
}

// The amounts you actually reach for, learned from the last two weeks.
// Every active activity gets its top amount before any activity gets a second,
// so a busy one can't crowd the others out of the row.
export function suggestQuickActions(entries: Entry[], activities: Activity[]): Suggestion[] {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - (WINDOW_DAYS - 1))
  const cutoffDay = localDateString(cutoff)

  const byId = new Map(activities.map((activity) => [activity.id, activity]))
  const tally = new Map<string, Suggestion>()

  for (const entry of entries) {
    if (entry.day < cutoffDay) continue
    const activity = byId.get(entry.activity_id)
    if (!activity) continue
    const key = `${entry.activity_id}:${entry.amount}`
    const existing = tally.get(key)
    if (existing) existing.count++
    else tally.set(key, { activity, amount: entry.amount, count: 1 })
  }

  const ranked = [...tally.values()].sort(
    (a, b) => b.count - a.count || b.amount - a.amount,
  )

  const chosen: Suggestion[] = []
  const perActivity = new Map<string, number>()
  // pass 1: one per activity, in order of how often it was logged
  for (const suggestion of ranked) {
    if (chosen.length >= MAX_CHIPS) break
    if (perActivity.has(suggestion.activity.id)) continue
    perActivity.set(suggestion.activity.id, 1)
    chosen.push(suggestion)
  }
  // pass 2: fill any remaining slots with runners-up
  for (const suggestion of ranked) {
    if (chosen.length >= MAX_CHIPS) break
    const used = perActivity.get(suggestion.activity.id) ?? 0
    if (used >= MAX_PER_ACTIVITY || chosen.includes(suggestion)) continue
    perActivity.set(suggestion.activity.id, used + 1)
    chosen.push(suggestion)
  }

  // keep activity order stable so the chips don't reshuffle under your thumb
  const order = new Map(activities.map((activity, i) => [activity.id, i]))
  return chosen.sort(
    (a, b) =>
      (order.get(a.activity.id) ?? 0) - (order.get(b.activity.id) ?? 0) || a.amount - b.amount,
  )
}
