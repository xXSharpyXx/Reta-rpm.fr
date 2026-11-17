package ch.duartesantos.opengym.wear

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.roundToLong

/*
 * The workout as the phone sends it (frontend/src/lib/watch-sync.js buildSnapshot), read into
 * plain values, and what the watch shows from it: the set to do now, its load, the rest. Pure:
 * no Android in here, so it is tested on the JVM (src/test).
 */

data class WSet(
    val w: Double?,
    val r: Int?,
    val sec: Int?,
    val done: Boolean,
    val warmup: Boolean,
)

data class WEntry(
    val id: String,
    val name: String,
    val mode: String,
    val restSec: Int?,
    val bodyweight: Boolean,
    val sets: List<WSet>,
)

data class Snapshot(
    /** The running workout's id, or null when none runs. */
    val wid: String?,
    val unit: String,
    val cur: Int,
    /** The rest of the workout, else of the profile (seconds; 0 = rest off). */
    val restSec: Int,
    /** A rest running on the phone: when it ends, by the phone's clock. */
    val restEndsAt: Long?,
    val entries: List<WEntry>,
    /** The phone's clock when it sent this. */
    val phoneNow: Long?,
    val accent: Long?,
    val ink: Long?,
) {
    val active: Boolean get() = wid != null
}

/** One set to do: where it is, and its number among its kind (warm-ups apart from work sets). */
data class Target(
    val entryIdx: Int,
    val setIdx: Int,
    val entry: WEntry,
    val set: WSet,
    val number: Int,
    val count: Int,
)

data class Rest(val endsAt: Long, val totalMs: Long)

private fun JSONObject.numOrNull(k: String): Double? =
    if (has(k) && !isNull(k)) optDouble(k).takeIf { !it.isNaN() && !it.isInfinite() } else null

private fun colorOf(v: String?): Long? {
    if (v == null || !Regex("^#[0-9a-fA-F]{6}$").matches(v)) return null
    return 0xFF000000L or v.substring(1).toLong(16)
}

object Model {
    const val CLOCK_SKEW_MAX_MS = 30_000L

    fun parse(json: String): Snapshot? = try {
        parse(JSONObject(json))
    } catch (e: Exception) {
        null
    }

    fun parse(o: JSONObject): Snapshot {
        val unit = if (o.optString("unit") == "lb") "lb" else "kg"
        val theme = o.optJSONObject("theme")
        val a = o.optJSONObject("active")
        val entries = mutableListOf<WEntry>()
        a?.optJSONArray("entries")?.let { arr ->
            for (i in 0 until arr.length()) {
                val e = arr.optJSONObject(i) ?: continue
                entries.add(entry(e))
            }
        }
        val rest = a?.optJSONObject("rest")?.numOrNull("endsAt")?.roundToLong()
        return Snapshot(
            wid = if (a != null && a.has("entries")) a.optString("id").takeIf { it.isNotEmpty() } else null,
            unit = unit,
            cur = a?.optInt("cur", 0) ?: 0,
            restSec = (a?.numOrNull("restSec") ?: o.numOrNull("restSec") ?: 0.0).toInt().coerceAtLeast(0),
            restEndsAt = rest,
            entries = entries,
            phoneNow = o.numOrNull("now")?.roundToLong(),
            accent = colorOf(theme?.optString("accent")),
            ink = colorOf(theme?.optString("ink")),
        )
    }

    private fun entry(e: JSONObject): WEntry {
        val sets = mutableListOf<WSet>()
        val arr: JSONArray? = e.optJSONArray("sets")
        if (arr != null) for (i in 0 until arr.length()) {
            val s = arr.optJSONObject(i) ?: continue
            sets.add(
                WSet(
                    w = s.numOrNull("w"),
                    r = s.numOrNull("r")?.toInt(),
                    sec = s.numOrNull("sec")?.toInt(),
                    done = s.optBoolean("done", false),
                    warmup = s.optBoolean("warmup", false),
                ),
            )
        }
        return WEntry(
            id = e.optString("id"),
            name = e.optString("name"),
            mode = e.optString("mode", "reps"),
            restSec = e.numOrNull("restSec")?.toInt(),
            bodyweight = e.optBoolean("bodyweight", false),
            sets = sets,
        )
    }

