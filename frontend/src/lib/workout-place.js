// Where a workout was done (owner, 2026-11-17): the gym picked on the finish screen, as a name.
//
//   workout.place   string  "Basic-Fit Lyon Part-Dieu", up to PLACE_MAX characters
//
// Not the machines of lib/gyms.js (S.gyms, entry.gym), which say which cable stack an exercise
// was done on and steer its weights. This is only a label on the session, kept by name so a
// backup or another device reads it as it is. The finish screen offers the places used before
// and the gym cards' labels (views/CheckIn.jsx) as one-tap choices.
export const PLACE_MAX = 40
const SUGGEST_MAX = 8

/** A place name as it is stored: trimmed, one space between words, at most PLACE_MAX characters. */
export const cleanPlace = s => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, PLACE_MAX)

/** The place of a saved workout, or '' for one without (or with something unreadable). */
export const placeOf = w => (typeof w?.place === 'string' ? cleanPlace(w.place) : '')

/**
 * The places to offer: the ones workouts were done at, the most recent first, then the labels of
 * the gym cards not already in the list. Each name once, whatever its case; at most eight.
 */
export function placesOf(S) {
  const out = [], seen = new Set()
  const add = name => {
    const p = cleanPlace(name)
    const k = p.toLocaleLowerCase()
    if (!p || seen.has(k)) return
    seen.add(k); out.push(p)
  }
  const ws = Array.isArray(S?.workouts) ? S.workouts : []
  const dated = ws.filter(w => placeOf(w)).sort((a, b) => (Number(b.start) || 0) - (Number(a.start) || 0))
  for (const w of dated) add(w.place)
  for (const c of Array.isArray(S?.gymCards) ? S.gymCards : []) add(c?.label)
  return out.slice(0, SUGGEST_MAX)
}
