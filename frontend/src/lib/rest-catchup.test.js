import { describe, expect, it } from 'vitest'
import { restCatchUp } from './rest-catchup.js'

const T0 = 1_760_000_000_000
const rest = (over = {}) => ({ left: 90, total: 90, endsAt: T0 + 90_000, ...over })

describe('restCatchUp: a set ticked elsewhere, heard of late', () => {
  it('takes off the seconds since the tap from the rest the tick just started', () => {
    const before = null
    const now = rest()
    // ticked on the watch 40 s ago, the phone only opens now
    expect(restCatchUp(before, now, T0 - 40_000, T0)).toBe(40)
  })

  it('leaves a tick heard of at once alone', () => {
    expect(restCatchUp(null, rest(), T0 - 800, T0)).toBe(0)
    expect(restCatchUp(null, rest(), T0 - 1500, T0)).toBe(0)
  })

  it('leaves the rest alone when the tick did not start a new one', () => {
    const same = rest()
    expect(restCatchUp(same, same, T0 - 40_000, T0)).toBe(0)
  })

  it('leaves a paused, ready or missing rest alone', () => {
    expect(restCatchUp(null, rest({ paused: true }), T0 - 40_000, T0)).toBe(0)
    expect(restCatchUp(null, rest({ ready: true }), T0 - 40_000, T0)).toBe(0)
    expect(restCatchUp(null, null, T0 - 40_000, T0)).toBe(0)
  })

  it('ignores a tap time that is missing or in the future (clocks apart)', () => {
    expect(restCatchUp(null, rest(), undefined, T0)).toBe(0)
    expect(restCatchUp(null, rest(), T0 + 30_000, T0)).toBe(0)
  })
})
