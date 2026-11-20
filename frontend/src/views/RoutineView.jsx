import { useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { exOr } from '../lib/exercises.js'
import { t, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { exLine, setLabel, supersetUnits } from '../lib/history.js'
import { buildSessionEntries } from '../lib/session-start.js'
import { isWarmupRow } from '../lib/workout-model.js'
import { speedUnitOf } from '../lib/speed.js'
import { supersetMeta } from '../lib/superset-meta.js'
import { glyphOf } from '../lib/glyphs.js'
import { startFlow } from '../sheets.jsx'
import { Thumb } from '../components/Media.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

/**
 * A routine as you will train it: each exercise with the sets the next session opens at (the
 * same build Start uses, lib/session-start.js, so progression is already applied), a Start button
 * on top, and a pencil to the editor (RoutineEdit.jsx). Plan's routine list opens this page.
 */
export default function RoutineView() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const r = S.routines.find(x => x.id === id)
  useEffect(() => { if (!r) nav('/plan', { replace: true }) }, [!!r])
  const entries = useMemo(() => {
    if (!r) return []
    try { return buildSessionEntries(S, r) } catch { return r.ex.map(cfg => ({ id: cfg.id, target: cfg, sets: [] })) }
  }, [S, r])
  if (!r) return null

  // A session already open: the button takes you back to it rather than starting another.
  const busy = !!S.active
  const start = () => { if (busy) nav('/workout'); else startFlow([r.id]) }
  const speedUnit = speedUnitOf(S)

  // Superset members read as A1, A2, B1... the way the editor labels them.
  const units = supersetUnits(r.ex)
  const groups = units.filter(u => u.length > 1)
  const ssPos = new Map()
  groups.forEach((u, k) => u.forEach((idx, n) => ssPos.set(idx, String.fromCharCode(65 + (k % 26)) + (n + 1))))
  const unitFirst = new Map(groups.map(u => [u[0], u]))

  return <div className="narrow routine-view">
    <div className="hdr">
      <button className="iconbtn" data-back="/plan" onClick={() => nav('/plan')} aria-label={t('Plan')}><Icon name="chevronLeft" /></button>
      <div className="row" style={{ flex: 1, margin: '0 12px', gap: 10, minWidth: 0 }}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <h1 style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</h1>
      </div>
      <button className="iconbtn" onClick={() => nav('/plan/r/' + r.id)} aria-label={t('Edit routine')} title={t('Edit routine')}><Icon name="pencil" /></button>
    </div>

    <Button variant="primary" icon="play" disabled={!busy && !r.ex.length} onClick={start}>{busy ? t('Resume') : t('Start workout')}</Button>

    <h4 className="sec">{t('Exercises')}</h4>
    {r.ex.length ? <div className="list routine-view-list">{r.ex.map((cfg, i) => {
      const ex = exOr(cfg.id)
      const entry = entries[i] || { target: cfg, sets: [] }
      let work = 0
      const sets = (entry.sets || []).map(s => {
        const warm = isWarmupRow(s)
        if (!warm) work++
        return { warm, label: warm ? t('Warm-up') : t('Set {0}', work), value: setLabel(cfg.id, s, entry.target || cfg, speedUnit) }
      })
      return <div key={i}>
        {unitFirst.has(i) && <div className="ss-label"><Icon name="link" /><span className="ss-label-name">{supersetMeta(r.ex, unitFirst.get(i)).name || t('Superset')}</span></div>}
        <div className={'item routine-view-ex' + (ssPos.has(i) ? ' in-ss' : '')}>
          {ssPos.has(i) && <span className="ss-pos">{ssPos.get(i)}</span>}
          <Thumb ex={ex} />
          <div className="grow">
            <div className={`tt ${exerciseNameClass(ex)}`}>{exerciseNameFor(ex)}</div>
            <div className="ss">{exLine(entry.target || cfg, S.unit, speedUnit)}</div>
            {cfg.note && <div className="small dim" style={{ marginTop: 2 }}>{cfg.note}</div>}
            {sets.length > 0 && <ol className="routine-view-sets">{sets.map((s, k) =>
              <li key={k} className={s.warm ? 'warm' : undefined}><span>{s.label}</span><span className="num">{s.value}</span></li>)}</ol>}
          </div>
        </div>
      </div>
    })}</div> : <div className="empty"><div className="ico"><Icon name="dumbbell" /></div>{t('No exercises yet. Add your first one!')}
      <div style={{ marginTop: 12 }}><Button size="sm" variant="tinted" icon="pencil" onClick={() => nav('/plan/r/' + r.id)}>{t('Edit routine')}</Button></div>
    </div>}
  </div>
}
