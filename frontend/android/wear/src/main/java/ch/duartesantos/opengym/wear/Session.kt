package ch.duartesantos.opengym.wear

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import kotlin.math.abs

/** What the watch shows: the phone's workout, the sets ticked here not yet confirmed, the rest. */
data class UiState(
    val snap: Snapshot? = null,
    /** Sets ticked on the watch the phone has not confirmed yet: "entry:set" → when. */
    val pending: Map<String, Long> = emptyMap(),
    val rest: Rest? = null,
    val bpm: Int? = null,
    val hrAllowed: Boolean = true,
    /** Values changed on the watch for a set not ticked yet: "entry:set" → what it is logged with. */
    val edits: Map<String, SetEdit> = emptyMap(),
)

/** A set's values as changed on the watch (a drag, the bezel, the keypad); null keeps the phone's. */
data class SetEdit(val w: Double? = null, val r: Int? = null, val sec: Int? = null)

/**
 * The one copy of the watch's state, shared by the screen and the services. The phone is the
 * reference: every snapshot it sends replaces what the watch thought. The watch only runs ahead of
 * it for a moment after a tap (the tick, the rest it starts), until the phone's answer arrives;
 * with the phone out of reach it keeps going on its own, and its taps wait in PhoneLink's outbox.
 */
object Session {
    // After a tap here, a snapshot without a rest may be one the phone sent before it heard of it.
    private const val LOCAL_FRESH_MS = 5_000L
    // A tick the phone never confirms (it was undone there, the set is gone) stops counting. Long:
    // a phone locked in a pocket can take minutes to wake its page and apply the queue.
    private const val PENDING_MS = 10 * 60_000L
    // A workout that turns up this long after the phone sent it is one already running, not one
    // that just started: the app does not open itself for it.
    private const val NEW_WORKOUT_MS = 2 * 60_000L

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    private var lastAt = 0L
    private var localAt = 0L
    /** When the last snapshot came in (watch clock), for the session service's give-up. */
    @Volatile var receivedAt = 0L
        private set

    @Synchronized
    fun onSnapshot(ctx: Context, json: String, at: Long) {
        if (at != 0L && at < lastAt) return
        val snap = Model.parse(json) ?: return
        lastAt = at
        val now = System.currentTimeMillis()
        receivedAt = now
        val cur = _state.value
        val sameWorkout = cur.snap?.wid == snap.wid
        val pending = if (!snap.active || !sameWorkout) emptyMap() else cur.pending.filter { (key, t) ->
            val (ei, si) = key.split(":").map { it.toInt() }
            now - t < PENDING_MS && snap.entries.getOrNull(ei)?.sets?.getOrNull(si)?.done == false
        }
        val localFresh = sameWorkout && now - localAt < LOCAL_FRESH_MS
        val rest = Model.restAfterSnapshot(snap, now, cur.rest, cur.rest, localFresh)
        val edits = if (!snap.active || !sameWorkout) emptyMap() else cur.edits.filter { (key, _) ->
            val (ei, si) = key.split(":").map { it.toInt() }
            snap.entries.getOrNull(ei)?.sets?.getOrNull(si)?.done == false
        }
        _state.value = cur.copy(snap = snap, pending = pending, rest = rest, bpm = if (snap.active) cur.bpm else null, edits = edits)
        RestAlarm.schedule(ctx, rest)
        // A workout that just started on the phone: the app comes up by itself.
        if (snap.active && !sameWorkout && (at == 0L || abs(now - at) < NEW_WORKOUT_MS)) Launcher.onNewWorkout(ctx)
        if (!snap.active) Launcher.clear(ctx)
    }

    /** The values the set on screen is logged with: those changed here, else the phone's. */
    fun valuesOf(st: UiState, t: Target): SetEdit {
        val e = st.edits["${t.entryIdx}:${t.setIdx}"]
        return SetEdit(w = e?.w ?: t.set.w, r = e?.r ?: t.set.r, sec = e?.sec ?: t.set.sec)
    }

    /** A value of the set on screen changed here, kept until the set is ticked here or on the phone. */
    @Synchronized
    fun edit(t: Target, change: (SetEdit) -> SetEdit) {
        val cur = _state.value
        val key = "${t.entryIdx}:${t.setIdx}"
        _state.value = cur.copy(edits = cur.edits + (key to change(valuesOf(cur, t))))
    }

