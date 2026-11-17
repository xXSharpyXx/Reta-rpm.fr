// restoreRoutine, what the Undo of a deleted routine runs (views/Plan.jsx deleteRoutineWithUndo):
// the routine comes back at the same places, in lists that may have changed since.
import { describe, expect, it } from 'vitest'
import { restoreRoutine, routineSnapshot, deleteRoutine } from './routines.js'

const routine = (id, name) => ({ id, name, emoji: null, ex: [{ id: '0025' }] })

describe('restoreRoutine', () => {
  const base = () => ({
    routines: [routine('a', 'A'), routine('b', 'B'), routine('c', 'C')],
    week: { 1: ['a', 'b'], 3: 'b' }, dayPlan: { '2099-01-01': 'b', '2099-01-02': 'a' },
    queue: { ids: ['c', 'b'] },
  })

  it('puts back what deleteRoutine took, at the same places', () => {
    const s = base()
    const snap = routineSnapshot(s, 'b')
    deleteRoutine(s, 'b')
    s.queue.ids = ['c']           // a save in between dropped it too
    expect(restoreRoutine(s, snap)).toBe(true)
    expect(s.routines.map(r => r.id)).toEqual(['a', 'b', 'c'])
    expect(s.week).toEqual({ 1: ['a', 'b'], 3: ['b'] })
    expect(s.dayPlan).toEqual(base().dayPlan)
    expect(s.queue.ids).toEqual(['c', 'b'])
  })

  it('fits into lists that got shorter, keeps a date planned since, and never doubles a routine', () => {
    const s = base()
    const snap = routineSnapshot(s, 'b')
    deleteRoutine(s, 'b')
    s.routines = [s.routines[1]]          // A deleted meanwhile
    delete s.week[1]
    s.dayPlan['2099-01-01'] = 'c'
    expect(restoreRoutine(s, snap)).toBe(true)
    expect(s.routines.map(r => r.id)).toEqual(['c', 'b'])
    expect(s.week[1]).toEqual(['b'])
    expect(s.dayPlan['2099-01-01']).toBe('c')
    expect(restoreRoutine(s, snap)).toBe(false)
    expect(s.routines.map(r => r.id)).toEqual(['c', 'b'])
  })
})
