// The running workout on the iPhone's Lock Screen and in the Dynamic Island (a Live Activity), the
// page's side (native: ios/App/App/LiveActivityPlugin.swift and WorkoutActivity.swift, the views in
// ios/App/OpenGymWidgets). An Apple Watch shows the same activity in its Smart Stack.
//
// Page → activity: while a workout runs, its state as the Lock Screen shows it (the set to do now
// and the few after it, the rest's end, how far along the session is) whenever that changes. The
// rest counts down on the Lock Screen by itself (Text(timerInterval:)), so nothing is sent per
// second.
//
// Activity → page: its Done button ticks the set it shows. iOS runs that in the app (an App Intent)
// even with the page asleep, so the native side queues it as a small event ({ id, type: 'setDone',
// wid, exId, entryIdx, setIdx, at }), moves the activity on to the next set itself, and the page
// applies the event when it can: through the workout screen's own tick (bindLiveActions), the one
// a tap in the app runs (rest timer, the high-water mark, the end-of-workout sheet), never a second
// copy of it. Each event is applied once, by its id, and only then acknowledged, which takes it out
// of the native queue; until the workout screen is there to apply it, it waits there.
// Next to Done sits one smaller button: Skip rest while a rest runs ({ type: 'restSkip', wid, at }),
// otherwise Next exercise ({ type: 'next', wid, fromEntryIdx, at }), which moves on to the next
// exercise without ticking anything (Discord: Done read like "finish", and there was no way to
// leave a machine somebody else took). The native side moves the activity on by itself for both.
//
// Text only: no exercise animations or pictures (Gym visual licence).
//
// The Android app takes the same calls (LiveSessionPlugin.java, LiveSessionService.java): a silent
// "Workout in progress" notification on the lock screen, a Live Update on Android 16, with +30 s,
// Skip rest and Set done. There it also runs the rest's countdown and its end (one short buzz), so
// useUI books no separate rest alert while it is on (lockScreenOwnsRest). Settings can switch it off.
import { MOBILE, nativePlatform } from './mobile.js'
import { EXIDX } from './exercises.js'
import { t } from './i18n.js'
import { exerciseNameText } from './format.js'
import { setLabel, supersetUnits } from './history.js'
import { isWarmupRow } from './workout-model.js'
import { nextUnfinishedUnit, restSecFor } from './supersetFlow.js'
import { speedUnitOf } from './speed.js'
import { accentPair, accentValue } from './accent.js'
import { gymNameOf } from './gyms.js'
import { fmtNum } from './format.js'
import { isBw, fmtSec } from './history.js'
import { entryKind, perBellOf } from './workout-summary.js'
import { askNotifPermissionOnce } from './rest-alert.js'

export const LIVE_VERSION = 2
const APPLIED_KEY = 'gym_live_applied'
const APPLIED_MAX = 300
const SEND_DEBOUNCE_MS = 300
// The sets after the current one the activity carries, so its Done can move on without the page.
export const LIVE_AHEAD = 8
// The first open set of this many later exercises, so Next exercise works without the page too.
export const LIVE_UNITS = 4
// ActivityKit drops an update over 4 KB. Long names in a script with 3-byte letters can get there,
// so the farthest sets go first until it fits (the page sends a fresh list after every tick anyway).
const LIVE_BUDGET = 3600

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/* ---------- what the activity shows ---------- */

/**
 * The sets still to do, in the order the workout screen leads through them: from the current
 * exercise's unit on, a superset round by round (a1, b1, a2, b2), then the units after it, then
 * the ones before it that still have sets open. Each with the rest that follows it.
 */
export function upcomingSets (S) {
  const A = S && S.active
  if (!A || !Array.isArray(A.entries) || !A.entries.length) return []
  const units = supersetUnits(A.entries)
  const cur = Math.max(0, Math.min(A.entries.length - 1, A.cur || 0))
  const start = Math.max(0, units.findIndex(u => u.includes(cur)))
  const order = [...units.slice(start), ...units.slice(0, start)]
  const out = []
  for (const unit of order) {
    const rounds = Math.max(0, ...unit.map(i => (A.entries[i]?.sets || []).length))
    let rest = 0
    try { rest = restSecFor(A.entries, unit, num(S.restSec) || 0) || 0 } catch { rest = num(S.restSec) || 0 }
    for (let r = 0; r < rounds; r++) {
      const inRound = unit.filter(i => { const s = A.entries[i]?.sets?.[r]; return s && !s.done })
      inRound.forEach((i, k) => out.push({ entryIdx: i, setIdx: r, restAfter: k === inRound.length - 1 ? rest : 0, unit: unit[0] }))
    }
  }
  return out
}

