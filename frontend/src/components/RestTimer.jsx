import { useEffect } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { REST_MAX } from '../lib/duration.js'
import { durationSheet } from './DurationWheel.jsx'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'
import { SeasonDeco } from './Seasonal.jsx'

const clock = sec => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0')

// The clock is a button: a tap opens the wheel at the time that is left, for a rest that wants
// to be a round 2:00 rather than eight taps of +15. 0:00 ends the rest, like Skip. What is left
// is read again at Done, since the rest kept counting while the wheel was open. Done on a wheel
// nobody turned changes nothing: the rest keeps the seconds it counted down meanwhile, and one
// that ran out (or a switch-sides pause that ended) is not started again.
export function adjustRestSheet() {
  const tm = useUI.getState().timer
  if (!tm) return
  const opened = tm.ready ? 0 : Math.min(tm.left, REST_MAX)
  durationSheet({
    title: t('Time left'), value: opened, max: REST_MAX, off: t('Skip'),
    footer: t('Scroll to 0:00 to end the rest now.'),
    onDone: v => applyRestLeft(v, opened),
  })
}

// What the wheel's Done does to the rest as it is by then: a new time left, the rest ended at
// 0:00, or a fresh rest when the old one has run out (Ready) or was skipped meanwhile.
export function applyRestLeft(v, opened) {
  if (opened !== undefined && v === opened) return
  const ui = useUI.getState()
  const now = ui.timer
  if (!now) { if (v > 0) ui.startRest(v); return }
  if (v <= 0) { ui.stopRest(); return }
  if (now.ready) { ui.startRest(v, now.forIdx); return }
  if (v !== now.left) ui.addRest(v - now.left)
}

// One bar, two meanings: the rest countdown between sets, and the work countdown during a
// timed set (issue #16). They are mutually exclusive by construction — startWork() stops any
// running rest — so the bar can never have to show both, and a work set gets its own colour
// plus a "Done" that logs the time actually held.
//
// On the workout screen (which has no tab bar, see App.jsx) the bar is docked at the bottom edge
// and holds the time left alone, centred; the progress runs along its top edge. Elsewhere it sits
// on top of the tab bar.
export default function RestTimer() {
  const timer = useUI(s => s.timer)
  const work = useUI(s => s.work)
  const { stopRest, finishWorkEarly, stopWork } = useUI()
  const on = work || timer
  // The page keeps room at its bottom for the bar (index.css body.resting), so the last set and
  // the Finish button can scroll clear of it.
  useEffect(() => {
    document.body.classList.toggle('resting', !!on)
    return () => document.body.classList.remove('resting')
  }, [!!on])
  if (!on) return null
  const pct = Math.max(0, Math.min(100, (on.left / on.total) * 100))
  // The bar shrinks by transform, not width: a width transition lays the page out again on every
  // frame of every rest (~45 layouts a second), a scaled bar is the compositor's alone.

  if (work) return (
    <div id="timer" className="working">
      <div className="bar" aria-hidden="true"><i style={{ transform: `scaleX(${pct / 100})` }} /></div>
      <div className="tclock">
        <span className="t">{work.left <= 0 && work.overtime ? '+' + clock(-work.left) : clock(work.left)}</span>
        {work.label && <span className="lbl">{work.label}</span>}
      </div>
      <div className="acts">
        <Button size="sm" onClick={stopWork}>{t('Cancel')}</Button>
        <Button size="sm" variant="primary" icon="check" onClick={finishWorkEarly}>{t('Done')}</Button>
      </div>
    </div>
  )
  // Only the time left (owner's call): no −15, +15, pause or Skip on the bar. A tap on it opens
  // the wheel to change the time left, where 0:00 ends the rest; once the rest is over a tap puts
  // the bar away.
  const label = timer.kind === 'switch' ? t('Switch sides') : timer.paused ? t('Paused') : t('Rest')
  return (
    <div id="timer" className={'rest solo' + (timer.paused ? ' paused' : '') + (timer.kind === 'switch' ? ' switch' : '') + (timer.ready ? ' ready' : '')}>
      <div className="bar" aria-hidden="true"><i style={{ transform: `scaleX(${pct / 100})` }} /></div>
      <SeasonDeco spot="rest-timer" workout />
      <button type="button" className="tclock" onClick={timer.ready ? stopRest : adjustRestSheet}
        aria-label={timer.ready ? t('Ready') + '. ' + t('Dismiss') : clock(timer.left) + '. ' + t('Change the time left')}>
        <span className="t" role={timer.ready ? 'status' : undefined}>{timer.ready ? t('Ready') : clock(timer.left)}</span>
        <span className="lbl">{label}</span>
      </button>
    </div>
  )
}