    /**
     * The set to do now: the first one not done in the phone's current exercise, else in the
     * exercises after it, else before it. `alsoDone` are sets ticked here that the phone has not
     * confirmed yet ("entry:set"). Null when everything is done.
     */
    fun nextTarget(s: Snapshot, alsoDone: Set<String> = emptySet()): Target? {
        val n = s.entries.size
        if (n == 0) return null
        val start = s.cur.coerceIn(0, n - 1)
        for (k in 0 until n) {
            val ei = (start + k) % n
            val e = s.entries[ei]
            val si = e.sets.indices.firstOrNull { !e.sets[it].done && "$ei:$it" !in alsoDone } ?: continue
            val set = e.sets[si]
            val same = e.sets.withIndex().filter { it.value.warmup == set.warmup }
            return Target(ei, si, e, set, same.indexOfFirst { it.index == si } + 1, same.size)
        }
        return null
    }

    /** The rest after a set of this exercise, in seconds (0: no rest). */
    fun restFor(s: Snapshot, entryIdx: Int): Int =
        (s.entries.getOrNull(entryIdx)?.restSec ?: s.restSec).coerceAtLeast(0)

    /** 60 → "60", 62.5 → "62.5", 1.25 → "1.25". */
    fun weight(w: Double): String {
        val r = Math.round(w * 100) / 100.0
        return if (abs(r - Math.rint(r)) < 1e-9) r.toLong().toString() else r.toString().trimEnd('0').trimEnd('.')
    }

    /** "60 kg × 8", "Bodyweight × 12", "45 s", "20 kg · 45 s". */
    fun load(set: WSet, entry: WEntry, unit: String, bodyweightWord: String): String {
        val w = set.w?.takeIf { it > 0 }?.let { "${weight(it)} $unit" }
        return when (entry.mode) {
            "time" -> listOfNotNull(w, set.sec?.let { "$it s" }).joinToString(" · ").ifEmpty { "–" }
            else -> {
                val who = w ?: if (entry.bodyweight) bodyweightWord else null
                val reps = set.r?.let { "× $it" }
                listOfNotNull(who, reps).joinToString(" ").ifEmpty { "–" }
            }
        }
    }

    /** "1:05", "0:09". */
    fun clock(ms: Long): String {
        val s = ((ms.coerceAtLeast(0) + 999) / 1000)
        return "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
    }

    /**
     * The rest the watch shows after a snapshot arrived (`watchNow`: the watch's clock then): the
     * phone's, moved onto the watch's clock. Without one, the rest started here a moment ago
     * (`local`, while `localFresh`) is kept, as the phone may not have heard of the tick yet.
     */
    fun restAfterSnapshot(s: Snapshot, watchNow: Long, prev: Rest?, local: Rest?, localFresh: Boolean): Rest? {
        if (!s.active) return null
        val endsAt = s.restEndsAt
        if (endsAt == null) return if (localFresh) local else null
        // Two clocks a few seconds apart: the phone's end moved onto the watch's. A bigger gap is a
        // snapshot read late (the app opened minutes after it came), not a wrong clock: as it is.
        val gap = if (s.phoneNow != null) watchNow - s.phoneNow else 0L
        val offset = if (abs(gap) <= CLOCK_SKEW_MAX_MS) gap else 0L
        val mine = endsAt + offset
        val left = mine - watchNow
        if (left <= 0) return null
        // The ring's full length: the one already shown when this is the same rest moved a bit.
        val total = if (prev != null && abs(prev.endsAt - mine) < 10 * 60_000) maxOf(prev.totalMs, left) else left
        return Rest(mine, total)
    }
}