/**
 * The set to do, as the Android lock screen spells it: "60 kg × 8", "+10 kg × 12" or "12 reps"
 * for a bodyweight set, "20 kg per dumbbell × 10", a hold's duration. Empty when the set has
 * nothing to say (the setLabel line stands in then).
 */
export function loadLine (S, e, s) {
  const unit = S?.unit || 'kg'
  const kind = entryKind({ ...e, sets: [{ ...s, done: true }] })
  const w = Number(s?.w) || 0
  if (kind === 'cardio') return ''
  if (kind === 'time') return fmtSec(Number(s?.sec) || 0) + (w > 0 ? ' · ' + fmtNum(w) + ' ' + unit : '')
  const r = Number(s?.r) || 0
  const cfg = { ...(e.target || {}), id: e.target?.id ?? e.id }
  if (isBw(cfg)) return w > 0 ? `+${fmtNum(w)} ${unit} × ${r}` : t('{0} reps', r)
  const bell = perBellOf(e) === 'each' ? ' ' + t('per dumbbell') : ''
  return `${fmtNum(w)} ${unit}${bell} × ${r}`
}

function setView (S, A, { entryIdx, setIdx, restAfter, unit }) {
  const e = A.entries[entryIdx]
  const s = e.sets[setIdx]
  const target = e.target || {}
  const work = (e.sets || []).filter(x => !isWarmupRow(x))
  const warmup = !!isWarmupRow(s)
  const n = warmup ? (e.sets || []).filter(isWarmupRow).indexOf(s) + 1 : work.indexOf(s) + 1
  let label = ''
  try { label = setLabel(e.id, s, target, speedUnitOf(S)) } catch { label = '' }
  let load = label
  try { load = loadLine(S, e, s) || label } catch { load = label }
  return {
    exId: String(e.id),
    entryIdx,
    setIdx,
    // Cased as the workout screen shows it: the stored names are lower-case and only CSS title-cases
    // them in the app, which the Lock Screen never sees (Discord).
    exName: EXIDX[e.id] ? exerciseNameText(EXIDX[e.id]) : String(target.name || e.name || e.id),
    setLine: warmup ? t('Warm-up') + ' ' + n : t('Set {0} of {1}', n, work.length),
    target: label,
    // For the Android lock screen: the weight with its unit and the reps ("60 kg × 8"), and the
    // machine when one is set. The iPhone activity reads `target` and ignores these.
    load,
    machine: gymNameOf(S, e.gym) || '',
    restAfter: Math.max(0, Math.round(restAfter || 0)),
    // The superset unit's first entry: Next exercise moves on to the next set with another one.
    unit: Number.isInteger(unit) ? unit : entryIdx,
  }
}

const bytes = o => new TextEncoder().encode(JSON.stringify(o)).length

/** Trims the farthest sets, then the farthest exercises, until the activity fits ActivityKit's 4 KB. */
function fitLive (live) {
  const st = live.state
  while (bytes(live) > LIVE_BUDGET && (st.ahead.length || st.unitStarts.length)) {
    if (st.ahead.length > st.unitStarts.length) st.ahead.pop()
    else st.unitStarts.pop()
  }
  return live
}

/**
 * The activity's fixed part (`attributes`: what stays the same for the workout) and its state, or
 * null when no workout is running here. `timer` is the rest as useUI holds it.
 */
