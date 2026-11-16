// When each routine was last done, for the Workouts page's list of sessions (views/Plan.jsx):
// "last time 3 days ago" under a session's name, so picking another one than the day's is easy.

/** The latest day (ISO) a saved workout ran this routine, or null. */
export function lastDoneOf(workouts, routineId) {
  let last = null
  for (const w of workouts || []) {
    const ids = [].concat(w.routineIds ?? (w.routineId ? [w.routineId] : []))
    if (ids.includes(routineId) && w.d && (!last || w.d > last)) last = w.d
  }
  return last
}
