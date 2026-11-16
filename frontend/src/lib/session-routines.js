import { uid } from './format.js'
import { modeOf, defaultConfig, isPerSide, entryRoutineId, setsFromRows } from './history.js'
import { isSideSet, isWarmupRow, hasCompletedWork, modeForEntry } from './workout-model.js'
import { routineSlotIndex, updateRoutineFromEntry } from './routines.js'

// A saved workout is evidence of what was logged, not a live routine. Copy only its flat
// exercise setup on this explicit action; finishing a workout never calls this helper.
const sessionEntries = session => Array.isArray(session?.entries) ? session.entries : []

function groupIds(ex) {
  const next = ex.map(entry => ({ ...entry }))
  let i = 0
  while (i < next.length) {
    const raw = next[i].sg
    if (raw == null || raw === '') { delete next[i].sg; i++; continue }
    const start = i
    while (i + 1 < next.length && next[i + 1].sg === raw) i++
    const end = i
    if (end === start) delete next[start].sg
    else {
      const mapped = `sg-${uid()}`
      for (let j = start; j <= end; j++) next[j].sg = mapped
    }
    i++
  }
  return next
}

const scalarGroup = value => {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value)
  return text ? text : null
}

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null
const positive = value => {
  const n = finite(value)
  return n != null && n > 0 ? n : null
}

// A flat per-side routine stores the total across both limbs. makeSideSet() then splits that
// total into two equal planned sides, so an odd/asymmetric logged total is rounded to the nearest
// representable even total. The copy keeps the target when only one limb was completed: a flat
// routine cannot encode partial completion or two different side prescriptions.
function perSideReps(row, target) {
  if (!isSideSet(row)) return positive(row?.r)
  const done = ['L', 'R'].filter(key => row.sides[key]?.done === true)
  if (done.length === 1) return evenTotal(target?.reps) ?? evenTotal(row.sides[done[0]]?.r)
  if (done.length < 2) return null
  return evenTotal(done.reduce((total, key) => total + (positive(row.sides[key]?.r) || 0), 0))
}

function evenTotal(value) {
  const n = positive(value)
  return n == null ? null : Math.max(2, 2 * Math.round(n / 2))
}

function perSideWeight(row) {
  if (!isSideSet(row)) return finite(row?.w)
  const done = ['L', 'R'].filter(key => row.sides[key]?.done === true)
  const weights = done.map(key => finite(row.sides[key]?.w)).filter(value => value != null)
  return weights.length ? Math.max(...weights) : null
}

