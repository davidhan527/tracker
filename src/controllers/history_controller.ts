import { Controller } from '@hotwired/stimulus'
import { supabase } from '../lib/supabase'
import type { Entry, Exercise } from '../types'

const RECENT_LIMIT = 20

export default class HistoryController extends Controller {
  static targets = ['todayTotal', 'todayLabel', 'list', 'empty']

  declare readonly todayTotalTarget: HTMLElement
  declare readonly todayLabelTarget: HTMLElement
  declare readonly listTarget: HTMLUListElement
  declare readonly emptyTarget: HTMLElement

  private names = new Map<string, string>()
  private selectedId: string | null = null

  connect() {
    window.addEventListener('exercises:changed', this.onExercises)
    window.addEventListener('entries:changed', this.onEntries)
  }

  disconnect() {
    window.removeEventListener('exercises:changed', this.onExercises)
    window.removeEventListener('entries:changed', this.onEntries)
  }

  async delete(event: Event) {
    const { id } = (event as unknown as { params: { id: string } }).params
    const { error } = await supabase.from('entries').delete().eq('id', id)
    if (!error) window.dispatchEvent(new CustomEvent('entries:changed'))
  }

  private onExercises = (event: Event) => {
    const detail = (event as CustomEvent<{ exercises: Exercise[]; selectedId: string | null }>).detail
    this.names = new Map(detail.exercises.map((exercise) => [exercise.id, exercise.name]))
    this.selectedId = detail.selectedId
    void this.refresh()
  }

  private onEntries = () => {
    void this.refresh()
  }

  private async refresh() {
    if (!this.selectedId) {
      this.todayTotalTarget.textContent = '0'
      this.todayLabelTarget.textContent = ''
      this.renderList([])
      return
    }

    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)

    const [today, recent] = await Promise.all([
      supabase
        .from('entries')
        .select('reps')
        .eq('exercise_id', this.selectedId)
        .gte('created_at', startOfDay.toISOString()),
      supabase
        .from('entries')
        .select('id, exercise_id, reps, created_at')
        .order('created_at', { ascending: false })
        .limit(RECENT_LIMIT),
    ])

    const total = ((today.data ?? []) as Pick<Entry, 'reps'>[]).reduce((sum, row) => sum + row.reps, 0)
    this.todayTotalTarget.textContent = String(total)
    this.todayLabelTarget.textContent = this.names.get(this.selectedId) ?? ''
    this.renderList((recent.data ?? []) as Entry[])
  }

  private renderList(entries: Entry[]) {
    this.emptyTarget.hidden = entries.length > 0
    this.listTarget.replaceChildren(...entries.map((entry) => this.renderEntry(entry)))
  }

  private renderEntry(entry: Entry): HTMLLIElement {
    const item = document.createElement('li')

    const label = document.createElement('span')
    label.className = 'entry-label'
    label.textContent = `${entry.reps} × ${this.names.get(entry.exercise_id) ?? '?'}`

    const time = document.createElement('time')
    time.className = 'muted'
    time.dateTime = entry.created_at
    time.textContent = timeAgo(entry.created_at)

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'ghost danger'
    remove.textContent = '✕'
    remove.setAttribute('aria-label', 'Delete entry')
    remove.dataset.action = 'history#delete'
    remove.dataset.historyIdParam = entry.id

    item.append(label, time, remove)
    return item
  }
}

function timeAgo(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