export function buildLiveActivity (S, timer = null) {
  const A = S && S.active
  if (!A || !Array.isArray(A.entries) || !A.entries.length || A.editingWorkoutId) return null
  const next = upcomingSets(S)
  let done = 0, total = 0
  for (const e of A.entries) for (const s of e?.sets || []) { total++; if (s?.done) done++ }
  const rest = timer && !timer.ready && timer.kind !== 'switch' ? timer : null
  const pair = accentPair(accentValue(S))
  // The first open set of each exercise after the current one, in the order the sets come.
  const starts = []
  for (const x of next) {
    if (x.unit === next[0].unit || starts.some(y => y.unit === x.unit)) continue
    if (starts.length >= LIVE_UNITS) break
    starts.push(x)
  }
  return fitLive({
    attributes: {
      v: LIVE_VERSION,
      wid: String(A.id || ''),
      start: num(A.start),
      accent: pair.accent,
      ink: pair.ink,
      labels: {
        // "Log set", not "Done": it ticks the set, and "Done" read like finishing the workout.
        done: t('Log set'),
        rest: t('Rest'),
        next: t('Up next'),
        allDone: t('All sets done'),
        restOver: t('Rest’s over. Next set!'),
        nextExercise: t('Next exercise'),
        skipRest: t('Skip rest'),
        // Sets are left, but the activity ran past the ones it carries (many taps, page asleep).
        openApp: t('Open openGym for the next set'),
        // The Android lock screen's own words (LiveSessionService.java).
        title: t('Workout in progress'),
        letsGo: t('Let’s go'),
        setDone: t('Set done'),
        plus30: t('+30 s'),
      },
    },
    state: {
      name: A.name || '',
      cur: next.length ? setView(S, A, next[0]) : null,
      ahead: next.slice(1, 1 + LIVE_AHEAD).map(x => setView(S, A, x)),
      unitStarts: starts.map(x => setView(S, A, x)),
      restEndsAt: rest && !rest.paused ? num(rest.endsAt) : null,
      restLeft: rest && rest.paused ? num(rest.left) : null,
      restTotal: rest ? num(rest.total) : null,
      done,
      total,
    },
  })
}

/* ---------- applying the activity's events ---------- */

let handlers = null   // the workout screen's: setDone, next, restSkip, timer
const readApplied = () => { try { return JSON.parse(localStorage.getItem(APPLIED_KEY)) || [] } catch { return [] } }
const writeApplied = ids => { try { localStorage.setItem(APPLIED_KEY, JSON.stringify(ids.slice(-APPLIED_MAX))) } catch { /* the queue's ack is what counts */ } }

/**
 * Where Next exercise from `fromEntryIdx` goes: the first entry of the next unit with sets open, as
 * the workout screen's own Next would. null when the page already moved off that unit (an event
 * applied twice, or a tick that advanced by itself) or nothing else is open.
 */
export function nextExerciseTarget (A, fromEntryIdx) {
  if (!A || !Array.isArray(A.entries) || !Number.isInteger(fromEntryIdx)) return null
  const units = supersetUnits(A.entries)
  const from = units.find(u => u.includes(fromEntryIdx))
  if (!from || !from.includes(A.cur || 0)) return null
  const to = nextUnfinishedUnit(A.entries, units, fromEntryIdx)
  return to && to !== from ? to[0] : null
}

/** Whether Skip rest tapped at `at` is about this rest: one started after the tap is a new one. */
export function restSkipApplies (timer, at) {
  if (!timer || timer.kind === 'switch') return false
  if (timer.paused || timer.ready || !num(at)) return true
  const started = num(timer.endsAt) != null && num(timer.total) != null ? timer.endsAt - timer.total * 1000 : null
  // A second of slack: the page restarts a rest it hears of late from the tap's own time.
  return started == null || started <= at + 1000
}

function entryIndexOf (A, ev) {
  if (A.entries[ev.entryIdx] && String(A.entries[ev.entryIdx].id) === String(ev.exId)) return ev.entryIdx
  return A.entries.findIndex(e => String(e.id) === String(ev.exId))
}

/**
 * Applies the events not applied yet, in order, and returns the ids that are done with: applied
 * now, applied before, or about a workout that is not running any more. Without the workout
 * screen's actions the run stops, and that event and the ones after it stay queued.
 */
