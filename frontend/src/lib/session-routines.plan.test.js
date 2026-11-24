import { describe, expect, it } from 'vitest'
import { templateChanges, planEx } from './session-routines.js'

// The plan the finish recap proposes for the next session: the routine as it is, with the changes
// of the session applied only where the lifter says so.
const cfg = (id, sets = 3) => ({ id, sets, reps: 5, weight: 60, mode: 'reps' })
const routine = { id: 'r', name: 'Push', ex: [cfg('bench'), cfg('incline'), cfg('fly')] }
const done = (id, n = 3) => ({ id, rid: 'r', target: { ...cfg(id) }, sets: Array.from({ length: n }, () => ({ w: 60, r: 5, done: true })) })
// bench and incline done, fly left out, dips added, and incline done before bench
const session = { id: 's', routineIds: ['r'], entries: [done('incline'), done('bench', 4), done('dips')] }
const changes = templateChanges(routine, session)
const ids = ex => ex.map(x => x.id)

describe('planEx', () => {
  it('sees what the session changed', () => {
    expect(changes.added).toEqual(['dips'])
    expect(changes.removed).toEqual(['fly'])
  })
  it('by default keeps the routine as it is: the skipped exercise stays, the new one is not added', () => {
    expect(ids(planEx(routine, changes))).toEqual(['bench', 'incline', 'fly'])
    expect(planEx(routine, changes)[0].sets).toBe(3)
  })
  it('drops a skipped exercise only when asked', () => {
    expect(ids(planEx(routine, changes, { drop: ['fly'] }))).toEqual(['bench', 'incline'])
  })
  it('adds a new exercise with the setup it was done with, at the end', () => {
    const ex = planEx(routine, changes, { add: ['dips'] })
    expect(ids(ex)).toEqual(['bench', 'incline', 'fly', 'dips'])
    expect(ex[3]).toMatchObject({ id: 'dips', sets: 3 })
  })
  it("takes today's order and set counts when asked, the kept exercise slotted back after its neighbour", () => {
    const ex = planEx(routine, changes, { today: true })
    expect(ids(ex)).toEqual(['incline', 'fly', 'bench'])      // dips not added, fly kept
    expect(ex.find(x => x.id === 'bench').sets).toBe(4)
    expect(ids(planEx(routine, changes, { today: true, add: ['dips'], drop: ['fly'] }))).toEqual(['incline', 'bench', 'dips'])
  })
  it('does not touch the routine it was given', () => {
    planEx(routine, changes, { today: true, add: ['dips'], drop: ['fly'] })
    expect(ids(routine.ex)).toEqual(['bench', 'incline', 'fly'])
  })
})
