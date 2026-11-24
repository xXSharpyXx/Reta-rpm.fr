// Swiping the day on Home: a sideways swipe on the week and the day under it moves the picked day
// one day, so the day before or after is one gesture away instead of a tap on the strip.
// The direction is the owner's: toward the left goes to the day before, toward the right to the day
// after (one constant, SWIPE_LEFT_IS_BEFORE, flips it).
export const SWIPE_MIN_PX = 50
export const SWIPE_LEFT_IS_BEFORE = true

/** -1 (the day before), +1 (the day after) or 0 for a swipe of (dx, dy) pixels: short or mostly vertical ones do nothing. */
export function swipeDays(dx, dy) {
  const ax = Math.abs(dx), ay = Math.abs(dy)
  if (ax < SWIPE_MIN_PX || ax < ay * 1.5) return 0
  const left = dx < 0
  return left === SWIPE_LEFT_IS_BEFORE ? -1 : 1
}

const dayNumber = iso => { const [y, m, d] = String(iso).split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000) }
const isoOfNumber = n => new Date(n * 86400000).toISOString().slice(0, 10)

/** The ISO day `delta` days from `iso`, in calendar days (a clock change does not matter). */
export const shiftDay = (iso, delta) => isoOfNumber(dayNumber(iso) + delta)

/**
 * How many weeks from today's week the week holding `iso` is (0 this week, -1 the one before),
 * for weeks that start on `weekStart` (0 Sunday, 1 Monday...).
 */
export function weekOffsetOf(iso, todayIso, weekStart = 1) {
  const today = dayNumber(todayIso)
  const dow = (today + 4) % 7                     // 1970-01-01 was a Thursday (4)
  const first = today - ((dow - weekStart + 7) % 7)
  return Math.floor((dayNumber(iso) - first) / 7)
}
