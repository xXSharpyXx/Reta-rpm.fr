// @vitest-environment happy-dom
// The finish summary's Duration tile opens the same editor the workout detail has, so a session
// nobody ended on time can be corrected right where its length is shown.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { finishWorkoutNow } from './sheets.jsx'

const clone = v => JSON.parse(JSON.stringify(v))
const S = () => useStore.getState().S
const mounted = []

function renderTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return el
}
const settle = () => act(async () => {})
const button = (text, within) => [...within.querySelectorAll('button')].find(b => b.textContent.trim() === text)

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  useUI.setState({ sheets: [], timer: null, work: null, toastMsg: '' })
  const st = clone(DEF)
  st.routines = [{ id: 'r1', name: 'Push A', ex: [{ id: '0025', sets: 1, reps: 5, weight: 60 }] }]
  st.active = {
    id: 'fin', d: '2026-09-28', start: Date.now() - 20 * 60000, routineIds: ['r1'], routineId: 'r1', name: 'Push A', bw: null, cur: 0,
    entries: [{ id: '0025', rid: 'r1', target: { sets: 1, reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: true }] }],
  }
  useStore.setState({ S: st, user: null })
})
afterEach(() => {
  mounted.splice(0).forEach(r => act(() => r.unmount()))
  document.body.innerHTML = ''
})

describe('finish summary: the duration can be corrected', () => {
  it('opens the duration editor from the tile, and the tile shows the new length', async () => {
    act(() => finishWorkoutNow())
    const summary = renderTopSheet()
    await settle()
    act(() => button('Skip', summary).click())                // the plan page comes first
    const before = S().workouts.at(-1)
    const tile = [...summary.querySelectorAll('button')].find(b => b.textContent.includes('Duration'))
    expect(tile.textContent).toContain('20 min')
    act(() => tile.click())
    const editor = renderTopSheet()
    act(() => editor.querySelector('button[aria-label="Increase"]').click())   // +5 min
    act(() => button('Save', editor).click())
    const after = S().workouts.at(-1)
    expect(after.end - after.start).toBe(25 * 60000)
    expect(after.start).toBe(before.start)
    expect(after._ts).toBeGreaterThan(0)
    expect(summary.textContent).toContain('25 min')
  })
})
