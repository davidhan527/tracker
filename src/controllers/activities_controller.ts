import { Controller } from '@hotwired/stimulus'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Activity } from '../types'

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
    // connect() can run before or after the client emits INITIAL_SESSION, so also pull
    void supabase.auth.getSession().then(({ data }) => this.handleSession(data.session))
  }

  disconnect() {
    window.removeEventListener('session:changed', this.onSession)
  }

  select() {
    this.broadcast()
  }

  // kind drives the sensible default unit; habits are per-day yes/no, no unit choice
  kindChanged() {
    const kind = this.kindTarget.value
    this.unitTarget.hidden = kind === 'habit'
    if (kind === 'exercise') this.unitTarget.value = 'reps'
    if (kind === 'book') this.unitTarget.value = 'pages'
  }

  async create(event: SubmitEvent) {
    event.preventDefault()
    const name = this.nameTarget.value.trim()
    if (!name) return

    this.statusTarget.textContent = ''
    const kind = this.kindTarget.value || 'exercise'
    const unit = kind === 'habit' ? 'days' : this.unitTarget.value || 'reps'
    const { data, error } = await supabase
      .from('activities')
      .insert({ name, unit, kind })
      .select()
      .single()
    if (error) {
      this.statusTarget.textContent =
        error.code === '23505'
          ? 'You are already tracking that.'
          : error.code === 'PGRST204'
            ? 'Run the kind-column migration from supabase/schema.sql first.'
            : `Could not add: ${error.message}`
      return
    }

    this.nameTarget.value = ''
    this.activities = [...this.activities, normalize(data)]
    this.render((data as Activity).id)
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
    // select * with client-side defaults, so the app keeps working while a new
    // column's migration hasn't run yet (learned that one the hard way)
    const { data, error } = await supabase.from('activities').select('*').order('created_at')
    if (error) {
      this.statusTarget.textContent = `Could not load activities: ${error.message}`
      return
    }

    let activities = (data ?? []).map(normalize)
    if (activities.length === 0) {
      // first run for this account; unique(user_id, name) makes a duplicate insert harmless
      const seeded = await supabase.from('activities').insert({ name: 'Pushups' }).select()
      activities = (seeded.data ?? []).map(normalize)
    }

    this.activities = activities
    this.render(activities[0]?.id)
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

function normalize(row: unknown): Activity {
  const activity = row as Activity
  return { ...activity, unit: activity.unit ?? 'reps', kind: activity.kind ?? 'exercise' }
}
