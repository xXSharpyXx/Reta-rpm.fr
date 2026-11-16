import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { dayPhotosOf } from '../lib/day-photos.js'
import { EXIDX, matchExercise, betterWeight, isAssisted } from '../lib/exercises.js'
import { lastBW, streakWeeks, setLabel, modeOf, effortOf, entriesForExercise, metricEntriesForExercise, metricModeForEntry, bestWeightForEntry, completedRepsOf, workoutDay, lifetimeVolume } from '../lib/history.js'
import { fmtNum, fmtDate, fmtVol, todayISO, exerciseNameText } from '../lib/format.js'
import { speedUnitOf, speedLabel, toSpeed } from '../lib/speed.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { bwSheet, goalSheet, calendarSheet, dayOverrideSheet, workoutDetailSheet, WorkoutRow, bwDeltaColor, weighInsSheet } from '../sheets.jsx'
import LineChart from '../components/LineChart.jsx'
import WeightRate from '../components/WeightRate.jsx'
import Heatmap from '../components/Heatmap.jsx'
import { SeasonDeco } from '../components/Seasonal.jsx'
import Icon from '../components/Icon.jsx'
import { reportSheet } from '../components/ReportSheet.jsx'
import { loadOfWeeklyPlan, rankOf, MUSCLE_NAME } from '../lib/muscles.js'
import { LB_TO_KG } from '../lib/recovery.js'
import { e1rmSeries, best1RM, formulaOf } from '../lib/onerm.js'
import { currentDbLoad, workoutAs } from '../lib/dumbbells.js'
import { maxRepsSeries } from '../lib/pyramid.js'
import { weighInAt } from '../lib/bodyweight.js'
import { perSetSessions, perSetLines, dropOffSet } from '../lib/per-set.js'
import { relativeSeries } from '../lib/relative-strength.js'
import {
  hasEffort, hasEstimableEffort, displayScale, scaleName, toScale, avgRir, effortSummary, effortWeeks,
  effortHistogram, HARD_RIR
} from '../lib/effort.js'
import { anchorsByWorkout, resolveSetRir } from '../lib/recovery.js'
import { Button, Segmented, SelectRow } from '../components/ui.jsx'

// Set 1 to 5 on the per-set chart — system colours, so each line keeps its hue in dark mode.
const SET_COLORS = ['var(--blue)', 'var(--green)', 'var(--orange)', 'var(--purple)', 'var(--pink)']

// The date range buttons under Body weight, and since issue #511 under Exercise progress too.
// In days, 0 = everything; a function because the labels follow the current language.
const rangeOptions = () => [{ value: 30, label: '1M' }, { value: 90, label: '3M' }, { value: 365, label: '1Y' }, { value: 0, label: t('All') }]
// Where a range starts, in ms. Worked out once per pick rather than from each render's clock, so
// the memoised chart arrays below keep their identity (LineChart drops its hover on a new one).
const rangeStart = days => (days ? Date.now() - days * 86400000 : 0)

// The user's own last registered bodyweight, in kg: the body-mass part of a bodyweight
// exercise's load for estimated effort.
function profileBodyweightKg(S) {
  const entries = S.bodyweight || []
  if (!entries.length) return null
  const last = entries.slice().sort((a, b) => String(a.d).localeCompare(String(b.d))).at(-1)
  if (!last || !(last.w > 0)) return null
  return S.unit === 'lb' ? last.w * LB_TO_KG : last.w
}


