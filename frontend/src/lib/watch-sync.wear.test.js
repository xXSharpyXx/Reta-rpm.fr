// @vitest-environment happy-dom
// The Wear OS watch's additions to the watch link: its rest buttons move the phone's rest, and
// the heart rate it measured (one file per workout on the phone) is read into the saved workout.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyEvents, bindWatchAppActions, hrFilesToMerge, mergeWatchHr, _setWatchPluginForTest, _resetWatchSync, REST_EVENT_MAX_AGE_MS } from './watch-sync.js'
import { mergeHeartRate } from './health-read.js'

const active = { id: 'w-1', start: 1, entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: false }] }] }
const S = (over = {}) => ({ active, workouts: [], ...over })
const store = s => () => ({ S: s })

beforeEach(() => { localStorage.clear(); _resetWatchSync() })
afterEach(() => _resetWatchSync())

describe('the rest buttons', () => {
  const app = () => ({ restAdd: vi.fn(), restSkip: vi.fn(), patchSet: vi.fn(), start: vi.fn() })

  it('moves the phone\'s rest by the watch\'s seconds, and skips it', () => {
    const h = app()
    bindWatchAppActions(h)
    const now = Date.now()
    const done = applyEvents([
      { id: 'a', type: 'restAdd', wid: 'w-1', sec: 15, at: now },
      { id: 'b', type: 'restAdd', wid: 'w-1', sec: -15, at: now },
      { id: 'c', type: 'restSkip', wid: 'w-1', at: now },
    ], store(S()))
    expect(done).toEqual(['a', 'b', 'c'])
    expect(h.restAdd.mock.calls).toEqual([[15], [-15]])
    expect(h.restSkip).toHaveBeenCalledOnce()
  })

  it('drops a press that is a minute old, or about another workout, without replaying it', () => {
    const h = app()
    bindWatchAppActions(h)
    const done = applyEvents([
      { id: 'a', type: 'restSkip', wid: 'w-1', at: Date.now() - REST_EVENT_MAX_AGE_MS - 1000 },
      { id: 'b', type: 'restAdd', wid: 'w-other', sec: 15, at: Date.now() },
    ], store(S()))
    expect(done).toEqual(['a', 'b'])
    expect(h.restSkip).not.toHaveBeenCalled()
    expect(h.restAdd).not.toHaveBeenCalled()
  })

  it('keeps the press queued until the app can apply it', () => {
    const done = applyEvents([{ id: 'a', type: 'restSkip', wid: 'w-1', at: Date.now() }], store(S()))
    expect(done).toEqual([])
  })

  it('caps an absurd number of seconds', () => {
    const h = app()
    bindWatchAppActions(h)
    applyEvents([{ id: 'a', type: 'restAdd', wid: 'w-1', sec: 99999, at: Date.now() }], store(S()))
    expect(h.restAdd).toHaveBeenCalledWith(600)
  })
})

describe('which heart-rate files to read', () => {
  const saved = { id: 'w-0', start: 1000, end: 5000, entries: [] }
  it('only a saved workout, and only when its file grew', () => {
    const s = S({ workouts: [saved] })
    const files = [{ wid: 'w-0', n: 10 }, { wid: 'w-1', n: 5 }, { wid: 'gone', n: 3 }, { wid: 'w-0x', n: 0 }]
    expect(hrFilesToMerge(files, s)).toEqual(['w-0'])
    expect(hrFilesToMerge(files, s, { 'w-0': { n: 10 } })).toEqual([])
    expect(hrFilesToMerge(files, s, { 'w-0': { n: 4 } })).toEqual(['w-0'])
    expect(hrFilesToMerge(null, s)).toEqual([])
  })
})

describe('reading the watch\'s heart rate into the log', () => {
  it('reads each new file once and hands its samples over', async () => {
    const s = S({ active: null, workouts: [{ id: 'w-0', start: 1000, end: 60000, entries: [] }] })
    const plugin = {
      listHr: vi.fn(async () => ({ files: [{ wid: 'w-0', n: 2 }] })),
      readHr: vi.fn(async () => ({ samples: [[2000, 100], [3000, 110]] })),
    }
    _setWatchPluginForTest(plugin, store(s))
    const mergeHr = vi.fn()
    bindWatchAppActions({ mergeHr })
    expect(await mergeWatchHr()).toEqual(['w-0'])
    expect(mergeHr).toHaveBeenCalledWith('w-0', [[2000, 100], [3000, 110]])
    // Nothing new in the file: not read again.
    expect(await mergeWatchHr()).toEqual([])
    expect(plugin.readHr).toHaveBeenCalledOnce()
  })

  it('does nothing on a phone whose native side has no heart-rate files (the iPhone)', async () => {
    _setWatchPluginForTest({}, store(S()))
    bindWatchAppActions({ mergeHr: vi.fn() })
    expect(await mergeWatchHr()).toEqual([])
  })

  it('the samples give the session and its sets a reading, and a fuller file replaces the session\'s', () => {
    const w = { id: 'w-0', start: 1, end: 200000, entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true, at: 60000 }, { w: 60, r: 8, done: true, at: 150000 }] }] }
    const s = { workouts: [w] }
    const samples = []
    for (let t = 0; t <= 200000; t += 5000) samples.push([t, 100 + (t / 5000)])
    expect(mergeHeartRate(s, 'w-0', samples.slice(0, 20), 'wear', 1)).toBe(true)
    const first = w.hr
    expect(first.src).toBe('wear')
    expect(w.entries[0].sets[0].hr).toBeTruthy()
    expect(mergeHeartRate(s, 'w-0', samples, 'wear', 2)).toBe(true)
    expect(w.hr.n).toBeGreaterThan(first.n)
  })
})
