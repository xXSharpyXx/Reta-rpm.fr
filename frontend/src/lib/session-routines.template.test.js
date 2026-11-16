import { describe, expect, it } from 'vitest'
import { routineTemplates, applyTemplate } from './session-routines.js'

// The finish summary's choice: keep the workout just done as the routine's template, or keep the routine.
const routine = () => ({ id: 'r1', name: 'Push A', prog: 'double', ex: [
  { id: '0025', sets: 3, reps: 8, weight: 60 },
  { id: '0334', sets: 3, reps: 10, weight: 12 },
] })
const row = (extra = {}) => ({ w: 60, r: 8, done: true, ...extra })
const entry = (id, n = 3, extra = {}) => ({ id, rid: 'r1', target: { sets: 3, reps: 8, weight: 60 }, sets: Array.from({ length: n }, () => row()), ...extra })
const active = entries => ({ id: 'a', routineIds: ['r1'], entries })

describe('routineTemplates', () => {
  it('offers nothing when the session matches the routine', () => {
    expect(routineTemplates(active([entry('0025'), entry('0334')]), [routine()])).toEqual([])
  })

  it('offers nothing for a session with no completed set, or freestyle', () => {
    const idle = [entry('0025', 4, { sets: [{ w: 60, r: 8 }] })]
    expect(routineTemplates(active(idle), [routine()])).toEqual([])
    expect(routineTemplates(active([{ ...entry('0025', 4), rid: undefined }]), [routine()])).toEqual([])
  })

  it('takes the sets added in the session, against the prescription, keeping the plan’s reps and weight', () => {
    const [o] = routineTemplates(active([entry('0025', 4, { target: { sets: 3, reps: 10, weight: 65 } }), entry('0334')]), [routine()])
    expect(o).toMatchObject({ routineId: 'r1', name: 'Push A', added: [], removed: [] })
    expect(o.ex[0]).toEqual({ id: '0025', sets: 4, reps: 8, weight: 60 })
    // A set the progression added by itself is not an edit.
    expect(routineTemplates(active([entry('0025', 4, { target: { sets: 4 } }), entry('0334')]), [routine()])).toEqual([])
  })

  it('names exercises added and removed, and follows the session’s order', () => {
    const [o] = routineTemplates(active([entry('0586', 2, { addedInSession: true }), entry('0025')]), [routine()])
    expect(o.ex.map(x => x.id)).toEqual(['0586', '0025'])
    expect(o.added).toEqual(['0586'])
    expect(o.removed).toEqual(['0334'])
    expect(o.ex[0].rid).toBeUndefined()
    expect(o.ex[0].addedInSession).toBeUndefined()
  })

  it('takes warm-ups added in the session', () => {
    const e = entry('0025')
    e.sets.unshift({ w: 20, r: 10, warmup: true, done: true })
    const [o] = routineTemplates(active([e, entry('0334')]), [routine()])
    expect(o.ex[0].warmupSets).toBe(1)
  })

  it('keeps a superset made in the session together', () => {
    const [o] = routineTemplates(active([entry('0025', 3, { sg: 'x' }), entry('0334', 3, { sg: 'x' })]), [routine()])
    expect(o.ex[0].sg).toBeTruthy()
    expect(o.ex[0].sg).toBe(o.ex[1].sg)
  })

  it('applyTemplate replaces the exercises and hands back the old ones', () => {
    const r = routine()
    const old = applyTemplate(r, [{ id: '0586', sets: 2 }])
    expect(r.ex).toEqual([{ id: '0586', sets: 2 }])
    expect(old.map(x => x.id)).toEqual(['0025', '0334'])
  })
})
