// The app's looks. Three main ones (light, dark and the Reta-rpm.fr one taken from tom-rpm.fr),
// then a few more for fun. Each is drawn on one of two bases, light or dark: <html data-theme>
// keeps saying "light" or "dark", so every rule written for those two keeps working, and
// <html data-skin> names the look itself, which src/themes.css (and brand.css for the Reta one)
// paints on top.
//
// S.theme stores the id. 'system' follows the device between light and dark, with no skin.
// Choosing a look also sets the accent it was drawn with; the accent can still be changed after.

export const MAIN_THEMES = [
  { id: 'light', name: 'Light', base: 'light', accent: null, swatch: ['#f2f2f7', '#ffffff', '#34c759'] },
  { id: 'dark', name: 'Dark', base: 'dark', accent: null, swatch: ['#000000', '#1c1c1e', '#30d158'] },
  { id: 'brand', name: 'Reta-rpm', base: 'dark', accent: 'red', swatch: ['#0a0a0b', '#131826', '#e0524e'] },
]

export const EXTRA_THEMES = [
  { id: 'ocean', name: 'Ocean', base: 'dark', accent: 'teal', swatch: ['#04131c', '#0b2433', '#40c8e0'] },
  { id: 'forest', name: 'Forest', base: 'dark', accent: 'lime', swatch: ['#07110b', '#11231a', '#30d158'] },
  { id: 'neon', name: 'Neon', base: 'dark', accent: 'pink', swatch: ['#0b0614', '#1a1030', '#ff375f'] },
  { id: 'sand', name: 'Sand', base: 'light', accent: 'orange', swatch: ['#f4eee4', '#fffaf2', '#ff9500'] },
]

export const APP_THEMES = [...MAIN_THEMES, ...EXTRA_THEMES]

export const DEFAULT_THEME = 'brand'

const BY_ID = new Map(APP_THEMES.map(th => [th.id, th]))

/** The look for a stored id; an unknown or missing one is the default. 'system' is not a look. */
export const themeOf = id => BY_ID.get(id) || BY_ID.get(DEFAULT_THEME)

/**
 * What <html> gets for a stored theme: `base` for data-theme ('light' | 'dark') and `skin` for
 * data-skin (a look's id, or '' for the plain light and dark and for 'system').
 * `prefersDark` is the device's preference, read only for 'system'.
 */
export function resolveAppTheme(id, prefersDark = true) {
  if (id === 'system') return { base: prefersDark ? 'dark' : 'light', skin: '' }
  const th = themeOf(id)
  return { base: th.base, skin: th.id === 'light' || th.id === 'dark' ? '' : th.id }
}

/** The state change for picking a look: the theme, its accent when it has one, and the first-launch question answered. */
export function pickTheme(s, id) {
  const th = id === 'system' ? null : BY_ID.get(id)
  if (id !== 'system' && !th) return
  s.theme = id
  if (th?.accent) s.accent = th.accent
  s.themePicked = true
}
