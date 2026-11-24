import { describe, expect, it } from 'vitest'
import { swipeDays, shiftDay, weekOffsetOf } from './day-swipe.js'

describe('swipeDays: which way a sideways swipe moves the day', () => {
  it('a swipe toward the left goes to the day before, toward the right to the day after', () => {
    expect(swipeDays(-80, 5)).toBe(-1)
    expect(swipeDays(80, -5)).toBe(1)
  })
  it('ignores a short swipe, a mostly vertical one and a tap', () => {
    expect(swipeDays(-30, 0)).toBe(0)
    expect(swipeDays(-80, 90)).toBe(0)
    expect(swipeDays(0, 0)).toBe(0)
  })
})

describe('shiftDay', () => {
  it('moves one day across month and year ends', () => {
    expect(shiftDay('2026-11-24', -1)).toBe('2026-11-23')
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('is not thrown by a clock change', () => {
    expect(shiftDay('2026-03-29', 1)).toBe('2026-03-30')
    expect(shiftDay('2026-10-25', -1)).toBe('2026-10-24')
  })
})

describe('weekOffsetOf: which week the picked day sits in, from the week of today', () => {
  // 2026-11-24 is a Tuesday; weeks start on Monday (1)
  it('today and its week are 0, the Sunday before is -1, next Monday is +1', () => {
    expect(weekOffsetOf('2026-11-24', '2026-11-24', 1)).toBe(0)
    expect(weekOffsetOf('2026-11-23', '2026-11-24', 1)).toBe(0)
    expect(weekOffsetOf('2026-11-22', '2026-11-24', 1)).toBe(-1)
    expect(weekOffsetOf('2026-11-29', '2026-11-24', 1)).toBe(0)
    expect(weekOffsetOf('2026-11-30', '2026-11-24', 1)).toBe(1)
  })
  it('follows a week that starts on Sunday', () => {
    expect(weekOffsetOf('2026-11-22', '2026-11-24', 0)).toBe(0)
    expect(weekOffsetOf('2026-11-21', '2026-11-24', 0)).toBe(-1)
  })
})
