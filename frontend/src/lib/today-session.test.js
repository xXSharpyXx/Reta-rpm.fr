// The Workouts page's "today" card (lib/today-session.js). These cases were the Home today row's
// (Android QA 1.3.10 rc: the row reported the last finished session while Start already named the
// next one) and moved with it.
import { describe, expect, it } from 'vitest'
import { todaySession } from './today-session.js'
import { isoOf } from './format.js'

const TODAY = '2026-11-16'   // a Monday
const routines = [
  { id: 'd1', name: 'US W1 D1', ex: [{ id: '0025' }] },
  { id: 'd2', name: 'US W1 D2', ex: [{ id: '0025' }] },
  { id: 'd3', name: 'US W1 D3', ex: [{ id: '0025' }] },
  { id: 'own', name: 'Core', ex: [{ id: '0025' }] },
]
const noon = new Date(TODAY + 'T12:00:00').getTime()
const daysFrom = n => { const d = new Date(TODAY + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d) }
const queue = (over = {}) => ({ ids: ['d1', 'd2', 'd3'], since: noon - 3 * 86400000, startsOn: daysFrom(-2), label: 'US W1', ...over })
const at = (id, start, name) => ({ id: 'w-' + id + start, d: TODAY, start, end: start + 1000, routineIds: id ? [id] : [], routineId: id, name: name || routines.find(r => r.id === id).name, entries: [] })
const S = over => ({ routines, week: {}, dayPlan: {}, workouts: [], queue: null, rotation: null, ...over })

describe('todaySession', () => {
  it('names the weekday plan, several routines joined', () => {
    const s = todaySession(S({ week: { 1: ['d1', 'own'] } }), TODAY)
    expect(s.name).toBe('US W1 D1 + Core')
    expect(s.ids).toEqual(['d1', 'own'])
    expect(s.done).toBe(null)
    expect(s.rescheduled).toBe(false)
  })

  it('a coach week puts its next session in front, and own routines ride along', () => {
    expect(todaySession(S({ queue: queue(), week: { 1: ['own'] } }), TODAY).name).toBe('US W1 D1 + Core')
  })

  it('a queue session done today: the next one is offered', () => {
    const s = todaySession(S({ queue: queue(), workouts: [at('d1', noon - 3600000)] }), TODAY)
    expect(s.name).toBe('US W1 D2')
    expect(s.done).toBe(null)
  })

  it('a freestyle session on a planned day leaves the plan offered', () => {
    const s = todaySession(S({ week: { 1: ['own'] }, workouts: [at(null, noon - 3600000, 'Freestyle')] }), TODAY)
    expect(s.name).toBe('Core')
    expect(s.done).toBe(null)
  })

  it('the planned routine done today reads as done', () => {
    const w = at('own', noon - 3600000)
    expect(todaySession(S({ week: { 1: ['own'] }, workouts: [w] }), TODAY).done).toBe(w)
  })

  it('a rest override wins, says the day was changed, and names the next session', () => {
    const s = todaySession(S({ week: { 1: ['own'], 2: ['d1'] }, dayPlan: { [TODAY]: 'rest' } }), TODAY)
    expect(s.routines).toEqual([])
    expect(s.rescheduled).toBe(true)
    expect(s.next.routine.name).toBe('US W1 D1')
  })

  it('a session pinned to today is the day\'s session, ahead of the floating order', () => {
    const s = todaySession(S({ queue: queue(), dayPlan: { [TODAY]: 'd3' } }), TODAY)
    expect(s.name).toBe('US W1 D3')
    expect(s.rescheduled).toBe(true)
  })
})