// How hard the training was — the half of the picture a volume chart cannot show. Everything
// is computed in RIR (lib/effort.js) and converted to whichever scale this profile reads.
// Every number carries how much of the training it speaks for: rating is optional and off by
// default, so a partly rated history is the normal case, and an average without its
// denominator would quietly speak for sets that were never rated.
function EffortCard({ S }) {
  const [win, setWin] = useState(90)
  const kind = displayScale(S)
  const hd = scaleName(kind)
  // Every set without a logged rating is estimated (the same precedence fatigue scoring
  // uses: logged effort first, Epley-inverse estimate against the 90-day anchor second),
  // so the average always speaks for the whole training, not just the rated subset.
  // Averaging rated sets only reads as RIR 0 for a history whose only ratings are
  // imported sets taken to failure. Estimates never override a real rating, so a fully
  // rated window still reads exactly its logged numbers.
  // Same options as the fatigue map (unit + profile bodyweight), so a bodyweight set is
  // estimated against the same body-mass-inclusive anchor in both places.
  const opts = useMemo(() => ({ unit: S.unit, bodyweightKg: profileBodyweightKg(S) }), [S.unit, S.bodyweight])
  const anchors = useMemo(
    () => anchorsByWorkout(S.workouts, opts),
    [S.workouts, opts],
  )
  // The summary, the weekly curve and the histogram each walk the same sets; a set's reading
  // depends only on the anchors and options, so it is worked out once per set, not three times.
  const resolve = useMemo(() => {
    const seen = new WeakMap()
    return (s, w, e) => {
      if (seen.has(s)) return seen.get(s)
      const r = resolveSetRir(s, s, e, w, anchors.get(w), opts)
      seen.set(s, r)
      return r
    }
  }, [anchors, opts])
  const sum = effortSummary(S, win, resolve)
  const weeks = effortWeeks(S, win, resolve)
  const hist = effortHistogram(S, win, resolve)
  const estimated = sum.est > 0
  const maxBin = Math.max(1, ...hist.map(b => b.n))
  // The week's set count rides along in the tooltip, because the pair is the reading:
  // volume up with effort up is fatigue piling up, volume up with effort flat is adaptation.
  const pts = weeks.map(w => ({ t: w.t, y: toScale(kind, w.rir), note: t('{0} sets', w.sets) }))
  // Bins run hardest-first in both scales: RIR 0 and RPE 10 are the same set.
  const binLabel = b => kind === 'rpe' ? (b.tail ? '≤ 6' : String(10 - b.rir)) : (b.tail ? b.rir + '+' : String(b.rir))

  return <div className="card">
    <h2>{t('Effort')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· {t('how close to failure')}{estimated ? ' · ' + t('estimated') : ''}</span></h2>
    <Segmented className="seg-range" value={win} onChange={setWin}
      options={[{ value: 30, label: '30d' }, { value: 90, label: '90d' }, { value: 365, label: '1Y' }, { value: 0, label: t('All') }]} />
    {sum.rated === 0 && sum.est === 0 ? <div className="muted small">{t('No rated sets in this period.')}</div> : <>
      <div className="row between" style={{ alignItems: 'flex-end', gap: 12 }}>
        <div>
          <div className="stat-v">{sum.avg == null ? '–' : fmtNum(toScale(kind, sum.avg)) + ' ' + hd}</div>
          <div className="small dim">{t('average effort')}</div>
        </div>
        <div style={{ textAlign: 'end' }}>
          <div className="stat-v" style={{ color: 'var(--yellow)' }}>{sum.hardPct == null ? '–' : Math.round(sum.hardPct * 100) + '%'}</div>
          <div className="small dim">{t('at {0} {1} or harder', hd, fmtNum(toScale(kind, HARD_RIR)))}</div>
        </div>
      </div>
      <div className="small dim" style={{ marginTop: 8 }}>{estimated
        ? t('{0} rated · {1} estimated of {2} sets', sum.rated, sum.est, sum.done)
        : t('{0} of {1} finished sets rated', sum.rated, sum.done)}</div>
      {effortOf(S) === 'none' && <div className="small" style={{ color: 'var(--yellow)', marginTop: 4 }}>
        {t('Effort per set is off. Turn it on in Settings → Workout to keep rating.')}
      </div>}
      {pts.length > 1 && <>
        <h4 className="sec" style={{ marginTop: 12 }}>{t('Week by week')}</h4>
        <div className="chart"><LineChart points={pts} h={140} unit={hd} color="var(--yellow)" invert={kind === 'rir'} /></div>
      </>}
      <h4 className="sec" style={{ marginTop: 12 }}>{t('Where the sets land')}</h4>
      {hist.map(b => <div key={b.rir} className="mrow">
        <span className="nm">{hd} {binLabel(b)}</span>
        <span className="bar"><i style={{ width: Math.round(b.n / maxBin * 100) + '%', background: b.rir <= HARD_RIR ? 'var(--yellow)' : 'var(--label-3)' }} /></span>
        <span className="v">{b.n ? b.n + ' · ' + Math.round(b.pct * 100) + '%' : '–'}</span>
      </div>)}
      <div className="small dim" style={{ marginTop: 8 }}>
        {t('Most working sets belong close to failure, not at it. Half at the floor and half at the top still average out to a healthy-looking middle.')}
      </div>
    </>}
  </div>
}

// Stats = the analytics hub: all charts, progress and history live here.
// The muscle volume your plan programs in a week: every weekday routine once, plus each session
// of a running rotation (lib/muscles.js loadOfWeeklyPlan). It used to sit on Plan; it is analysis,
// so it lives here now (/stats?focus=weekly-volume).
const PLAN_VOLUME_ROWS = 5
export function WeeklyPlanVolume({ S }) {
  const [all, setAll] = useState(false)
  const load = loadOfWeeklyPlan(S)
  const muscles = rankOf(load).worked
  const shown = all ? muscles : muscles.slice(0, PLAN_VOLUME_ROWS)
  const max = muscles.length ? load[muscles[0]] : 0
  return <div className="card" id="weekly-volume" data-weekly-muscle-volume>
    <h2 style={{ marginBottom: 2 }}>{t('Weekly muscle volume')}</h2>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Planned sets per week, from your plan.')}</div>
    {muscles.length ? shown.map(muscle => <div className="mrow" key={muscle}>
      <span className="nm">{t(MUSCLE_NAME[muscle])}</span>
      <span className="bar"><i style={{ width: Math.round(load[muscle] / max * 100) + '%' }} /></span>
      <span className="v">{t('{0} sets', fmtNum(Math.round(load[muscle] * 10) / 10))}</span>
    </div>) : <div className="muted small">{t('No muscle volume planned.')}</div>}
    {muscles.length > PLAN_VOLUME_ROWS && <>
      <div style={{ height: 8 }} />
      <Button className="weekly-plan-toggle" trailingIcon={all ? 'chevronUp' : 'chevronDown'} aria-expanded={all}
        onClick={() => setAll(v => !v)}>{t(all ? 'Show less' : 'Show more')}</Button>
    </>}
  </div>
}

export default function Stats() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [range, setRange] = useState(90)
  // Plan's "Weekly muscle volume" row lands here (/stats?focus=weekly-volume). The router is a
  // HashRouter, so the query sits in the hash; the scroll waits a frame for the page's own
  // scroll-to-top on navigation to have happened first.
  useEffect(() => {
    if (!/[?&]focus=weekly-volume\b/.test(window.location.hash || '')) return
    const frame = window.requestAnimationFrame(() => document.getElementById('weekly-volume')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }))
    return () => window.cancelAnimationFrame(frame)
  }, [])
  const [exId, setExId] = useState(null)
  const [exMetric, setExMetric] = useState('top')
  // What the Body weight view measures the lift by: 'e1rm' (default) or the heaviest set.
  const [relBasis, setRelBasis] = useState('e1rm')
  // Exercise progress over a date range (issue #511), All by default. Only the chart follows it:
  // "Best:" and the recent sessions under it stay all-time.
  const [exRange, setExRange] = useState(0)
  const exFrom = useMemo(() => rangeStart(exRange), [exRange])
  const inExRange = p => p.t >= exFrom
  const now = Date.now()
  const kind = displayScale(S)
  const hd = scaleName(kind)

  const bwPts = S.bodyweight.filter(b => range === 0 || weighInAt(b) > now - range * 86400000)
    .map(b => ({ t: weighInAt(b), y: b.w, d: b.d }))
  const bw30 = S.bodyweight.filter(b => weighInAt(b) > now - 30 * 86400000)
  const bwDelta30 = bw30.length > 1 ? bw30[bw30.length - 1].w - bw30[0].w : null
  const workouts = S.workouts
  const monthW = workouts.filter(w => workoutDay(w)?.slice(0, 7) === todayISO().slice(0, 7)).length
  const lifetime = lifetimeVolume(S)

  // Dumbbell weights are read in each exercise's current meaning (lib/dumbbells.js), so the
  // chart and its best compare like with like across a switch between per bell and total.
  const meantIn = {}
  const metricDataOf = (workout, id) => {
    const entries = metricEntriesForExercise(workoutAs(workout, id, meantIn[id] ??= currentDbLoad(S, id)), id)
    const mode = entries.at(-1)?.mode || null
    const sameMode = entries.filter(item => item.mode === mode)
    const best = mode === 'reps' ? sameMode.reduce((value, item) => {
      const candidate = bestWeightForEntry(item.entry)
      if (!(candidate > 0)) return value
      return value > 0 ? betterWeight(id, value, candidate) : candidate
    }, 0) : 0
    return { mode, entries: sameMode, rows: sameMode.flatMap(item => item.rows), best }
  }
  const entryOf = id => workouts.flatMap(w => w.entries).find(e => e.id === id)
  const listOf = value => Array.isArray(value) ? value : value == null || value === '' ? [] : [value]
  const firstAvailable = (...values) => {
    for (const value of values) {
      const list = listOf(value)
      if (list.length) return list
    }
    return []
  }
  const nameOf = id => {
    if (EXIDX[id]) return exerciseNameFor(EXIDX[id])
    const entry = entryOf(id)
    return entry?.muscleSnapshot?.n || entry?.n || id
  }
  const matcherOf = id => {
    if (EXIDX[id]) return EXIDX[id]
    const entry = entryOf(id)
    const snapshot = entry?.muscleSnapshot || {}
    const primaries = firstAvailable(snapshot.primaries, entry?.primaries)
    const secondaries = firstAvailable(
      snapshot.sm, snapshot.secondaries, snapshot.muscleGroups,
      entry?.sm, entry?.secondaries, entry?.muscleGroups,
    )
    return {
      n: snapshot.n || entry?.n || id,
      bp: snapshot.bp || entry?.bp || '',
      tg: primaries[0] || snapshot.tg || entry?.tg || '',
      sm: secondaries,
      eq: snapshot.eq || entry?.eq || '',
      desc: snapshot.desc || entry?.desc || '',
    }
  }
  // Cardio is charted and ranked in the profile's speed unit; the sets keep km/h (lib/speed.js).
  const speedUnit = speedUnitOf(S)
  const currentOf = id => {
    for (let i = workouts.length - 1; i >= 0; i--) {
      const data = metricDataOf(workouts[i], id)
      if (!data.mode) continue
      const mode = data.mode
      const rows = data.rows
      const mx = mode === 'reps'
        ? data.best
        : Math.max(0, ...rows.map(s => mode === 'cardio' ? toSpeed(s.speed || 0, speedUnit) : mode === 'time' ? (s.sec || 0) : (s.w || 0)))
      if (mx > 0) return { mx, unit: mode === 'cardio' ? speedLabel(speedUnit) : mode === 'time' ? 's' : S.unit }
      // Unloaded reps work still has a current figure — its rep count. Without this the whole
      // picker label went blank and the exercise sorted to the bottom as if it had no history.
      if (mode === 'reps') {
        const reps = Math.max(0, ...rows.map(completedRepsOf))
        if (reps > 0) return { mx: reps, unit: t('reps') }
      }
    }
    return { mx: 0, unit: S.unit }
  }
  const exHist = [...new Set(workouts.flatMap(w => w.entries.map(e => e.id)))].filter(id => EXIDX[id] || nameOf(id) !== id)
  const exCurrent = Object.fromEntries(exHist.map(id => [id, currentOf(id)]))
  exHist.sort((a, b) => exCurrent[b].mx - exCurrent[a].mx || nameOf(a).localeCompare(nameOf(b)))
  const curEx = exId && exHist.includes(exId) ? exId : exHist[0] || null
  // A completed reps work row is authoritative for strength metrics, even when the parent
  // target also contains timed/cardio work. Entries without reps rows use their selected mode.
  const curMode = curEx ? (() => {
    for (let i = workouts.length - 1; i >= 0; i--) {
      const data = metricDataOf(workouts[i], curEx)
      if (data.mode) return data.mode
      const entries = entriesForExercise(workouts[i], curEx)
      for (let j = entries.length - 1; j >= 0; j--) {
        const mode = metricModeForEntry(entries[j])
        if (mode) return mode
      }
    }
    return modeOf({ id: curEx })
  })() : 'reps'
  const curCardio = curMode === 'cardio'
  const curTimed = curMode === 'time'
  // A pull-up or a push-up carries no weight, so its "best weight" is 0 — and dropping every
  // zero point left the card reading "No data yet" for exercises with a full history behind
  // them (issue #5). When nothing in an exercise's history was ever loaded, the progress IS
  // the rep count, so plot that. Add a weighted set later and it switches back to weight on
  // its own, which is also the honest reading: that is when load became the thing improving.
  const repsOnly = curEx && curMode === 'reps' && !workouts.some(w =>
    entriesForExercise(w, curEx).some(en => bestWeightForEntry(en) > 0))
  const metric = s => curCardio ? toSpeed(s.speed || 0, speedUnit) : curTimed ? (s.sec || 0) : (s.w || 0)
  const exUnit = curCardio ? speedLabel(speedUnit) : curTimed ? 's' : repsOnly ? t('reps') : S.unit
  let exPts = [], exList = [], exBest = 0
  if (curEx) {
    workouts.forEach(w => {
      const data = metricDataOf(w, curEx)
      if (data.mode === curMode) {
        const doneSets = data.rows
        const representative = data.entries.at(-1)?.entry
        const mx = curMode === 'reps'
          ? (repsOnly ? Math.max(0, ...doneSets.map(completedRepsOf)) : data.best)
          : Math.max(0, ...doneSets.map(metric))
        if (mx > 0) {
          exPts.push({ t: w.start, y: mx, d: w.d, sets: doneSets, target: representative?.target })
          // Weighted work on an assistance machine reads the other way: the smallest load is the
          // best (issue #232). Reps, duration and speed are always "more is better".
          const better = curMode === 'reps' && !repsOnly ? betterWeight(curEx, exBest || mx, mx) : Math.max(exBest, mx)
          exBest = exBest > 0 ? better : mx
        }
      }
    })
    exList = exPts.slice(-5).reverse()
  }
  // Estimated 1RM (issue #18) — only reps-mode training produces one, so cardio and timed
  // work simply have no points and the toggle stays hidden.
  // Both memoised on the same inputs, and it has to start at e1rmSeries: LineChart clears its
  // hover whenever `points` changes identity, so a chart array rebuilt on every render made the
  // tooltip vanish under your finger the moment anything else on this screen re-rendered.
  // Memoising only the .map() would not have helped — its dependency was itself rebuilt each time.
  const e1Pts = useMemo(
    () => (curEx && curMode === 'reps' ? e1rmSeries(S, curEx) : []),
    [S, curEx, curMode],
  )
  const e1ChartPts = useMemo(() => e1Pts.filter(p => p.t >= exFrom).map(p => ({ t: p.t, y: p.y, d: p.d })), [e1Pts, exFrom])
  const e1Best = curEx && curMode === 'reps' ? best1RM(S, curEx) : null
  const showE1 = e1Pts.length > 0
  // Effort on this exercise, per session. It rides on the top-set curve as well as having a
  // curve of its own, because the two only mean something together: the same weight moved
  // with more left in the tank is progress a weight-only chart draws as a flat line.
  const exRir = exPts.map(p => avgRir(p.sets))
  const showEff = exRir.filter(v => v != null).length >= 3
  const effPts = exPts.map((p, i) => (exRir[i] == null ? null : { t: p.t, y: toScale(kind, exRir[i]), d: p.d })).filter(p => p && inExRange(p))
  // Pyramid sets' Max sets: the most reps in one, per workout — the point of a Max set is seeing
  // that number climb, which the top-set weight line does not show.
  const maxPts = useMemo(
    () => (curEx && curMode === 'reps' ? maxRepsSeries(workouts, curEx).map(p => ({ t: p.t, y: p.y, d: p.d, note: p.w > 0 ? fmtNum(p.w) + ' ' + S.unit : undefined })) : []),
    [workouts, curEx, curMode, S.unit],
  )
  const showMax = maxPts.length > 0
  const maxBest = showMax ? Math.max(...maxPts.map(p => p.y)) : 0
  const maxChartPts = useMemo(() => maxPts.filter(p => p.t >= exFrom), [maxPts, exFrom])
  // Per set (issue #145): one line per set number, to see which set you drop off on — often not
  // the last. Offered once two sessions are logged and one of them has two sets or more.
  // Memoised like e1Pts: LineChart drops its hover whenever `points` changes identity.
  // Loaded work is drawn as each set's estimated 1RM, so straight sets at one weight still part
  // where reps were lost. Reps instead for unloaded work, an assistance machine (where a 1RM
  // reads backwards), or a history of sets all past the estimate's rep cap.
  const oneRmFormula = formulaOf(S)
  const perSet = useMemo(() => {
    if (!curEx || curMode !== 'reps') return null
    const usable = list => list.length >= 2 && list.some(s => s.sets.length >= 2)
    let metric = repsOnly || isAssisted(curEx) ? 'reps' : 'e1rm'
    let sessions = perSetSessions(workouts, curEx, { metric, formula: oneRmFormula })
    if (metric === 'e1rm' && !usable(sessions)) sessions = perSetSessions(workouts, curEx, { metric: metric = 'reps' })
    if (!usable(sessions)) return null
    const { lines, hidden } = perSetLines(sessions)
    const shown = new Set(lines.map(l => l.n))
    return {
      series: lines.map(l => ({ n: l.n, points: l.points, color: SET_COLORS[l.n - 1] })),
      anchors: sessions.map(s => ({
        t: s.t, d: s.d, y: Math.max(...s.sets.map(x => x.y)),
        note: s.sets.filter(x => shown.has(x.n)).map(x => x.n + ': ' + (repsOnly ? x.r : fmtNum(x.w) + '×' + x.r)).join(' · '),
      })),
      ns: lines.map(l => l.n),
      hidden,
      metric,
      drop: dropOffSet(sessions),
    }
  }, [workouts, curEx, curMode, repsOnly, oneRmFormula])
  // The same sessions cut to the range; a set number with nothing left in it drops out of the legend.
  const perSetChart = useMemo(() => {
    if (!perSet) return null
    const series = perSet.series.map(s => ({ ...s, points: s.points.filter(p => p.t >= exFrom) })).filter(s => s.points.length)
    return { anchors: perSet.anchors.filter(p => p.t >= exFrom), series, ns: series.map(s => s.n) }
  }, [perSet, exFrom])
  // Progress against body weight: the lift's effective load (body weight included for bodyweight
  // and assisted work) as a share of the body weight at the time, so it only rises when you got
  // stronger for your size. Both bases are memoised on the same inputs as e1Pts, for the same reason.
  // On a top-set basis a bare bodyweight exercise is a flat 100%, so that basis is only offered
  // when it actually varies.
  const relE1 = useMemo(() => (curEx && curMode === 'reps' ? relativeSeries(S, curEx, { basis: 'e1rm' }) : []), [S, curEx, curMode])
  const relTop = useMemo(() => (curEx && curMode === 'reps' ? relativeSeries(S, curEx, { basis: 'top' }) : []), [S, curEx, curMode])
  const canRelE1 = relE1.length >= 2 && !relE1.some(p => p.assisted)
  const canRelTop = relTop.length >= 2 && relTop.some(p => Math.abs(p.y - relTop[0].y) > 1e-9)
  const relUsed = relBasis === 'top' ? (canRelTop ? 'top' : 'e1rm') : (canRelE1 ? 'e1rm' : 'top')
  const relPts = relUsed === 'top' ? relTop : relE1
  const relChartPts = useMemo(() => relPts.filter(p => p.t >= exFrom).map(p => ({
    t: p.t, y: p.y * 100, d: p.d,
    note: (relUsed === 'e1rm' ? t('Est. 1RM') + ' ' : '') + fmtNum(p.load) + ' ' + S.unit + ' @ ' + fmtNum(p.bw) + ' ' + S.unit,
  })), [relPts, relUsed, exFrom, S.unit])
  const showRel = canRelE1 || canRelTop
  const onRel = showRel && exMetric === 'bodyweight'
  const onSets = !!perSet && exMetric === 'sets'
  const onE1 = showE1 && exMetric === 'e1rm'
  const onEff = showEff && exMetric === 'effort'
  const onMax = showMax && exMetric === 'max'
  const topPts = exPts.map((p, i) => ({
    t: p.t, y: p.y, d: p.d,
    // 0 RIR (nothing left) is a full dot, 4+ a faint one; unrated sessions keep the plain line.
    m: exRir[i] == null ? null : 1 - Math.min(4, Math.max(0, exRir[i])) / 4,
    note: exRir[i] == null ? undefined : hd + ' ' + fmtNum(toScale(kind, exRir[i]))
  })).filter(inExRange)
  const chartPts = onSets ? perSetChart.anchors : onRel ? relChartPts : onMax ? maxChartPts : onEff ? effPts : onE1 ? e1ChartPts : topPts
  // A line needs two workouts. A range that holds fewer says so, instead of a lone dot or an empty box.
  const rangeTooShort = exRange !== 0 && chartPts.length < 2
  const exOpts = [{ value: 'top', label: t('Top set') }]
  if (perSet) exOpts.push({ value: 'sets', label: t('Per set') })
  if (showE1) exOpts.push({ value: 'e1rm', label: t('Est. 1RM') })
  if (showEff) exOpts.push({ value: 'effort', label: t('Effort') })
  if (showMax) exOpts.push({ value: 'max', label: t('Max reps') })
  if (showRel) exOpts.push({ value: 'bodyweight', label: t('Bodyweight') })

  return <>
    <div className="hdr"><SeasonDeco spot="stats-hdr" /><div><h1>{t('Stats')}</h1><div className="sub">{t('Progress & history')}</div></div>
      <div className="row" style={{ gap: 8 }}>
        <button className="iconbtn" onClick={reportSheet} aria-label={t('Performance report')} title={t('Performance report')}><Icon name="note" /></button>
        <button className="iconbtn" onClick={() => nav('/history')} aria-label={t('History')}><Icon name="history" /></button>
      </div></div>

    <div className="tiles">
      <div className="tile"><div className="l"><Icon name="dumbbell" />{t('Workouts')}</div><div className="v">{workouts.length}</div></div>
      <div className="tile"><div className="l"><Icon name="calendar" />{t('This month')}</div><div className="v">{monthW}</div></div>
      <div className="tile"><div className="l"><Icon name="flame" />{t('Week streak')}</div><div className="v">{streakWeeks(S)}</div></div>
      <div className="tile"><div className="l"><Icon name="scale" />{t('Weight 30d')}</div><div className="v" style={{ fontSize: 22, color: bwDelta30 === null ? 'inherit' : bwDeltaColor(bwDelta30, (lastBW(S) || {}).w || 0) }}>{bwDelta30 === null ? '–' : (bwDelta30 > 0 ? '+' : '') + fmtNum(bwDelta30) + ' ' + S.unit}</div></div>
      {/* Everything ever lifted (Discord): imports included, warm-ups only when the profile
          counts them (#719). Full width, since a few hundred sessions make a long number. */}
      {lifetime > 0 && <div className="tile" style={{ gridColumn: '1 / -1' }} data-lifetime-volume><SeasonDeco spot="stats-tile" /><div className="l"><Icon name="plate" />{t('Lifted in total')}</div><div className="v">{fmtVol(Math.round(lifetime), S.unit)}</div></div>}
    </div>

    <div className="card">
      <SeasonDeco spot="stats-heatmap" />
      <h2>{t('Activity (last 12 months)')}</h2>
      <Heatmap
        S={S}
        metric={S.heatmapMetric === 'vol' ? 'vol' : 'time'}
        onMetricChange={metric => useStore.getState().update(s => { s.heatmapMetric = metric })}
        onDay={iso => { const ws = workouts.filter(w => workoutDay(w) === iso); if (ws.length === 1) workoutDetailSheet(ws[0]); else if (ws.length) calendarSheet(iso); else dayOverrideSheet(iso) }}
      />
    </div>

    {S.routines.length > 0 && <WeeklyPlanVolume S={S} />}
    {workouts.length > 0 && <div className="card row between" style={{ alignItems: 'center', gap: 12 }}>
      <div style={{ minWidth: 0 }}><h2 style={{ margin: 0 }}>{t('Structural balance')}</h2>
        <div className="muted small" style={{ marginTop: 4 }}>{t('See which lift is holding back the rest.')}</div></div>
      <Button size="sm" variant="tinted" trailingIcon="chevronRight" style={{ flexShrink: 0 }} onClick={() => nav('/structural-balance')}>{t('Open')}</Button>
    </div>}
    {(workouts.length > 0 || dayPhotosOf(S).length > 0) && <div className="card row between" style={{ alignItems: 'center', gap: 12 }}>
      <div style={{ minWidth: 0 }}><h2 style={{ margin: 0 }}>{t('Progress photos')}</h2>
        <div className="muted small" style={{ marginTop: 4 }}>{t('Every progress photo, lined up by date, for any day. Plus a before/after slider.')}</div></div>
      <Button size="sm" variant="tinted" trailingIcon="chevronRight" style={{ flexShrink: 0 }} onClick={() => nav('/progress-photos')}>{t('Open')}</Button>
    </div>}
    <div className="card row between" style={{ alignItems: 'center', gap: 12 }}>
      <SeasonDeco spot="stats-peek" />
      <div style={{ minWidth: 0 }}><h2 style={{ margin: 0 }}>{t('Body measurements')}</h2>
        <div className="muted small" style={{ marginTop: 4 }}>{(S.measurements || []).length
          ? t('Last check-in {0}', fmtDate(S.measurements[S.measurements.length - 1].d, true))
          : t('Waist, arms, body fat and anything else you measure, each with its own curve.')}</div></div>
      <Button size="sm" variant="tinted" trailingIcon="chevronRight" style={{ flexShrink: 0 }} onClick={() => nav('/measurements')}>{t('Open')}</Button>
    </div>
    {(hasEffort(S) || hasEstimableEffort(S)) && <EffortCard S={S} />}

    <div className="cols">
      <div className="card">
        <div className="row between bw-head" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{t('Body weight')}</h2>
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" icon="target" style={S.targetW ? { color: 'var(--yellow)' } : undefined} onClick={goalSheet}>{S.targetW ? fmtNum(S.targetW) : t('Goal')}</Button>
            <Button size="sm" icon="plus" onClick={() => bwSheet()}>{t('Log')}</Button>
          </div>
        </div>
        <Segmented className="seg-range" value={range} onChange={setRange}
          options={rangeOptions()} />
        <div className="chart"><LineChart points={bwPts} h={160} unit={S.unit} goal={S.targetW} /></div>
        {/* the weekly rate and, with one set, how it sits in its corridor (#759) */}
        {S.bodyweight.length > 0 && <WeightRate S={S} />}
        {/* every weigh-in, week by week with its average (Discord 'Weight') */}
        {S.bodyweight.length > 0 && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 4 }}>
          <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={weighInsSheet}>{t('All weigh-ins')}</Button>
        </div>}
        <SeasonDeco spot="stats-web" />
      </div>

      <div className="card">
        <h2>{t('Exercise progress')}</h2>
        {exHist.length ? <>
          <div className="sect-b" style={{ marginBottom: 10 }}>
            <SelectRow title={t('Exercise')} sheetTitle={t('Exercise progress')} value={curEx} onChange={setExId} stackedValue
              options={exHist.map(id => ({ value: id, label: (EXIDX[id] ? exerciseNameText(EXIDX[id]) : nameOf(id)) + (exCurrent[id].mx ? ' · ' + fmtNum(exCurrent[id].mx) + ' ' + exCurrent[id].unit : '') }))}
              search={{
                placeholder: t('Search…'),
                label: t('Search…'),
                emptyLabel: t('No match'),
                match: (option, query) => matchExercise(matcherOf(option.value), query),
              }} />
          </div>
          {exOpts.length > 1 && <Segmented className="seg-range" value={onRel ? 'bodyweight' : onMax ? 'max' : onEff ? 'effort' : onE1 ? 'e1rm' : onSets ? 'sets' : 'top'} onChange={setExMetric} options={exOpts} />}
          <Segmented className="seg-range" value={exRange} onChange={setExRange} options={rangeOptions()} />
          {onRel && canRelE1 && canRelTop && <Segmented className="seg-range" value={relUsed} onChange={setRelBasis}
            options={[{ value: 'e1rm', label: t('Est. 1RM') }, { value: 'top', label: t('Top set') }]} />}
          <div className="chart">
            {rangeTooShort
              ? <div className="empty small">{t('Fewer than two workouts in this period. Pick a longer one.')}</div>
              : onSets
              ? <LineChart points={perSetChart.anchors} series={perSetChart.series} h={150} unit={perSet.metric === 'reps' ? t('reps') : S.unit} />
              : onRel
              ? <LineChart points={relChartPts} h={150} unit="% BW" />
              : onMax
              ? <LineChart points={maxChartPts} h={150} unit={t('reps')} color="var(--blue)" />
              : onEff
              ? <LineChart points={effPts} h={150} unit={hd} color="var(--yellow)" invert={kind === 'rir'} />
              : <LineChart points={chartPts} h={150} unit={exUnit} color="var(--blue)" />}
          </div>
          {onSets && !rangeTooShort && <div className="row small" style={{ gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
            {perSetChart.ns.map(n => <span key={n} className="row" style={{ gap: 5, alignItems: 'center' }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: SET_COLORS[n - 1] }} />{t('Set {0}', n)}
            </span>)}
          </div>}
          <div style={{ marginTop: 8 }}>{exList.map((p, i) => <div key={i} className="row between small" style={{ padding: '6px 0', borderBottom: 'var(--hair) solid var(--sep)' }}>
            <span className="muted">{fmtDate(p.d, true)}</span><span>{p.sets.map(s => setLabel(curEx, s, p.target, speedUnit)).join('  ')}</span></div>)}</div>
          <div className="small dim" style={{ marginTop: 8 }}>
            {onSets ? (perSet.metric === 'reps' ? t('Reps in each working set, one line per set number') : t('Estimated 1RM of each working set, one line per set number')) : onRel ? (relUsed === 'top' ? t('Heaviest set as a share of body weight, per workout') : t('Estimated 1RM as a share of body weight, per workout')) : onMax ? <>{t('Most reps in a Max set per workout')} · {t('Best:')}{' '}<b className="accent">{maxBest} {t('reps')}</b></> : onEff ? t('Average effort per workout') : onE1 ? t('Estimated 1RM per workout') : curCardio ? t('Top speed per workout') : curTimed ? t('Longest hold per workout') : repsOnly ? t('Most reps in a set per workout') : t('Best set weight per workout')}
            {onRel ? <> · {t('Best:')}{' '}<b className="accent">{fmtNum(Math.max(0, ...relPts.map(p => p.y * 100)))} % BW</b></>
              : onEff || onMax || onSets ? '' : <> · {t('Best:')}{' '}<b className="accent">{fmtNum(onE1 ? e1Best.est : exBest)} {onE1 ? S.unit : exUnit}</b></>}
          </div>
          {onRel && !rangeTooShort && (() => {
            const inRange = relPts.filter(p => p.t >= exFrom)
            const first = inRange[0], last = inRange[inRange.length - 1]
            return <div className="small dim" style={{ marginTop: 4 }}>
              {t('Body weight over this period: {0} → {1}. Bodyweight and assisted exercises count your body weight as part of the load.', fmtNum(first.bw) + ' ' + S.unit, fmtNum(last.bw) + ' ' + S.unit)}
            </div>
          })()}
          {onSets && (perSet.drop || perSet.hidden > 0) && <div className="small dim" style={{ marginTop: 4 }}>
            {perSet.drop && t('Where you most often drop off: set {0} ({1} of {2} workouts)', perSet.drop.n, perSet.drop.count, perSet.drop.of)}
            {perSet.drop && perSet.hidden > 0 ? ' · ' : ''}
            {perSet.hidden > 0 && t('Only the first {0} sets are drawn.', perSet.ns.length)}
          </div>}
          {onE1 && <div className="small dim" style={{ marginTop: 4 }}>
            {t('Best estimate from {0} on {1}. An estimate, not a tested max.', fmtNum(e1Best.w) + ' ' + S.unit + ' × ' + e1Best.r, fmtDate(e1Best.d, true))}
          </div>}
          {!onEff && !onE1 && !onMax && !onSets && !onRel && showEff && <div className="small dim" style={{ marginTop: 4 }}>
            {t('A fuller dot means less left in the tank. The same weight at a lower {0} is progress the line alone doesn’t show.', hd)}
          </div>}
        </> : <div className="muted small">{t('Finish your first workout and your progress curves will show up here.')}</div>}
      </div>
    </div>

    {workouts.length > 0 && <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Recent workouts')}</h4>
        <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={() => nav('/history')}>{t('All')} {workouts.length}</Button>
      </div>
      <div className="list">{[...workouts].reverse().slice(0, 6).map(w => <WorkoutRow key={w.id} w={w} onClick={() => workoutDetailSheet(w)} />)}</div>
    </>}
  </>
}
