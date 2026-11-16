import { describe, expect, it } from 'vitest'
import { summaryRows, prSetIndex, perBellOf, entryKind } from './workout-summary.js'

const bench = sets => ({ id: 'barbell-bench-press', target: { mode: 'reps' }, sets })

describe('summaryRows', () => {
  it('gives one row per done set, numbered, with the unit on every weight', () => {
    const { kind, rows } = summaryRows(bench([
      { w: 10, r: 12, done: true },
      { w: 15, r: 12, done: true },
      { w: 22, r: 12, done: true },
      { w: 25, r: 10, done: false },
    ]), { unit: 'kg' })
    expect(kind).toBe('reps')
    expect(rows.map(r => [r.n, r.weight, r.reps])).toEqual([[1, '10 kg', '12'], [2, '15 kg', '12'], [3, '22 kg', '12']])
  })

  it('numbers warm-ups apart from the work sets', () => {
    const { rows } = summaryRows(bench([
      { w: 20, r: 10, done: true, phase: 'warmup' },
      { w: 60, r: 8, done: true },
    ]))
    expect(rows.map(r => [r.warm, r.n])).toEqual([[true, 1], [false, 1]])
  })

  it('marks a set taken to failure', () => {
    const { rows } = summaryRows(bench([{ w: 60, r: 8, done: true }, { w: 60, r: 6, done: true, failure: true }]))
    expect(rows.map(r => r.fail)).toEqual([false, true])
  })

  it('puts the record on the first set that reached the top weight, only when the workout lists it', () => {
    const e = bench([{ w: 60, r: 8, done: true }, { w: 70, r: 5, done: true }, { w: 70, r: 4, done: true }])
    expect(prSetIndex(e)).toBe(1)
    expect(summaryRows(e, { isPr: true }).rows.map(r => r.pr)).toEqual([false, true, false])
    expect(summaryRows(e).rows.some(r => r.pr)).toBe(false)
  })

  it('ignores warm-ups when looking for the record', () => {
    expect(prSetIndex(bench([{ w: 100, r: 1, done: true, phase: 'warmup' }, { w: 80, r: 5, done: true }]))).toBe(1)
  })

  it('shows drops under their set', () => {
    const { rows } = summaryRows(bench([{ w: 100, r: 8, done: true, type: 'dropset', drops: [{ w: 80, r: 6 }] }]), { unit: 'kg' })
    expect(rows[0].extra).toBe('↘ 80 kg × 6')
  })

  it('reads a timed set as its duration', () => {
    const { kind, rows } = summaryRows({ id: 'plank', target: { mode: 'time' }, sets: [{ sec: 75, done: true }] })
    expect(kind).toBe('time')
    expect(rows[0].reps).toBe('1:15')
  })

  it('reads a cardio set as minutes and speed', () => {
    const e = { id: 'run', target: { mode: 'cardio' }, sets: [{ min: 20, speed: 10, done: true }] }
    expect(entryKind(e)).toBe('cardio')
    expect(summaryRows(e).rows[0].weight).toBe('20 min')
  })

  it('says once that a weight is per dumbbell', () => {
    expect(perBellOf({ id: 'dumbbell-bench-press', target: { dbLoad: 'each' }, sets: [] })).toBe('each')
    expect(perBellOf({ id: 'barbell-bench-press', target: {}, sets: [] })).toBe(null)
  })
})
