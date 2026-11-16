// What today holds, for the Workouts page's "today" card (views/Plan.jsx): the routines planned
// for the day (a weekday can hold several, a coach week puts its next session in front), whether
// that plan was moved for the day, whether it is already done, and on a rest day the next session.
//
// "Done" means today's plan is covered, not just that something was logged: a freestyle session
// on a planned day, or the first session of a rotation whose next one is today's too, leaves the
// plan offered. A queue session is never covered by an earlier workout: the queue only names one
// it does not count as done yet. On a rest day the last session logged today is the day's.
import { effectiveRoutines, effectiveRoutineIds, nextTrainingDay } from './history.js'
import { queueOf, pinState } from './queue.js'

export function todaySession(S, today) {
  const routines = effectiveRoutines(S, today)
  const ids = effectiveRoutineIds(S, today)
  const name = routines.map(r => r.name).join(' + ')
  // A fulfilled pin (a coach session pinned to today and since done) reads as no override.
  const rescheduled = S.dayPlan?.[today] !== undefined && pinState(S, S.dayPlan[today]) !== 'done'
  const logged = (S.workouts || []).filter(w => w.d === today)
  const queueIds = queueOf(S)?.ids || []
  const covered = id => !queueIds.includes(id) && logged.some(w => (Array.isArray(w.routineIds) ? w.routineIds : [w.routineId]).includes(id))
  const done = (routines.every(r => covered(r.id)) && logged.at(-1)) || null
  const next = routines.length ? null : nextTrainingDay(S, today)
  return { routines, ids, name, rescheduled, done, next }
}
