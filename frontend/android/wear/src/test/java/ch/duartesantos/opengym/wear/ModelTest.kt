package ch.duartesantos.opengym.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// The snapshot as lib/watch-sync.js buildSnapshot makes it (frontend/src/lib/watch-sync.test.js).
private const val SNAP = """
{"v":1,"unit":"kg","restSec":90,"now":1000000,"theme":{"accent":"#30d158","ink":"#000000"},
 "active":{"id":"w-1","name":"Push day","cur":1,"unit":"kg","restSec":90,"rest":null,
  "entries":[
   {"id":"0025","name":"Barbell Bench Press","mode":"reps","restSec":null,"last":null,
    "sets":[{"w":60,"r":8,"sec":null,"done":true,"warmup":false},{"w":62.5,"r":8,"sec":null,"done":false,"warmup":false}]},
   {"id":"0001","name":"Push-up","mode":"reps","restSec":120,"bodyweight":true,
    "sets":[{"w":null,"r":10,"sec":null,"done":false,"warmup":true},{"w":null,"r":12,"sec":null,"done":false,"warmup":false},{"w":null,"r":12,"sec":null,"done":false,"warmup":false}]}
  ]}}
"""

class ModelTest {
    private val snap = Model.parse(SNAP)!!

    @Test fun readsTheWorkout() {
        assertEquals("w-1", snap.wid)
        assertTrue(snap.active)
        assertEquals(2, snap.entries.size)
        assertEquals(62.5, snap.entries[0].sets[1].w!!, 0.0)
        assertEquals(0xFF30D158L, snap.accent)
        assertEquals(1000000L, snap.phoneNow)
    }

    @Test fun noWorkout() {
        val s = Model.parse("""{"v":1,"unit":"lb","active":null,"ready":null}""")!!
        assertFalse(s.active)
        assertEquals("lb", s.unit)
        assertNull(Model.nextTarget(s))
        assertNull(Model.parse("not json"))
    }

    @Test fun theSetToDoIsThePhonesCurrentExercise() {
        val t = Model.nextTarget(snap)!!
        assertEquals(1, t.entryIdx)
        assertEquals(0, t.setIdx)
        // warm-ups are counted apart from the work sets
        assertTrue(t.set.warmup)
        assertEquals(1, t.number)
        assertEquals(1, t.count)
        val t2 = Model.nextTarget(snap, setOf("1:0"))!!
        assertEquals(1, t2.setIdx)
        assertEquals(1, t2.number)
        assertEquals(2, t2.count)
        // the current exercise done: the next undone set elsewhere, wrapping round
        val t3 = Model.nextTarget(snap, setOf("1:0", "1:1", "1:2"))!!
        assertEquals(0, t3.entryIdx)
        assertEquals(1, t3.setIdx)
        assertEquals("2/2", "${t3.number}/${t3.count}")
        assertNull(Model.nextTarget(snap, setOf("1:0", "1:1", "1:2", "0:1")))
    }

    @Test fun restOfTheExerciseElseTheWorkout() {
        assertEquals(90, Model.restFor(snap, 0))
        assertEquals(120, Model.restFor(snap, 1))
    }

    @Test fun loads() {
        val bench = snap.entries[0]
        assertEquals("62.5 kg × 8", Model.load(bench.sets[1], bench, "kg", "Bodyweight"))
        assertEquals("60 kg × 8", Model.load(bench.sets[0], bench, "kg", "Bodyweight"))
        val push = snap.entries[1]
        assertEquals("Bodyweight × 12", Model.load(push.sets[1], push, "kg", "Bodyweight"))
        val plank = WEntry("p", "Plank", "time", null, true, listOf(WSet(null, null, 45, false, false)))
        assertEquals("45 s", Model.load(plank.sets[0], plank, "kg", "Bodyweight"))
        assertEquals("1.25", Model.weight(1.25))
        assertEquals("100", Model.weight(100.0))
    }

    @Test fun clock() {
        assertEquals("1:05", Model.clock(65_000))
        assertEquals("0:01", Model.clock(1))
        assertEquals("0:00", Model.clock(-5))
    }

    @Test fun thePhonesRestOnTheWatchsClock() {
        val s = snap.copy(restEndsAt = 1_090_000L, phoneNow = 1_000_000L)
        // the watch's clock is 3 s ahead of the phone's
        val r = Model.restAfterSnapshot(s, 1_003_000L, null, null, false)!!
        assertEquals(1_093_000L, r.endsAt)
        assertEquals(90_000L, r.totalMs)
        // a rest started here a moment ago stays until the phone has heard of it
        val local = Rest(2_000_000L, 120_000L)
        assertEquals(local, Model.restAfterSnapshot(snap, 1_000_000L, local, local, true))
        assertNull(Model.restAfterSnapshot(snap, 1_000_000L, local, local, false))
        // over already
        assertNull(Model.restAfterSnapshot(s, 2_000_000L, null, null, false))
    }

    @Test fun moreSecondsOnTheSameRestKeepTheRingsLength() {
        val s = snap.copy(restEndsAt = 1_105_000L, phoneNow = 1_000_000L)
        val prev = Rest(1_090_000L, 120_000L)
        val r = Model.restAfterSnapshot(s, 1_000_000L, prev, prev, false)
        assertNotNull(r)
        assertEquals(120_000L, r!!.totalMs)
    }
}
