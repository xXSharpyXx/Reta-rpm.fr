// The first page after Finish: the plan of the next session. One card per exercise, its rows laid
// out like the workout screen's (the set bubble, the weight and reps cells with their − and +),
// where the new number sits in green and the old one, small and struck, at the cell's corner. Under
// the rows, Refuse (keep today's numbers) or Validate; the − and + change the exercise's next weight
// and reps (one pair per exercise, the warm-ups follow). An exercise left out today stays in the
// routine unless the switch says otherwise, a new one stays out unless it is switched in, and one
// line offers today's order and set counts. Apply writes the choices on the saved workout
// (lib/next-choice.js) and the structure on the routine (lib/session-routines.js planEx).
import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { EXIDX } from '../lib/exercises.js'
import { fmtNum } from '../lib/format.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { finishCompare } from '../lib/finish-compare.js'
import { setNextChoices } from '../lib/next-choice.js'
import { planEx } from '../lib/session-routines.js'
import { Button, NumberField, Switch } from './ui.jsx'
import Icon from './Icon.jsx'

const nameOf = id => (EXIDX[id] ? exerciseNameFor(EXIDX[id]) : String(id))
const nameClass = id => (EXIDX[id] ? exerciseNameClass(EXIDX[id]) : '')
const round2 = v => Math.round(v * 100) / 100

/** What the policy proposes, as a choice (the old numbers where it names none). */
export const proposalOf = row => ({ w: row.next.w ?? row.was.w, r: row.next.r ?? row.was.r })
/** Refusing: today's weight, and the reps the proposal asks (or today's target). */
export const keptOf = row => ({ w: row.was.w, r: row.was.r ?? row.next.r })

/**
 * What the plan page has to show for `rec` (the saved workout) and `templates` (the routines the
 * session was built from, with their changes): the rows with a proposal, the exercises left out and
 * the ones added, and the routines whose order or set counts differ. `any` is false when there is
 * nothing to plan, and the summary opens at once.
 */
export function planOf(st, rec, templates = []) {
  const extra = {}
  for (const tp of templates) for (const id of tp.changes.added) {
    const cfg = tp.changes.ex.find(x => x.id === id)
    if (cfg) extra[id] = cfg
  }
  const rows = finishCompare(st, rec, { extra }).filter(r => r.editable && r.next)
  const shown = new Set(rows.map(r => r.id))
  const skipped = [], added = [], tweaks = []
  for (const tp of templates) {
    for (const id of tp.changes.removed) skipped.push({ routineId: tp.routineId, id })
    for (const id of tp.changes.added) if (!shown.has(id)) added.push({ routineId: tp.routineId, id })
    if (tp.changes.reordered || tp.changes.sets.length || tp.changes.supersets) tweaks.push(tp)
  }
  return { rows, skipped, added, tweaks, any: !!(rows.length || skipped.length || added.length || tweaks.length) }
}

function SetCell({ kind, value, old, step, min, decimal, onChange, locked }) {
  const bump = dir => onChange(Math.max(min, round2((Number(value) || 0) + dir * step)))
  return <div className={'stp ' + kind + (locked ? ' plain' : '')}>
    {!locked && <button type="button" aria-label={t('Decrease')} onClick={() => bump(-1)}><Icon name="minus" /></button>}
    <span className="val plan-val">
      {old != null && old !== value && <s className="was" aria-label={t('Was {0}', fmtNum(old))}>{fmtNum(old)}</s>}
      {locked ? <span className="plan-fixed">{fmtNum(value)}</span> : <NumberField decimal={decimal} value={value} onChange={v => onChange(Math.max(min, v))} />}
    </span>
    {!locked && <button type="button" aria-label={t('Increase')} onClick={() => bump(1)}><Icon name="plus" /></button>}
  </div>
}

function PlanCard({ row, unit, value, refused, onValue, onRefuse, onValidate, extra }) {
  let work = 0
  const shown = refused ? null : value
  return <div className="card plan-card" data-plan-card={row.id}>
    <div className="row between" style={{ gap: 8, marginBottom: 6 }}>
      <div className={'tt ' + nameClass(row.id)} style={{ fontWeight: 600, minWidth: 0 }}>{nameOf(row.id)}</div>
      {row.isNew && <span className="tag acc nocap">{t('New')}</span>}
    </div>
    <div className="sethead"><span className="n-sp" /><span className="w-sp">{unit}</span><span className="r-sp">{t('Reps')}</span><span className="ck-sp" /></div>
    {row.sets.map((s, i) => {
      const warm = s.kind === 'warm'
      if (!warm) work++
      const glyph = warm ? t('W') : s.kind === 'fail' ? t('F') : work
      // A work row shows what next time asks (the new number, the old one struck beside it); a
      // warm-up shows what it was, and follows the work weight when the next session is built.
      const w = warm || !shown ? s.w : shown.w
      const r = warm || !shown ? s.r : shown.r
      return <div key={i} className="setrow">
        <span className={'n' + (warm ? ' warm' : s.kind === 'fail' ? ' fail' : '')} aria-hidden="true">{glyph}</span>
        <SetCell kind="w" value={w} old={warm || !shown ? null : s.w} step={row.step || 2.5} min={0} decimal locked={warm || !shown}
          onChange={v => onValue({ w: v })} />
        <SetCell kind="r" value={r} old={warm || !shown ? null : s.r} step={1} min={1} decimal={false} locked={warm || !shown}
          onChange={v => onValue({ r: Math.round(v) })} />
        <span className="ck-sp" />
      </div>
    })}
    <div className="plan-actions">
      <Button size="sm" variant={refused ? 'primary' : 'plain'} data-refuse aria-pressed={refused} onClick={onRefuse}>{t('Refuse')}</Button>
      <Button size="sm" variant={refused ? 'plain' : 'primary'} icon="check" data-validate aria-pressed={!refused} onClick={onValidate}>{t('Validate')}</Button>
    </div>
    {extra}
  </div>
}

