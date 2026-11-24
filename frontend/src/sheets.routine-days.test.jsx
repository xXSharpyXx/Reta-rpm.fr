// @vitest-environment happy-dom
// Planning a routine on days from the routine's side (the Workouts page, "My sessions"): the seven
// days of the week, ticked where the routine is on, a tap adds or takes it off a day.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { routineDaysSheet } from './sheets.jsx'

const clone = v => JSON.parse(JSON.stringify(v))
const S = () => useStore.getState().S
const mounted = []
let host
function open(id) {
  act(() => routineDaysSheet(id))
  const sheet = useUI.getState().sheets.at(-1)
  host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
}
const day = d => host.querySelector(`[data-day="${d}"]`)

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  useUI.setState({ sheets: [] })
  const st = clone(DEF)
  st.weekStart = 1
  st.routines = [{ id: 'push', name: 'Push', ex: [] }, { id: 'pull', name: 'Pull', ex: [] }]
  st.week = { 1: ['push'], 3: ['push', 'pull'] }
  useStore.setState({ S: st, user: null })
})
afterEach(() => { mounted.splice(0).forEach(r => act(() => r.unmount())); document.body.innerHTML = '' })

describe('routineDaysSheet', () => {
  it('lists the seven days, Monday first, ticked where the routine is planned', () => {
    open('push')
    const days = [...host.querySelectorAll('[data-routine-days] [data-day]')]
    expect(days.map(d => d.dataset.day)).toEqual(['1', '2', '3', '4', '5', '6', '0'])
    expect(days.map(d => d.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'true', 'false', 'false', 'false', 'false'])
  })
  it('a tap plans the routine on that day, another takes it off, next to what else is there', () => {
    open('pull')
    act(() => day(5).click())
    expect(S().week[5]).toEqual(['pull'])
    act(() => day(3).click())
    expect(S().week[3]).toEqual(['push'])
    expect(S().week[1]).toEqual(['push'])
  })
  it('a day left with nothing becomes a rest day', () => {
    open('push')
    act(() => day(1).click())
    expect(S().week[1]).toBeUndefined()
  })
})
