export interface Activity {
  id: string
  name: string
  unit: string // 'reps', 'pages', 'minutes', …; 'days' for habits
  kind: string // 'exercise' | 'book' | 'habit' (habit = yes/no per day)
  created_at: string
}

export interface Entry {
  id: string
  activity_id: string
  amount: number
  created_at: string
}
