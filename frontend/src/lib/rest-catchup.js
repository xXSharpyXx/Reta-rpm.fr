// A set ticked on another device (the Lock Screen's Done, the Apple Watch) starts its rest the moment
// it is tapped there, but the page may hear of the tick much later: the phone was asleep in a
// pocket, and the event waits in the native queue until the app opens. The rest the page starts for
// it must not begin again from that late moment, or it ends later than the other device's does and
// each of the two restarts its own countdown to follow the other's.
//
// Returns the whole seconds to take off the rest the tick just started: how long ago the tap was,
// or 0 when there is nothing to catch up (heard of at once, no new rest, a rest that is paused or
// over, a tap time that is missing or in the future because the clocks differ).
export function restCatchUp (restBefore, restNow, at, now = Date.now()) {
  if (!restNow || restNow === restBefore || restNow.ready || restNow.paused) return 0
  const tapped = Number(at)
  if (!Number.isFinite(tapped) || tapped <= 0) return 0
  const late = Math.floor((now - tapped) / 1000)
  return late > 1 ? late : 0
}
