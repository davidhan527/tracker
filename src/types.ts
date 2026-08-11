export interface Exercise {
  id: string
  name: string
  unit: string // 'reps', 'pages', 'minutes', …
  created_at: string
}

export interface Entry {
  id: string
  exercise_id: string
  reps: number
  created_at: string
}
