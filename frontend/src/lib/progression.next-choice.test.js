import { describe, it, expect } from 'vitest'
import { nextPrescription, plannedOf } from './progression.js'
import { EXDB, isAssisted } from './exercises.js'

// The weight and reps the lifter chose at the end of the last session (lib/next-choice.js) are what
// the next session opens at, unless the routine's plan was edited since.
const LIFT = EXDB.find(e => e.bp !== 'cardio' && !['upper legs', 'lower legs', 'back', 'hips', 'glutes'].includes(e.bp) && !['body weight', 'band', 'resistance band'].includes(e.eq) && !isAssisted(e.id)).id
const PUSH = EXDB.find(e => e.eq === 'body weight' && e.bp !== 'cardio').id
const R = { id: 'r', ex: [] }
const WHY = 'Your choice at the end of the last session.'

const cfg = { id: LIFT, sets: 3, reps: 5, weight: 60, prog: 'linear' }
const logged = (c, w, reps, extra = {}, d = '2026-04-01') => ({
  d, routineIds: ['r'],
  entries: [{ id: c.id, rid: 'r', planned: plannedOf(c), target: { sets: c.sets, reps: c.reps, weight: c.weight }, sets: reps.map(r => ({ w, r, done: true })), ...extra }],
})
const state = (...workouts) => ({ unit: 'kg', workouts })

describe('a choice saved at the end of the last session', () => {
  it('is what the next session opens at, instead of the policy', () => {
    const clean = logged(cfg, 60, [5, 5, 5])
    expect(nextPrescription(state(clean), cfg, R)).toMatchObject({ kind: 'up', weight: 62.5 })   // without a choice
    const kept = logged(cfg, 60, [5, 5, 5], { next: { w: 60, r: 5 } })
    const p = nextPrescription(state(kept), cfg, R)
    expect(p).toMatchObject({ kind: 'hold', weight: 60, reps: 5 })
    expect(p.why[0]).toBe(WHY)
  })

  it('may ask for more than the policy would', () => {
    const p = nextPrescription(state(logged(cfg, 60, [5, 5, 5], { next: { w: 65, r: 4 } })), cfg, R)
    expect(p).toMatchObject({ kind: 'up', weight: 65, reps: 4 })
  })

  it('gives way to the plan when the routine was edited since', () => {
    const edited = { ...cfg, reps: 8 }
    const p = nextPrescription(state(logged(cfg, 60, [5, 5, 5], { next: { w: 65, r: 4 } })), edited, R)
    expect(p.why[0]).toBe('Plan changed, so starting from your new target.')
    expect(p.weight).not.toBe(65)
  })

  it('works for bodyweight work, where the weight is 0', () => {
    const bw = { id: PUSH, sets: 3, reps: 10, weight: 0, prog: 'double', repsMin: 8, repsMax: 0 }
    const w = logged(bw, 0, [10, 10, 10], { next: { w: 0, r: 12 } })
    expect(nextPrescription(state(w), bw, R)).toMatchObject({ weight: 0, reps: 12 })
  })

  it('is ignored when it does not hold up', () => {
    const clean = nextPrescription(state(logged(cfg, 60, [5, 5, 5])), cfg, R)
    for (const next of [{ w: 60, r: 0 }, { w: -5, r: 5 }, { w: NaN, r: 5 }, { w: 60 }]) {
      expect(nextPrescription(state(logged(cfg, 60, [5, 5, 5], { next })), cfg, R)).toEqual(clean)
    }
  })

  it('lapses once a later session is saved without one', () => {
    const chose = logged(cfg, 60, [5, 5, 5], { next: { w: 50, r: 5 } })
    const later = logged(cfg, 50, [5, 5, 5], {}, '2026-04-08')
    expect(nextPrescription(state(chose, later), cfg, R)).toMatchObject({ kind: 'up', weight: 52.5 })
  })

  it('under triple progression sets every set of the cycle to the chosen reps', () => {
    const triple = { id: LIFT, sets: 3, setsMax: 5, reps: 12, repsMin: 8, weight: 60, inc: 2.5, mode: 'reps', prog: 'triple' }
    const w = logged(triple, 60, [12, 12, 12], { next: { w: 60, r: 9 } })
    expect(nextPrescription(state(w), triple, R)).toMatchObject({ weight: 60, reps: 9, sets: 3, rowReps: [9, 9, 9] })
  })
})
