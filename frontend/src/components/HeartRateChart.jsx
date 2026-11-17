// The heart rate of a finished workout over time (lib/heart-rate.js hrSeries): a filled red
// curve with the lowest and highest bpm on the right and the minutes along the bottom. Small on
// the workout's read-back; the full sheet (sheets.jsx heartRateSheet) makes it interactive: a tap
// or a drag puts a line on a moment and `onPick` hears which point it is.
import { useRef } from 'react'
import { seriesPoints } from '../lib/heart-rate.js'
import { t } from '../lib/i18n.js'

const W = 340
const PAD_R = 30   // room for the bpm labels on the right
const PAD_B = 18   // room for the minutes under the curve
// The share of the width the curve itself takes, for anything lined up under it.
export const PLOT_SHARE = (W - PAD_R) / W

// Gridlines every 5, 10, 15 or 30 minutes: about four to seven across the chart.
const stepFor = min => [5, 10, 15, 30, 60].find(s => min / s <= 7) || 60

export default function HeartRateChart({ series, h = 120, pick = null, onPick = null, marks = [] }) {
  const svgRef = useRef(null)
  const pts = seriesPoints(series)
  if (pts.length < 2) return null
  const span = series.v.length * series.dt
  const lo = Math.min(...pts.map(p => p.bpm)), hi = Math.max(...pts.map(p => p.bpm))
  const yLo = Math.max(0, lo - 4), yHi = hi + 4
  const cw = W - PAD_R, ch = h - PAD_B
  const x = s => (s / span) * cw
  const y = bpm => ch - ((bpm - yLo) / (yHi - yLo || 1)) * (ch - 4)
  // Gaps in the curve (no sample in a bucket) are bridged: a band that saved nothing for a minute
  // still had a heart beating.
  const line = pts.map((p, i) => (i ? 'L' : 'M') + x(p.s).toFixed(1) + ' ' + y(p.bpm).toFixed(1)).join(' ')
  const area = line + ` L${x(pts[pts.length - 1].s).toFixed(1)} ${ch} L${x(pts[0].s).toFixed(1)} ${ch} Z`
  const minutes = span / 60
  const step = stepFor(minutes)
  const grid = []
  for (let m = step; m < minutes; m += step) grid.push(m)

  const choose = ev => {
    if (!onPick || !svgRef.current) return
    const r = svgRef.current.getBoundingClientRect()
    const px = ((ev.clientX - r.left) / r.width) * W
    const s = Math.max(0, Math.min(span, (px / cw) * span))
    let best = pts[0]
    for (const p of pts) if (Math.abs(p.s - s) < Math.abs(best.s - s)) best = p
    onPick(best)
  }
  const handlers = onPick ? {
    onPointerDown: ev => { ev.currentTarget.setPointerCapture?.(ev.pointerId); choose(ev) },
    onPointerMove: ev => { if (ev.buttons || ev.pointerType === 'touch') choose(ev) },
  } : {}

  return <svg ref={svgRef} className={'hrc' + (onPick ? ' live' : '')} viewBox={`0 0 ${W} ${h}`} width="100%" role="img" aria-label={t('Heart rate')} {...handlers}>
    {grid.map(m => <line key={m} x1={x(m * 60)} x2={x(m * 60)} y1={0} y2={ch} className="hrc-grid" />)}
    <line x1={0} x2={cw} y1={ch} y2={ch} className="hrc-base" />
    <path d={area} className="hrc-area" />
    <path d={line} className="hrc-line" />
    {marks.map((m, i) => <circle key={i} cx={x(m.ms / 1000)} cy={ch} r={2.5} className="hrc-mark" />)}
    {pick && <>
      <line x1={x(pick.s)} x2={x(pick.s)} y1={0} y2={ch} className="hrc-pick" />
      <circle cx={x(pick.s)} cy={y(pick.bpm)} r={4} className="hrc-dot" />
    </>}
    <text x={W - 2} y={10} className="hrc-lbl" textAnchor="end">{hi}</text>
    <text x={W - 2} y={ch - 2} className="hrc-lbl" textAnchor="end">{lo}</text>
    <text x={0} y={h - 4} className="hrc-lbl" textAnchor="start">{t('{0} min', 0)}</text>
    {onPick
      ? grid.map(m => <text key={m} x={x(m * 60)} y={h - 4} className="hrc-lbl" textAnchor="middle">{t('{0} min', m)}</text>)
      : <text x={cw} y={h - 4} className="hrc-lbl" textAnchor="end">{t('{0} min', Math.round(minutes))}</text>}
  </svg>
}
