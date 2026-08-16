export type Kind = 'exercise' | 'book' | 'habit'

// unified client-side view over the three activity tables
export interface Activity {
  id: string
  name: string
  unit: string // exercises: reps/minutes/km; books: pages; habits: days
  kind: Kind
  created_at: string
}

export interface Best {
  day: string // YYYY-MM-DD
  amount: number
}

// derived once by the dashboard and broadcast, so every card shares one fetch
export interface Stats {
  perDay: Map<string, Map<string, number>> // activityId -> day -> total
  best: Map<string, Best> // activityId -> all-time best day
  entries: Entry[] // raw rows, for anything that needs individual amounts
}

// unified client-side view over the three entry tables
export interface Entry {
  id: string
  kind: Kind
  activity_id: string
  amount: number // habits: always 1
  day: string // YYYY-MM-DD local day the entry counts toward (habits: done_on)
  created_at: string // when it was logged (recency display)
}
