import { describe, it, expect } from 'vitest'
import { finishCompare, trendOf } from './finish-compare.js'
import { nextPrescription } from './progression.js'

const set = (w, r, extra = {}) => ({ w, r, done: true, ...extra })
const routine = { id: 'r1', name: 'A', prog: 'linear', ex: [{ id: 'bench', sets: 3, reps: 5, weight: 60, mode: 'reps' }] }
const workout = (id, d, sets, more = {}) => ({ id, d, start: Date.parse(d + 'T10:00:00'), end: Date.parse(d + 'T11:00:00'),
  entries: [{ id: 'bench', rid: 'r1', target: { ...routine.ex[0] }, sets }], ...more })

describe('last time and next time on the finish summary (#324)', () => {
  it('compares by the heaviest set, then by reps', () => {
    expect(trendOf([set(62.5, 5)], [set(60, 6)])).toBe(1)
    expect(trendOf([set(60, 5), set(60, 5)], [set(60, 5), set(60, 6)])).toBe(-1)
    expect(trendOf([set(60, 5)], [set(60, 5)])).toBe(0)
    expect(trendOf([set(60, 5)], null)).toBeNull()
  })
  it('finds the previous session of the exercise and leaves warm-ups out', () => {
    const prev = workout('w1', '2026-10-01', [set(20, 5, { phase: 'warmup' }), set(60, 5), set(60, 5), set(60, 4)])
    const now = workout('w2', '2026-10-03', [set(60, 5), set(60, 5), set(60, 5)])
    const st = { unit: 'kg', routines: [routine], workouts: [prev, now], exWeights: {} }
    const [row] = finishCompare(st, now)
    expect(row.last).toEqual([{ w: 60, r: 5 }, { w: 60, r: 5 }, { w: 60, r: 4 }])
    expect(row.trend).toBe(1)
    expect(row.next).toBeTruthy()
    expect(row.next.w).toBeGreaterThanOrEqual(60)
  })
  it('a first time has no last, and a workout out of progression has no next', () => {
    const now = workout('w1', '2026-10-03', [set(60, 5)], { noProg: true })
    const [row] = finishCompare({ unit: 'kg', routines: [routine], workouts: [now] }, now)
    expect(row.last).toBeNull()
    expect(row.trend).toBeNull()
    expect(row.next).toBeNull()
  })
})

describe('what the summary row says about the choice at the end of the session', () => {
  const prev = () => workout('w1', '2026-10-01', [set(60, 5), set(60, 5), set(60, 5)])
  const setup = (entryExtra = {}, r = routine) => {
    const now = workout('w2', '2026-10-03', [set(60, 5), set(60, 5), set(60, 5)])
    now.entries[0] = { ...now.entries[0], ...entryExtra }
    return { now, st: { unit: 'kg', routines: [r], workouts: [prev(), now], exWeights: {} } }
  }

  it('carries the old value, the routine, the step and the proposal as the policy makes it', () => {
    const { now, st } = setup()
    const [row] = finishCompare(st, now)
    expect(row).toMatchObject({ id: 'bench', rid: 'r1', editable: true, was: { w: 60, r: 5 }, chosen: null })
    expect(row.step).toBeGreaterThan(0)
    expect(row.next).toMatchObject({ w: 62.5, r: 5, kind: 'up' })
  })

  it('keeps the proposal the policy makes even when a choice is saved, and reports the choice', () => {
    const { now, st } = setup({ next: { w: 50, r: 6 } })
    const [row] = finishCompare(st, now)
    expect(row.next).toMatchObject({ w: 62.5, r: 5, kind: 'up' })
    expect(row.chosen).toEqual({ w: 50, r: 6 })
    // and the next session does open at the choice
    expect(nextPrescription(st, routine.ex[0], routine)).toMatchObject({ weight: 50, reps: 6 })
  })

  it('is not editable for an exercise whose progression is off', () => {
    const off = { ...routine, ex: [{ ...routine.ex[0], prog: 'off' }] }
    const { now, st } = setup({}, off)
    const [row] = finishCompare(st, now)
    expect(row.editable).toBe(false)
  })
})

describe('the rows the finish recap draws', () => {
  it('lists every done set with its kind, warm-ups and failures included', () => {
    const now = workout('w2', '2026-10-03', [set(20, 8, { phase: 'warmup' }), set(60, 5), set(60, 3, { f: true })])
    const [row] = finishCompare({ unit: 'kg', routines: [routine], workouts: [now] }, now)
    expect(row.sets.map(x => x.kind)).toEqual(['warm', 'work', row.sets[2].kind])
    expect(row.sets[0]).toEqual({ w: 20, r: 8, kind: 'warm' })
  })
  it('proposes numbers for an exercise added today when its setup is given', () => {
    const added = { id: 'dips', sets: 3, reps: 8, weight: 20, mode: 'reps' }
    const now = workout('w2', '2026-10-03', [set(60, 5)])
    now.entries.push({ id: 'dips', rid: 'r1', target: { ...added }, sets: [set(20, 8), set(20, 8), set(20, 8)] })
    const st = { unit: 'kg', routines: [routine], workouts: [now] }
    expect(finishCompare(st, now).find(r => r.id === 'dips').next).toBeNull()
    const row = finishCompare(st, now, { extra: { dips: added } }).find(r => r.id === 'dips')
    expect(row.isNew).toBe(true)
    expect(row.next).toMatchObject({ w: 22.5, kind: 'up' })
  })
})

