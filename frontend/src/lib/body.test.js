import { describe, expect, it } from 'vitest'
import { bmiOf, fatSeries, latestBody, weightSeries } from './body.js'

const S = (extra = {}) => ({
  unit: 'kg',
  bodyweight: [{ d: '2026-10-14', w: 81.2 }, { d: '2026-10-15', w: 80.6, t: new Date(2026, 9, 15, 7).getTime(), src: 'hc' }],
  bodyComp: [{ d: '2026-10-15', t: 1, src: 'hc', fat: 18.4, lean: 62.3, water: 45.1, bmr: 1712 }],
  bodyHeight: { m: 1.8, t: 1 },
  ...extra,
})

describe('bmiOf', () => {
  it('is weight over height squared, to one decimal', () => {
    expect(bmiOf(80.6, 1.8)).toBe(24.9)
    expect(bmiOf(80, 0)).toBeNull()
    expect(bmiOf(null, 1.8)).toBeNull()
  })
})

describe('latestBody', () => {
  it('gives the last weigh-in with the composition of that day', () => {
    expect(latestBody(S())).toEqual({ d: '2026-10-15', w: 80.6, fat: 18.4, lean: 62.3, bone: null, water: 45.1, bmr: 1712, bmi: 24.9, delta: -0.6 })
  })

  it('converts the masses to pounds on a pound profile, the BMI from kg', () => {
    const r = latestBody(S({ unit: 'lb', bodyweight: [{ d: '2026-10-15', w: 177.7 }] }))
    expect(r.lean).toBe(137.3)
    expect(r.bmi).toBe(24.9)
  })

  it('lets a measurement check-in’s body fat win on its day', () => {
    expect(latestBody(S({ measurements: [{ d: '2026-10-15', bodyFat: 17.9 }] })).fat).toBe(17.9)
  })

  it('is null with nothing weighed', () => {
    expect(latestBody({})).toBeNull()
  })
})

describe('series', () => {
  it('sorts by time and keeps the range', () => {
    expect(weightSeries(S()).map(p => p.y)).toEqual([81.2, 80.6])
    expect(weightSeries(S(), new Date(2026, 9, 15).getTime()).map(p => p.y)).toEqual([80.6])
    expect(fatSeries(S({ measurements: [{ d: '2026-10-01', bodyFat: 19 }] })).map(p => p.y)).toEqual([19, 18.4])
  })
})
