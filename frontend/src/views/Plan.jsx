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
  dayAssignSheet, starterPlanSheet, menuSheet,
  planHasRoutines, exportPlanFile, printWholePlan, importPlanFile,
  startSession, workoutDetailSheet, WorkoutRow,
} from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { SeasonDeco } from '../components/Seasonal.jsx'
import { Button, Row, Section } from '../components/ui.jsx'
import SwipeRow from '../components/SwipeRow.jsx'
import { copyRoutine, deleteRoutine, restoreRoutine, routineSnapshot } from '../lib/routines.js'
import MiniBodyMap from '../components/MiniBodyMap.jsx'
import { workoutControls } from '../lib/workout-controls.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { useListReorder } from '../lib/use-list-reorder.js'
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

// The flash a row lands with when a swipe brought it (a duplicate, an undo): one per new value.
let flashSeq = 0

/* The Workouts page (one tab, in place of Plan and Start). Top to bottom: the performance review,
   today's session with a big Start, the other sessions and a free one, the latest workouts done,
   and the fixed week with its sessions to edit. Starting from here asks no confirmation: every
   button already names what it starts. */
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
    {!S.active && <OtherWorkouts S={S} />}
    <LatestWorkouts S={S} nav={nav} />
    <h4 className="sec plan-h">{t('My plans')}</h4>
    <Schedule S={S} nav={nav} />
    <Routines S={S} update={update} nav={nav} />
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
  </div>
}

// The other sessions, to start one instead of today's, and a free one picked as you go.
function OtherWorkouts({ S }) {
  const ids = new Set(effectiveRoutineIds(S, todayISO()))
  const others = S.routines.filter(r => !ids.has(r.id))
  // How many exercises, and when it was last done (lib/session-picker.js).
  const lastSub = r => { const last = lastDoneOf(S.workouts, r.id); return [exCount(r.ex.length), last ? t('last time {0}', fmtDaysAgo(last)) : t('never done yet')].join(' · ') }
  return <>
    <h4 className="sec plan-h">{t('Other routines')}</h4>
    <div className="list plan-others">
      {others.map(r => <div key={r.id} className="item" {...tappable(() => startSession([r.id]))}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{lastSub(r)}</div></div>
        <span className="tag acc">{t('Start')}</span>
      </div>)}
      <div className="item" {...tappable(() => startSession([]))}>
        <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="shuffle" /></span>
        <div className="grow"><div className="tt">{t('Freestyle workout')}</div><div className="ss">{t('Pick the exercises as you go')}</div></div>
        <span className="tag acc">{t('Start')}</span>
      </div>
    </div>
  </>
}

