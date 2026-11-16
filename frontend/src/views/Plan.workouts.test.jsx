// @vitest-environment happy-dom
// The Workouts page (views/Plan.jsx), one tab in place of Plan and Start. Top to bottom: the
// performance review, today's session with a big Start, the other sessions and a free one, the
// latest workouts, and the fixed week with its sessions. Its buttons start without the
// "Start …?" confirmation or picker: each one already names what it starts.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Plan from './Plan.jsx'
import { startSession, workoutDetailSheet } from '../sheets.jsx'
import { todayISO } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, nav: null }
  state.snapshot = () => ({ S: state.S, user: null, update: mut => { const next = structuredClone(state.S); mut(next); state.S = next } })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('../lib/coach.js', () => ({ coachAvailable: () => false }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), dayAssignSheet: vi.fn(), menuSheet: vi.fn(), confirmSheet: vi.fn(),
  planHasRoutines: () => true, exportPlanFile: vi.fn(), printWholePlan: vi.fn(), importPlanFile: vi.fn(),
  startSession: vi.fn(), workoutDetailSheet: vi.fn(),
  WorkoutRow: ({ w, onClick }) => <div className="wrow" onClick={onClick}>{w.name}</div>,
}))

const routines = [
  { id: 'push', name: 'Push', emoji: null, ex: [{ id: '0025' }, { id: '0026' }] },
  { id: 'pull', name: 'Pull', emoji: null, ex: [{ id: '0027' }] },
]
const dow = new Date(todayISO() + 'T12:00:00').getDay()
const setS = over => {
  mocks.S = { routines, week: { [dow]: ['push'] }, dayPlan: {}, workouts: [], active: null, queue: null, rotation: null, weekStart: 1, body: 'male', swipeSets: false, ...over }
}

let host, root
beforeEach(() => {
  vi.clearAllMocks()
  mocks.nav = vi.fn()
  setS()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const mount = () => act(() => root.render(<Plan />))
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text))
const headings = () => [...host.querySelectorAll('h4.sec')].map(h => h.textContent)

describe('the Workouts page', () => {
  it('keeps the review at the top, then today, the others, the latest, the plans', () => {
    setS({ workouts: [{ id: 'w1', d: '2026-11-10', start: 1, end: 2, name: 'Old push', entries: [] }] })
    mount()
    const text = host.textContent
    const order = ['Analyze my latest performance', "Today's plan", 'Other routines', 'Latest workouts', 'My plans', 'This week', 'Routines']
    const at = order.map(s => text.indexOf(s))
    expect(at.every(i => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
  })

  it('starts today\'s session from its big button, without asking first', () => {
    mount()
    expect(host.querySelector('.today-name').textContent).toBe('Push')
    click(button('Start Push'))
    expect(startSession).toHaveBeenCalledWith(['push'])
  })

  it('offers the other sessions and a free one', () => {
    mount()
    const rows = [...host.querySelectorAll('.plan-others .item')]
    expect(rows.map(r => r.querySelector('.tt').textContent)).toEqual(['Pull', 'Freestyle workout'])
    click(rows[0])
    expect(startSession).toHaveBeenLastCalledWith(['pull'])
    click(rows[1])
    expect(startSession).toHaveBeenLastCalledWith([])
  })

  it('opens a latest workout\'s detail', () => {
    const w = { id: 'w1', d: '2026-11-10', start: 1, end: 2, name: 'Old push', entries: [] }
    setS({ workouts: [w] })
    mount()
    click(host.querySelector('.plan-latest .wrow'))
    expect(workoutDetailSheet).toHaveBeenCalledWith(w)
  })

  it('a session in progress takes today\'s place, and nothing else can start', () => {
    setS({ active: { id: 'a', name: 'Push', start: Date.now(), entries: [], cur: 0 } })
    mount()
    expect(host.querySelector('.today-lbl').textContent).toBe('Workout in progress')
    expect(host.querySelector('.plan-others')).toBeNull()
    click(button('Resume'))
    expect(mocks.nav).toHaveBeenCalledWith('/workout')
  })

  it('a rest day says so and names the next session', () => {
    setS({ week: { [(dow + 1) % 7]: ['pull'] } })
    mount()
    expect(host.querySelector('.today-name').textContent).toBe('Rest day')
    expect(host.querySelector('.today-sub').textContent).toMatch(/Next session: .+, Pull/)
  })

  it('shows the plans with no Schedule/Routines switch', () => {
    mount()
    expect(host.querySelector('.plan-views')).toBeNull()
    expect(host.querySelectorAll('.plan-week .plan-day')).toHaveLength(7)
    expect(host.querySelectorAll('.plan-routines .plan-routine')).toHaveLength(2)
    expect(headings()).toContain('My plans')
  })
})
