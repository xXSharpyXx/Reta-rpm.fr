// The finish summary's "Next time" line for an exercise with a progression proposal, and the
// controls under it: validate (the proposal stands), keep the weight just lifted, or type other
// numbers; plus one button that confirms every row. What is chosen is written on the saved
// workout's entry (lib/next-choice.js), where the next session's prescription reads it back.
// The rows come from lib/finish-compare.js; an untouched row writes nothing, so ignoring all of
// this leaves the automatic progression exactly as it was.
import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { setNextChoices } from '../lib/next-choice.js'
import { Button, Stepper } from './ui.jsx'
import Icon from './Icon.jsx'

const same = (a, b) => !!a && !!b && a.w === b.w && a.r === b.r

/** What the policy proposes, as a choice: the weight and reps (the old ones where it names none). */
export const proposalOf = row => ({ w: row.next.w ?? row.was.w, r: row.next.r ?? row.was.r })
/** The weight just lifted, kept: what refusing the proposal means. */
const keptOf = row => ({ w: row.was.w, r: row.was.r ?? row.next.r })
const valid = c => !!c && Number.isFinite(c.w) && c.w >= 0 && Number.isFinite(c.r) && c.r >= 1

/** 'proposal' (it stands, written or not), 'kept' (the old weight) or 'edited' (other numbers). */
export function choiceState(row) {
  if (!row.chosen || same(row.chosen, proposalOf(row))) return 'proposal'
  return same(row.chosen, keptOf(row)) ? 'kept' : 'edited'
}

function save(rec, choices) {
  useStore.getState().update(s => {
    const next = setNextChoices(s.workouts, rec, choices)
    if (next) s.workouts = next
  })
}

function NextTimeEditor({ row, rec, unit, name, close }) {
  const start = row.chosen || proposalOf(row)
  const [w, setW] = useState(start.w)
  const [r, setR] = useState(start.r ?? 1)
  const ok = valid({ w, r })
  return <>
    <h3>{t('Next time')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{name}</div>
    <Stepper label={t('Weight')} unit={unit} value={w} step={row.step || 2.5} min={0} onChange={setW} />
    <div style={{ height: 10 }} />
    <Stepper label={t('Reps')} value={r} step={1} min={1} decimal={false} onChange={v => setR(Math.round(v))} />
    <div style={{ height: 18 }} />
    <Button variant="primary" disabled={!ok} onClick={() => { if (!ok) return; save(rec, [{ id: row.id, rid: row.rid, choice: { w, r } }]); close() }}>{t('Save')}</Button>
  </>
}

/**
 * One exercise's "Next time" line and its controls. `word` is the policy's own name for the move
 * ("step up", "same again"…), kept for the proposal when nothing was chosen.
 */
export function NextTimeLine({ row, rec, unit, name, word }) {
  const state = choiceState(row)
  const prop = proposalOf(row)
  const kept = keptOf(row)
  const moves = !same(prop, kept)           // nothing to refuse when the proposal is what was lifted
  const shown = row.chosen || prop
  const struck = !row.chosen && moves
  const wText = shown.w != null ? fmtNum(shown.w) + ' ' + unit : ''
  const refuse = () => save(rec, [{ id: row.id, rid: row.rid, choice: valid(kept) ? kept : null }])
  const restore = () => save(rec, [{ id: row.id, rid: row.rid, choice: null }])
  const edit = () => useUI.getState().openSheet(close => <NextTimeEditor row={row} rec={rec} unit={unit} name={name} close={close} />)
  return <>
    <div className="small accent" data-next-line>
      {t('Next time')}: {struck && row.was.w != null && prop.w !== row.was.w && <><del className="dim">{fmtNum(row.was.w)} {unit}</del>{' '}</>}{wText}
      {shown.w != null && shown.r != null ? ' × ' : ''}
      {struck && row.was.r != null && prop.r !== row.was.r && <><del className="dim">{row.was.r}</del>{' '}</>}{shown.r != null ? shown.r : ''}
      {' · '}{row.chosen ? t('Your choice') : word}
    </div>
    <div className="row" data-next-controls style={{ justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
      {moves && <button type="button" className={'chip' + (state === 'kept' ? ' on' : '')} aria-pressed={state !== 'edited'}
        onClick={state === 'proposal' ? refuse : restore}>
        {state === 'kept' ? t('Keep {0}', fmtNum(kept.w) + ' ' + unit) : <><Icon name="check" /><span>{t('Apply')}</span></>}
      </button>}
      <button type="button" className="iconbtn" aria-label={t('Edit next time')} onClick={edit}><Icon name="pencil" /></button>
    </div>
  </>
}

/** One button for the whole list: every row written as it is shown (the proposal or its choice). */
export function ValidateAll({ rows, rec }) {
  const editable = rows.filter(r => r.editable && r.next)
  if (!editable.length) return null
  const run = () => {
    const choices = editable.map(row => {
      const choice = row.chosen || proposalOf(row)
      return valid(choice) ? { id: row.id, rid: row.rid, choice: { w: choice.w, r: choice.r } } : null
    }).filter(Boolean)
    if (choices.length) save(rec, choices)
    useUI.getState().toast(t('Next session set'))
  }
  return <Button variant="primary" icon="checkCircle" onClick={run}>{t('Validate all')}</Button>
}
