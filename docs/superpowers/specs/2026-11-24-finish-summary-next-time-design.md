# Finish summary: validate, refuse or edit next time's numbers, and edit the duration

Short design (small change). Approved in conversation on 2026-11-24.

## Intent and why
At the end of a workout the summary already says what the next session opens at ("Next time:
62.5 kg × 5 · step up"), but it is read-only and the progression rule alone decides. The lifter
wants to see, for every exercise, what changes (old value struck, new value next to it), accept or
refuse it, type a different number by hand, and confirm everything with one button. They also want
to correct the session's duration from the summary.

## Goals
- Per exercise in the summary: old value struck, new value, a validate / keep-old toggle and an
  edit button, at the bottom right of the row. One "Validate all" button at the end.
- What the lifter chose is what the next session opens at.
- The duration tile can be edited.

## Non-goals / anti-goals
- No permanent change to the routine's plan.
- No new top-level state to sync: a choice must never conflict across devices.
- No behaviour change for someone who ignores the new controls: closing the summary leaves the
  automatic progression exactly as it is today.
- Number of sets is not editable here. Only reps-mode exercises (the ones the summary lists today).

## Constraints
- Anything that decides what you lift next is a pure helper in `frontend/src/lib` with a unit test
  beside it (CONTRIBUTING.md). User-facing text goes through `t()` into every locale pack, no em dashes.
- `nextPrescription` stays the single source of the automatic number.

## Approaches
- A. A "next session" map in the app state: new field to sync across devices. Rejected (merge risk).
- B. The choice is stored on the finished workout itself (chosen). It travels with the history that
  already syncs, expires when the next session of that routine is saved, and stays per routine.
- C. Edit the routine's weight: permanent and not honoured by progression for a weight alone.
  Rejected.

## Design (B)
- A saved workout entry may carry `next: { w, r }`: the weight and reps the lifter confirmed for
  the next session of that exercise (a kept-old choice is `next` = today's numbers).
- `nextPrescription` reads the last session of the exercise (the routine's own, as today). When that
  entry carries `next`, its weight and reps replace the policy's for the first set of the next session;
  the policy still counts stalls and the plan-changed rule still wins when the routine was edited.
  The result is `kind: 'hold'` (or `up` when above the last weight), with a line saying why
  ("Your choice at the end of the last session").
- Summary rows (`finishCompare`) get the policy's proposal as today. UI state per row: accepted
  (default, shown with the old value struck), kept, or edited. Validate toggles accepted/kept; the
  pencil opens a small weight and reps editor. Each change writes `entry.next` on the saved workout
  immediately (an accepted untouched row writes nothing, so the automatic path stays untouched);
  "Validate all" writes every row as shown and closes the summary.
- Duration: the "Duration" tile opens the duration wheel; the saved workout's `end` moves
  (`start` is kept), `dur`-style fields derived from it stay consistent, and the summary and the
  history show the new value.

## Left to the builder
- Exact wording and locale strings; layout details of the row controls on small screens.
- Whether Apple Health / the watch summary need the corrected end (check how `end` is used).
- Handling of undo of a history edit that touches `next`.