// The last workouts done, newest first: a tap opens the same read-back as Stats.
function LatestWorkouts({ S, nav }) {
  if (!S.workouts.length) return null
  return <>
    <div className="row between plan-h">
      <h4 className="sec" style={{ margin: 0 }}>{t('Latest workouts')}</h4>
      <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={() => nav('/history')}>{t('All')} {S.workouts.length}</Button>
    </div>
    <div className="list plan-latest">{[...S.workouts].reverse().slice(0, 5).map(w => <WorkoutRow key={w.id || w.start} w={w} onClick={() => workoutDetailSheet(w)} />)}</div>
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

/* ================================ Routines ================================ */

function Routines({ S, update, nav }) {
  const [edit, setEdit] = useState(false)
  const [flash, setFlash] = useState(null)
  const swipe = workoutControls(S).swipeSets
  const routines = S.routines
  // The order of this list is the order of `S.routines`, and every other screen reads the same
  // array (the Start screen, the day sheets, the routine pickers), so moving a routine here moves
  // it everywhere (#142). Reordering lives behind Edit, like on an iPhone.
  const reorder = useListReorder(routines.length, (from, to) => update(s => {
    if (to < 0 || to >= s.routines.length) return
    const [m] = s.routines.splice(from, 1)
    s.routines.splice(to, 0, m)
  }))

  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    nav('/plan/r/' + r.id)
  }
  // The same delete as RoutineEdit's "Delete routine" button (lib/routines.js), with an Undo in
  // place of its confirm (v1.3.11): the swipe and the edit-mode minus both land here.
  const remove = r => deleteRoutineWithUndo(r.id)
  // The swipe's other side: a copy right below the original, named the way "Copy routine" names
  // one, and staying on this list rather than opening it.
  const duplicate = r => {
    const copy = copyRoutine(r, t('Copy'))
    update(s => {
      const at = s.routines.findIndex(x => x.id === r.id)
      s.routines.splice(at < 0 ? s.routines.length : at + 1, 0, copy)
    })
    setFlash({ id: copy.id, n: ++flashSeq })
    // With its own Undo: the toast takes the place of any Undo still showing (one toast at a
    // time), so the newest swipe is at least the one you can take back.
    useUI.getState().toast(t('Copied as “{0}”.', copy.name), { action: t('Undo'), onAction: () => {
      update(s => { if (s.routines.some(x => x.id === copy.id)) deleteRoutine(s, copy.id) })
    } })
  }
  // The weekdays a routine is on, short, in the order the week runs.
  const order = weekOrder(weekStartOf(S))
  const daysOf = id => order.filter(d => [].concat(S.week[d] || []).includes(id)).map(d => t(DAYS[d]))
  const sub = r => [exCount(r.ex.length), daysOf(r.id).join(', ')].filter(Boolean).join(' · ')

  return <>
    <h4 className="sec plan-sub">{t('Routines')}</h4>
    <div className="row between plan-sec-h plan-routines-bar">
      {routines.length > 0
        ? <button className="plan-textbtn" aria-pressed={edit} onClick={() => setEdit(e => !e)}>{edit ? t('Done') : t('Edit')}</button>
        : <span />}
      <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New routine')}</Button>
    </div>
    {routines.length ? <>
      {edit
        ? <div className="list routine-list plan-routines is-editing" ref={reorder.listRef}>{routines.map((r, i) =>
          <div key={r.id} data-reorder-row className="item plan-routine" style={reorder.rowStyle(i)}>
            <button className="plan-minus" aria-label={t('Delete {0}', r.name)} title={t('Delete routine')} onClick={() => remove(r)}><Icon name="minus" /></button>
            <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
            <div className="grow"><div className="tt">{r.name}</div><div className="ss">{sub(r)}</div></div>
            {routines.length > 1 && <button className="plan-handle" aria-label={t('Move {0}', r.name)} title={t('Drag to reorder')}
              {...reorder.handle(i)}><Icon name="chevronsUpDown" /></button>}
          </div>)}</div>
        : <div className="list routine-list plan-routines">{routines.map(r => {
          const row = <div key={r.id} className="item plan-routine" {...tappable(() => nav('/plan/r/' + r.id))}>
            <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
            <div className="grow"><div className="tt">{r.name}</div><div className="ss">{sub(r)}</div></div>
            <MiniBodyMap routines={[r]} body={S.body} />
            <Icon name="chevronRight" className="chev" /></div>
          // Swipe (v1.3.11, Settings → Swipe actions): toward the start deletes with an Undo,
          // toward the end duplicates. Edit's minus and the routine's own page stay the way in
          // for a keyboard and a screen reader.
          return swipe
            ? <SwipeRow key={r.id} className="swrow-item" copyLabel={t('Duplicate')}
              onDelete={() => remove(r)} onCopy={() => duplicate(r)}
              flash={flash?.id === r.id ? flash.n : 0}>{row}</SwipeRow>
            : row
        })}</div>}
      <p className="sect-f">{edit ? t('Drag to reorder. Tap the minus to delete.') : t('Tap a routine to edit it. Reorder and delete are behind Edit.')}</p>
    </> : <>
      <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Make one, or grab the starter plan to get going.')}</div>
      <Button icon="clipboard" onClick={starterPlanSheet}>{t('Load starter plan')}</Button>
    </>}
  </>
}
