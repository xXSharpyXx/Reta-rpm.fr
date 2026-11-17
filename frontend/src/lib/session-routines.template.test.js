import { describe, expect, it } from 'vitest'
import { templateFromSession, templateChanges, applyTemplate } from './session-routines.js'

// The finish asks whether the workout just done becomes its routine's template (owner, 2026-11-17).
const routine = () => ({
  id: 'r1', name: 'Push', prog: 'double',
  ex: [
    { id: 'bench', sets: 3, reps: 8, weight: 60, restSec: 120, note: 'Elbows in' },
    { id: 'fly', sets: 3, reps: 12, weight: 14 },
    { id: 'dips', sets: 2, reps: 10, weight: 0 },
  ],
})
const done = (n, w = 20, r = 10) => Array.from({ length: n }, () => ({ w, r, done: true }))
const entry = (id, sets, extra = {}) => ({ id, rid: 'r1', target: { sets: 3, reps: 10, weight: 20 }, sets, ...extra })
const workout = entries => ({ id: 'w', routineIds: ['r1'], entries })

describe('templateFromSession', () => {
  it('keeps a slot the routine has, with only its set count changed', () => {
    const ex = templateFromSession(routine(), workout([entry('bench', done(4, 62.5, 8)), entry('fly', done(3)), entry('dips', done(2))]))
    expect(ex[0]).toEqual({ id: 'bench', sets: 4, reps: 8, weight: 60, restSec: 120, note: 'Elbows in' })
    expect(ex.map(x => x.id)).toEqual(['bench', 'fly', 'dips'])
  })

  it('drops an exercise skipped, takes one added with the setup it was done with, in the order done', () => {
    const ex = templateFromSession(routine(), workout([entry('fly', done(3)), entry('row', done(3, 40, 10)), entry('bench', done(3)), entry('dips', [{ w: 0, r: 10 }])]))
    expect(ex.map(x => x.id)).toEqual(['fly', 'row', 'bench'])
    expect(ex[1]).toMatchObject({ id: 'row', sets: 3, reps: 10, weight: 40, prog: 'double' })
    expect(ex[1].rid).toBeUndefined()
  })

  it('leaves warm-ups out of the set count, and the other routine of a combined day out', () => {
    const ex = templateFromSession(routine(), workout([
      entry('bench', [{ w: 20, r: 10, done: true, phase: 'warmup' }, ...done(3)]),
      { ...entry('curl', done(3)), rid: 'r2' },
    ]))
    expect(ex).toEqual([expect.objectContaining({ id: 'bench', sets: 3 })])
  })
})

describe('templateChanges', () => {
  it('is null when the workout was the template', () => {
    expect(templateChanges(routine(), workout([entry('bench', done(3)), entry('fly', done(3)), entry('dips', done(2))]))).toBeNull()
  })

  it('names what changes: added, removed, set counts, order, supersets', () => {
    const c = templateChanges(routine(), workout([
      entry('fly', done(3), { sg: 'x' }), entry('bench', done(4), { sg: 'x' }), entry('row', done(3)),
    ]))
    expect(c.added).toEqual(['row'])
    expect(c.removed).toEqual(['dips'])
    expect(c.sets).toEqual([{ id: 'bench', from: 3, to: 4 }])
    expect(c.reordered).toBe(true)
    expect(c.supersets).toBe(true)
  })

  it('is null for a workout with nothing of the routine done', () => {
    expect(templateChanges(routine(), workout([entry('bench', [{ w: 20, r: 10 }])]))).toBeNull()
  })
})

describe('applyTemplate', () => {
  it('writes the list as the routine\'s exercises, and nothing else', () => {
    const r = routine()
    const c = templateChanges(r, workout([entry('bench', done(4)), entry('fly', done(3))]))
    expect(applyTemplate(r, c.ex)).toBe(true)
    expect(r.ex.map(x => [x.id, x.sets])).toEqual([['bench', 4], ['fly', 3]])
    expect(r).toMatchObject({ id: 'r1', name: 'Push', prog: 'double' })
  })
})
