// What the lifter chose at the end of a workout for the next session of an exercise: the weight and
// reps it should open at, which may be the automatic progression's proposal, the weight just
// lifted, or numbers typed by hand. It lives on the saved workout's entry as `next: { w, r }`, so it
// travels with the history that already syncs, and it expires by itself: progression only ever
// reads the last session of an exercise (lib/progression.js nextPrescription), and the next saved
// session has no `next` unless its own summary sets one.
import { sameWorkout } from './workout-date.js'
import { stampWorkout } from './sync-merge.js'

const okNumber = v => typeof v === 'number' && Number.isFinite(v)

/** The entry's choice when it holds up (a weight of 0 or more, at least one rep), else null. */
export function nextChoiceOf (entry) {
  const n = entry && entry.next
  if (!n || typeof n !== 'object') return null
  return okNumber(n.w) && n.w >= 0 && okNumber(n.r) && n.r >= 1 ? { w: n.w, r: n.r } : null
}

/** The workout with every entry's choice left out: what the automatic progression would say. */
export function withoutNextChoice (workout) {
  if (!workout || !Array.isArray(workout.entries) || !workout.entries.some(e => e && 'next' in e)) return workout
  return { ...workout, entries: workout.entries.map(e => { if (!e || !('next' in e)) return e; const { next, ...rest } = e; return rest }) }
}

const sameChoice = (a, b) => (a === null && b === null) || (!!a && !!b && a.w === b.w && a.r === b.r)

/**
 * The history after the choices for `ref`'s entries are set (a `null` choice removes one).
 * `choices` is [{ id, rid?, choice }]: an entry is found by exercise id and, when given, the routine
 * it came from, since a combined day can hold the same exercise twice. Stamped like every edit of a
 * saved workout. Returns null when nothing changes, the workout is not there, or a choice does not
 * hold up.
 */
export function setNextChoices (workouts, ref, choices, now = Date.now()) {
  const list = Array.isArray(workouts) ? workouts : []
  const current = list.find(w => sameWorkout(w, ref))
  if (!current || !Array.isArray(current.entries)) return null
  const entries = current.entries.slice()
  let changed = false
  for (const { id, rid, choice } of choices || []) {
    if (choice !== null && !nextChoiceOf({ next: choice })) return null
    const at = entries.findIndex(e => e && e.id === id && (rid == null || e.rid === rid))
    if (at < 0) continue
    const had = nextChoiceOf(entries[at])
    if (sameChoice(had, choice)) continue
    const { next, ...rest } = entries[at]
    entries[at] = choice ? { ...rest, next: { w: choice.w, r: choice.r } } : rest
    changed = true
  }
  if (!changed) return null
  const edited = stampWorkout({ ...current, entries }, now)
  return list.map(w => (w === current ? edited : w))
}
