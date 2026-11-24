import { describe, expect, it } from 'vitest'
import { nextChoiceOf, withoutNextChoice, setNextChoices } from './next-choice.js'

const entry = (id, over = {}) => ({ id, sets: [{ w: 60, r: 5, done: true }], ...over })
const workout = (over = {}) => ({ id: 'w1', d: '2026-11-24', start: 1000, end: 2000, entries: [entry('0025')], ...over })

describe('nextChoiceOf', () => {
  it('reads a valid choice', () => {
    expect(nextChoiceOf(entry('0025', { next: { w: 62.5, r: 5 } }))).toEqual({ w: 62.5, r: 5 })
  })
  it('keeps a bodyweight choice (weight 0)', () => {
    expect(nextChoiceOf(entry('0025', { next: { w: 0, r: 8 } }))).toEqual({ w: 0, r: 8 })
  })
  it('ignores what does not hold up', () => {
    for (const next of [{ w: -1, r: 5 }, { w: 60, r: 0 }, { w: NaN, r: 5 }, { w: '60', r: 5 }, { w: 60 }, null, 7]) {
      expect(nextChoiceOf(entry('0025', { next }))).toBeNull()
    }
    expect(nextChoiceOf(entry('0025'))).toBeNull()
    expect(nextChoiceOf(null)).toBeNull()
  })
})

describe('withoutNextChoice', () => {
  it('drops next from every entry, without touching the input', () => {
    const w = workout({ entries: [entry('a', { next: { w: 50, r: 5 } }), entry('b', { next: { w: 20, r: 8 } })] })
    const out = withoutNextChoice(w)
    expect(out.entries.every(e => !('next' in e))).toBe(true)
    expect(w.entries[0].next).toEqual({ w: 50, r: 5 })
  })
  it('returns the same workout when there is none', () => {
    const w = workout()
    expect(withoutNextChoice(w)).toBe(w)
  })
})

describe('setNextChoices', () => {
  it('sets the choice on the matching entry and stamps the workout', () => {
    const a = workout(), b = workout({ id: 'w2' })
    const out = setNextChoices([a, b], a, [{ id: '0025', choice: { w: 62.5, r: 5 } }], 777)
    expect(out[0].entries[0].next).toEqual({ w: 62.5, r: 5 })
    expect(out[0]._ts).toBe(777)
    expect(out[1]).toBe(b)
    expect(a.entries[0].next).toBeUndefined()
  })
  it('addresses an entry by id and routine when the exercise is there twice', () => {
    const w = workout({ entries: [entry('0025', { rid: 'r1' }), entry('0025', { rid: 'r2' })] })
    const out = setNextChoices([w], w, [{ id: '0025', rid: 'r2', choice: { w: 70, r: 3 } }], 1)
    expect(out[0].entries[0].next).toBeUndefined()
    expect(out[0].entries[1].next).toEqual({ w: 70, r: 3 })
  })
  it('removes the choice for null', () => {
    const w = workout({ entries: [entry('0025', { next: { w: 50, r: 5 } })] })
    const out = setNextChoices([w], w, [{ id: '0025', choice: null }], 5)
    expect('next' in out[0].entries[0]).toBe(false)
  })
  it('does several entries in one go', () => {
    const w = workout({ entries: [entry('a'), entry('b')] })
    const out = setNextChoices([w], w, [{ id: 'a', choice: { w: 1, r: 1 } }, { id: 'b', choice: { w: 2, r: 2 } }], 5)
    expect(out[0].entries.map(e => e.next)).toEqual([{ w: 1, r: 1 }, { w: 2, r: 2 }])
  })
  it('returns null when nothing changes or the workout is not there', () => {
    const w = workout({ entries: [entry('0025', { next: { w: 50, r: 5 } })] })
    expect(setNextChoices([w], w, [{ id: '0025', choice: { w: 50, r: 5 } }], 5)).toBeNull()
    expect(setNextChoices([w], w, [{ id: '0025', choice: null }], 5)).not.toBeNull()
    expect(setNextChoices([workout()], workout({ id: 'nope' }), [{ id: '0025', choice: { w: 1, r: 1 } }], 5)).toBeNull()
    expect(setNextChoices([workout()], workout(), [{ id: '0025', choice: null }], 5)).toBeNull()
    expect(setNextChoices([workout()], workout(), [{ id: 'zzz', choice: { w: 1, r: 1 } }], 5)).toBeNull()
  })
  it('refuses a choice that does not hold up', () => {
    const w = workout()
    expect(setNextChoices([w], w, [{ id: '0025', choice: { w: 60, r: 0 } }], 5)).toBeNull()
  })
})
