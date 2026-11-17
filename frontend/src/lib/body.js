// The Body page (views/Body.jsx): the last weigh-in with what the scale measured that day, and the
// weight and body-fat curves. Pure: it only reads S.bodyweight (in the profile's unit),
// S.bodyComp and S.bodyHeight (from Health Connect, lib/health-read.js mergeBodyComp) and the body
// fat of a measurement check-in (lib/measurements.js), which wins on a day that has both.
import { weighInAt } from './bodyweight.js'
import { LB_PER_KG } from './health-read.js'

const dayMs = d => new Date(d + 'T12:00:00').getTime()
const list = v => (Array.isArray(v) ? v.filter(e => e && typeof e.d === 'string') : [])

/** Body mass index from a weight in kg and a height in metres, to one decimal; null without both. */
export function bmiOf(kg, m) {
  if (!(kg > 0) || !(m > 0)) return null
  return Math.round((kg / (m * m)) * 10) / 10
}

/** The body fat by day: the scale's, or a measurement check-in's on a day that has one. */
function fatByDay(S) {
  const out = new Map()
  for (const e of list(S.bodyComp)) if (e.fat > 0) out.set(e.d, e.fat)
  for (const e of list(S.measurements)) if (e.bodyFat > 0) out.set(e.d, e.bodyFat)
  return out
}

/** Chart points { t, y, d } of the weight (profile unit) since `from` (ms, 0 = all). */
export function weightSeries(S, from = 0) {
  return list(S.bodyweight).filter(b => b.w > 0)
    .map(b => ({ t: weighInAt(b), y: b.w, d: b.d }))
    .filter(p => p.t >= from)
    .sort((a, b) => a.t - b.t)
}

/** Chart points { t, y, d } of the body fat in % since `from`. */
export function fatSeries(S, from = 0) {
  return [...fatByDay(S)].map(([d, y]) => ({ t: dayMs(d), y, d }))
    .filter(p => p.t >= from)
    .sort((a, b) => a.t - b.t)
}

/**
 * The last weigh-in and what goes with it: { d, w, fat, lean, bone, water, bmr, bmi, delta }.
 * Masses in the profile's unit; `delta` is the change in weight since the weigh-in before.
 * The day's composition is taken from that same day only; null when nothing was weighed.
 */
export function latestBody(S) {
  const unit = S?.unit === 'lb' ? 'lb' : 'kg'
  const toUnit = kg => (kg > 0 ? Math.round((unit === 'lb' ? kg * LB_PER_KG : kg) * 10) / 10 : null)
  const ws = weightSeries(S)
  const comp = list(S.bodyComp)
  const last = ws.at(-1)
  // A day with a composition but no weight (a scale that wrote only the fat) still counts.
  const lastComp = comp.reduce((m, e) => (!m || e.d > m.d ? e : m), null)
  const d = last && (!lastComp || last.d >= lastComp.d) ? last.d : lastComp?.d
  if (!d) return null
  const c = comp.find(e => e.d === d) || {}
  const w = last && last.d === d ? last.y : null
  const prev = w != null ? ws.at(-2) : null
  const kg = w != null ? (unit === 'lb' ? w / LB_PER_KG : w) : null
  return {
    d, w,
    fat: fatByDay(S).get(d) ?? null,
    lean: toUnit(c.lean), bone: toUnit(c.bone), water: toUnit(c.water),
    bmr: c.bmr > 0 ? c.bmr : null,
    bmi: bmiOf(kg, Number(S.bodyHeight?.m)),
    delta: prev ? Math.round((w - prev.y) * 10) / 10 : null,
  }
}
