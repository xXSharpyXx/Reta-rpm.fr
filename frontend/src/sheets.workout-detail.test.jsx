// @vitest-environment happy-dom
// A past workout's detail sheet. Discord (rubik_97): drop-set weights were counted in the volume
// but never listed, and supersets were not shown at all. Discord 'Improvement ideas': an exercise
// opens its own history from here, and the workout can be copied as text.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { workoutDetailSheet } from './sheets.jsx'
import { EXDB } from './lib/exercises-data.js'

const lifts = EXDB.filter(e => e.bp !== 'cardio' && e.eq === 'barbell').slice(0, 3).map(e => e.id)
const clone = v => JSON.parse(JSON.stringify(v))
const mounted = []

function mountTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)

const workout = (entries, extra = {}) => ({
  id: 'w1', d: '2026-09-15', start: new Date(2026, 8, 15, 17).getTime(), end: new Date(2026, 8, 15, 18).getTime(), name: 'Push',
  vol: 0, prs: [], routineIds: [], entries, ...extra,
})
const done = (w, r, more = {}) => ({ w, r, done: true, ...more })

let toast
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  toast = vi.fn()
  useUI.setState({ sheets: [], toast })
  const S = clone(DEF)
  Object.assign(S, { unit: 'kg', routines: [], workouts: [], active: null })
  useStore.setState({ S, user: null })
  document.body.innerHTML = ''
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
  vi.unstubAllGlobals()
})

describe('workout detail', () => {
  it('lists a drop-set\'s drops and a rest-pause set\'s bursts', () => {
    workoutDetailSheet(workout([
      { id: lifts[0], target: { mode: 'reps' }, sets: [done(100, 8, { type: 'dropset', drops: [{ w: 80, r: 6 }, { w: 60, r: 5 }] })] },
      { id: lifts[1], target: { mode: 'reps' }, sets: [done(60, 16, { type: 'restpause', clusters: [{ r: 4, restSec: 15 }, { r: 2, restSec: 15 }] })] },
    ]))
    // One table row per set (components/WorkoutSummary.jsx): Set | Weight | Reps, drops under the weight.
    const rows = [...mountTopSheet().querySelectorAll('.wsum-sets tbody tr')].map(tr => [...tr.children].map(td => td.textContent))
    expect(rows).toEqual([['1', '100 kg↘ 80 kg × 6   ↘ 60 kg × 5', '8'], ['1', '60 kg', '10+4+2']])
  })

  it('keeps a superset together under one label, in a flat and in a combined workout', () => {
    const entries = [
      { id: lifts[0], sg: 'sg1', target: { mode: 'reps' }, sets: [done(40, 10)] },
      { id: lifts[1], sg: 'sg1', target: { mode: 'reps' }, sets: [done(20, 12)] },
      { id: lifts[2], target: { mode: 'reps' }, sets: [done(60, 5)] },
    ]
    workoutDetailSheet(workout(entries))
    let host = mountTopSheet()
    let groups = host.querySelectorAll('.wd-ss')
    expect(groups).toHaveLength(1)
    expect(groups[0].querySelector('.ss-label').textContent).toBe('Superset')
    expect(groups[0].querySelectorAll('.wsum-ex')).toHaveLength(2)
    expect(host.querySelectorAll('.wsum-ex')).toHaveLength(3)

    useUI.setState({ sheets: [] })
    const combined = entries.map((e, i) => ({ ...e, rid: i < 2 ? 'A' : 'B' }))
    workoutDetailSheet(workout(combined, { routineIds: ['A', 'B'] }))
    host = mountTopSheet()
    expect(host.textContent).toContain('Freestyle')           // routines since deleted
    expect(host.querySelectorAll('.wd-ss .wsum-ex')).toHaveLength(2)
  })

  it('shows an unpaired exercise without a superset label', () => {
    workoutDetailSheet(workout([
      { id: lifts[0], sg: 'sg1', target: { mode: 'reps' }, sets: [done(40, 10)] },
      { id: lifts[1], target: { mode: 'reps' }, sets: [done(20, 12)] },
    ]))
    expect(mountTopSheet().querySelector('.wd-ss')).toBeNull()
  })

  it('opens the exercise\'s history from its row', () => {
    const w = workout([{ id: lifts[0], target: { mode: 'reps' }, sets: [done(60, 5)] }])
    useStore.setState(s => ({ S: { ...s.S, workouts: [w] } }))
    workoutDetailSheet(w)
    const row = mountTopSheet().querySelector('.wsum-ex')
    expect(row.getAttribute('role')).toBe('button')
    act(() => { row.click() })
    expect(useUI.getState().sheets).toHaveLength(2)
    const history = mountTopSheet()
    expect(history.textContent).toContain('Exercise history')
    expect(history.textContent).toContain('60×5')
  })

  // One rule for both: a superset paired across two routines of a combined session is shown apart
  // in the sheet, each under its own routine, and the copied text does not call it a superset.
})

// Owner, 2026-11-17: three actions only, and no empty photo block on a read-only sheet.
describe('workout detail actions', () => {
  it('offers edit, save as routine and delete, nothing else', () => {
    const w = workout([{ id: lifts[0], target: { mode: 'reps' }, sets: [done(60, 5)] }])
    useStore.setState(st => ({ S: { ...st.S, workouts: [w] } }))
    workoutDetailSheet(w)
    const host = mountTopSheet()
    const labels = [...host.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean)
    expect(labels).toEqual(expect.arrayContaining(['Edit workout', 'Save as routine', 'Delete workout']))
    for (const gone of ['Repeat today', 'Change date & time', 'Change duration', 'Copy as text', 'Share as image', 'Save as PDF', 'Export as .fit file']) {
      expect(labels).not.toContain(gone)
    }
    expect(host.querySelector('.wmedia')).toBeNull()
  })

  it('shows the heart rate as one curve, not beside every set', () => {
    const start = new Date(2026, 8, 15, 17).getTime()
    const w = workout([{ id: lifts[0], target: { mode: 'reps' }, sets: [done(60, 5, { hr: { avg: 120, max: 130 } })] }],
      { hr: { avg: 119, max: 145, src: 'hc', n: 400 }, hrSeries: { t0: start, dt: 15, v: [100, 110, 140, null, 120] } })
    useStore.setState(st => ({ S: { ...st.S, workouts: [w] } }))
    workoutDetailSheet(w)
    const host = mountTopSheet()
    expect(host.querySelector('[data-hr-card]').textContent).toContain('119')
    expect(host.querySelector('svg.hrc')).toBeTruthy()
    expect(host.querySelector('.wsum-sets').textContent).not.toContain('♥')
  })
})
