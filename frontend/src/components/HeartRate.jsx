// The heart rate of a finished workout, read back (owner, 2026-11-17): one curve over the whole
// session instead of an average beside every set. On the workout's read-back a small card (the
// average and the curve); tapped, a sheet with the curve large, where a tap or a drag on it says
// what the heart rate was at that minute and which exercise was being done.
import { useState } from 'react'
import { useUI } from '../store/useUI.js'
import { EXIDX } from '../lib/exercises.js'
import { t, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { sanitizeHr, sanitizeSeries, seriesStats, seriesPoints, entryAt, entrySpans } from '../lib/heart-rate.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import HeartRateChart, { PLOT_SHARE } from './HeartRateChart.jsx'
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

// Under the curve, which exercise was being done when (owner, 2026-11-17): a bar per exercise
// over the minutes it took and its picture where it began. A tap on one puts the line there.
function ExerciseStrip({ w, series, picked, onPick }) {
  const spans = entrySpans(w)
  if (!spans.length) return null
  const total = series.v.length * series.dt * 1000
  const pct = ms => Math.max(0, Math.min(100, (ms / total) * 100)) * PLOT_SHARE + '%'
  const pts = seriesPoints(series)
  const pickAt = ms => {
    let best = pts[0]
    for (const p of pts) if (Math.abs(p.s * 1000 - ms) < Math.abs(best.s * 1000 - ms)) best = p
    if (best) onPick(best)
  }
  return <div className="hr-strip" data-hr-strip>
    <div className="hr-strip-bars">{spans.map(x => <i key={x.ei} className={x.ei === picked ? 'on' : undefined}
      style={{ insetInlineStart: pct(x.from), width: `calc(${pct(x.to)} - ${pct(x.from)})` }} />)}</div>
    <div className="hr-strip-ex">{spans.map(x => {
      const e = w.entries?.[x.ei]
      const ex = e ? EXIDX[e.id] : null
      const name = ex ? exerciseNameFor(ex) : (e?.n || e?.id || '')
      return <button key={x.ei} type="button" className={'hr-strip-b' + (x.ei === picked ? ' on' : '')}
        style={{ insetInlineStart: pct(x.from) }} aria-label={name} title={name} onClick={() => pickAt((x.from + x.to) / 2)}>
        {ex ? <Thumb ex={ex} /> : <span className="thumb" />}
      </button>
    })}</div>
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
    <HeartRateChart series={series} h={200} pick={pick} onPick={setPick} />
    <ExerciseStrip w={w} series={series} picked={ei} onPick={setPick} />
    <h4 className="sec" style={{ marginTop: 16 }}>{t('Summary')}</h4>
    <div className="tiles">
      <div className="tile"><div className="l">{t('Avg. bpm')}</div><div className="v">{avgBpmOf(w)}</div></div>
      <div className="tile"><div className="l">{t('Min. bpm')}</div><div className="v">{stats.min}</div></div>
      <div className="tile"><div className="l">{t('Max. bpm')}</div><div className="v">{Math.max(stats.max, sanitizeHr(w.hr)?.max || 0)}</div></div>
    </div>
  </div>
}

export const heartRateSheet = w => useUI.getState().openSheet(() => <HeartRateDetail w={w} />)
