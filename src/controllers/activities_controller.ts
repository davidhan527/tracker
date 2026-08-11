import { Controller } from '@hotwired/stimulus'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Activity } from '../types'

export default class ActivitiesController extends Controller {
  static targets = ['picker', 'name', 'unit', 'status']

  declare readonly pickerTarget: HTMLSelectElement
  declare readonly nameTarget: HTMLInputElement
  declare readonly unitTarget: HTMLSelectElement
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

  async create(event: SubmitEvent) {
    event.preventDefault()
    const name = this.nameTarget.value.trim()
    if (!name) return

    this.statusTarget.textContent = ''
    const unit = this.unitTarget.value || 'reps'
    const { data, error } = await supabase.from('activities').insert({ name, unit }).select().single()
    if (error) {
      this.statusTarget.textContent =
        error.code === '23505' ? 'You are already tracking that.' : `Could not add: ${error.message}`
      return
    }

    this.nameTarget.value = ''
    this.activities = [...this.activities, data as Activity]
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
    const { data, error } = await supabase
      .from('activities')
      .select('id, name, unit, created_at')
      .order('created_at')
    if (error) {
      this.statusTarget.textContent = `Could not load activities: ${error.message}`
      return
    }

    let activities = (data ?? []) as Activity[]
    if (activities.length === 0) {
      // first run for this account; unique(user_id, name) makes a duplicate insert harmless
      const seeded = await supabase.from('activities').insert({ name: 'Pushups' }).select()
      activities = (seeded.data ?? []) as Activity[]
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
