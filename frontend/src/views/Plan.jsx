import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { DAYN, DAYS, weekOrder, weekStartOf, uid, exCount, routineCount, todayISO, fmtDaysAgo } from '../lib/format.js'
import { effectiveRoutineIds } from '../lib/history.js'
import { todaySession } from '../lib/today-session.js'
import { lastDoneOf } from '../lib/session-picker.js'
import { t } from '../lib/i18n.js'
import {
  dayAssignSheet, routineDaysSheet, starterPlanSheet, menuSheet,
  planHasRoutines, exportPlanFile, printWholePlan, importPlanFile,
  startSession,
} from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { SeasonDeco } from '../components/Seasonal.jsx'
import { Button, Row, Section, Segmented } from '../components/ui.jsx'
import { deleteRoutine, restoreRoutine, routineSnapshot } from '../lib/routines.js'
import MiniBodyMap from '../components/MiniBodyMap.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { coachAvailable } from '../lib/coach.js'
import { deriveSessionName } from '../lib/session-merge.js'
import { markUndone, undoMarks } from '../lib/sync-merge.js'

/* Undo for Plan's two removals (v1.3.11). Both go through the store's normal update, so sync
   sees an ordinary edit (a routine put back clears its own removal stamp, lib/sync-merge.js). */

/** Deletes a routine with an Undo toast in place of a confirm: the toast puts it back exactly,
 *  list place, weekdays and reschedules included (lib/routines.js routineSnapshot). */
export function deleteRoutineWithUndo(id) {
  const st = useStore.getState()
  const snap = routineSnapshot(st.S, id)
  if (!snap) return false
  const before = st.S
  st.update(s => { deleteRoutine(s, id) })
  // What the removal moved (weekdays, reschedules), for the Undo to mark as put back:
  // a change another device made to one of them before it saw the removal then still wins.
  snap.marks = undoMarks(before, useStore.getState().S)
  useUI.getState().toast(t('“{0}” gone.', snap.routine.name), { action: t('Undo'), onAction: () => undoDeleteRoutine(snap) })
  return true
}
export function undoDeleteRoutine(snap) {
  let ok = false
  useStore.getState().update(s => { ok = restoreRoutine(s, snap); if (ok && snap.marks) markUndone(s, snap.marks) })
  // False when a sync brought it back first (another device's Undo, or its later edit).
  if (!ok) useUI.getState().toast(t('It’s already back.'))
  return ok
}

/* The Workouts page (one tab, in place of Plan and Start), Hevy style (owner, 2026-11-24). Top to
   bottom: the performance review, a big Start for today's routine (no name, no Edit) with "Start
   another routine" under it, then two glued buttons: "My week" (Monday to Sunday, to plan the
   sessions on) and "My sessions" (the free session first, then every routine). */
