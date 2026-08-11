export interface Exercise {
  id: string
  name: string
  created_at: string
}

export interface Entry {
  id: string
  exercise_id: string
  reps: number
  created_at: string
}
