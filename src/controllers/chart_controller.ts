import { Controller } from '@hotwired/stimulus'
import { supabase } from '../lib/supabase'
import { dailyTotals, formatDay, localDateString, renderColumnChart, type DayTotal } from '../lib/chart'
import type { Exercise } from '../types'

const DAYS = 30

export default class ChartController extends Controller {
  static targets = ['container', 'tooltip', 'label']

  declare readonly containerTarget: HTMLElement
  declare readonly tooltipTarget: HTMLElement
  declare readonly labelTarget: HTMLElement

  private selectedId: string | null = null
  private days: DayTotal[] = []

  connect() {
    window.addEventListener('exercises:changed', this.onExercises)
    window.addEventListener('entries:changed', this.onEntries)
    this.containerTarget.addEventListener('pointerover', this.onPointer)
    this.containerTarget.addEventListener('pointermove', this.onPointer)
    this.containerTarget.addEventListener('pointerleave', this.hideTooltip)
  }

  disconnect() {
    window.removeEventListener('exercises:changed', this.onExercises)
    window.removeEventListener('entries:changed', this.onEntries)
  }

  private onExercises = (event: Event) => {
    const detail = (event as CustomEvent<{ exercises: Exercise[]; selectedId: string | null }>).detail
    this.selectedId = detail.selectedId
    this.labelTarget.textContent =
      detail.exercises.find((exercise) => exercise.id === this.selectedId)?.name ?? ''
    void this.refresh()
  }

  private onEntries = () => {
    void this.refresh()
  }

  private async refresh() {
    this.hideTooltip()
    if (!this.selectedId) {
      this.days = []
      this.containerTarget.replaceChildren()
      return
    }

    const today = new Date()
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (DAYS - 1))
    const { data, error } = await supabase
      .from('entries')
      .select('reps, created_at')
      .eq('exercise_id', this.selectedId)
      .gte('created_at', start.toISOString())
    if (error) return

    this.days = dailyTotals((data ?? []) as { reps: number; created_at: string }[], DAYS, today)

    if (this.days.every((day) => day.total === 0)) {
      const empty = document.createElement('p')
      empty.className = 'muted'
      empty.textContent = `No reps in the last ${DAYS} days.`
      this.containerTarget.replaceChildren(empty)
      return
    }
    // markup is built from numbers and locale date strings only — no user content
    this.containerTarget.innerHTML = renderColumnChart(this.days)
  }

  private onPointer = (event: PointerEvent) => {
    const hit = (event.target as Element).closest?.('[data-index]')
    if (!hit) {
      this.hideTooltip()
      return
    }
    const index = Number(hit.getAttribute('data-index'))
    const day = this.days[index]
    if (!day) return

    for (const bar of this.containerTarget.querySelectorAll('.chart-bar')) {
      bar.classList.toggle('is-hover', bar.getAttribute('data-index') === String(index))
    }

    const isToday = day.date === localDateString(new Date())
    this.tooltipTarget.textContent = `${isToday ? 'Today' : formatDay(day.date)} · ${day.total} reps`
    const wrap = this.containerTarget.getBoundingClientRect()
    const slot = hit.getBoundingClientRect()
    const x = slot.left + slot.width / 2 - wrap.left
    this.tooltipTarget.hidden = false
    const clamped = Math.min(
      Math.max(x, this.tooltipTarget.offsetWidth / 2),
      wrap.width - this.tooltipTarget.offsetWidth / 2,
    )
    this.tooltipTarget.style.left = `${clamped}px`
  }

  private hideTooltip = () => {
    this.tooltipTarget.hidden = true
    for (const bar of this.containerTarget.querySelectorAll('.chart-bar.is-hover')) {
      bar.classList.remove('is-hover')
    }
  }
}
