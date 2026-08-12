// Personal rules. This is a single-user app: these are meant to be edited by hand.

// Concentric ring lineup, outermost first, matched by exact activity name.
// An activity that doesn't exist yet simply has no ring.
export const RING_ACTIVITIES = ['Bible', 'Pushups', 'Chin-ups']

// Tracked, but never a headline: no ring, no hero row, no nudge.
// Still present in the matrix, the recent list and the log sheet.
export const HERO_EXCLUDED = ['Pickleball']

// Recovery rules: the day after `habit` is done, `skip` disappears from the
// hero entirely — rings, rows and nudges. (Pickleball flares up tennis elbow.)
export const REST_AFTER = [{ skip: 'Chin-ups', habit: 'Pickleball' }]

// Pin an activity to a specific palette slot (1-7). Everything else takes the
// next free slot in creation order, so pinning one name never shifts the others.
// The chain that has to stay legible is the matrix column order:
// Bible → Pushups → Chin-ups → Pickleball → All(summary).
export const COLOR_OVERRIDES: Record<string, number> = {
  Bible: 3, // teal
  Pickleball: 7, // violet — magenta here would collide with Chin-ups coral
}