function SwitchRow({ label, checked, onChange }) {
  return <div className="row between plan-switch">
    <span>{label}</span>
    <Switch aria-label={label} checked={checked} onChange={onChange} />
  </div>
}

export default function FinishPlan({ w, templates, plan, onDone }) {
  const st = useStore(s => s.S)
  const [vals, setVals] = useState(() => Object.fromEntries(plan.rows.map(r => [r.id, r.chosen || proposalOf(r)])))
  const [refused, setRefused] = useState({})
  const [keep, setKeep] = useState({})
  const [addOn, setAddOn] = useState({})
  const [today, setToday] = useState({})
  const key = (rid, id) => rid + ':' + id
  const routineName = rid => st.routines.find(r => r.id === rid)?.name || ''
  const setVal = (id, patch) => { setVals(v => ({ ...v, [id]: { ...v[id], ...patch } })); setRefused(r => ({ ...r, [id]: false })) }
  const addedInRows = new Set(plan.rows.filter(r => r.isNew).map(r => r.id))
  const routineOf = id => templates.find(tp => tp.changes.added.includes(id))?.routineId

  const apply = () => {
    const choices = plan.rows.map(r => ({ id: r.id, rid: r.rid, choice: refused[r.id] ? keptOf(r) : vals[r.id] }))
      .filter(c => c.choice && c.choice.w >= 0 && c.choice.r >= 1)
    useStore.getState().update(s => {
      const next = setNextChoices(s.workouts, w, choices)
      if (next) s.workouts = next
      for (const tp of templates) {
        const routine = s.routines.find(r => r.id === tp.routineId)
        if (!routine) continue
        const drop = tp.changes.removed.filter(id => keep[key(tp.routineId, id)] === false)
        const add = tp.changes.added.filter(id => addOn[key(tp.routineId, id)] === true)
        const useToday = !!today[tp.routineId]
        if (!drop.length && !add.length && !useToday) continue
        const ex = planEx(routine, tp.changes, { drop, add, today: useToday })
        if (ex.length) routine.ex = ex
      }
    })
    useUI.getState().toast(t('Next session set'))
    onDone()
  }

  return <div className="fin2" data-finish-plan>
    <div className="fin2-head"><h3 className="fin2-title">{t('Next session')}</h3></div>
    <p className="muted small" style={{ marginTop: 0 }}>{t('Check what changes next time. Nothing is saved until you apply.')}</p>
    {plan.rows.map(row => {
      const rid = routineOf(row.id)
      const extra = row.isNew && rid ? <SwitchRow label={t('Add to routine')} checked={addOn[key(rid, row.id)] === true}
        onChange={on => setAddOn(a => ({ ...a, [key(rid, row.id)]: on }))} /> : null
      return <PlanCard key={row.id} row={row} unit={st.unit} value={vals[row.id]} refused={!!refused[row.id]} extra={extra}
        onValue={patch => setVal(row.id, patch)}
        onRefuse={() => setRefused(r => ({ ...r, [row.id]: true }))}
        onValidate={() => setRefused(r => ({ ...r, [row.id]: false }))} />
    })}
    {plan.added.filter(a => !addedInRows.has(a.id)).map(a => <div key={key(a.routineId, a.id)} className="card plan-card" data-plan-card={a.id}>
      <div className="row between"><div className={'tt ' + nameClass(a.id)} style={{ fontWeight: 600 }}>{nameOf(a.id)}</div><span className="tag acc nocap">{t('New')}</span></div>
      <SwitchRow label={t('Add to routine')} checked={addOn[key(a.routineId, a.id)] === true}
        onChange={on => setAddOn(x => ({ ...x, [key(a.routineId, a.id)]: on }))} />
    </div>)}
    {plan.skipped.map(sk => <div key={key(sk.routineId, sk.id)} className="card plan-card" data-plan-card={sk.id}>
      <div className="row between"><div className={'tt ' + nameClass(sk.id)} style={{ fontWeight: 600 }}>{nameOf(sk.id)}</div><span className="tag nocap">{t('Not done today')}</span></div>
      <SwitchRow label={t('Keep in routine')} checked={keep[key(sk.routineId, sk.id)] !== false}
        onChange={on => setKeep(k => ({ ...k, [key(sk.routineId, sk.id)]: on }))} />
    </div>)}
    {plan.tweaks.map(tp => <div key={tp.routineId} className="card plan-card">
      <SwitchRow label={templates.length > 1 ? t('Use today’s order and sets') + ' · ' + routineName(tp.routineId) : t('Use today’s order and sets')}
        checked={!!today[tp.routineId]} onChange={on => setToday(x => ({ ...x, [tp.routineId]: on }))} />
    </div>)}
    <Button variant="primary" icon="checkCircle" onClick={apply}>{t('Apply')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={onDone}>{t('Skip')}</Button>
  </div>
}
