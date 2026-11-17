// The heart rate of a finished workout, read back (owner, 2026-11-17): one curve over the whole
// session instead of an average beside every set. On the workout's read-back a small card (the
// average and the curve); tapped, a sheet with the curve large, where a tap or a drag on it says
// what the heart rate was at that minute and which exercise was being done.
import { useState } from 'react'
import { useUI } from '../store/useUI.js'
import { EXIDX } from '../lib/exercises.js'
import { t, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { sanitizeHr, sanitizeSeries, seriesStats, entryAt, entryMarks } from '../lib/heart-rate.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import HeartRateChart from './HeartRateChart.jsx'
import { Thumb } from './Media.jsx'
import Icon from './Icon.jsx'

/** The session's average bpm: the one the hub or the watch gave, else the curve's. Null without. */
export function avgBpmOf(w) {
  const hr = sanitizeHr(w?.hr)
  if (hr) return hr.avg
  return seriesStats(w?.hrSeries)?.avg ?? null
}

/** The card on a workout's read-back: nothing for a workout without a heart rate. */
export function HeartRateCard({ w }) {
  const series = sanitizeSeries(w?.hrSeries)
  const hr = sanitizeHr(w?.hr)
  const avg = avgBpmOf(w)
  if (avg == null) return null
  const open = series ? tappable(() => heartRateSheet(w)) : {}
  return <div className={'hr-card' + (series ? ' tappable' : '')} data-hr-card {...open}>
    <div className="row between">
      <div>
        <div className="hr-card-l">{t('Avg. heart rate (bpm)')}</div>
        <div className="hr-card-v">{avg}{!series && hr && <span className="hr-card-max"> · {t('max {0}', hr.max)}</span>}</div>
      </div>
      {series && <Icon name="chevronRight" className="chev" />}
    </div>
    {series && <HeartRateChart series={series} h={110} />}
  </div>
}

function HeartRateDetail({ w }) {
  const series = sanitizeSeries(w.hrSeries)
  const [pick, setPick] = useState(null)
  if (!series) return null
  const stats = seriesStats(series)
  const ei = pick ? entryAt(w, pick.s * 1000) : null
  const e = ei != null ? w.entries?.[ei] : null
  const ex = e ? EXIDX[e.id] : null
  const marks = entryMarks(w)
  return <div className="hr-detail">
    <h3 style={{ textAlign: 'center' }}>{t('Heart rate')}</h3>
    <div className="hr-pick">
      {pick ? <>
        {e && <div className="row" style={{ gap: 8, minWidth: 0 }}>
          {ex && <Thumb ex={ex} />}
          <span className={'hr-pick-ex ' + exerciseNameClass(ex)}>{ex ? exerciseNameFor(ex) : (e.n || e.id)}</span>
        </div>}
        <div className="hr-pick-v"><b>{t('{0} bpm', pick.bpm)}</b> <span className="muted">{t('at minute {0}', Math.floor(pick.s / 60))}</span></div>
      </> : <div className="muted small">{t('Tap the curve to see a moment of the session.')}</div>}
    </div>
    <HeartRateChart series={series} h={200} pick={pick} onPick={setPick} marks={marks} />
    <h4 className="sec" style={{ marginTop: 16 }}>{t('Summary')}</h4>
    <div className="tiles">
      <div className="tile"><div className="l">{t('Avg. bpm')}</div><div className="v">{avgBpmOf(w)}</div></div>
      <div className="tile"><div className="l">{t('Min. bpm')}</div><div className="v">{stats.min}</div></div>
      <div className="tile"><div className="l">{t('Max. bpm')}</div><div className="v">{Math.max(stats.max, sanitizeHr(w.hr)?.max || 0)}</div></div>
    </div>
  </div>
}

export const heartRateSheet = w => useUI.getState().openSheet(() => <HeartRateDetail w={w} />)
