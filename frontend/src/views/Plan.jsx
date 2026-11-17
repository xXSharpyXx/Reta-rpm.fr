import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { DAYN, DAYS, weekOrder, weekStartOf, uid, exCount, routineCount, todayISO, fmtDaysAgo } from '../lib/format.js'
import { effectiveRoutineIds } from '../lib/history.js'
import { todaySession } from '../lib/today-session.js'
import { lastDoneOf } from '../lib/session-picker.js'
import { t } from '../lib/i18n.js'
import {
  dayAssignSheet, starterPlanSheet, menuSheet,
  planHasRoutines, exportPlanFile, printWholePlan, importPlanFile,
  startSession,
} from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { SeasonDeco } from '../components/Seasonal.jsx'
import { Button, Row, Section } from '../components/ui.jsx'
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

/* The Workouts page (one tab, in place of Plan and Start). Top to bottom: the performance review,
   today's session with a big Start, the other sessions and a free one, and the fixed week. A tap
   on a session offers to start it or to edit it; the big button and Freestyle start at once. */
export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const config = useStore(s => s.config)
  const coachMode = useStore(s => s.coachLocal?.mode)
  const user = useStore(s => s.user)
  const fileRef = useRef(null)

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
    <TodayCard S={S} nav={nav} />
    <OtherWorkouts S={S} nav={nav} update={update} />
    <h4 className="sec plan-h">{t('My plans')}</h4>
    <Schedule S={S} nav={nav} />
    <Section className="plan-link">
      <Row icon="dumbbell" iconTint="var(--indigo)" title={t('Exercise library')} accessory="chevron" onClick={() => nav('/library')} />
    </Section>
  </div>
}

/* ================================ Today ================================ */

// Today's session from the fixed week, with one big button. A session in progress takes its
// place (Resume), a session already done says so, and a rest day names the next one.
function TodayCard({ S, nav }) {
  const today = todaySession(S, todayISO())
  // The day's routines, each one to edit (a combined day holds several).
  const editToday = () => today.routines.length === 1 ? nav('/plan/r/' + today.routines[0].id) : menuSheet({
    title: t('Edit'), items: today.routines.map(r => ({ icon: glyphOf(r.emoji), label: r.name, chevron: true, onClick: () => nav('/plan/r/' + r.id) })),
  })
  const start = () => startSession(today.ids)
  if (S.active) {
    const editing = !!S.active.editingWorkoutId
    return <div className="card today-card on">
      <div className="today-lbl">{editing ? t('Edit workout') : t('Workout in progress')}</div>
      <div className="today-name">{S.active.name}</div>
      <Button variant="primary" icon={editing ? 'pencil' : 'play'} className="today-go" onClick={() => nav('/workout')}>{editing ? t('Edit') : t('Resume')}</Button>
    </div>
  }
  if (!today.routines.length) {
    return <div className="card today-card">
      <div className="today-lbl">{t('Today')}{today.rescheduled ? ' · ' + t('rescheduled') : ''}</div>
      <div className="today-name">{today.done ? t('{0} (done)', today.done.name || t('Workout')) : t('Rest day')}</div>
      {today.next && !today.done && <div className="today-sub">{t('Next session: {0}, {1}', t(DAYN[today.next.weekday]), today.next.routine.name)}</div>}
    </div>
  }
  const n = today.routines.reduce((k, r) => k + r.ex.length, 0)
  return <div className={'card today-card' + (today.done ? '' : ' on')}>
    <div className="today-lbl">{t("Today's plan")}{today.rescheduled ? ' · ' + t('rescheduled') : ''}</div>
    <div className="row" style={{ gap: 12, alignItems: 'center' }}>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="today-name">{today.done ? t('{0} (done)', today.name) : today.name}</div>
        <div className="today-sub">{exCount(n)}</div>
      </div>
      <MiniBodyMap routines={today.routines} body={S.body} />
    </div>
    <Button variant={today.done ? 'tinted' : 'primary'} icon="play" className="today-go" onClick={start}>{t('Start {0}', today.name)}</Button>
    <Button variant="ghost" size="sm" icon="pencil" className="today-edit" onClick={editToday}>{t('Edit')}</Button>
  </div>
}

// The other sessions and a free one. A tap on a session asks what to do with it: start it, or edit
// it (the list of sessions to edit that used to sit at the bottom of the page is this one now).
// A session in progress hides the starting: there is only editing then.
function OtherWorkouts({ S, nav, update }) {
  const ids = new Set(effectiveRoutineIds(S, todayISO()))
  const others = S.routines.filter(r => !ids.has(r.id))
  const edit = r => nav('/plan/r/' + r.id)
  const choose = r => S.active ? edit(r) : menuSheet({
    title: r.name,
    subtitle: exCount(r.ex.length),
    items: [
      { icon: 'play', label: t('Start'), accent: true, onClick: () => startSession([r.id]) },
      { icon: 'pencil', label: t('Edit'), onClick: () => edit(r) },
    ],
  })
  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    edit(r)
  }
  // How many exercises, and when it was last done (lib/session-picker.js).
  const lastSub = r => { const last = lastDoneOf(S.workouts, r.id); return [exCount(r.ex.length), last ? t('last time {0}', fmtDaysAgo(last)) : t('never done yet')].join(' · ') }
  return <>
    <div className="row between plan-h">
      <h4 className="sec" style={{ margin: 0 }}>{t('Other routines')}</h4>
      <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New routine')}</Button>
    </div>
    {!S.routines.length && <div className="empty plan-empty">
      <div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Make one, or grab the starter plan to get going.')}
      <div style={{ marginTop: 12 }}><Button icon="clipboard" onClick={starterPlanSheet}>{t('Load starter plan')}</Button></div>
    </div>}
    <div className="list plan-others">
      {others.map(r => <div key={r.id} className="item" {...tappable(() => choose(r))}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{lastSub(r)}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>)}
      {!S.active && <div className="item" {...tappable(() => startSession([]))}>
        <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="shuffle" /></span>
        <div className="grow"><div className="tt">{t('Freestyle workout')}</div><div className="ss">{t('Pick the exercises as you go')}</div></div>
        <span className="tag acc">{t('Start')}</span>
      </div>}
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
    <h4 className="sec plan-sub">{t('This week')}</h4>
    <div className="list plan-week">{weekOrder(ws).map(dayRow)}</div>
    <p className="sect-f">{t('Want two routines on one day? Tap the day and pick both.')}</p>

  </>
}
