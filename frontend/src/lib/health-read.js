// What openGym takes back from the phone's health hub (#544, #127): Health Connect on Android,
// Apple Health on the iPhone. Two things, each behind its own switch in Settings:
//
//   - the heart rate during a finished workout, per set and for the session (lib/heart-rate.js
//     works out which samples belong to which set), for every watch that saves to the hub;
//   - weigh-ins other apps saved there (a smart scale's, Garmin's, Withings', Samsung's...).
//
// Pure: lib/health-sync.js reads the hub and hands the records over; this decides what goes into
// the log. The rules:
//   - a set that already has a heart rate keeps it (the Apple Watch measured it live);
//   - a day with a weigh-in typed into openGym keeps it: an imported one never replaces it, and
//     one typed in later replaces the imported one (lib/sync-merge.js mergeBodyweight);
//   - openGym's own records in the hub (what it wrote there itself) are never read back as new;
//   - an imported weigh-in carries `src` and is never written back to the hub (no ping-pong:
//     lib/health-connect.js healthRecords leaves it out).
import { hrFromSamples, sanitizeHr } from './heart-rate.js'
import { stampWorkout } from './sync-merge.js'
import { isoOf } from './format.js'

export const LB_PER_KG = 2.2046226218
// Weigh-ins outside this are a typo or another person's profile in the hub, not a body weight.
const KG_MIN = 20
const KG_MAX = 400
// Packages and bundle ids that are openGym: the app, its test build, the Apple Watch app.
const OWN = /^ch\.duartesantos\.opengym(\.|$)/

/** Whether a record in the hub is one openGym wrote itself (by its client id or by its origin). */
export function isOwnRecord(rec) {
  if (!rec || typeof rec !== 'object') return false
  if (/^opengym-/.test(String(rec.clientId || ''))) return true
  return OWN.test(String(rec.origin || ''))
}

/**
 * The heart rate read for workout `wid` (`samples`: [ms, bpm] from the hub) put into the log `S`
 * (mutated). Only sets without a reading get one; the session's reading is set when the workout
 * has none, or replaced by a fuller one from the same hub (Garmin and Fitbit sync late, so a
 * read right after the workout can hold only part of it). One the watch took is never replaced.
 * The workout is stamped as edited, so a sync keeps the change. Returns whether anything changed.
 */
export function mergeHeartRate(S, wid, samples, src, now = Date.now()) {
  const w = (S?.workouts || []).find(x => x && x.id === wid)
  if (!w) return false
  const res = hrFromSamples(w, samples)
  let changed = false
  for (const [key, got] of res.sets) {
    const [ei, si] = key.split(':').map(Number)
    const set = w.entries?.[ei]?.sets?.[si]
    if (!set) continue
    if (got.hr && !sanitizeHr(set.hr)) { set.hr = got.hr; changed = true }
    if (got.restHr && !sanitizeHr(set.restHr)) { set.restHr = got.restHr; changed = true }
  }
  if (res.session) {
    const cur = w.hr && typeof w.hr === 'object' ? w.hr : null
    const fuller = !cur || (cur.src === src && res.n > (Number(cur.n) || 0))
    if (fuller && cur?.src !== 'watch') {
      w.hr = { ...res.session, src, n: res.n }
      changed = true
    }
  }
  if (changed) stampWorkout(w, now)
  return changed
}

/** Whether a workout still has sets the hub could fill: one done and without a heart rate. */
export function lacksHeartRate(w) {
  if (!w || typeof w !== 'object') return false
  if (!w.hr) return true
  return (w.entries || []).some(e => (e?.sets || []).some(s => s && (s.done === true || s.sides) && !sanitizeHr(s.hr)))
}

/**
 * Weigh-ins from the hub (`records`: [{ t, kg, id, origin, clientId }]) put into the log `S`
 * (mutated), at most one per day: the latest of that day. `seen` is this phone's memo of what it
 * imported ({ [day]: { id, t } }), updated in place, which makes a second read of the same records
 * a no-op. A day is left alone when it has a weigh-in typed into openGym, when the weigh-in was
 * deleted in openGym after the record was taken, or when the record is not newer than the one
 * already imported for it. Weights go in in the profile's unit. Returns the days changed.
 */
