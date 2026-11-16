// A saved workout read back as a table, one row per set (components/WorkoutSummary.jsx): the set
// number, the weight with its unit, the reps, and the marks a row can carry (failure, the record).
// Pure, so the reading of a logged session is tested here and every screen shows it the same way.
import { fmtNum } from './format.js'
import { fmtSpeed } from './speed.js'
import { t } from './i18n-core.js'
import { modeOf, isBw, fmtSec, EFFORT } from './history.js'
import { hrLabel } from './heart-rate.js'
import { isWarmupRow, isFailureSet, hasCompletedWork, isSideSet, dropsOf, clustersOf } from './workout-model.js'
import { dbLoadOf, bellsIn } from './dumbbells.js'

const EXPLICIT_MODES = new Set(['reps', 'time', 'cardio'])
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** How a set of this entry is read: 'reps', 'time' or 'cardio', as setLabel reads it. */
export function entryKind(entry) {
  const cfg = entry?.target
  const c = cfg ? { ...cfg, id: cfg.id ?? entry?.id } : { id: entry?.id }
  let mode = modeOf(c)
  const sets = (entry?.sets || []).filter(hasCompletedWork)
  if (!cfg && sets.length && sets.every(s => !(s.r > 0))) {
    if (sets.some(s => s.min > 0 || s.speed > 0)) mode = 'cardio'
    else if (sets.some(s => s.sec > 0)) mode = 'time'
  }
  if (!EXPLICIT_MODES.has(cfg?.mode) && mode !== 'reps' && sets.some(s => s.r > 0 && !(s.min > 0 || s.speed > 0 || s.sec > 0))) mode = 'reps'
  return mode === 'cardio' || mode === 'time' ? mode : 'reps'
}

/** 'each' when the weights are one dumbbell's, 'total' when both together, else null. */
export function perBellOf(entry) {
  const cfg = entry?.target
  const c = cfg ? { ...cfg, id: cfg.id ?? entry?.id } : { id: entry?.id }
  if (isBw(c) || bellsIn(c) !== 2) return null
  const m = dbLoadOf(c.dbLoad)
  return m === 'each' || m === 'total' ? m : null
}

// How hard the set felt, when it was rated: "RPE 8", "RIR 2".
const effortOf = s => {
  const k = s.rir != null ? 'rir' : s.rpe != null ? 'rpe' : null
  return k ? `${EFFORT[k].hd} ${fmtNum(s[k])}` : ''
}

// The heaviest load of one set: a side set's heavier side, otherwise its own weight.
const loadOf = s => (isSideSet(s) ? Math.max(num(s.sides.L.w), num(s.sides.R.w)) : num(s.w))

/**
 * The set that made the workout's record on this exercise. A PR is a heavier top set
 * (finishWorkout: beatsWeight on the session's heaviest weight), so it is the first work set that
 * reached that weight. -1 when the entry has none (a hold, cardio, or nothing done).
 */
export function prSetIndex(entry) {
  if (entryKind(entry) !== 'reps') return -1
  const sets = entry?.sets || []
  let best = -1, at = -1
  sets.forEach((s, i) => {
    if (!hasCompletedWork(s) || isWarmupRow(s)) return
    const w = loadOf(s)
    if (w > best) { best = w; at = i }
  })
  return best > 0 ? at : -1
}

// A rest-pause set's reps as its bursts ("10+4+2"), the way setLabel writes them.
function repsText(side, planned) {
  const reps = num(side.r)
  const bursts = clustersOf(side).map(b => num(b?.r)).filter(r => r > 0)
  const sum = bursts.reduce((a, b) => a + b, 0)
  if (!bursts.length || sum > reps || (planned && sum !== reps)) return String(reps)
  return (reps > sum ? [reps - sum, ...bursts] : bursts).join('+')
}

/**
 * The rows of one exercise. `isPr` says whether the workout lists this exercise as a record.
 * Each row: { i, n, warm, weight, reps, fail, pr, extra, effort, hr }. `n` is the work set's number, 1 on;
 * a warm-up is marked by `warm` and numbered among the warm-ups.
 */
export function summaryRows(entry, { unit = 'kg', speedUnit = 'kmh', isPr = false } = {}) {
  const kind = entryKind(entry)
  const cfg = entry?.target || {}
  const c = { ...cfg, id: cfg.id ?? entry?.id }
  const bw = kind === 'reps' && isBw(c)
  const planned = cfg.intensifier?.type === 'restpause'
  const prAt = isPr ? prSetIndex(entry) : -1
  const kg = w => fmtNum(w) + ' ' + unit
  const weightOf = w => (bw ? (w > 0 ? '+' + kg(w) : t('Body weight')) : kg(w))
  let work = 0, warm = 0
  const rows = []
  ;(entry?.sets || []).forEach((s, i) => {
    if (!hasCompletedWork(s)) return
    const isWarm = !!isWarmupRow(s)
    const n = isWarm ? ++warm : ++work
    const row = { i, n, warm: isWarm, weight: '', reps: '', fail: !!isFailureSet(s), pr: i === prAt, extra: '', effort: effortOf(s), hr: hrLabel(s).trim() }
    if (kind === 'cardio') {
      row.weight = num(s.min) + ' min'
      row.reps = fmtSpeed(num(s.speed), speedUnit)
    } else if (kind === 'time') {
      row.weight = num(s.w) > 0 ? kg(num(s.w)) : '–'
      row.reps = fmtSec(num(s.sec))
    } else if (isSideSet(s)) {
      const L = s.sides.L, R = s.sides.R
      row.weight = num(L.w) === num(R.w) ? weightOf(num(L.w)) : `${t('L')} ${fmtNum(num(L.w))} · ${t('R')} ${weightOf(num(R.w))}`
      row.reps = `${t('L')} ${L.done ? repsText(L, planned) : '–'} · ${t('R')} ${R.done ? repsText(R, planned) : '–'}`
    } else {
      row.weight = weightOf(num(s.w))
      row.reps = repsText(s, planned)
    }
    if (kind === 'reps') {
      const sides = isSideSet(s) ? [s.sides.L, s.sides.R] : [s]
      const drops = sides.flatMap(side => dropsOf(side).filter(d => num(d?.r) > 0))
      if (drops.length) row.extra = drops.map(d => '↘ ' + weightOf(num(d.w)) + ' × ' + num(d.r)).join('   ')
    }
    rows.push(row)
  })
  return { kind, perBell: perBellOf(entry), rows }
}
