import { uid } from './format.js'
import { modeOf, defaultConfig, isPerSide, entryRoutineId, setsFromRows } from './history.js'
import { isSideSet, isWarmupRow, hasCompletedWork, modeForEntry } from './workout-model.js'

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

/* ---------- the workout just done as the routine's new template (owner, 2026-11-17) ---------- */
// At the finish the summary asks, per routine of the session, whether to keep what was just done
// as that routine's template or to keep the template as it is. "What was just done" is the
// exercises with at least one completed work set, in the order they were done, with the number of
// work sets done and the supersets they were done in. An exercise the routine already has keeps its
// own slot (its reps, weight, progression rule, rest and note), with only its set count and its
// superset changed; one added or swapped in gets the setup it was done with (copiedEntry); one
// skipped leaves the template. Nothing is written unless the summary's button is tapped.

const doneWork = entry => (Array.isArray(entry?.sets) ? entry.sets : []).filter(row => !isWarmupRow(row) && hasCompletedWork(row))

/** The routine's exercise list as the session `session` (a saved workout) did it. */
export function templateFromSession(routine, session) {
  if (!routine || !Array.isArray(routine.ex)) return []
  const used = new Set()
  const ex = sessionEntries(session)
    .filter(entry => entry?.id != null && entryRoutineId(session, entry) === routine.id && doneWork(entry).length)
    .map(entry => {
      const at = routine.ex.findIndex((slot, i) => !used.has(i) && slot?.id === entry.id)
      if (at < 0) return copiedEntry(entry, routine)
      used.add(at)
      const cfg = structuredClone(routine.ex[at])
      const sets = setsFromRows(cfg, doneWork(entry).length)
      if (sets > 0) cfg.sets = sets
      const sg = scalarGroup(entry.sg ?? entry.target?.sg)
      if (sg) cfg.sg = sg
      else delete cfg.sg
      return cfg
    })
  return groupIds(ex)
}

// Two exercises are in one superset in a list when they are neighbours with the same tag.
const pairs = ex => ex.map((x, i) => (i > 0 && x.sg && x.sg === ex[i - 1].sg ? ex[i - 1].id + '+' + x.id : null)).filter(Boolean).join(',')

/**
 * How the session differs from the routine's template, or null when it does not (nothing to ask).
 * `{ ex, added, removed, sets: [{ id, from, to }], reordered, supersets }`: `ex` is the list to
 * write, the others say what changes, by exercise id.
 */
export function templateChanges(routine, session) {
  const ex = templateFromSession(routine, session)
  if (!ex.length || !Array.isArray(routine?.ex)) return null
  const before = routine.ex.filter(x => x?.id != null)
  const ids = list => list.map(x => x.id)
  const added = ids(ex).filter(id => !before.some(x => x.id === id))
  const removed = ids(before).filter(id => !ex.some(x => x.id === id))
  const sets = ex.map(x => {
    const old = before.find(y => y.id === x.id)
    const from = old ? Math.max(1, Math.round(Number(old.sets)) || 1) : null
    return old && from !== x.sets ? { id: x.id, from, to: x.sets } : null
  }).filter(Boolean)
  const kept = ids(ex).filter(id => !added.includes(id))
  const reordered = kept.join(',') !== ids(before).filter(id => !removed.includes(id)).join(',')
  const supersets = pairs(ex) !== pairs(before)
  if (!added.length && !removed.length && !sets.length && !reordered && !supersets) return null
  return { ex, added, removed, sets, reordered, supersets }
}

/** Write `ex` (from templateChanges) as the routine's exercises, on a store draft. */
export function applyTemplate(routine, ex) {
  if (!routine || !Array.isArray(ex) || !ex.length) return false
  routine.ex = groupIds(ex.map(cfg => structuredClone(cfg)))
  return true
}

/**
 * The routine's exercises for the next session, as the finish recap proposes them: the routine as it
 * is, with what the session changed (`changes`, from templateChanges) applied only where asked.
 * `drop`: skipped exercises to take out (they stay otherwise). `add`: new exercises to put in, with
 * the setup they were done with (they stay out otherwise). `today`: take the session's order and
 * set counts; a skipped exercise that stays is slotted back after its neighbour in the routine.
 * Returns a new list; the routine is not touched.
 */
export function planEx(routine, changes, { drop = [], add = [], today = false } = {}) {
  const base = (routine?.ex || []).filter(x => x?.id != null)
  const clone = x => structuredClone(x)
  const added = new Set(changes?.added || [])
  const wantAdded = x => !added.has(x.id) || add.includes(x.id)
  if (!today) {
    const kept = base.filter(x => !drop.includes(x.id)).map(clone)
    const fresh = (changes?.ex || []).filter(x => added.has(x.id) && add.includes(x.id)).map(clone)
    return groupIds([...kept, ...fresh])
  }
  const list = (changes?.ex || []).filter(wantAdded).map(clone)
  for (const id of changes?.removed || []) {
    if (drop.includes(id)) continue
    const at = base.findIndex(x => x.id === id)
    if (at < 0) continue
    let place = 0
    for (let j = at - 1; j >= 0; j--) {
      const k = list.findIndex(x => x.id === base[j].id)
      if (k >= 0) { place = k + 1; break }
    }
    list.splice(place, 0, clone(base[at]))
  }
  return groupIds(list)
}

/**
 * What a template change (templateChanges) amounts to, counted for the one-line question at the
 * finish: exercises added and left out, sets added and removed over the exercises kept, and
 * whether the order or the supersets moved.
 */
export function templateChangeCounts(changes) {
  const c = changes || {}
  let setsAdded = 0, setsRemoved = 0
  for (const x of c.sets || []) {
    const d = (Number(x?.to) || 0) - (Number(x?.from) || 0)
    if (d > 0) setsAdded += d; else setsRemoved -= d
  }
  return {
    added: (c.added || []).length, removed: (c.removed || []).length,
    setsAdded, setsRemoved, reordered: !!c.reordered, supersets: !!c.supersets,
  }
}
