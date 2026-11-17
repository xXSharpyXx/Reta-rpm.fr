// One finished workout, read back the same way everywhere it is shown: Stats (the workout sheet),
// the week on Home ("See more") and the latest workouts on the Workouts page. The name in large
// type, then date · duration · volume · records, then one card per exercise with its sets in a
// small table (Set | Weight | Reps). The rows come from lib/workout-summary.js.
import { useStore } from '../store/useStore.js'
import { EXIDX } from '../lib/exercises.js'
import { sessionSections, sessionVolume, workoutVolume, countsWarmups } from '../lib/history.js'
import { isWarmupRow } from '../lib/workout-model.js'
import { fmtDate, fmtVol, fmtNum, durPart } from '../lib/format.js'
import { speedUnitOf } from '../lib/speed.js'
import { t, tn, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { glyphOf } from '../lib/glyphs.js'
import { gymNameOf } from '../lib/gyms.js'
import { summaryRows } from '../lib/workout-summary.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { Thumb } from './Media.jsx'
import Icon from './Icon.jsx'
import { HeartRateCard } from './HeartRate.jsx'

const nameOf = e => (EXIDX[e.id] ? exerciseNameFor(EXIDX[e.id]) : (e.n || e.id))

/** The line under the name: date · duration · volume, and the records of the session. */
export function WorkoutMeta({ w, st, withBw = false }) {
  const prN = (w.prs || []).length
  const parts = [fmtDate(w.d, true), ...durPart((w.end || w.start) - w.start), fmtVol(sessionVolume(w, st), st.unit),
    ...(withBw && w.bw ? [fmtNum(w.bw) + ' ' + st.unit] : [])]
  return <div className="wsum-meta">
    <span>{parts.join(' · ')}</span>
    {prN > 0 && <span className="pr"><Icon name="trophy" />{tn('{0} PR', '{0} PRs', prN)}</span>}
  </div>
}

function SetTable({ e, st, isPr }) {
  const { kind, rows } = summaryRows(e, { unit: st.unit, speedUnit: speedUnitOf(st), isPr })
  if (!rows.length) return <div className="small dim">{t('no sets')}</div>
  const heads = kind === 'cardio' ? [t('Duration'), t('Speed')] : kind === 'time' ? [t('Weight'), t('Duration')] : [t('Weight'), t('Reps')]
  return <table className="wsum-sets">
    <thead><tr><th scope="col">{t('Set')}</th><th scope="col">{heads[0]}</th><th scope="col">{heads[1]}</th></tr></thead>
    <tbody>{rows.map(r => <tr key={r.i} className={r.warm ? 'warm' : undefined}>
      <td className="n">{r.warm ? <span className="wsum-warm" title={t('Warm-up')}>{t('W')}{r.n}</span> : r.n}</td>
      <td className="w">{r.weight}{r.extra && <div className="wsum-extra">{r.extra}</div>}</td>
      <td className="r"><div className="wsum-rc">
        <span>{r.reps}</span>
        {r.effort && <span className="wsum-eff">{r.effort}</span>}
        {r.fail && <span className="wsum-badge fail">{t('Failure')}</span>}
        {r.pr && <span className="pr"><Icon name="trophy" />PR</span>}
      </div></td>
    </tr>)}</tbody>
  </table>
}

function ExerciseCard({ e, w, st, onExercise }) {
  const ex = EXIDX[e.id]
  const machine = gymNameOf(st, e.gym)
  const isPr = !!(w.prs && w.prs.includes(e.id))
  const { perBell } = summaryRows(e)
  const tap = onExercise ? tappable(() => onExercise(e.id)) : {}
  return <div className={'wsum-ex' + (onExercise ? ' tappable' : '')} {...tap}>
    <div className="wsum-head">
      {ex && <Thumb ex={ex} />}
      <div className="grow">
        <div className="wsum-name">
          <span className={exerciseNameClass(ex)}>{nameOf(e)}</span>
          {perBell && <span className="wsum-bell">{t(perBell === 'each' ? 'per dumbbell' : 'both dumbbells')}</span>}
        </div>
        {machine && <div className="wsum-machine"><Icon name="mapPin" />{machine}</div>}
      </div>
      {onExercise && <Icon name="chevronRight" className="chev" />}
    </div>
    <SetTable e={e} st={st} isPr={isPr} />
    {e.note && <div className="small dim wsum-note">
      {e.notePin && <Icon name="pin" style={{ fontSize: 12, marginInlineEnd: 4, verticalAlign: '-1px', color: 'var(--yellow)' }} />}{e.note}
    </div>}
  </div>
}

/** The exercises of a workout, grouped by routine for a combined session, supersets together. */
export function WorkoutExercises({ w, onExercise }) {
  const st = useStore(s => s.S)
  const card = i => <ExerciseCard key={i} e={w.entries[i]} w={w} st={st} onExercise={onExercise} />
  const units = us => us.map(unit => unit.length < 2 ? card(unit[0])
    : <div key={'ss' + unit[0]} className="wd-ss wsum-ss">
      <div className="ss-label"><Icon name="link" />{t('Superset')}</div>
      {unit.map(card)}
    </div>)
  const groups = sessionSections(w.entries || [])
  const grouped = groups.length > 1 || (groups[0] && groups[0].rid && (w.routineIds || []).length > 1)
  if (!grouped) return <div className="wsum-list">{units(groups[0]?.units || [])}</div>
  return <div className="wsum-list">{groups.map(g => {
    const r = g.rid ? st.routines.find(x => x.id === g.rid) : null
    const items = g.items.map(i => w.entries[i])
    const setN = items.reduce((n, e) => n + e.sets.filter(s => s.done && !isWarmupRow(s)).length, 0)
    const vol = workoutVolume({ entries: items }, { warmups: countsWarmups(st) })
    return <div key={g.rid || '__none'}>
      <div className="row between wsum-group">
        <div className="row" style={{ gap: 7, fontWeight: 600 }}>{r && <Icon name={glyphOf(r.emoji)} />}{r ? r.name : t('Freestyle')}</div>
        <div className="small dim">{t('{0} sets', setN)} · {fmtVol(vol, st.unit)}</div>
      </div>
      {units(g.units)}
    </div>
  })}</div>
}

/** The whole read-back: the name, the meta line, the exercises. */
export default function WorkoutSummary({ w, onExercise, withBw = false }) {
  const st = useStore(s => s.S)
  return <div className="wsum">
    <h3 className="wsum-title">{w.name || t('Workout')}</h3>
    <WorkoutMeta w={w} st={st} withBw={withBw} />
    {/* The heart rate as one curve over the session, not an average beside every set. */}
    <HeartRateCard w={w} />
    <WorkoutExercises w={w} onExercise={onExercise} />
  </div>
}