export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const config = useStore(s => s.config)
  const coachMode = useStore(s => s.coachLocal?.mode)
  const user = useStore(s => s.user)
  const fileRef = useRef(null)
  // The week to plan on first; with no routine to plan yet, the sessions, where the first one is made.
  const [view, setView] = useState(() => (S.routines.length ? 'week' : 'sessions'))

  /* The Coach's way in: its own button in the header, gated by the same predicate every other
     Coach surface uses, so an instance without the feature sees the header it would have without. */
  const showCoach = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode })

  // Share, print, import and starter plans: one menu behind the header button.
  const openMenu = () => {
    const has = planHasRoutines(S)
    menuSheet({
      title: t('Plan'),
      subtitle: has ? null : t('Add an exercise to a routine first. An empty plan has nothing to share.'),
      items: [
        { icon: 'share', label: t('Export plan file'), sub: t('A small file a friend can import into their own openGym. Routines only, none of your workouts or weigh-ins.'), disabled: !has, onClick: exportPlanFile },
        { icon: 'note', label: t('Print / Save as PDF'), disabled: !has, onClick: printWholePlan },
        { icon: 'download', label: t('Import a plan file'), onClick: () => fileRef.current?.click() },
        { icon: 'clipboard', label: t('Load starter plan'), onClick: starterPlanSheet },
      ],
    })
  }
  const pickFile = ev => { const f = ev.target.files[0]; ev.target.value = ''; importPlanFile(f) }

  return <div className="narrow plan">
    <div className="hdr">
      <SeasonDeco spot="header-bats" />
      <div><h1>{t('Workouts')}</h1><div className="sub">{t(DAYN[new Date().getDay()])}</div></div>
      <div className="hdr-actions">
        {showCoach && <Button size="sm" variant="tinted" icon="sparkles" onClick={() => nav('/coach')}>{t('Coach')}</Button>}
        <button className="iconbtn" onClick={openMenu} aria-label={t('Plan options')} title={t('Plan options')}><Icon name="share" /></button>
      </div>
    </div>
    <input ref={fileRef} type="file" accept="application/json,.json" onChange={pickFile} hidden />
    <Section className="plan-link plan-analyze">
      <Row icon="sparkles" iconTint="var(--acc)" title={t('Analyze my latest performance')} subtitle={t('Progress, stalls, records and an AI review')}
        accessory="chevron" onClick={() => nav('/plan/bilan')} />
    </Section>
    <StartCard S={S} nav={nav} />
    <Segmented className="plan-views" value={view} onChange={setView}
      options={[{ value: 'week', label: t('My week') }, { value: 'sessions', label: t('My sessions') }]} />
    {view === 'week' ? <Schedule S={S} nav={nav} /> : <Sessions S={S} nav={nav} update={update} />}
    <Section className="plan-link">
      <Row icon="dumbbell" iconTint="var(--indigo)" title={t('Exercise library')} accessory="chevron" onClick={() => nav('/library')} />
    </Section>
  </div>
}

/* ================================ Start ================================ */

// Today's routine from the fixed week behind one big Start (no name, nothing to edit here), and
// "Start another routine" under it. A session in progress takes its place (Resume); on a rest day
// there is no big Start, and the next session is named.
function StartCard({ S, nav }) {
  const today = todaySession(S, todayISO())
  if (S.active) {
    const editing = !!S.active.editingWorkoutId
    return <div className="card today-card on">
      <div className="today-lbl">{editing ? t('Edit workout') : t('Workout in progress')}</div>
      <div className="today-name">{S.active.name}</div>
      <Button variant="primary" icon={editing ? 'pencil' : 'play'} className="today-go" onClick={() => nav('/workout')}>{editing ? t('Edit') : t('Resume')}</Button>
    </div>
  }
  const planned = today.routines.length > 0
  const another = () => menuSheet({
    title: t('Start another routine'),
    items: [
      { icon: 'shuffle', label: t('Freestyle workout'), sub: t('Pick the exercises as you go'), onClick: () => startSession([]) },
      ...S.routines.map(r => ({ icon: glyphOf(r.emoji), label: r.name, sub: exCount(r.ex.length), onClick: () => startSession([r.id]) })),
    ],
  })
  return <div className={'card today-card' + (planned && !today.done ? ' on' : '')}>
    {planned
      ? <div className="today-lbl">{t("Today's plan")}{today.rescheduled ? ' · ' + t('rescheduled') : ''}</div>
      : <>
        <div className="today-lbl">{today.done ? t('{0} (done)', today.done.name || t('Workout')) : t('Rest day')}</div>
        {today.next && !today.done && <div className="today-sub">{t('Next session: {0}, {1}', t(DAYN[today.next.weekday]), today.next.routine.name)}</div>}
      </>}
    {planned && <Button variant={today.done ? 'tinted' : 'primary'} icon="play" className="today-go" onClick={() => startSession(today.ids)}>{t('Start')}</Button>}
    <Button variant={planned ? 'ghost' : 'primary'} icon="shuffle" className="today-other" onClick={another}>{t('Start another routine')}</Button>
  </div>
}

