import { FATIGUE_STATES, fatigueHalfLifeOf } from './recovery.js'
import { dateLocale } from './i18n-core.js'

/**
 * Select the consumer-facing fatigue state for one numeric recovery value.
 * Values below .25 are ready, .25 through .5 are recovering, and values above .5 are fatigued.
 * Keeping this boundary selector in production code prevents views and tests from drifting apart.
 *
 * @param {number} value Numeric fatigue value from fatigueOf().
 * @returns {'ready'|'recovering'|'fatigued'} The stable state label for the UI.
 */
export function fatigueStateOf(value) {
  return value < 0.25
    ? FATIGUE_STATES.READY
    : value <= 0.5
      ? FATIGUE_STATES.RECOVERING
      : FATIGUE_STATES.FATIGUED
}

// Boundaries fatigueStateOf draws: below READY_BELOW the muscle reads ready,
// at or below RECOVERING_BELOW (but above ready) it reads recovering.
export const FATIGUE_READY_BELOW = 0.25
export const FATIGUE_RECOVERING_BELOW = 0.5
