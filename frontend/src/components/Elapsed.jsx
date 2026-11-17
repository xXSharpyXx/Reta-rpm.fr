import { useEffect, useState } from 'react'

/** "12:34" (minutes:seconds) under an hour, "1:05" (hours:minutes) from the hour on. */
export function fmtElapsed(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  if (s >= 3600) return Math.floor(s / 3600) + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0')
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

// A session's running time since `start`: "12:34", then "1:05" (hours:minutes) past the hour.
// Its own little component so the only thing that re-renders every second is this text: the
// workout header and the tab bar's Resume button both show it.
export default function Elapsed({ start }) {
  const [t, setT] = useState('0:00')
  useEffect(() => {
    const tick = () => setT(fmtElapsed((Date.now() - start) / 1000))
    // Hidden (another app, the screen locked), nobody reads it: no re-render a second, and the
    // count is right again the moment the page shows.
    const onTick = () => { if (!document.hidden) tick() }
    tick(); const iv = setInterval(onTick, 1000)
    document.addEventListener('visibilitychange', onTick)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onTick) }
  }, [start])
  return <span>{t}</span>
}