export function applyLiveEvents (events, getState) {
  if (!Array.isArray(events)) return []
  const applied = readApplied()
  const done = []
  for (const ev of events) {
    if (!ev || typeof ev.id !== 'string') continue
    if (applied.includes(ev.id)) { done.push(ev.id); continue }
    const A = getState()?.S?.active
    const ours = A && Array.isArray(A.entries) && !A.editingWorkoutId && (!ev.wid || ev.wid === String(A.id))
    if (ev.type === 'setDone' && ours) {
      if (!handlers) break
      const idx = entryIndexOf(A, ev)
      const set = idx >= 0 ? A.entries[idx].sets?.[ev.setIdx] : null
      if (set && !set.done) handlers.setDone(idx, ev.setIdx, { at: num(ev.at) })
    } else if (ev.type === 'next' && ours) {
      if (!handlers) break
      const to = nextExerciseTarget(A, ev.fromEntryIdx)
      if (to != null) handlers.next?.(to)
    } else if (ev.type === 'restSkip' && ours) {
      if (!handlers) break
      if (restSkipApplies(handlers.timer?.(), num(ev.at))) handlers.restSkip?.()
    } else if (ev.type === 'restAdd' && ours) {
      // +30 s on the Android lock screen: only for the rest it was tapped in, still running.
      if (!handlers) break
      const tm = handlers.timer?.()
      if (tm && !tm.ready && restSkipApplies(tm, num(ev.at)) && num(ev.sec) > 0) handlers.restAdd?.(num(ev.sec))
    }
    // Applied, or meaningless now (another workout, a set that is gone or already ticked).
    applied.push(ev.id)
    done.push(ev.id)
  }
  writeApplied(applied)
  return done
}

/* ---------- the native plugin ---------- */

let pluginP = null
// The iPhone's Live Activity, or on Android the "Workout in progress" notification on the lock
// screen (LiveSessionPlugin.java), which takes the same calls and sends the same events.
let platform = null
// Set once the Android side answered that it can show the card (an older APK has no such plugin).
let androidReady = false
// Inside an object: a Capacitor plugin proxy answers `then` (lib/rest-alert.js, the Coach hang #42).
const livePlugin = () => pluginP || (pluginP = (async () => {
  const p = MOBILE ? await nativePlatform() : null
  if (p !== 'ios' && p !== 'android') return null
  platform = p
  const { registerPlugin } = await import('@capacitor/core')
  return { LiveActivity: registerPlugin('LiveActivity') }
})().catch(() => null))

/** Settings → "Workout on the lock screen" (Android, on unless switched off). */
export const lockScreenOn = S => S?.lockScreenWorkout !== false

/**
 * Whether the Android lock-screen notification runs this rest: it counts it down and marks its
 * end with one short buzz, so the separate rest countdown and rest-over alert stay off.
 */
export const lockScreenOwnsRest = S => androidReady && lockScreenOn(S) && !!S?.active && !S.active.editingWorkoutId

let getStateRef = null
let draining = null
// As in lib/watch-sync.js: nothing is applied, acknowledged or sent before the store has its copy
// back (boot's finishBoot), so a tap is never dropped against an empty, not yet restored state.
const storeReady = () => getStateRef?.()?.ready !== false

/**
 * Takes the Done taps from the native queue, applies them, and acknowledges what is done once the
 * change is on disk (the store's saveNow): until then the queue is the tap's only copy.
 */
export function drainLiveEvents () {
  if (draining) return draining
  draining = (async () => {
    try {
      const p = await livePlugin()
      if (!p || !getStateRef || !storeReady()) return []
      const { events = [] } = (await p.LiveActivity.drain()) || {}
      const done = applyLiveEvents(events, getStateRef)
      if (done.length) await getStateRef()?.saveNow?.()
      if (done.length) await p.LiveActivity.ack({ ids: done })
      return done
    } catch { return [] } finally { draining = null }
  })()
  return draining
}

/** The workout screen hands over its own tick (and Next, Skip rest) while it is mounted. Returns the unbind. */
export function bindLiveActions (h) {
  handlers = h
  drainLiveEvents()
  return () => { if (handlers === h) handlers = null }
}

/**
 * Started once by the app: shows, updates and ends the activity as the workout and its rest
 * change (debounced, only what differs from the last one sent), and drains the Done taps when the
 * app comes back or the native side says one came in. Resolves with the stop function.
 */
