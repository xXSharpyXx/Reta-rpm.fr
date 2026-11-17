// Body composition a scale's app (Renpho Health...) saves in Health Connect: one entry per day,
// the latest reading of each kind, and a second read of the same records changes nothing.
import { describe, expect, it } from 'vitest'
import { mergeBodyComp } from './health-read.js'

const at = (d, h) => new Date(2026, 9, d, h).getTime()
const rec = (type, d, h, v, extra = {}) => ({ type, t: at(d, h), v, id: `${type}${d}${h}`, origin: 'com.renpho.health', clientId: null, ...extra })

describe('mergeBodyComp', () => {
  it('keeps one entry per day, the latest reading of each kind', () => {
    const S = {}
    const days = mergeBodyComp(S, [
      rec('fat', 15, 7, 18.42), rec('fat', 15, 20, 18.9), rec('lean', 15, 7, 62.456),
      rec('water', 16, 7, 45.1), rec('bmr', 16, 7, 1712.4),
    ])
    expect(days.sort()).toEqual(['2026-10-15', '2026-10-16'])
    expect(S.bodyComp).toEqual([
      { d: '2026-10-15', t: at(15, 20), src: 'hc', fat: 18.9, lean: 62.46 },
      { d: '2026-10-16', t: at(16, 7), src: 'hc', water: 45.1, bmr: 1712 },
    ])
  })

  it('reading the same records again changes nothing', () => {
    const S = {}
    const records = [rec('fat', 15, 7, 18.4), rec('bone', 15, 7, 3.1), rec('height', 1, 9, 1.78)]
    mergeBodyComp(S, records)
    const before = JSON.stringify(S)
    expect(mergeBodyComp(S, records)).toEqual([])
    expect(JSON.stringify(S)).toBe(before)
  })

  it('updates a day when a later weigh-in comes in', () => {
    const S = {}
    mergeBodyComp(S, [rec('fat', 15, 7, 18.4)])
    expect(mergeBodyComp(S, [rec('fat', 15, 7, 18.4), rec('fat', 15, 21, 18.1)])).toEqual(['2026-10-15'])
    expect(S.bodyComp).toHaveLength(1)
    expect(S.bodyComp[0].fat).toBe(18.1)
  })

  it('skips openGym records, unknown kinds and impossible values', () => {
    const S = {}
    expect(mergeBodyComp(S, [
      rec('fat', 15, 7, 18, { clientId: 'opengym-x' }), rec('steps', 15, 7, 5000),
      rec('fat', 15, 7, 120), rec('lean', 15, 7, -1), null,
    ])).toEqual([])
    expect(S.bodyComp).toBeUndefined()
  })

  it('keeps the newest height apart from the days', () => {
    const S = {}
    expect(mergeBodyComp(S, [rec('height', 1, 9, 1.775), rec('height', 3, 9, 1.78)])).toEqual(['height'])
    expect(S.bodyHeight).toEqual({ m: 1.78, t: at(3, 9) })
    expect(S.bodyComp).toBeUndefined()
  })
})
