// @vitest-environment happy-dom
// The workout just done and its routine (owner, 2026-11-17, reworked 2026-11-24): the first page
// after Finish plans the next session, and what the session changed (an exercise left out, one
// added, the order and set counts) is decided there, with switches, instead of in a dialog after
// Save. Nothing changes unless a switch says so.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { finishWorkoutNow } from './sheets.jsx'

const clone = v => JSON.parse(JSON.stringify(v))
const S = () => useStore.getState().S
const mounted = []
let host

function renderTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
}
// The photo section asks the media store whether it can keep files; let that answer land.
const settle = () => act(async () => {})
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const toggle = label => host.querySelector(`[role="switch"][aria-label="${label}"]`)

function install(entries, routineEx = [{ id: '0025', sets: 1, reps: 5, weight: 60 }]) {
  const st = clone(DEF)
  st.routines = [{ id: 'r1', name: 'Push A', ex: routineEx }]
  st.active = {
    id: 'fin', d: '2026-09-28', start: Date.now() - 20 * 60000, routineIds: ['r1'], routineId: 'r1', name: 'Push A', bw: null, cur: 0,
    entries,
  }
  useStore.setState({ S: st, user: null })
}
const bench = { id: '0025', rid: 'r1', target: { sets: 1, reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: true }] }
const raise = { id: '0334', rid: 'r1', addedInSession: true, target: { sets: 2, reps: 12, weight: 8 }, sets: [{ w: 8, r: 12, done: true }, { w: 8, r: 12, done: true }] }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  useUI.setState({ sheets: [], timer: null, work: null })
})
afterEach(() => {
  mounted.splice(0).forEach(r => act(() => r.unmount()))
  document.body.innerHTML = ''
})

async function finish() {
  act(() => finishWorkoutNow())
  renderTopSheet()
  await settle()
}

describe("finish: what the session changed in the routine", () => {
  it('offers an exercise added today, and the switch puts it in the routine with the setup it was done with', async () => {
    install([clone(bench), clone(raise)])
    await finish()
    expect(host.querySelector('[data-plan-card="0334"]').textContent).toContain('New')
    // Nothing changed yet: the offer is only an offer.
    expect(S().routines[0].ex.map(x => x.id)).toEqual(['0025'])
    act(() => toggle('Add to routine').click())
    act(() => button('Apply').click())
    expect(S().routines[0].ex.map(x => [x.id, x.sets])).toEqual([['0025', 1], ['0334', 2]])
    // The bench keeps its own slot: the routine's weight, not today's.
    expect(S().routines[0].ex[0]).toMatchObject({ reps: 5, weight: 60 })
    expect(S().routines[0].ex[1].rid).toBeUndefined()
  })

  it('leaves the routine as it was when nothing is switched', async () => {
    install([clone(bench), clone(raise)])
    await finish()
    act(() => button('Apply').click())
    expect(S().routines[0].ex.map(x => x.id)).toEqual(['0025'])
  })

  it('counts the sets done: one more set is offered with today\'s order and sets', async () => {
    install([{ ...clone(bench), sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }] }])
    await finish()
    act(() => toggle('Use today’s order and sets').click())
    act(() => button('Apply').click())
    expect(S().routines[0].ex[0].sets).toBe(2)
  })

  it('keeps the note and the gym typed on the summary, the next page', async () => {
    install([clone(bench)])
    await finish()
    act(() => button('Skip').click())
    const note = host.querySelector('textarea')
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(note, 'felt strong')
      note.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(host.textContent).toContain('Duration')
    expect(host.textContent).toContain('Volume')
    expect(host.textContent).toContain('Gym')
    act(() => button('Save').click())
    expect(S().workouts.at(-1).note).toBe('felt strong')
    expect(useUI.getState().sheets).toHaveLength(0)
  })
})