export async function startLiveActivitySync ({ useStore, useUI }) {
  const p = await livePlugin()
  if (!p) return () => {}
  getStateRef = () => useStore.getState()
  let supported = false
  try { supported = !!(await p.LiveActivity.status())?.supported } catch { supported = false }
  androidReady = supported && platform === 'android'
  let last = null, tm = null
  // Android: the lock-screen card needs the notification permission (Android 13+). It is asked
  // once, like the rest countdown's; refused, a toast says what that costs, once per workout.
  let warnedFor = null
  const checkNotifications = async wid => {
    if (warnedFor === wid) return
    warnedFor = wid
    try {
      if ((await p.LiveActivity.status())?.notifications !== false) return
      // Not held up for good by a dialog left open: the answer counts if it comes in time.
      await Promise.race([askNotifPermissionOnce(), new Promise(r => setTimeout(r, 20000))])
      if ((await p.LiveActivity.status())?.notifications !== false) return
      useUI.getState().toast(t('Notifications are off, so your workout can’t show on the lock screen. You can allow them in Android settings.'), { ms: 6000 })
    } catch { /* nothing to say */ }
  }
  // Android: a tap on the card opens the app on the workout, wherever it was left.
  const openWorkout = async () => {
    if (platform !== 'android') return
    try {
      const { open } = (await p.LiveActivity.consumeOpen()) || {}
      if (open && useStore.getState().S?.active) window.location.hash = '#/workout'
    } catch { /* an older native side: the app opens where it was */ }
  }
  const send = async () => {
    tm = null
    // An empty, not yet restored copy would end the activity of a workout that is still running.
    if (!storeReady()) return
    try {
      const S = useStore.getState().S
      const live = platform === 'android' && !lockScreenOn(S) ? null : buildLiveActivity(S, useUI.getState().timer)
      const json = live ? JSON.stringify(live) : ''
      if (json === last) return
      if (live && platform === 'android') checkNotifications(live.attributes.wid)
      if (live) await p.LiveActivity.update({ wid: live.attributes.wid, attributes: JSON.stringify(live.attributes), state: JSON.stringify(live.state) })
      else await p.LiveActivity.end()
      last = json
    } catch { /* not now: the next change tries again */ }
  }
  const schedule = () => { if (!supported) return; clearTimeout(tm); tm = setTimeout(send, SEND_DEBOUNCE_MS) }
  const offStore = useStore.subscribe((s, prev) => {
    if (s.ready && !prev.ready) { drainLiveEvents(); schedule() }
    else if (s.S !== prev.S) schedule()
  })
  const restOf = x => (x ? `${x.endsAt}|${!!x.paused}|${!!x.ready}|${x.left}|${x.kind || ''}` : '')
  const offUI = useUI.subscribe((s, prev) => {
    if (s.timer === prev.timer) return
    // A running rest changes `left` every second; only a start, a stop or a pause matters here.
    const a = s.timer, b = prev.timer
    const same = a && b && !a.paused && !b.paused && a.endsAt === b.endsAt && !!a.ready === !!b.ready
    if (!same && restOf(a) !== restOf(b)) schedule()
  })
  const sub = await p.LiveActivity.addListener('liveActivityEvent', () => { drainLiveEvents() }).catch(() => null)
  const subOpen = platform === 'android' ? await p.LiveActivity.addListener('liveActivityOpen', () => { openWorkout() }).catch(() => null) : null
  const onVisible = () => { if (document.visibilityState === 'visible') { drainLiveEvents(); schedule(); openWorkout() } }
  document.addEventListener('visibilitychange', onVisible)
  // At launch: a workout that ended while the app was gone takes its activity with it.
  if (supported) send()
  drainLiveEvents()
  openWorkout()
  return () => { offStore(); offUI(); sub?.remove?.(); subOpen?.remove?.(); document.removeEventListener('visibilitychange', onVisible); clearTimeout(tm) }
}

// Test seams.
export function _setLivePluginForTest (plugin, getState, plat = null) { pluginP = Promise.resolve(plugin ? { LiveActivity: plugin } : null); getStateRef = getState || null; platform = plat }
export function _resetLiveActivity () { handlers = null; pluginP = null; getStateRef = null; draining = null; platform = null; androidReady = false }
