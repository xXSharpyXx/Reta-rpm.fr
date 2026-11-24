// @vitest-environment happy-dom
// The week on Home (views/Home.jsx DayWorkouts): today is picked by default, a tap picks another
// day, and under the strip stands what was trained that day. Each session: its name, its date and
// duration, and "See more" opening its exercises in place. A day with nothing: one line, and a
// quiet way to plan it. A session in progress stays a tap away above the day.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { dayOverrideSheet, workoutDetailSheet } from '../sheets.jsx'
import { todayISO, isoOf } from '../lib/format.js'
import { shiftDay } from '../lib/day-swipe.js'
import Home from './Home.jsx'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
  workoutDetailSheet: vi.fn(), exerciseHistorySheet: vi.fn(),
}))

const routines = [{ id: 'r1', name: 'Push', emoji: null, ex: [{ id: '0025' }] }]
const at = iso => new Date(iso + 'T18:00:00').getTime()
const workout = (iso, name, more = {}) => ({
  id: 'w-' + iso + name, d: iso, start: at(iso), end: at(iso) + 45 * 60000, name, routineIds: [], prs: [],
  entries: [{ id: '0025', target: { mode: 'reps' }, sets: [{ w: 60, r: 8, done: true }, { w: 65, r: 6, done: true }] }], ...more,
})

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  nav.mockClear(); dayOverrideSheet.mockClear(); workoutDetailSheet.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const setS = (over = {}) => useStore.setState(s => ({
  S: { ...s.S, unit: 'kg', routines, dayPlan: {}, workouts: [], active: null, weighIn: false, queue: null, week: { 0: ['r1'], 1: ['r1'], 2: ['r1'], 3: ['r1'], 4: ['r1'], 5: ['r1'], 6: ['r1'] }, ...over },
  user: null,
}))
const mount = () => act(() => root.render(<Home />))
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const panel = () => host.querySelector('.dayw')
const names = () => [...host.querySelectorAll('.dayw-name')].map(e => e.textContent)
const otherDay = () => [...host.querySelectorAll('.wday')].find(d => !d.classList.contains('today'))

describe('Home — the picked day', () => {
  it('shows today by default, with the session done today', () => {
    setS({ workouts: [workout(todayISO(), 'Push Day')] })
    mount()
    expect(panel().dataset.day).toBe(todayISO())
    expect(host.querySelector('.wday.today').classList.contains('sel')).toBe(true)
    expect(names()).toEqual(['Push Day'])
    expect(host.querySelector('.dayw-stats').textContent).toContain('45 min')
    expect(host.querySelector('.dayw-stats').textContent).toContain('870 kg')
  })

  it('lists three exercises with their sets, and See N more opens the rest in place', () => {
    const ids = ['0025', '0001', '0002', '0003', '0004']
    setS({ workouts: [workout(todayISO(), 'Push Day', { entries: ids.map(id => ({ id, target: { mode: 'reps' }, sets: [{ w: 60, r: 8, done: true }, { w: 65, r: 6, done: true }] })) })] })
    mount()
    expect(host.querySelectorAll('.dayw-exrow')).toHaveLength(3)
    expect(host.querySelector('.dayw-exrow').textContent).toMatch(/^2 sets /)
    const more = host.querySelector('.dayw-more')
    expect(more.textContent).toBe('See 2 more exercises')
    click(more)
    expect(host.querySelectorAll('.dayw-exrow')).toHaveLength(5)
    expect(more.textContent).toBe('See less')
    expect(nav).not.toHaveBeenCalled()
    expect(workoutDetailSheet).not.toHaveBeenCalled()
  })

  it('has no See more for three exercises or fewer', () => {
    setS({ workouts: [workout(todayISO(), 'Push Day')] })
    mount()
    expect(host.querySelector('.dayw-more')).toBeNull()
  })

  it('lists every session of a day, one under the other', () => {
    setS({ workouts: [workout(todayISO(), 'Morning'), workout(todayISO(), 'Evening')] })
    mount()
    expect(names()).toEqual(['Morning', 'Evening'])
    expect(host.querySelectorAll('.dayw-card')).toHaveLength(2)
  })

  it('a tap on another day shows that day, and says so when nothing was done', () => {
    setS()
    mount()
    const d = otherDay()
    click(d)
    expect(d.classList.contains('sel')).toBe(true)
    expect(panel().textContent).toContain('No workout this day')
    click([...host.querySelectorAll('button')].find(b => b.textContent === 'Plan this day'))
    expect(dayOverrideSheet).toHaveBeenCalledWith(panel().dataset.day)
  })

  it('a day trained in the past shows its own session', () => {
    const d = new Date(todayISO() + 'T12:00:00'); d.setDate(d.getDate() - 7)
    const iso = isoOf(d)
    setS({ workouts: [workout(iso, 'Legs')] })
    mount()
    click(host.querySelector('[aria-label="Previous week"]'))
    const day = [...host.querySelectorAll('.wday')].find(x => x.querySelector('.num').textContent === String(d.getDate()) && x.querySelector('.dot.done'))
    click(day)
    expect(names()).toEqual(['Legs'])
    click(host.querySelector('.dayw-head'))
    expect(workoutDetailSheet).toHaveBeenCalledTimes(1)
  })

  it('never starts a session from the day', () => {
    setS()
    mount()
    click(host.querySelector('.wday.today'))
    expect(nav).not.toHaveBeenCalled()
  })
})

describe('Home — a session in progress', () => {
  it('reads an open editor on a saved workout as an edit, not as a session in progress', () => {
    setS({ active: { id: 'w', name: 'Push', start: 1000, cur: 0, entries: [], editingWorkoutId: 'w' } })
    mount()
    const row = host.querySelector('.today-row')
    expect(row.querySelector('.ttl').textContent).toBe('Push')
    expect(row.querySelector('.tag').textContent).toBe('Edit')
    click(row)
    expect(nav).toHaveBeenCalledWith('/workout')
  })

  it('still reads a running session as in progress', () => {
    setS({ active: { id: 'a', name: 'Push', start: Date.now(), cur: 0, entries: [] } })
    mount()
    const row = host.querySelector('.today-row')
    expect(row.querySelector('.ttl').textContent).toBe('Push (in progress)')
    expect(row.querySelector('.tag').textContent).toBe('Resume')
  })
})

describe('Home: swipe the day', () => {
  const touch = (type, x, y) => Object.assign(new Event(type, { bubbles: true }), { touches: type === 'touchend' ? [] : [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] })
  const swipe = (el, dx, dy = 0) => {
    act(() => { el.dispatchEvent(touch('touchstart', 200, 300)) })
    act(() => { el.dispatchEvent(touch('touchend', 200 + dx, 300 + dy)) })
  }
  it('a swipe toward the left goes to the day before, toward the right to the day after', () => {
    setS()
    mount()
    swipe(panel(), -90)
    expect(panel().dataset.day).toBe(shiftDay(todayISO(), -1))
    swipe(panel(), 90)
    swipe(panel(), 90)
    expect(panel().dataset.day).toBe(shiftDay(todayISO(), 1))
  })
  it('keeps the picked day on the strip, whichever week it falls in', () => {
    setS()
    mount()
    for (let i = 0; i < 9; i++) swipe(panel(), -90)
    expect(panel().dataset.day).toBe(shiftDay(todayISO(), -9))
    expect(host.querySelectorAll('.wday.sel')).toHaveLength(1)
  })
  it('a short or mostly vertical swipe does nothing', () => {
    setS()
    mount()
    swipe(panel(), -20)
    swipe(panel(), -90, 120)
    expect(panel().dataset.day).toBe(todayISO())
  })
})

