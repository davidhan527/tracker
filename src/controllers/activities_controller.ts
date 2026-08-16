import { Controller } from '@hotwired/stimulus'
import type { Session } from '@supabase/supabase-js'
import { createActivity, loadActivities } from '../lib/data'
import { supabase } from '../lib/supabase'
import type { Activity, Kind } from '../types'

const UNIT_OPTIONS: Record<string, string[]> = {
  exercise: ['reps', 'minutes', 'km'],
  book: ['pages', 'chapters'],
  habit: [],
}

export default class ActivitiesController extends Controller {
  static targets = ['picker', 'name', 'unit', 'kind', 'status']

  declare readonly pickerTarget: HTMLSelectElement
  declare readonly nameTarget: HTMLInputElement
  declare readonly unitTarget: HTMLSelectElement
  declare readonly kindTarget: HTMLSelectElement
  declare readonly statusTarget: HTMLElement

  private activities: Activity[] = []
  private userId: string | null = null

  connect() {
    window.addEventListener('session:changed', this.onSession)
    window.addEventListener('data:refresh', this.onRefreshRequested)
    this.kindChanged()
    // connect() can run before or after the client emits INITIAL_SESSION, so also pull
    void supabase.auth.getSession().then(({ data }) => this.handleSession(data.session))
  }

  disconnect() {
    window.removeEventListener('session:changed', this.onSession)
    window.removeEventListener('data:refresh', this.onRefreshRequested)
  }

  // pull-to-refresh reloads from the top of the chain, so activities and every
  // downstream card refetch together
  private onRefreshRequested = () => {
    if (this.userId) void this.load()
  }

  select() {
    this.broadcast()
  }

  // each kind offers its own units; habits are yes/no days with no choice
  kindChanged() {
    const units = UNIT_OPTIONS[this.kindTarget.value] ?? []
    this.unitTarget.hidden = units.length === 0
    this.unitTarget.replaceChildren(
      ...units.map((unit) => {
        const option = document.createElement('option')
        option.value = unit
        option.textContent = unit
        return option
      }),
    )
  }

  async create(event: SubmitEvent) {
    event.preventDefault()
    const name = this.nameTarget.value.trim()
    if (!name) return

    this.statusTarget.textContent = ''
    const kind = (this.kindTarget.value || 'exercise') as Kind
    const fallback = UNIT_OPTIONS[kind]?.[0] ?? 'reps'
    const { activity, error } = await createActivity(kind, name, this.unitTarget.value || fallback)
    if (error || !activity) {
      this.statusTarget.textContent =
        error?.code === '23505'
          ? 'You are already tracking that.'
          : `Could not add: ${error?.message ?? 'unknown error'}`
      return
    }

    this.nameTarget.value = ''
    this.activities = [...this.activities, activity]
    this.render(activity.id)
  }

  private onSession = (event: Event) => {
    this.handleSession((event as CustomEvent<{ session: Session | null }>).detail.session)
  }

  private handleSession(session: Session | null) {
    const id = session?.user.id ?? null
    if (id === this.userId) return
    this.userId = id
    if (id) void this.load()
    else this.clear()
  }

  private async load() {
    const { activities, error } = await loadActivities()
    if (error) {
      this.statusTarget.textContent = `Could not load activities: ${error}`
      return
    }

    let items = activities
    if (items.length === 0) {
      // first run for this account; unique(user_id, name) makes a duplicate insert harmless
      const seeded = await createActivity('exercise', 'Pushups', 'reps')
      if (seeded.activity) items = [seeded.activity]
    }

    this.activities = items
    this.render(items[0]?.id)
  }

  private clear() {
    this.activities = []
    this.pickerTarget.replaceChildren()
    this.broadcast()
  }

  private render(selectedId?: string) {
    this.pickerTarget.replaceChildren(
      ...this.activities.map((activity) => {
        const option = document.createElement('option')
        option.value = activity.id
        option.textContent = activity.name
        return option
      }),
    )
    if (selectedId) this.pickerTarget.value = selectedId
    this.broadcast()
  }

  private broadcast() {
    window.dispatchEvent(
      new CustomEvent('activities:changed', {
        detail: { activities: this.activities, selectedId: this.pickerTarget.value || null },
      }),
    )
  }
}