function copiedEntry(entry, source) {
  const rows = Array.isArray(entry?.sets) ? entry.sets : []
  const work = rows.filter(row => !isWarmupRow(row))
  // A saved entry can retain planned rows after an early finish. Match history.js lastEntryFor:
  // only a fully completed work row may seed the copied target. A partially checked per-side row
  // is still retained by buildCompletedWorkout, but its two-limb state cannot fit a flat routine.
  const row = work.filter(candidate => candidate?.done === true).at(-1) || null
  const target = entry?.target && typeof entry.target === 'object'
    ? structuredClone(entry.target)
    : {}
  // Copy the mode that was logged, even if the catalogue's default has since changed (#678).
  const defaults = defaultConfig(entry?.id, modeForEntry(entry, modeOf({ ...target, id: entry?.id })))
  const cfg = { ...defaults, ...target, id: entry?.id, sets: Math.max(1, setsFromRows({ ...defaults, ...target }, work.length) || 1), warmupSets: rows.filter(isWarmupRow).length }
  const mode = modeOf(cfg)
  if (mode === 'time' && row) Object.assign(cfg, { sec: row.sec ?? cfg.sec, weight: row.w ?? cfg.weight ?? 0 })
  else if (mode === 'cardio' && row) Object.assign(cfg, { min: row.min ?? cfg.min, speed: row.speed ?? cfg.speed })
  else if (mode === 'reps') {
    const reps = row && isPerSide(cfg) ? perSideReps(row, cfg) : positive(row?.r)
    if (reps != null) cfg.reps = reps
    if (row) {
      const weight = perSideWeight(row)
      if (weight != null) cfg.weight = weight
    }
    if (isPerSide(cfg) && row == null) cfg.reps = evenTotal(cfg.reps) ?? cfg.reps
  }

  // A planned entry says what its routine asked for (`planned`, session-start.js), and the plan
  // owns a planned session's sets and reps. Today's target is the prescription and the rows are
  // what was done with it: a double-progression aim inside the range, a set the bodyweight
  // ceiling added, a bonus set, or reps carried over from last time. Copied as the new plan,
  // each of those reads as an edited plan on the copy's first session (nextPrescription):
  // "Plan changed", a range narrowed to the reps of one day, the climb started again. The copy
  // takes the plan's sets and reps instead, so it continues from where the source routine
  // stands. The weight is still the one lifted — history decides it either way.
  const planned = entry?.planned && typeof entry.planned === 'object' ? entry.planned : null
  if (planned) {
    cfg.sets = Math.max(1, positive(planned.sets) || 1)
    if (mode === 'reps' && positive(planned.reps) != null) {
      cfg.reps = planned.reps
      // A plan with no range has no bottom to keep, whatever the target carried.
      if (positive(planned.repsMin) != null) cfg.repsMin = planned.repsMin
      else delete cfg.repsMin
    }
    if (mode === 'time' && positive(planned.sec) != null) cfg.sec = planned.sec
  }
  // A rule set on the source routine rather than on the exercise decides how the plan is read:
  // a range is a double-progression aim there and a flat target under the default. A copy
  // without it would open 3 × 8–12 at 12. Each exercise keeps its own routine's rule, since a
  // combined session can hold routines that progress differently.
  if (!cfg.prog && typeof source?.prog === 'string' && source.prog) cfg.prog = source.prog

  // buildCompletedWorkout carries setup.sg inside target, while older records may carry it on
  // the entry. Keep either form, but never copy session-only ownership fields such as rid.
  const sg = scalarGroup(entry?.sg ?? target.sg)
  if (sg) cfg.sg = sg
  else delete cfg.sg
  // What a session stamps on its entries describes that session, not a plan. None of it belongs
  // in a routine: a copied `planned` or `rid` would tell the next session it had been built from
  // another plan or another routine.
  for (const key of SESSION_ONLY) delete cfg[key]
  return cfg
}

// `rowReps` is one session's per-set aim under triple progression (progression.js), not a plan.
const SESSION_ONLY = ['planned', 'plan', 'carried', 'rid', 'noProg', 'muscleSnapshot', 'rowReps']

// `routines` are the ones the session was built from, when they still exist: the rule each copied
// exercise is read under comes from there (see copiedEntry).
export function routineFromSession(session, name = session?.name, routines = []) {
  const byId = new Map((Array.isArray(routines) ? routines : []).filter(r => r?.id != null).map(r => [r.id, r]))
  const ex = groupIds(sessionEntries(session).filter(entry => entry?.sets?.length)
    .map(entry => copiedEntry(entry, byId.get(entryRoutineId(session, entry)))))
  if (!ex.length) throw new Error('no exercises')
  return { id: uid(), name: String(name || 'Workout').trim() || 'Workout', ex }
}

export function saveSessionAsRoutine(state, session, name) {
  const routine = routineFromSession(session, name, state.routines)
  state.routines.push(routine)
  return routine.id
}

// An exercise added in the middle of a routine's session (#592) is stamped `addedInSession` by
// the workout screen's Add exercise. Finishing offers to keep it in that routine for next time,
// once, on the summary; nothing is written unless that offer is taken (addToRoutine).
// One group per routine (a combined day can add to two), only exercises the routine does not
// have yet and that had a completed set: a skipped one was not part of the workout. A swap keeps
// its slot and is not an addition.
export function routineAdditions(active, routines = []) {
  const groups = new Map()
  for (const entry of sessionEntries(active)) {
    if (entry?.addedInSession !== true || !entry.rid || !(entry.sets || []).some(hasCompletedWork)) continue
    const routine = (Array.isArray(routines) ? routines : []).find(r => r?.id === entry.rid)
    if (!routine || !Array.isArray(routine.ex) || routine.ex.some(x => x?.id === entry.id)) continue
    if (!groups.has(routine.id)) groups.set(routine.id, { routine, entries: [] })
    const list = groups.get(routine.id).entries
    if (!list.some(e => e.id === entry.id)) list.push(entry)
  }
  // The setup copied the way Save as routine copies it (copiedEntry): sets, reps and weight as
  // done today, never what only described today's session.
  return [...groups.values()].map(({ routine, entries }) => ({
    routineId: routine.id, name: routine.name, ex: groupIds(entries.map(e => copiedEntry(e, routine))),
  }))
}

