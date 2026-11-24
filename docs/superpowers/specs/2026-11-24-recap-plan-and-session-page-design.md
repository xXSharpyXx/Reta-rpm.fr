# Recap as next session's plan, swipe days, add-exercise bubble, Workouts page

Design (owner delegated the UX calls on 2026-11-24). Builds on
`2026-11-24-finish-summary-next-time-design.md` (the choice is still stored as `entry.next`).

## 1. Finish recap: page one is the plan of the next session
- Opens first after Finish; "Apply" saves and moves to page two, today's small summary (name, note,
  duration, volume, sets, gym, photos, Save), unchanged except that the duration stays editable.
- One card per exercise of the routine base, laid out like the workout screen's set rows
  (`.setrow`: set bubble W / F / number, weight cell, reps cell, same steppers):
  - done exercise (reps mode): rows are the next session's sets; where the proposal differs from
    what was done, the old value shows small and struck at the left of the cell and the new one in
    green. The steppers edit the exercise's next weight and reps (one pair per exercise: load vs
    rep progression and constant load vs pyramids give similar results at equal volume, so no
    per-set weights). Warm-up rows follow the work weight. Under the rows: Refuse / Validate for the
    whole exercise (Validate stands by default; Refuse keeps today's numbers).
  - routine exercise not done today: card marked "Not done today", numbers unchanged (nothing was
    lifted to progress from), switch "Keep in routine" on by default.
  - exercise added today: card marked "New" with the numbers proposed from today, switch "Add to
    routine" off by default.
  - order or set counts differ from the routine: one line "Use today's order and sets", off.
- The old "keep as template" dialog and the "New in this workout" offer are replaced by this.
- Apply writes `entry.next` on the saved workout for done exercises (validated or edited ones; a
  refusal writes today's numbers) and the routine's exercise list for the structure switches.
- Cardio and timed exercises have no weights to propose: they appear only through the structure switches.

## 2. Home: swipe the day
A sideways swipe on the selected day's content moves one day: toward the left, the day before;
toward the right, the day after (as the owner asked; one constant flips it). Vertical scroll untouched.

## 3. Workout: add-exercise bubble
A "+" chip after the last numbered chip in the chip row opens the same picker as the header's
"Add exercise".

## 4. Workouts page (Hevy style)
Under the AI row: a big "Start" (today's routine, no name, no "Edit") and below it "Start another
routine", which opens a list with "Freestyle workout" first, then the routines. Under them two glued
segments: "My week" (Monday to Sunday, assign sessions, as the week list does now) and "My sessions"
(Freestyle first, then every routine, each with an "assign to days" action, plus New routine).
On a rest day, no big Start; "Start another routine" stays. A session in progress keeps Resume.

## Non-goals
Per-set weights; changing progression rules; watch protocol changes.
