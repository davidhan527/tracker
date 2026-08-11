import { Controller } from '@hotwired/stimulus'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Exercise } from '../types'

export default class ExercisesController extends Controller {
  static targets = ['picker', 'name', 'status']

  declare readonly pickerTarget: HTMLSelectElement
  declare readonly nameTarget: HTMLInputElement
  declare readonly statusTarget: HTMLElement

  private exercises: Exercise[] = []
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
    const { data, error } = await supabase.from('exercises').insert({ name }).select().single()
    if (error) {
      this.statusTarget.textContent =
        error.code === '23505' ? 'That exercise already exists.' : `Could not add: ${error.message}`
      return
    }

    this.nameTarget.value = ''
    this.exercises = [...this.exercises, data as Exercise]
    this.render((data as Exercise).id)
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
      .from('exercises')
      .select('id, name, created_at')
      .order('created_at')
    if (error) {
      this.statusTarget.textContent = `Could not load exercises: ${error.message}`
      return
    }

    let exercises = (data ?? []) as Exercise[]
    if (exercises.length === 0) {
      // first run for this account; unique(user_id, name) makes a duplicate insert harmless
      const seeded = await supabase.from('exercises').insert({ name: 'Pushups' }).select()
      exercises = (seeded.data ?? []) as Exercise[]
    }

    this.exercises = exercises
    this.render(exercises[0]?.id)
  }

  private clear() {
    this.exercises = []
    this.pickerTarget.replaceChildren()
    this.broadcast()
  }

  private render(selectedId?: string) {
    this.pickerTarget.replaceChildren(
      ...this.exercises.map((exercise) => {
        const option = document.createElement('option')
        option.value = exercise.id
        option.textContent = exercise.name
        return option
      }),
    )
    if (selectedId) this.pickerTarget.value = selectedId
    this.broadcast()
  }

  private broadcast() {
    window.dispatchEvent(
      new CustomEvent('exercises:changed', {
        detail: { exercises: this.exercises, selectedId: this.pickerTarget.value || null },
      }),
    )
  }
}
