// @vitest-environment happy-dom
// The finish asks whether the workout just done becomes its routine's template (owner,
// 2026-11-17). One tap keeps it; the other button, or closing the summary, leaves the routine.
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

function install(entries) {
  const st = clone(DEF)
  st.routines = [{ id: 'r1', name: 'Push A', ex: [{ id: '0025', sets: 1, reps: 5, weight: 60 }] }]
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

// Save on the summary, then one dialog per routine whose template the workout differs from.
async function finishAndSave() {
  act(() => finishWorkoutNow())
  renderTopSheet()
  await settle()
  act(() => button('Save').click())
  renderTopSheet()
}

describe("finish summary: the workout as the routine's template", () => {
  it('asks once Save is tapped, and Update routine makes it the template', async () => {
    install([clone(bench), clone(raise)])
    await finishAndSave()
    const box = host.querySelector('[data-template-choice]')
    expect(box).toBeTruthy()
    expect(box.textContent).toContain('Update “Push A”')
    expect(box.textContent).toContain('Compared with the routine: 1 exercise added.')
    // Nothing changed yet: the offer is only an offer.
    expect(S().routines[0].ex.map(x => x.id)).toEqual(['0025'])
    act(() => button('Update routine').click())
    expect(S().routines[0].ex.map(x => [x.id, x.sets])).toEqual([['0025', 1], ['0334', 2]])
    // The bench keeps its own slot: the routine's weight, not today's.
    expect(S().routines[0].ex[0]).toMatchObject({ reps: 5, weight: 60 })
    expect(S().routines[0].ex[1].rid).toBeUndefined()
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('keeps the template as it was on the other button', async () => {
    install([clone(bench), clone(raise)])
    await finishAndSave()
    act(() => button('Keep original routine').click())
    expect(S().routines[0].ex.map(x => x.id)).toEqual(['0025'])
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('says nothing when the workout was the template', async () => {
    install([clone(bench)])
    act(() => finishWorkoutNow())
    renderTopSheet()
    await settle()
    act(() => button('Save').click())
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('counts the sets done: one more set is a change to offer', async () => {
    install([{ ...clone(bench), sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }] }])
    await finishAndSave()
    expect(host.querySelector('[data-template-choice]').textContent).toContain('1 set added')
  })

  it('keeps the note and the gym typed on the summary', async () => {
    install([clone(bench)])
    act(() => finishWorkoutNow())
    renderTopSheet()
    await settle()
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
  })
})
