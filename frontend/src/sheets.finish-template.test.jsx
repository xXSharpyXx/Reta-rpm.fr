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

describe("finish summary: the workout as the routine's template", () => {
  it('offers it when the workout differs, and one tap makes it the template', async () => {
    install([clone(bench), clone(raise)])
    act(() => finishWorkoutNow())
    renderTopSheet()
    await settle()
    const box = host.querySelector('[data-template-choice]')
    expect(box).toBeTruthy()
    expect(box.textContent).toContain('Use this workout as the template for “Push A”?')
    expect(box.querySelectorAll('.tpl-lines li')).toHaveLength(1)   // one exercise added
    // Nothing changed yet: the offer is only an offer.
    expect(S().routines[0].ex.map(x => x.id)).toEqual(['0025'])
    act(() => button('Use this workout as the template').click())
    expect(S().routines[0].ex.map(x => [x.id, x.sets])).toEqual([['0025', 1], ['0334', 2]])
    // The bench keeps its own slot: the routine's weight, not today's.
    expect(S().routines[0].ex[0]).toMatchObject({ reps: 5, weight: 60 })
    expect(S().routines[0].ex[1].rid).toBeUndefined()
    expect(host.textContent).toContain('“Push A” now follows this workout')
  })

  it('keeps the template as it was on the other button', async () => {
    install([clone(bench), clone(raise)])
    act(() => finishWorkoutNow())
    renderTopSheet()
    await settle()
    act(() => button('Keep the current template').click())
    expect(S().routines[0].ex.map(x => x.id)).toEqual(['0025'])
    expect(host.textContent).toContain('“Push A” stays as it was')
  })

  it('says nothing when the workout was the template', async () => {
    install([clone(bench)])
    act(() => finishWorkoutNow())
    renderTopSheet()
    await settle()
    expect(host.querySelector('[data-template-choice]')).toBeNull()
  })

  it('counts the sets done: one more set is a change to offer', async () => {
    install([{ ...clone(bench), sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }] }])
    act(() => finishWorkoutNow())
    renderTopSheet()
    await settle()
    expect(host.querySelector('.tpl-lines').textContent).toMatch(/2 sets instead of 1/)
  })
})
