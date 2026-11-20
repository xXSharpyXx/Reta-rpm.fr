// Choosing the app's look (lib/app-themes.js): three main themes up front, the others one tap
// away. The same tiles in Settings → Look (themeSheet) and once at the first launch
// (themeWelcomeSheet), where nothing else is asked.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { MAIN_THEMES, EXTRA_THEMES, pickTheme } from '../lib/app-themes.js'
import { setRestAccent } from '../lib/rest-alert.js'
import { Button } from './ui.jsx'

// Spelled out as t() literals so the strings check sees each name.
export const themeName = id => ({
  light: t('Light'), dark: t('Dark'), brand: 'Reta-rpm', system: t('System'),
  ocean: t('Ocean'), forest: t('Forest'), neon: t('Neon'), sand: t('Sand'),
}[id] || id)

function Tile({ th, on, onPick }) {
  const [bg, card, acc] = th.swatch
  return <button type="button" className={'thp-tile' + (on ? ' on' : '')} aria-pressed={on} onClick={() => onPick(th.id)}>
    <span className="thp-prev" style={{ background: bg }} aria-hidden="true">
      <i style={{ background: card }} /><b style={{ background: acc }} />
    </span>
    <span className="thp-name">{themeName(th.id)}</span>
  </button>
}

export function ThemeTiles({ value, onPick, more }) {
  return <>
    <div className="thp-grid">{MAIN_THEMES.map(th => <Tile key={th.id} th={th} on={value === th.id} onPick={onPick} />)}</div>
    {more && <>
      <h4 className="sec thp-sec">{t('More themes')}</h4>
      <div className="thp-grid">{EXTRA_THEMES.map(th => <Tile key={th.id} th={th} on={value === th.id} onPick={onPick} />)}</div>
    </>}
  </>
}

const usePick = () => {
  const update = useStore(s => s.update)
  return id => update(s => {
    pickTheme(s, id)
    if (s.accent) setRestAccent(s.accent)
  })
}

function ThemeSheet() {
  const theme = useStore(s => s.S.theme)
  const pick = usePick()
  return <>
    <h3 className="fs-title">{t('Theme')}</h3>
    <ThemeTiles value={theme} onPick={pick} more />
    <Button size="sm" variant={theme === 'system' ? 'tinted' : undefined} className="thp-more" onClick={() => pick('system')}>
      {t('Follow the device (light or dark)')}
    </Button>
  </>
}

function ThemeWelcome({ close }) {
  const theme = useStore(s => s.S.theme)
  const update = useStore(s => s.update)
  const pick = usePick()
  const [more, setMore] = useState(false)
  const done = () => { update(s => { if (!s.themePicked) pickTheme(s, s.theme || 'brand') }); close() }
  return <>
    <h3 className="thp-intro">{t('Pick your look')}</h3>
    <p className="small thp-sub">{t('You can change it any time in Settings.')}</p>
    <ThemeTiles value={theme} onPick={pick} more={more} />
    {!more && <Button size="sm" variant="ghost" className="thp-more" onClick={() => setMore(true)}>{t('More themes')}</Button>}
    <Button variant="primary" className="thp-go" onClick={done}>{t('Continue')}</Button>
  </>
}

export const themeSheet = () => useUI.getState().openSheet(() => <ThemeSheet />)

let asked = false
/** Once per launch at most, and only while the question is still open. */
export function themeWelcomeSheet() {
  if (asked || useStore.getState().S.themePicked) return
  asked = true
  useUI.getState().openSheet(close => <ThemeWelcome close={close} />, { locked: true })
}
