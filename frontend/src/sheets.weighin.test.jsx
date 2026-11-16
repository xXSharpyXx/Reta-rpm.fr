// @vitest-environment happy-dom
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { startFlow, startSession } from './sheets.jsx'

// Starting a workout (the Workouts page's buttons, a coach week's chip on Home): each one names
// the session it starts, so there is nothing to pick or confirm. The quick weigh-in comes first
// unless Settings → During a workout → "Weigh in before workouts" is off (issue #137), in which
// case the session begins at once with no body weight on it.
describe('starting a workout: weigh in, then the session', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [] })
    useStore.setState(s => ({
      S: {
        ...s.S, active: null, bodyweight: [], weighIn: true, workouts: [],
        routines: [
          { id: 'push', name: 'Push', ex: [{ id: '0025' }, { id: '1457' }] },
          { id: 'core', name: 'Core', ex: [{ id: '0001' }] },
        ],
      },
    }))
  })

  it('on (the default): the weigh-in opens and the session waits for it', () => {
    act(() => startFlow(['core']))
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(useUI.getState().sheets[0].locked).toBe(true)   // the required weigh-in, not a picker
    expect(useStore.getState().S.active).toBeNull()
  })

  it('a profile written before the setting existed still asks', () => {
    useStore.setState(s => { const S = { ...s.S }; delete S.weighIn; return { S } })
    act(() => startSession(['push']))
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(useUI.getState().sheets[0].locked).toBe(true)
    expect(useStore.getState().S.active).toBeNull()
  })

  it('off: the session begins at once, with no sheet and no body weight', () => {
    useStore.setState(s => ({ S: { ...s.S, weighIn: false } }))
    act(() => startFlow(['core']))
    expect(useUI.getState().sheets).toHaveLength(0)
    const { active } = useStore.getState().S
    expect(active).not.toBeNull()
    expect(active.bw).toBeNull()
    expect(active.routineIds).toEqual(['core'])
    expect(active.name).toBe('Core')
  })

  it('a combined day starts as one session', () => {
    useStore.setState(s => ({ S: { ...s.S, weighIn: false } }))
    act(() => startSession(['push', 'core']))
    expect(useStore.getState().S.active.routineIds).toEqual(['push', 'core'])
  })

  it('Freestyle starts an empty session', () => {
    useStore.setState(s => ({ S: { ...s.S, weighIn: false } }))
    act(() => startSession([]))
    const { active } = useStore.getState().S
    expect(active.routineIds).toEqual([])
    expect(active.entries).toEqual([])
  })
})
