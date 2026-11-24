// @vitest-environment happy-dom
// The "+" bubble at the end of the numbered chips: it adds an exercise, the way the header's ⋯ does.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import WorkoutChips from './WorkoutChips.jsx'

const entries = [
  { id: '0025', sets: [{ w: 60, r: 5, done: true }] },
  { id: '0334', sets: [{ w: 8, r: 12, done: false }] },
]
let host, root
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('WorkoutChips: the add bubble', () => {
  it('ends the row with a + that asks to add an exercise', () => {
    const onAdd = vi.fn()
    act(() => root.render(<WorkoutChips entries={entries} cur={0} onPick={() => {}} onAdd={onAdd} />))
    const chips = [...host.querySelectorAll('.wchip')]
    expect(chips.map(c => c.textContent)).toEqual(['1', '2', ''])
    const add = chips.at(-1)
    expect(add.getAttribute('aria-label')).toBe('Add exercise')
    act(() => add.click())
    expect(onAdd).toHaveBeenCalledTimes(1)
  })
  it('has no bubble when nothing can be added', () => {
    act(() => root.render(<WorkoutChips entries={entries} cur={0} onPick={() => {}} />))
    expect(host.querySelectorAll('.wchip')).toHaveLength(2)
  })
  it('does not count the bubble as an exercise to pick', () => {
    const onPick = vi.fn()
    act(() => root.render(<WorkoutChips entries={entries} cur={0} onPick={onPick} onAdd={() => {}} />))
    act(() => [...host.querySelectorAll('.wchip')].at(-1).click())
    expect(onPick).not.toHaveBeenCalled()
  })
})
