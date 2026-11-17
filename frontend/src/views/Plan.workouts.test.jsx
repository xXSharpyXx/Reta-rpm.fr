// @vitest-environment happy-dom
// The Workouts page (views/Plan.jsx), one tab in place of Plan and Start. Top to bottom: the
// performance review, today's session with a big Start, the other sessions and a free one, and
// the fixed week. A tap on a session offers to start or edit it; the big button and Freestyle
// start at once.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Plan from './Plan.jsx'
import { startSession, menuSheet } from '../sheets.jsx'
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
  it('keeps the review at the top, then today, the other sessions, the fixed week', () => {
    setS({ workouts: [{ id: 'w1', d: '2026-11-10', start: 1, end: 2, name: 'Old push', entries: [] }] })
    mount()
    const text = host.textContent
    const order = ['Analyze my latest performance', "Today's plan", 'Other routines', 'My plans', 'This week']
    const at = order.map(s => text.indexOf(s))
    expect(at.every(i => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    // The latest workouts and the list of sessions to edit left the page (owner, 2026-11-17).
    expect(text).not.toContain('Latest workouts')
    expect(headings()).not.toContain('Routines')
    expect(host.querySelector('.plan-routines')).toBeNull()
  })

  it("starts today's session from its big button, without asking first, and edits it from its own button", () => {
    mount()
    expect(host.querySelector('.today-name').textContent).toBe('Push')
    click(button('Start Push'))
    expect(startSession).toHaveBeenCalledWith(['push'])
    click(host.querySelector('.today-edit'))
    expect(mocks.nav).toHaveBeenCalledWith('/plan/r/push')
  })

  it('a tap on another session offers to start it or to edit it', () => {
    mount()
    const rows = [...host.querySelectorAll('.plan-others .item')]
    expect(rows.map(r => r.querySelector('.tt').textContent)).toEqual(['Pull', 'Freestyle workout'])
    click(rows[0])
    expect(startSession).not.toHaveBeenCalled()
    const menu = menuSheet.mock.calls.at(-1)[0]
    expect(menu.title).toBe('Pull')
    expect(menu.items.map(i => i.label)).toEqual(['Start', 'Edit'])
    menu.items[0].onClick()
    expect(startSession).toHaveBeenLastCalledWith(['pull'])
    menu.items[1].onClick()
    expect(mocks.nav).toHaveBeenLastCalledWith('/plan/r/pull')
  })

  it('Freestyle starts at once', () => {
    mount()
    click([...host.querySelectorAll('.plan-others .item')].at(-1))
    expect(startSession).toHaveBeenLastCalledWith([])
  })

  it('New routine makes one and opens it', () => {
    mount()
    click(button('New routine'))
    expect(mocks.S.routines).toHaveLength(3)
    expect(mocks.nav).toHaveBeenLastCalledWith('/plan/r/' + mocks.S.routines[2].id)
  })

  it("a session in progress takes today's place; the others only open to edit", () => {
    setS({ active: { id: 'a', name: 'Push', start: Date.now(), entries: [], cur: 0 } })
    mount()
    expect(host.querySelector('.today-lbl').textContent).toBe('Workout in progress')
    expect(host.textContent).not.toContain('Freestyle workout')
    click(host.querySelector('.plan-others .item'))
    expect(menuSheet).not.toHaveBeenCalled()
    expect(mocks.nav).toHaveBeenLastCalledWith('/plan/r/pull')
    click(button('Resume'))
    expect(mocks.nav).toHaveBeenLastCalledWith('/workout')
  })

  it('a rest day says so and names the next session', () => {
    setS({ week: { [(dow + 1) % 7]: ['pull'] } })
    mount()
    expect(host.querySelector('.today-name').textContent).toBe('Rest day')
    expect(host.querySelector('.today-sub').textContent).toMatch(/Next session: .+, Pull/)
  })

  it('shows the fixed week with no Schedule/Routines switch', () => {
    mount()
    expect(host.querySelector('.plan-views')).toBeNull()
    expect(host.querySelectorAll('.plan-week .plan-day')).toHaveLength(7)
    expect(headings()).toContain('My plans')
  })
})
