// @vitest-environment happy-dom
// The finish summary's "Next time": for each exercise the old value struck and the proposal, a
// toggle to keep the old weight, a pencil to type another, and one button to confirm them all.
// What is chosen is saved on the finished workout (lib/next-choice.js).
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { finishWorkoutNow } from '../sheets.jsx'

const clone = v => JSON.parse(JSON.stringify(v))
const S = () => useStore.getState().S
const saved = () => S().workouts.at(-1).entries[0]
const mounted = []
let host

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
const button = (text, within = host) => [...within.querySelectorAll('button')].find(b => b.textContent.trim() === text)

function install(prog) {
  const st = clone(DEF)
  st.routines = [{ id: 'r1', name: 'Push A', ex: [{ id: '0025', sets: 1, reps: 5, weight: 60, ...(prog ? { prog } : {}) }] }]
  st.active = {
    id: 'fin', d: '2026-09-28', start: Date.now() - 20 * 60000, routineIds: ['r1'], routineId: 'r1', name: 'Push A', bw: null, cur: 0,
    entries: [{ id: '0025', rid: 'r1', target: { sets: 1, reps: 5, weight: 60, ...(prog ? { prog } : {}) }, sets: [{ w: 60, r: 5, done: true }] }],
  }
  useStore.setState({ S: st, user: null })
}
async function finish(prepare) {
  act(() => finishWorkoutNow())
  if (prepare) act(() => prepare())
  host = renderTopSheet()
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

describe('finish summary: next time', () => {
  it('strikes the old weight and shows the proposal', async () => {
    install()
    await finish()
    expect(host.querySelector('del').textContent).toContain('60')
    expect(host.textContent).toContain('62.5')
    // Nothing is written until the lifter does something: the automatic progression stands.
    expect(saved().next).toBeUndefined()
  })

  it('the toggle keeps the old weight, and puts the proposal back', async () => {
    install()
    await finish()
    act(() => button('Apply').click())
    expect(saved().next).toEqual({ w: 60, r: 5 })
    expect(button('Keep 60 kg')).toBeTruthy()
    act(() => button('Keep 60 kg').click())
    expect('next' in saved()).toBe(false)
    expect(button('Apply')).toBeTruthy()
  })

  it('the pencil opens an editor whose numbers are saved as the choice', async () => {
    install()
    await finish()
    act(() => host.querySelector('[aria-label="Edit next time"]').click())
    const editor = renderTopSheet()
    const plus = [...editor.querySelectorAll('button[aria-label="Increase"]')]
    act(() => plus[0].click())   // weight 62.5 -> 65
    act(() => plus[1].click())   // reps 5 -> 6
    act(() => button('Save', editor).click())
    expect(saved().next).toEqual({ w: 65, r: 6 })
    expect(host.textContent).toContain('Your choice')
  })

  it('Validate all writes every row as shown, a refused one staying refused', async () => {
    install()
    await finish()
    act(() => button('Validate all').click())
    expect(saved().next).toEqual({ w: 62.5, r: 5 })
    expect(useUI.getState().toastMsg).toBe('Next session set')
    act(() => button('Apply').click())      // refused now ...
    act(() => button('Validate all').click())
    expect(saved().next).toEqual({ w: 60, r: 5 })   // ... and still refused after it
  })

  it('shows a saved choice, not the proposal, when the summary is opened again', async () => {
    install()
    await finish(() => useStore.getState().update(s => { s.workouts.at(-1).entries[0].next = { w: 55, r: 8 } }))
    expect(host.textContent).toContain('55')
    expect(host.textContent).toContain('Your choice')
    expect(host.querySelector('del')).toBeNull()
  })

  it('has no controls for an exercise whose progression is off', async () => {
    install('off')
    await finish()
    expect(host.querySelector('[data-next-controls]')).toBeNull()
    expect(button('Validate all')).toBeUndefined()
  })
})