/** Append those exercises to the routine (a store draft), skipping any it has by now. Returns how many. */
export function addToRoutine(routine, ex) {
  if (!routine || !Array.isArray(routine.ex)) return 0
  const fresh = (Array.isArray(ex) ? ex : []).filter(cfg => cfg?.id != null && !routine.ex.some(x => x?.id === cfg.id))
  // groupIds again: a superset tag of the copies must not collide with one the routine has.
  routine.ex.push(...groupIds(fresh.map(cfg => structuredClone(cfg))))
  return fresh.length
}

// Superset tags are arbitrary ids: two lists group alike when the same neighbours share a tag.
function comparable(ex) {
  const tags = new Map()
  return JSON.stringify(ex.map(cfg => {
    const { sg, ...rest } = cfg || {}
    if (sg == null || sg === '') return rest
    if (!tags.has(sg)) tags.set(sg, tags.size)
    return { ...rest, sg: tags.get(sg) }
  }))
}

// One routine exercise as this session did it. An exercise that sits in the routine keeps its
// slot (reps, weight, progression and backups stay the plan's: progression moves those every
// session) and takes from the session what was changed by hand: the number of work sets, the
// warm-ups, the rest and the note. One added or swapped in is copied the way Save as routine
// copies it (copiedEntry).
function templateEntry(routine, entries, idx) {
  const entry = entries[idx]
  const at = routineSlotIndex(routine, entries, idx)
  if (at < 0) return copiedEntry(entry, routine)
  const draft = { ...routine, ex: routine.ex.map(cfg => structuredClone(cfg)) }
  updateRoutineFromEntry(draft, entries, idx)
  const slot = draft.ex[at]
  // Sets added or removed in the session move the plan by as many. Measured against today's
  // prescription, not the plan: a set the progression added by itself is not an edit.
  const work = (entry.sets || []).filter(row => !isWarmupRow(row)).length
  const today = positive(entry.target?.sets) ?? positive(slot.sets) ?? 1
  const delta = setsFromRows({ ...slot, id: slot.id }, work) - today
  if (delta) slot.sets = Math.max(1, (positive(slot.sets) || 1) + delta)
  const sg = scalarGroup(entry.sg)
  if (sg) slot.sg = sg
  else delete slot.sg
  return slot
}

/**
 * What finishing a routine's session offers (the summary's "Routine template"): keep the workout
 * just done as the routine's new template, or keep the routine as it is. One offer per routine
 * whose session differs from it (an exercise added, removed, swapped or moved, sets added or taken
 * away, warm-ups, rest or note changed), and only when that routine had a completed set: a session
 * that never started is not a model. Nothing is written here (applyTemplate does that).
 * Each offer is `{ routineId, name, ex, added, removed }`, `added`/`removed` being exercise ids.
 */
export function routineTemplates(active, routines = []) {
  const entries = sessionEntries(active)
  const out = []
  for (const routine of Array.isArray(routines) ? routines : []) {
    if (!routine || !Array.isArray(routine.ex)) continue
    const own = entries.map((entry, idx) => ({ entry, idx })).filter(x => x.entry?.rid === routine.id)
    if (!own.some(x => (x.entry.sets || []).some(hasCompletedWork))) continue
    const ex = own.map(x => templateEntry(routine, entries, x.idx))
    if (comparable(ex) === comparable(routine.ex)) continue
    const before = routine.ex.map(cfg => cfg?.id)
    const after = ex.map(cfg => cfg.id)
    out.push({
      routineId: routine.id,
      name: routine.name,
      ex: groupIds(ex),
      added: [...new Set(after.filter(id => !before.includes(id)))],
      removed: [...new Set(before.filter(id => !after.includes(id)))],
    })
  }
  return out
}

/** Make `ex` the routine's exercises (a store draft). Returns the exercises it replaced, for an Undo. */
export function applyTemplate(routine, ex) {
  if (!routine || !Array.isArray(routine.ex) || !Array.isArray(ex)) return null
  const previous = routine.ex
  routine.ex = ex.map(cfg => structuredClone(cfg))
  return previous
}
