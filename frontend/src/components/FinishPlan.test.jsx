// @vitest-environment happy-dom
// The first page after Finish: the plan of the next session. Every exercise on a card laid out like
// the workout's set rows, the old value struck and the new one green, Refuse or Validate under it,
// switches for what the session changed (an exercise left out, one added), and Apply.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { EXDB } from '../lib/exercises.js'
import { finishWorkoutNow } from '../sheets.jsx'

const clone = v => JSON.parse(JSON.stringify(v))
const S = () => useStore.getState().S
const mounted = []
let host
const settle = () => act(async () => {})
const text = () => host.textContent
const button = label => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
const toggle = label => host.querySelector(`[role="switch"][aria-label="${label}"]`)

const SKIPPED = '0334'                                  // in the routine, not done today
const ADDED = EXDB.find(e => e.id !== '0025' && e.id !== SKIPPED && e.bp === 'chest').id
const routineIds = () => S().routines[0].ex.map(x => x.id)

function install({ prog } = {}) {
  const st = clone(DEF)
  const bench = { id: '0025', sets: 2, reps: 5, weight: 60, ...(prog ? { prog } : {}) }
  st.routines = [{ id: 'r1', name: 'Push A', ex: [bench, { id: SKIPPED, sets: 2, reps: 12, weight: 8 }] }]
  const done = (id, w, r, n) => ({ id, rid: 'r1', target: { sets: n, reps: r, weight: w }, sets: Array.from({ length: n }, () => ({ w, r, done: true })) })
  st.active = {
    id: 'fin', d: '2026-09-28', start: Date.now() - 20 * 60000, routineIds: ['r1'], routineId: 'r1', name: 'Push A', bw: null, cur: 0,
    entries: [done('0025', 60, 5, 2), done(ADDED, 20, 8, 2)],
  }
  useStore.setState({ S: st, user: null })
}
async function finish() {
  act(() => finishWorkoutNow())
  const sheet = useUI.getState().sheets.at(-1)
  host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  await settle()
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  useUI.setState({ sheets: [], timer: null, work: null, toastMsg: '' })
})
afterEach(() => {
  mounted.splice(0).forEach(r => act(() => r.unmount()))
  document.body.innerHTML = ''
})

describe('finish: the plan of the next session', () => {
  it('opens on the plan, with the old weight struck and the new one beside it', async () => {
    install()
    await finish()
    expect(host.querySelector('[data-finish-plan]')).toBeTruthy()
    const card = host.querySelector('[data-plan-card="0025"]')
    expect(card.querySelector('s').textContent).toContain('60')
    expect(card.querySelector('.setrow input').value).toBe('62.5')
    // the summary is the next page
    expect(text()).not.toContain('Duration')
  })

  it('Apply saves the proposal and moves on to the summary', async () => {
    install()
    await finish()
    act(() => button('Apply').click())
    expect(S().workouts.at(-1).entries.find(e => e.id === '0025').next).toEqual({ w: 62.5, r: 5 })
    expect(host.querySelector('[data-finish-plan]')).toBeNull()
    expect(text()).toContain('Duration')
  })

  it('Refuse keeps today\'s numbers', async () => {
    install()
    await finish()
    act(() => host.querySelector('[data-plan-card="0025"] [data-refuse]').click())
    act(() => button('Apply').click())
    expect(S().workouts.at(-1).entries.find(e => e.id === '0025').next).toEqual({ w: 60, r: 5 })
  })

  it('the steppers on a row change the exercise\'s next weight and reps', async () => {
    install()
    await finish()
    const card = host.querySelector('[data-plan-card="0025"]')
    act(() => card.querySelector('.setrow button[aria-label="Increase"]').click())          // weight 62.5 -> 65
    act(() => [...card.querySelectorAll('.setrow')][0].querySelectorAll('button[aria-label="Increase"]')[1].click())   // reps 5 -> 6
    act(() => button('Apply').click())
    expect(S().workouts.at(-1).entries.find(e => e.id === '0025').next).toEqual({ w: 65, r: 6 })
  })

  it('an exercise left out stays in the routine, an added one stays out, unless asked', async () => {
    install()
    await finish()
    expect(host.querySelector(`[data-plan-card="${SKIPPED}"]`).textContent).toContain('Not done today')
    expect(host.querySelector(`[data-plan-card="${ADDED}"]`).textContent).toContain('New')
    expect(toggle('Keep in routine').getAttribute('aria-checked')).toBe('true')
    expect(toggle('Add to routine').getAttribute('aria-checked')).toBe('false')
    act(() => button('Apply').click())
    expect(routineIds()).toEqual(['0025', SKIPPED])
  })

  it('takes the left-out exercise out and puts the new one in when asked', async () => {
    install()
    await finish()
    act(() => toggle('Keep in routine').click())
    act(() => toggle('Add to routine').click())
    act(() => button('Apply').click())
    expect(routineIds()).toEqual(['0025', ADDED])
  })

  it('goes straight to the summary when there is nothing to plan', async () => {
    install({ prog: 'off' })
    S().active.entries = [S().active.entries[0]]
    useStore.setState({ S: { ...S(), routines: [{ id: 'r1', name: 'Push A', ex: [S().routines[0].ex[0]] }] } })
    await finish()
    expect(host.querySelector('[data-finish-plan]')).toBeNull()
    expect(text()).toContain('Duration')
  })
})
