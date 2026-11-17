import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { fatSeries, latestBody, weightSeries } from '../lib/body.js'
import { MOBILE } from '../lib/mobile.js'
import { healthStatus, loadHealth, onHealthChange, openHealthConnect, syncBodyNow } from '../lib/health-sync.js'
import { fmtDate, fmtNum, isoOf } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Segmented } from '../components/ui.jsx'

const RANGES = () => [{ value: 30, label: '1M' }, { value: 90, label: '3M' }, { value: 365, label: '1Y' }, { value: 0, label: t('All') }]

/**
 * The Sync button and the time of the last read, on the Android app (Health Connect). Shared with
 * Settings. Renders nothing where there is no Health Connect to read from.
 */
export function BodySyncButton({ size = 'sm', variant, withTime = true }) {
  const [st, setSt] = useState(null)
  const [h, setH] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!MOBILE) return
    let gone = false
    Promise.all([healthStatus(), loadHealth()]).then(([s, f]) => { if (!gone) { setSt(s); setH(f) } }).catch(() => {})
    const off = onHealthChange(f => { if (!gone) setH(f) })
    return () => { gone = true; off() }
  }, [])
  if (!MOBILE || !st || st.platform !== 'android' || st.status === 'unsupported') return null
  const toast = m => useUI.getState().toast(m)
  const run = async () => {
    if (st.status !== 'available') {
      toast(st.status === 'update' ? t('Update Health Connect first, then try again.') : t('Install Health Connect first, then try again.'))
      openHealthConnect().catch(() => {})
      return
    }
    setBusy(true)
    try {
      const r = await syncBodyNow(() => useStore.getState().S)
      if (r.health) setH(r.health)
      toast(r.ok ? t('Synced with Health Connect') : r.reason === 'denied' || r.reason === 'permission' ? t('Health Connect permission not granted') : t('Could not read Health Connect'))
    } catch { toast(t('Could not read Health Connect')) }
    setBusy(false)
  }
  return <div className="row" style={{ gap: 10, alignItems: 'center' }}>
    <Button size={size} variant={variant} icon="repeat" disabled={busy} onClick={run}>{busy ? t('Syncing…') : t('Sync')}</Button>
    {withTime && h?.readAt > 0 && <span className="small dim">{t('Last sync {0}', fmtDate(isoOf(new Date(h.readAt)), true))}</span>}
  </div>
}

function Stat({ label, value, unit }) {
  if (value == null) return null
  return <span>{label} <b>{fmtNum(value)}{unit ? ' ' + unit : ''}</b></span>
}

export default function Body() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [range, setRange] = useState(90)
  const from = useMemo(() => (range ? Date.now() - range * 86400000 : 0), [range])
  const weight = useMemo(() => weightSeries(S, from), [S.bodyweight, from])
  const fat = useMemo(() => fatSeries(S, from), [S.bodyComp, S.measurements, from])
  const last = useMemo(() => latestBody(S), [S.bodyweight, S.bodyComp, S.bodyHeight, S.measurements, S.unit])
  const unit = S.unit === 'lb' ? 'lb' : 'kg'

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" data-back="/stats" onClick={() => nav('/stats')} aria-label={t('Stats')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('Body')}</h1></div>
    </div>

    <div className="card">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="muted small">{last ? t('Last weigh-in, {0}', fmtDate(last.d, true)) : t('Last weigh-in')}</div>
          <div className="big" style={{ marginTop: 3 }}>{last?.w != null ? <>{fmtNum(last.w)} <span className="muted" style={{ fontSize: '1rem' }}>{unit}</span></> : '–'}</div>
          {last?.delta != null && last.delta !== 0 && <div className="small" style={{ marginTop: 3, color: 'var(--label-2)' }}>{last.delta > 0 ? '+' : ''}{fmtNum(last.delta)} {unit} {t('since previous')}</div>}
        </div>
        {last?.fat != null && <div style={{ textAlign: 'end' }}>
          <div className="muted small">{t('Body fat')}</div>
          <div className="big" style={{ marginTop: 3 }}>{fmtNum(last.fat)} <span className="muted" style={{ fontSize: '1rem' }}>%</span></div>
        </div>}
      </div>
      {last && (last.bmi != null || last.lean != null || last.water != null || last.bone != null || last.bmr != null) && <div className="measure-preview">
        <Stat label={t('BMI')} value={last.bmi} />
        <Stat label={t('Lean mass')} value={last.lean} unit={unit} />
        <Stat label={t('Body water')} value={last.water} unit={unit} />
        <Stat label={t('Bone mass')} value={last.bone} unit={unit} />
        <Stat label={t('BMR')} value={last.bmr} unit="kcal" />
      </div>}
      {MOBILE && <div style={{ marginTop: 12 }}><BodySyncButton /></div>}
    </div>

    <Segmented className="seg-range" value={range} onChange={setRange} options={RANGES()} />

    <div className="card">
      <h2 style={{ margin: '0 0 8px' }}>{t('Body weight')}</h2>
      {weight.length ? <div className="chart"><LineChart points={weight} h={160} unit={unit} goal={S.targetW} /></div>
        : <div className="empty small">{t('No weigh-ins yet. Log your weight to start the curve.')}</div>}
    </div>

    <div className="card">
      <h2 style={{ margin: '0 0 8px' }}>{t('Body fat')}</h2>
      {fat.length ? <div className="chart"><LineChart points={fat} h={160} unit="%" color="var(--orange)" /></div>
        : <div className="empty small">{t('No body fat readings yet')}</div>}
    </div>
  </div>
}