export function mergeWeighIns(S, records, { src, seen = {} } = {}) {
  const unit = S?.unit === 'lb' ? 'lb' : 'kg'
  const latest = new Map()
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || isOwnRecord(r)) continue
    const t = Number(r.t), kg = Number(r.kg)
    if (!(t > 0) || !(kg >= KG_MIN && kg <= KG_MAX)) continue
    const d = isoOf(new Date(t))
    const cur = latest.get(d)
    if (!cur || t > cur.t) latest.set(d, { t, kg, id: r.id || null })
  }
  if (!latest.size) return []
  if (!Array.isArray(S.bodyweight)) S.bodyweight = []
  const deleted = S.deleted?.bodyweight && typeof S.deleted.bodyweight === 'object' ? S.deleted.bodyweight : {}
  const days = []
  for (const [d, r] of latest) {
    const ex = S.bodyweight.find(b => b && b.d === d)
    if (ex && !ex.src) continue                           // typed in: it wins
    if (Number(deleted[d]) > r.t && !ex) continue         // removed in openGym after it was taken
    const before = seen[d] ? Number(seen[d].t) : ex ? Number(ex.t) || 0 : 0
    if (ex && !(r.t > before)) continue
    if (!ex && seen[d] && !(r.t > Number(seen[d].t))) continue
    const w = Math.round((unit === 'lb' ? r.kg * LB_PER_KG : r.kg) * 10) / 10
    if (ex) { ex.w = w; ex.t = r.t; ex.src = src }
    else S.bodyweight.push({ d, w, t: r.t, src })
    seen[d] = { id: r.id, t: r.t }
    days.push(d)
  }
  if (days.length) S.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
  return days
}

/* ------------------------------------------------------------ body composition (Renpho...) -- */

// What a smart scale's app saves next to the weight (Renpho Health, Withings, Eufy...), as the
// Android plugin reads it (readBody): fat in %, lean, bone and water in kg, bmr in kcal a day,
// height in metres. Outside these bounds it is a typo or someone else's profile in the hub.
export const BODY_TYPES = {
  fat: { min: 2, max: 75, round: 10 },
  lean: { min: 10, max: 250, round: 100 },
  bone: { min: 0.5, max: 15, round: 100 },
  water: { min: 5, max: 200, round: 100 },
  bmr: { min: 400, max: 6000, round: 1 },
  height: { min: 0.8, max: 2.6, round: 1000 },
}

/**
 * Body-composition readings from the hub (`records`: [{ type, t, v, id, origin, clientId }]) put
 * into `S.bodyComp` (mutated): one entry per day, { d, t, src, fat?, lean?, bone?, water?, bmr? },
 * each value the latest of its day, `t` the newest reading in it. Reading the same records again
 * changes nothing, so a resync never makes a duplicate. The height is kept apart, in `S.bodyHeight`
 * ({ m, t }), the newest one: a scale app writes it once, at setup. Returns the days changed (and
 * 'height' when the height changed).
 */
export function mergeBodyComp(S, records, { src = 'hc' } = {}) {
  const days = new Map()   // day -> { type -> { t, v } }
  let height = null
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || isOwnRecord(r)) continue
    const spec = BODY_TYPES[r.type]
    const t = Number(r.t), v = Number(r.v)
    if (!spec || !(t > 0) || !(v >= spec.min && v <= spec.max)) continue
    const value = Math.round(v * spec.round) / spec.round
    if (r.type === 'height') {
      if (!height || t > height.t) height = { m: value, t }
      continue
    }
    const d = isoOf(new Date(t))
    const day = days.get(d) || {}
    if (!day[r.type] || t > day[r.type].t) day[r.type] = { t, v: value }
    days.set(d, day)
  }
  const changed = []
  if (height) {
    const cur = S.bodyHeight
    if (!cur || (height.t >= Number(cur.t || 0) && (cur.m !== height.m || cur.t !== height.t))) {
      S.bodyHeight = height
      changed.push('height')
    }
  }
  if (!days.size) return changed
  if (!Array.isArray(S.bodyComp)) S.bodyComp = []
  for (const [d, day] of days) {
    let ex = S.bodyComp.find(e => e && e.d === d)
    let touched = false
    if (!ex) { ex = { d, t: 0, src }; S.bodyComp.push(ex); touched = true }
    for (const [type, r] of Object.entries(day)) {
      if (ex[type] === r.v) continue
      ex[type] = r.v
      touched = true
    }
    const newest = Math.max(Number(ex.t) || 0, ...Object.values(day).map(r => r.t))
    if (newest !== ex.t) { ex.t = newest; touched = true }
    if (touched) changed.push(d)
  }
  if (changed.some(d => d !== 'height')) S.bodyComp.sort((a, b) => (a.d < b.d ? -1 : 1))
  return changed
}
