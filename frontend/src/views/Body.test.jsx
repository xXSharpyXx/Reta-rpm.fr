// @vitest-environment happy-dom
// The Body page: the last weigh-in with what the scale measured that day, and the two curves.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: vi.fn(() => Promise.reject(new Error('offline'))), beacon: vi.fn() }))

import { DEF, useStore } from '../store/useStore.js'
import Body from './Body.jsx'

const mounted = []
function render() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(<MemoryRouter><Body /></MemoryRouter>))
  return host
}
afterEach(() => { mounted.splice(0).forEach(r => act(() => r.unmount())); document.body.innerHTML = '' })

describe('Body page', () => {
  it('shows the last weigh-in, its body fat and BMI, and both curves', () => {
    const today = new Date()
    const iso = d => new Date(today.getTime() - d * 86400000).toISOString().slice(0, 10)
    useStore.setState({ S: Object.assign(JSON.parse(JSON.stringify(DEF)), {
      unit: 'kg',
      bodyweight: [{ d: iso(3), w: 81.2 }, { d: iso(1), w: 80.6 }],
      bodyComp: [{ d: iso(3), t: 1, src: 'hc', fat: 19 }, { d: iso(1), t: 2, src: 'hc', fat: 18.4, lean: 62.3 }],
      bodyHeight: { m: 1.8, t: 1 },
    }), user: null })
    const host = render()
    const text = host.textContent
    expect(text).toContain('80.6')
    expect(text).toContain('18.4')
    expect(text).toContain('24.9')
    expect(text).toContain('62.3')
    expect(host.querySelectorAll('.chart svg').length).toBe(2)
  })

  it('says so when nothing was weighed yet', () => {
    useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: null })
    const text = render().textContent
    expect(text).toContain('No weigh-ins yet')
    expect(text).toContain('No body fat readings yet')
  })
})