    /** "Set done": the set is ticked on the phone as a tap there would, and the rest starts here at once. */
    @Synchronized
    fun tapDone(ctx: Context) {
        val cur = _state.value
        val snap = cur.snap ?: return
        val t = Model.nextTarget(snap, cur.pending.keys) ?: return
        val now = System.currentTimeMillis()
        val ev = JSONObject()
            .put("id", PhoneLink.newId())
            .put("type", "setDone")
            .put("wid", snap.wid)
            .put("exId", t.entry.id)
            .put("entryIdx", t.entryIdx)
            .put("setIdx", t.setIdx)
            .put("at", now)
        val key = "${t.entryIdx}:${t.setIdx}"
        val v = valuesOf(cur, t)
        v.w?.let { ev.put("w", it) }
        v.r?.let { ev.put("r", it) }
        v.sec?.let { ev.put("sec", it) }
        PhoneLink.send(ctx, ev)
        localAt = now
        val sec = Model.restFor(snap, t.entryIdx)
        val rest = if (sec > 0) Rest(now + sec * 1000L, sec * 1000L) else null
        _state.value = cur.copy(pending = cur.pending + (key to now), rest = rest, edits = cur.edits - key)
        RestAlarm.schedule(ctx, rest)
    }

    /** +15 s / -15 s on the rest, here at once and on the phone. */
    @Synchronized
    fun restAdd(ctx: Context, sec: Int) {
        val cur = _state.value
        val rest = cur.rest ?: return
        val now = System.currentTimeMillis()
        PhoneLink.send(ctx, JSONObject().put("id", PhoneLink.newId()).put("type", "restAdd").put("wid", cur.snap?.wid).put("sec", sec).put("at", now))
        localAt = now
        val endsAt = rest.endsAt + sec * 1000L
        val next = if (endsAt <= now) null else Rest(endsAt, maxOf(rest.totalMs, endsAt - now))
        _state.value = cur.copy(rest = next)
        RestAlarm.schedule(ctx, next)
    }

    @Synchronized
    fun restSkip(ctx: Context) {
        val cur = _state.value
        if (cur.rest == null) return
        val now = System.currentTimeMillis()
        PhoneLink.send(ctx, JSONObject().put("id", PhoneLink.newId()).put("type", "restSkip").put("wid", cur.snap?.wid).put("at", now))
        localAt = now
        _state.value = cur.copy(rest = null)
        RestAlarm.schedule(ctx, null)
    }

    fun onBpm(bpm: Int) {
        _state.value = _state.value.copy(bpm = bpm)
    }

    fun clearBpm() {
        _state.value = _state.value.copy(bpm = null)
    }

    fun setHrAllowed(allowed: Boolean) {
        _state.value = _state.value.copy(hrAllowed = allowed)
    }
}

/**
 * The buzz when the rest is over, with the screen off too: a wake lock for the length of the rest
 * (never more than 16 minutes) so the watch does not sleep through it.
 */
object RestAlarm {
    private val handler = Handler(Looper.getMainLooper())
    private var pending: Runnable? = null
    private var lock: PowerManager.WakeLock? = null
    private var endsAt = 0L

    fun schedule(ctx: Context, rest: Rest?) {
        val app = ctx.applicationContext
        handler.post {
            if (rest?.endsAt == endsAt && pending != null) return@post
            cancel()
            if (rest == null) return@post
            val delay = rest.endsAt - System.currentTimeMillis()
            if (delay <= 0) return@post
            endsAt = rest.endsAt
            try {
                val pm = app.getSystemService(Context.POWER_SERVICE) as PowerManager
                lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "reta:rest").apply {
                    setReferenceCounted(false)
                    acquire(minOf(delay + 5_000L, 16 * 60_000L))
                }
            } catch (e: Exception) {
                lock = null
            }
            val r = Runnable {
                buzz(app)
                pending = null
                release()
            }
            pending = r
            handler.postDelayed(r, delay)
        }
    }

    private fun cancel() {
        pending?.let { handler.removeCallbacks(it) }
        pending = null
        endsAt = 0L
        release()
    }

    private fun release() {
        try { lock?.takeIf { it.isHeld }?.release() } catch (e: Exception) { /* already let go */ }
        lock = null
    }

    @Suppress("DEPRECATION")
    private fun buzz(ctx: Context) {
        try {
            val v = ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
            v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 350, 150, 350, 150, 600), -1))
        } catch (e: Exception) {
            // no vibrator: the screen still shows the rest is over
        }
    }
}