/* ================================ Sessions ================================ */

// Every routine, the free session first. A tap asks what to do with it: start it, edit it, or plan
// it on days of the week. A session in progress hides the starting: there is only editing then.
function Sessions({ S, nav, update }) {
  const edit = r => nav('/plan/r/' + r.id)
  const choose = r => S.active ? edit(r) : menuSheet({
    title: r.name,
    subtitle: exCount(r.ex.length),
    items: [
      { icon: 'play', label: t('Start'), accent: true, onClick: () => startSession([r.id]) },
      { icon: 'pencil', label: t('Edit'), onClick: () => edit(r) },
      { icon: 'calendar', label: t('Plan on days'), onClick: () => routineDaysSheet(r.id) },
    ],
  })
  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    edit(r)
  }
  // How many exercises, the days it is planned on, and when it was last done (lib/session-picker.js).
  const sub = r => {
    const last = lastDoneOf(S.workouts, r.id)
    const days = weekOrder(weekStartOf(S)).filter(d => [].concat(S.week[d] || []).includes(r.id)).map(d => t(DAYS[d])).join(' ')
    return [exCount(r.ex.length), days, last ? t('last time {0}', fmtDaysAgo(last)) : t('never done yet')].filter(Boolean).join(' · ')
  }
  return <>
    <div className="row between plan-h">
      <h4 className="sec" style={{ margin: 0 }}>{t('My sessions')}</h4>
      <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New routine')}</Button>
    </div>
    {!S.routines.length && <div className="empty plan-empty">
      <div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Make one, or grab the starter plan to get going.')}
      <div style={{ marginTop: 12 }}><Button icon="clipboard" onClick={starterPlanSheet}>{t('Load starter plan')}</Button></div>
    </div>}
    <div className="list plan-others">
      {!S.active && <div className="item" {...tappable(() => startSession([]))}>
        <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="shuffle" /></span>
        <div className="grow"><div className="tt">{t('Freestyle workout')}</div><div className="ss">{t('Pick the exercises as you go')}</div></div>
        <span className="tag acc">{t('Start')}</span>
      </div>}
      {S.routines.map(r => <div key={r.id} className="item" {...tappable(() => choose(r))}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{sub(r)}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>)}
    </div>
  </>
}

/* ================================ Schedule ================================ */

function Schedule({ S, nav }) {
  const ws = weekStartOf(S)
  const todayDow = new Date().getDay()
  const routineOf = id => S.routines.find(x => x.id === id)
  const dayRoutines = d => [].concat(S.week[d] || []).map(routineOf).filter(Boolean)
  // One weekday: what is on it at a glance, and a tap to change it (dayAssignSheet picks one
  // routine, several for a combined day, or a rest day).
  const dayRow = d => {
    const rs = dayRoutines(d)
    return <div key={d} className="item plan-day" data-day={d} aria-label={t(DAYN[d])} {...tappable(() => dayAssignSheet(d))}>
      <span className={'plan-day-n' + (d === todayDow ? ' today' : '')} aria-hidden="true">{t(DAYS[d])}</span>
      <span className={'lrow-i' + (rs.length ? '' : ' rest')}><Icon name={rs.length ? glyphOf(rs[0].emoji) : 'moon'} /></span>
      <div className="grow">
        <div className="tt">{rs.length ? deriveSessionName(rs.map(r => r.name)) : t('Rest day')}</div>
        <div className="ss">{rs.length === 1 ? exCount(rs[0].ex.length) : rs.length ? routineCount(rs.length) : t('Tap to plan something')}</div>
      </div>
      {rs.length > 0 && <MiniBodyMap routines={rs} body={S.body} />}
      <Icon name="chevronRight" className="chev" />
    </div>
  }

  return <>
    <div className="list plan-week">{weekOrder(ws).map(dayRow)}</div>
    <p className="sect-f">{t('Want two routines on one day? Tap the day and pick both.')}</p>

  </>
}
