import { describe, it, expect } from 'vitest'
import { hrSeries, sanitizeSeries, seriesPoints, seriesStats, entryAt, entryMarks } from './heart-rate.js'

const T0 = Date.UTC(2026, 10, 1, 9, 0, 0)
const s = sec => T0 + sec * 1000
const w = {
  start: s(0), end: s(1800),
  entries: [
    { id: 'a', target: { mode: 'reps' }, sets: [{ w: 60, r: 8, done: true, at: s(120) }, { w: 60, r: 8, done: true, at: s(300) }] },
    { id: 'b', target: { mode: 'reps' }, sets: [{ w: 20, r: 10, done: true, at: s(900) }] },
  ],
}

describe('heart rate curve', () => {
  it('averages the samples per bucket and leaves the empty ones null', () => {
    const c = hrSeries(w, [[s(1), 100], [s(5), 110], [s(20), 130], [s(9999), 90]])
    expect(c.t0).toBe(s(0))
    expect(c.dt).toBe(15)
    expect(c.v).toHaveLength(120)
    expect(c.v[0]).toBe(105)
    expect(c.v[1]).toBe(130)
    expect(c.v[2]).toBe(null)
  })

  it('keeps long sessions to at most 360 buckets', () => {
    const long = { start: s(0), end: s(4 * 3600) }
    const c = hrSeries(long, [[s(10), 100], [s(7000), 120]])
    expect(c.v.length).toBeLessThanOrEqual(360)
  })

  it('has no curve with fewer than two buckets filled, or without a start and an end', () => {
    expect(hrSeries(w, [[s(1), 100], [s(2), 101]])).toBe(null)
    expect(hrSeries({ start: s(0) }, [[s(1), 100], [s(100), 101]])).toBe(null)
  })

  it('reads a stored curve defensively', () => {
    expect(sanitizeSeries({ t0: 1, dt: 15, v: [100, 'x', 400, 120] })).toEqual({ t0: 1, dt: 15, v: [100, null, null, 120] })
    expect(sanitizeSeries({ t0: 1, dt: 15, v: [100] })).toBe(null)
    expect(sanitizeSeries(null)).toBe(null)
  })

  it('gives points, min, max and average', () => {
    const c = { t0: s(0), dt: 60, v: [100, null, 140] }
    expect(seriesPoints(c)).toEqual([{ s: 30, bpm: 100 }, { s: 150, bpm: 140 }])
    expect(seriesStats(c)).toEqual({ avg: 120, min: 100, max: 140 })
  })

  it('says which exercise was being done at a moment', () => {
    expect(entryAt(w, 60 * 1000)).toBe(0)
    expect(entryAt(w, 600 * 1000)).toBe(1)
    expect(entryAt(w, 1700 * 1000)).toBe(1)
    expect(entryAt({ start: s(0), entries: [] }, 0)).toBe(null)
    expect(entryMarks(w).map(m => m.ei)).toEqual([0, 1])
  })
})
