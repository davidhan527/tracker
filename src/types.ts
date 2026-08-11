export interface Activity {
  id: string
  name: string
  unit: string // 'reps', 'pages', 'minutes', …
  created_at: string
}

export interface Entry {
  id: string
  activity_id: string
  amount: number
  created_at: string
}
