// @vitest-environment happy-dom
// The Workouts page (views/Plan.jsx), Hevy style (owner, 2026-11-24). Top to bottom: the performance
// review, a big Start for today's routine (no name, no Edit) with "Start another routine" under it,
// then two glued buttons: "My week" (Monday to Sunday, to plan the sessions on) and "My sessions"
// (the free session first, then every routine, each plannable on days).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Plan from './Plan.jsx'
import { startSession, menuSheet, routineDaysSheet } from '../sheets.jsx'
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
  starterPlanSheet: vi.fn(), dayAssignSheet: vi.fn(), routineDaysSheet: vi.fn(), menuSheet: vi.fn(), confirmSheet: vi.fn(),
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
  it('keeps the review at the top, then the Start buttons, then the week', () => {
    mount()
    const text = host.textContent
    const order = ['Analyze my latest performance', 'Start another routine', 'My week', 'My sessions']
    const at = order.map(s => text.indexOf(s))
    expect(at.every(i => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(host.querySelector('.plan-views')).toBeTruthy()
  })

  it("starts today's routine from a big Start that shows no name and no Edit", () => {
    mount()
    expect(host.querySelector('.today-name')).toBeNull()
    expect(host.querySelector('.today-edit')).toBeNull()
    expect(host.querySelector('.today-card').textContent).not.toContain('Push')
    click(host.querySelector('.today-go'))
    expect(startSession).toHaveBeenCalledWith(['push'])
  })

  it('"Start another routine" lists the free session first, then the routines', () => {
    mount()
    click(button('Start another routine'))
    const menu = menuSheet.mock.calls.at(-1)[0]
    expect(menu.items.map(i => i.label)).toEqual(['Freestyle workout', 'Push', 'Pull'])
    menu.items[0].onClick()
    expect(startSession).toHaveBeenLastCalledWith([])
    menu.items[2].onClick()
    expect(startSession).toHaveBeenLastCalledWith(['pull'])
  })

  it('with no routine yet, opens on the sessions where the first one is made', () => {
    setS({ routines: [], week: {} })
    mount()
    expect(host.querySelector('.plan-week')).toBeNull()
    expect(host.querySelector('.plan-empty')).toBeTruthy()
  })

  it('opens on the week, and the other button shows the sessions', () => {
    mount()
    expect(host.querySelectorAll('.plan-week .plan-day')).toHaveLength(7)
    expect(host.querySelector('.plan-others')).toBeNull()
    click(button('My sessions'))
    expect(host.querySelector('.plan-week')).toBeNull()
    const rows = [...host.querySelectorAll('.plan-others .item')]
    expect(rows.map(r => r.querySelector('.tt').textContent)).toEqual(['Freestyle workout', 'Push', 'Pull'])
    click(button('My week'))
    expect(host.querySelectorAll('.plan-week .plan-day')).toHaveLength(7)
  })

  it('a tap on a session offers to start it, edit it or plan it on days', () => {
    mount()
    click(button('My sessions'))
    click([...host.querySelectorAll('.plan-others .item')][2])
    const menu = menuSheet.mock.calls.at(-1)[0]
    expect(menu.title).toBe('Pull')
    expect(menu.items.map(i => i.label)).toEqual(['Start', 'Edit', 'Plan on days'])
    menu.items[0].onClick()
    expect(startSession).toHaveBeenLastCalledWith(['pull'])
    menu.items[1].onClick()
    expect(mocks.nav).toHaveBeenLastCalledWith('/plan/r/pull')
    menu.items[2].onClick()
    expect(routineDaysSheet).toHaveBeenLastCalledWith('pull')
  })

  it('the free session starts at once from the list', () => {
    mount()
    click(button('My sessions'))
    click(host.querySelector('.plan-others .item'))
    expect(startSession).toHaveBeenLastCalledWith([])
  })

  it('New routine makes one and opens it', () => {
    mount()
    click(button('My sessions'))
    click(button('New routine'))
    expect(mocks.S.routines).toHaveLength(3)
    expect(mocks.nav).toHaveBeenLastCalledWith('/plan/r/' + mocks.S.routines[2].id)
  })

  it('a session in progress takes the place of Start; the sessions only open to edit', () => {
    setS({ active: { id: 'a', name: 'Push', start: Date.now(), entries: [], cur: 0 } })
    mount()
    expect(host.querySelector('.today-lbl').textContent).toBe('Workout in progress')
    expect(button('Start another routine')).toBeUndefined()
    click(button('My sessions'))
    expect(host.textContent).not.toContain('Freestyle workout')
    click(host.querySelector('.plan-others .item'))
    expect(menuSheet).not.toHaveBeenCalled()
    expect(mocks.nav).toHaveBeenLastCalledWith('/plan/r/push')
    click(button('Resume'))
    expect(mocks.nav).toHaveBeenLastCalledWith('/workout')
  })

  it('a rest day has no big Start, names the next session, and still offers another routine', () => {
    setS({ week: { [(dow + 1) % 7]: ['pull'] } })
    mount()
    expect(host.querySelector('.today-go')).toBeNull()
    expect(host.querySelector('.today-lbl').textContent).toBe('Rest day')
    expect(host.querySelector('.today-sub').textContent).toMatch(/Next session: .+, Pull/)
    expect(button('Start another routine')).toBeTruthy()
  })
})
