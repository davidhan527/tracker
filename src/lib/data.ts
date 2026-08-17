// Consolidation layer: the DB keeps exercises/books/habits (and their entry
// tables) fully separate; this module merges them into the unified Activity /
// Entry shapes the UI works with, and routes writes to the right table.
import { localDateString } from './chart'
import { ARCHIVED } from './config'
import { supabase } from './supabase'
import type { Activity, Entry, Kind } from '../types'

export const KINDS: Kind[] = ['exercise', 'book', 'habit']

const ACTIVITY_TABLE: Record<Kind, string> = {
  exercise: 'exercises',
  book: 'books',
  habit: 'habits',
}

const ENTRY: Record<Kind, { table: string; ref: string; amount: string | null }> = {
  exercise: { table: 'exercise_entries', ref: 'exercise_id', amount: 'amount' },
  book: { table: 'book_entries', ref: 'book_id', amount: 'amount' },
  habit: { table: 'habit_entries', ref: 'habit_id', amount: null },
}

type Raw = Record<string, unknown>

function toActivity(kind: Kind, row: Raw): Activity {
  const unit =
    kind === 'exercise'
      ? ((row.unit as string) ?? 'reps')
      : kind === 'book'
        ? ((row.unit as string) ?? 'pages')
        : 'days'
  return {
    id: row.id as string,
    name: row.name as string,
    unit,
    kind,
    created_at: row.created_at as string,
    author: (row.author as string) ?? undefined,
    finishedOn: (row.finished_on as string) ?? null,
  }
}

export async function loadActivities(): Promise<{
  activities: Activity[]
  finished: Activity[]
  error: string | null
}> {
  const results = await Promise.all(
    KINDS.map((kind) => supabase.from(ACTIVITY_TABLE[kind]).select('*')),
  )
  const failed = results.find((result) => result.error)
  if (failed?.error) return { activities: [], finished: [], error: failed.error.message }

  const all = KINDS.flatMap((kind, i) =>
    ((results[i].data ?? []) as Raw[]).map((row) => toActivity(kind, row)),
  )
  // global creation order keeps series-color slots stable across kinds
  all.sort((a, b) => a.created_at.localeCompare(b.created_at))

  // dropping names here is what removes them from every widget at once; the rows
  // stay in the database, so archiving and finishing are both fully reversible
  const live = all.filter(
    (activity) => !ARCHIVED.includes(activity.name) && !activity.finishedOn,
  )
  const finished = all.filter((activity) => activity.finishedOn)
  finished.sort((a, b) => (b.finishedOn ?? '').localeCompare(a.finishedOn ?? ''))
  return { activities: live, finished, error: null }
}

export async function createActivity(
  kind: Kind,
  name: string,
  unit: string,
  author?: string,
): Promise<{ activity: Activity | null; error: { code?: string; message: string } | null }> {
  const row: Raw = kind === 'habit' ? { name } : { name, unit }
  if (kind === 'book' && author) row.author = author
  const { data, error } = await supabase.from(ACTIVITY_TABLE[kind]).insert(row).select().single()
  if (error) return { activity: null, error }
  return { activity: toActivity(kind, data as Raw), error: null }
}

// null reopens it. Kept reversible so a mistap is never a dead end.
export async function setBookFinished(
  id: string,
  day: string | null,
): Promise<string | null> {
  const { error } = await supabase.from('books').update({ finished_on: day }).eq('id', id)
  return error?.message ?? null
}

// pastDay: YYYY-MM-DD when backdating. Habits are idempotent per day at the DB
// level (unique(habit_id, done_on)) — a duplicate mark reports conflict.
export async function logEntry(
  activity: Activity,
  amount: number,
  pastDay: string | null,
): Promise<{ error: string | null; conflict: boolean }> {
  const spec = ENTRY[activity.kind]
  const row: Raw = { [spec.ref]: activity.id }
  if (activity.kind === 'habit') {
    row.done_on = pastDay ?? localDateString(new Date())
  } else {
    row[spec.amount!] = amount
    if (pastDay) {
      const [year, month, day] = pastDay.split('-').map(Number)
      // noon local keeps the entry on the picked calendar day in nearby timezones
      row.created_at = new Date(year, month - 1, day, 12).toISOString()
    }
  }

  const { error } = await supabase.from(spec.table).insert(row)
  if (error?.code === '23505') return { error: null, conflict: true }
  return { error: error?.message ?? null, conflict: false }
}

function toEntry(kind: Kind, row: Raw): Entry {
  const spec = ENTRY[kind]
  const created_at = row.created_at as string
  // ?? row.pages: tolerate book rows from before the pages→amount rename
  const amount = kind === 'habit' ? 1 : ((row[spec.amount!] ?? row.pages) as number)
  return {
    id: row.id as string,
    kind,
    activity_id: row[spec.ref] as string,
    amount,
    day: kind === 'habit' ? (row.done_on as string) : localDateString(new Date(created_at)),
    created_at,
  }
}

// A failed query must never look like a day with nothing logged, so these throw
// rather than coalescing to []. The caller decides what to show.
function assertOk(results: { error: { message: string } | null }[]) {
  const failed = results.find((result) => result.error)
  if (failed?.error) throw new Error(failed.error.message)
}

export async function entriesSince(since: Date): Promise<Entry[]> {
  const sinceDay = localDateString(since)
  const [exercises, books, habits] = await Promise.all([
    supabase.from('exercise_entries').select('*').gte('created_at', since.toISOString()),
    supabase.from('book_entries').select('*').gte('created_at', since.toISOString()),
    supabase.from('habit_entries').select('*').gte('done_on', sinceDay),
  ])
  assertOk([exercises, books, habits])
  return [
    ...((exercises.data ?? []) as Raw[]).map((row) => toEntry('exercise', row)),
    ...((books.data ?? []) as Raw[]).map((row) => toEntry('book', row)),
    ...((habits.data ?? []) as Raw[]).map((row) => toEntry('habit', row)),
  ]
}

// Everything, ever. Personal records need the whole history, and one user's
// tracker stays comfortably small — this is a handful of KB for years of data.
export async function allEntries(): Promise<Entry[]> {
  return entriesSince(new Date(2000, 0, 1))
}

export async function recentEntries(limit: number): Promise<Entry[]> {
  const results = await Promise.all(
    KINDS.map((kind) =>
      supabase.from(ENTRY[kind].table).select('*').order('created_at', { ascending: false }).limit(limit),
    ),
  )
  assertOk(results)
  return KINDS.flatMap((kind, i) => ((results[i].data ?? []) as Raw[]).map((row) => toEntry(kind, row)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit)
}

export async function deleteEntry(kind: Kind, id: string): Promise<boolean> {
  const { error } = await supabase.from(ENTRY[kind].table).delete().eq('id', id)
  return !error
}
