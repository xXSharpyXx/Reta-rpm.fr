// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sheets = vi.hoisted(() => ({ startFlow: vi.fn() }))
const nav = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../sheets.jsx', () => sheets)
vi.mock('../components/Media.jsx', () => ({ Thumb: ({ ex }) => <span data-thumb={ex.id} /> }))
vi.mock('react-router-dom', async orig => ({ ...(await orig()), useNavigate: () => nav }))

import RoutineView from './RoutineView.jsx'
import { DEF, useStore } from '../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host

function mount(ex, extra = {}) {
  const S = JSON.parse(JSON.stringify(DEF))
  S.routines = [{ id: 'r1', name: 'Push day', emoji: 'dumbbell', prog: 'linear', ex }]
  Object.assign(S, extra)
  useStore.setState({ S, user: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<MemoryRouter initialEntries={['/plan/s/r1']}><Routes><Route path="/plan/s/:id" element={<RoutineView />} /></Routes></MemoryRouter>))
}
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent === text || b.getAttribute('aria-label') === text)

beforeEach(() => { nav.mockReset(); sheets.startFlow.mockReset() })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('a routine’s own page', () => {
  it('lists each exercise with the sets the next session opens at, warm-ups first', () => {
    mount([{ id: '0025', mode: 'reps', sets: 3, reps: 8, weight: 60, warmupSets: 1 }])
    expect(host.querySelector('h1').textContent).toBe('Push day')
    const sets = [...host.querySelectorAll('.routine-view-sets li')]
    expect(sets).toHaveLength(4)
    expect(sets[0].className).toBe('warm')
    expect(sets[0].textContent).toContain('Warm-up')
    expect(sets.slice(1).map(li => li.firstChild.textContent)).toEqual(['Set 1', 'Set 2', 'Set 3'])
    expect(sets[1].lastChild.textContent).toBe('60×8')
  })

  it('starts this routine from the top button, and the pencil opens the editor', () => {
    mount([{ id: '0025', mode: 'reps', sets: 2, reps: 5, weight: 40 }])
    act(() => button('Start workout').click())
    expect(sheets.startFlow).toHaveBeenCalledWith(['r1'])
    act(() => button('Edit routine').click())
    expect(nav).toHaveBeenLastCalledWith('/plan/r/r1')
  })

  it('takes you back to a session already running instead of starting another', () => {
    mount([{ id: '0025', mode: 'reps', sets: 2, reps: 5, weight: 40 }], { active: { id: 'w', start: 1, entries: [], routineIds: [] } })
    act(() => button('Resume').click())
    expect(sheets.startFlow).not.toHaveBeenCalled()
    expect(nav).toHaveBeenLastCalledWith('/workout')
  })

  it('an empty routine has nothing to start and points to the editor', () => {
    mount([])
    expect(button('Start workout').disabled).toBe(true)
    expect(host.querySelector('.empty')).toBeTruthy()
  })
})
