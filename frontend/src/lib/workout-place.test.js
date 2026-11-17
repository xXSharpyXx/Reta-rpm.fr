import { describe, it, expect } from 'vitest'
import { cleanPlace, placeOf, placesOf, PLACE_MAX } from './workout-place.js'

describe('workout place', () => {
  it('stores a trimmed name of bounded length', () => {
    expect(cleanPlace('  Basic-Fit   Lyon ')).toBe('Basic-Fit Lyon')
    expect(cleanPlace('x'.repeat(80))).toHaveLength(PLACE_MAX)
    expect(cleanPlace(null)).toBe('')
  })

  it('reads a workout without a place as none', () => {
    expect(placeOf({})).toBe('')
    expect(placeOf({ place: 42 })).toBe('')
    expect(placeOf({ place: ' Home gym ' })).toBe('Home gym')
  })

  it('offers the places used, newest first, then the gym cards, each once', () => {
    const S = {
      workouts: [
        { start: 1, place: 'Fitness Park' },
        { start: 3, place: 'Basic-Fit' },
        { start: 2, place: 'basic-fit' },
        { start: 4 },
      ],
      gymCards: [{ label: 'Basic-Fit' }, { label: 'Keep Cool' }, {}],
    }
    expect(placesOf(S)).toEqual(['Basic-Fit', 'Fitness Park', 'Keep Cool'])
    expect(placesOf({})).toEqual([])
  })
})
