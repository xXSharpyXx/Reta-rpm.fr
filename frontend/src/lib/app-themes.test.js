import { describe, it, expect } from 'vitest'
import { APP_THEMES, MAIN_THEMES, DEFAULT_THEME, themeOf, resolveAppTheme, pickTheme } from './app-themes.js'

describe('app themes', () => {
  it('has three main looks: light, dark and the Reta-rpm one', () => {
    expect(MAIN_THEMES.map(t => t.id)).toEqual(['light', 'dark', 'brand'])
    expect(DEFAULT_THEME).toBe('brand')
    expect(new Set(APP_THEMES.map(t => t.id)).size).toBe(APP_THEMES.length)
  })

  it('resolves a look to its base and skin', () => {
    expect(resolveAppTheme('light')).toEqual({ base: 'light', skin: '' })
    expect(resolveAppTheme('dark')).toEqual({ base: 'dark', skin: '' })
    expect(resolveAppTheme('brand')).toEqual({ base: 'dark', skin: 'brand' })
    expect(resolveAppTheme('sand')).toEqual({ base: 'light', skin: 'sand' })
    expect(resolveAppTheme('ocean')).toEqual({ base: 'dark', skin: 'ocean' })
  })

  it('follows the device for system, with no skin', () => {
    expect(resolveAppTheme('system', true)).toEqual({ base: 'dark', skin: '' })
    expect(resolveAppTheme('system', false)).toEqual({ base: 'light', skin: '' })
  })

  it('reads an unknown or missing theme as the default', () => {
    expect(themeOf(undefined).id).toBe('brand')
    expect(resolveAppTheme('nope')).toEqual({ base: 'dark', skin: 'brand' })
  })

  it('picking a look sets its accent and answers the first-launch question', () => {
    const s = { theme: 'dark', accent: 'sky' }
    pickTheme(s, 'brand')
    expect(s).toEqual({ theme: 'brand', accent: 'red', themePicked: true })
    pickTheme(s, 'light')
    expect(s.theme).toBe('light')
    expect(s.accent).toBe('red')   // plain light keeps the accent you had
    pickTheme(s, 'bogus')
    expect(s.theme).toBe('light')
    pickTheme(s, 'system')
    expect(s.theme).toBe('system')
  })
})
