import { describe, it, expect } from 'vitest'
import { lastDoneOf } from './session-picker.js'

const st = {
  routines: [
    { id: 'push', name: 'Push', ex: [{ id: 'a' }, { id: 'b' }] },
    { id: 'pull', name: 'Pull', ex: [{ id: 'c' }] },
    { id: 'legs', name: 'Legs', ex: [] },
  ],
  workouts: [
    { d: '2026-11-02', routineIds: ['push'] },
    { d: '2026-11-06', routineIds: ['push', 'pull'] },
    { d: '2026-10-30', routineId: 'pull' },
  ],
}

describe('session picker', () => {
  it('finds the last day a routine was done, old single-routine workouts included', () => {
    expect(lastDoneOf(st.workouts, 'push')).toBe('2026-11-06')
    expect(lastDoneOf(st.workouts, 'pull')).toBe('2026-11-06')
    expect(lastDoneOf(st.workouts, 'legs')).toBeNull()
    expect(lastDoneOf(undefined, 'legs')).toBeNull()
  })
})
