package ch.duartesantos.opengym.wear

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import androidx.wear.ambient.AmbientLifecycleObserver
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// The phone app's own colours (frontend/src/index.css, dark theme): black, white labels, the
// accent the user picked there (sent with the workout; lime until it arrives).
private val Bg = Color(0xFF000000)
private val Label = Color(0xFFFFFFFF)
private val Label2 = Color(0x99EBEBF5)
private val Fill = Color(0xFF1C1C1E)
private const val DEFAULT_ACCENT = 0xFF30D158L
private const val DEFAULT_INK = 0xFF000000L

// How far a finger goes for one step: a tenth of a kilo, one rep, five seconds.
private const val DP_PER_TENTH = 6f
private const val DP_PER_REP = 22f
private const val DP_PER_SEC_STEP = 14f
// The bezel (or crown): pixels of scroll for one step.
private const val PX_PER_ROTARY_STEP = 36f

class MainActivity : ComponentActivity() {
    private val askPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        Session.setHrAllowed(SessionService.hrPermitted(this))
        SessionService.sync(this)
    }

    // Ambient: when the screen dims during a workout, the app stays on it (in a quiet black and
    // white version) instead of handing over to the watch face, and comes back as it was.
    private val ambient = mutableStateOf(false)
    private val ambientObserver = AmbientLifecycleObserver(this, object : AmbientLifecycleObserver.AmbientLifecycleCallback {
        override fun onEnterAmbient(ambientDetails: AmbientLifecycleObserver.AmbientDetails) { ambient.value = true }
        override fun onUpdateAmbient() {}
        override fun onExitAmbient() { ambient.value = false }
    })

    private fun permissionsToAsk(): Array<String> = buildList {
        add(Manifest.permission.BODY_SENSORS)
        add(Manifest.permission.ACTIVITY_RECOGNITION)
        if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
        if (Build.VERSION.SDK_INT >= 36) add("android.permission.health.READ_HEART_RATE")
    }.toTypedArray()

    fun requestHr() = askPermissions.launch(permissionsToAsk())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        lifecycle.addObserver(ambientObserver)
        if (!SessionService.hrPermitted(this)) requestHr()
        setContent { App(ambient, onRequestHr = { requestHr() }) }
    }

    override fun onResume() {
        super.onResume()
        Launcher.visible = true
        Launcher.clear(this)
        Session.setHrAllowed(SessionService.hrPermitted(this))
        lifecycleScope.launch {
            PhoneListenerService.pull(this@MainActivity)
            // In front: the one moment Android lets the app start its foreground service.
            SessionService.sync(this@MainActivity)
        }
        PhoneLink.flush(this)
    }

    override fun onPause() {
        Launcher.visible = false
        super.onPause()
    }
}

/** Which value the keypad is typing, for which set. */
private data class Typing(val field: Char, val target: Target)

@Composable
private fun App(ambientState: MutableState<Boolean>, onRequestHr: () -> Unit) {
    val st by Session.state.collectAsState()
    val ambient by ambientState
    val ctx = LocalContext.current
    val accent = Color(st.snap?.accent ?: DEFAULT_ACCENT)
    val ink = Color(st.snap?.ink ?: DEFAULT_INK)
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var typing by remember { mutableStateOf<Typing?>(null) }
    LaunchedEffect(st.rest, ambient) {
        while (true) {
            now = System.currentTimeMillis()
            val r = st.rest ?: break
            if (r.endsAt <= now || ambient) break
            delay(200)
        }
    }
    MaterialTheme {
        Box(Modifier.fillMaxSize().background(Bg), contentAlignment = Alignment.Center) {
            val snap = st.snap
            val rest = st.rest?.takeIf { it.endsAt > now }
            val target = snap?.takeIf { it.active }?.let { Model.nextTarget(it, st.pending.keys) }
            val tp = typing
            when {
                snap == null || !snap.active -> Message(stringResource(R.string.no_session_title), stringResource(R.string.no_session_body))
                ambient -> AmbientScreen(snap, st, target, rest != null)
                rest != null -> RestScreen(rest, now, accent, onSkip = { Session.restSkip(ctx) })
                target == null -> Message(stringResource(R.string.all_done_title), stringResource(R.string.all_done_body))
                tp != null && tp.target.entryIdx == target.entryIdx && tp.target.setIdx == target.setIdx ->
                    Keypad(tp.field, Session.valuesOf(st, target), snap.unit, accent, ink,
                        onDone = { text ->
                            when (tp.field) {
                                'w' -> Model.typedWeight(text)?.let { v -> Session.edit(target) { it.copy(w = v) } }
                                'r' -> Model.typedReps(text)?.let { v -> Session.edit(target) { it.copy(r = v) } }
                                's' -> Model.typedReps(text)?.let { v -> Session.edit(target) { it.copy(sec = v) } }
                            }
                            typing = null
                        },
                        onCancel = { typing = null })
                else -> SetScreen(snap, target, st, accent, ink,
                    onType = { typing = Typing(it, target) },
                    onDone = { typing = null; Session.tapDone(ctx) },
                    onRequestHr = onRequestHr)
            }
        }
    }
}

@Composable
private fun Message(title: String, body: String) {
    TimeText()
    Column(Modifier.fillMaxSize().padding(horizontal = 30.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, color = Label, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        Spacer(Modifier.height(6.dp))
        Text(body, color = Label2, fontSize = 13.sp, textAlign = TextAlign.Center)
    }
}

/**
 * The set to do, and nothing else: its reps and its weight in two boxes, the tick under them.
 * A drag up or down on a box moves it (a tenth of a kilo at a time for the weight), the bezel moves
 * the one picked last, and a tap on a box opens the keypad to type it.
 */
@Composable
private fun SetScreen(snap: Snapshot, t: Target, st: UiState, accent: Color, ink: Color, onType: (Char) -> Unit, onDone: () -> Unit, onRequestHr: () -> Unit) {
    val haptic = LocalHapticFeedback.current
    val v = Session.valuesOf(st, t)
    val timed = t.entry.mode == "time"
    val reps = t.entry.mode == "reps"
    val loaded = (v.w ?: 0.0) > 0.0
    val showWeight = (reps && (loaded || !t.entry.bodyweight)) || (timed && loaded)
    val fields = buildList {
        if (timed) add('s') else if (reps) add('r')
        if (showWeight) add('w')
    }
    var picked by remember(t.entryIdx, t.setIdx) { mutableStateOf(if ('w' in fields) 'w' else fields.firstOrNull() ?: 'w') }
    val focus = remember { FocusRequester() }
    var rotary by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(Unit) { try { focus.requestFocus() } catch (e: Exception) { /* no bezel */ } }
    val step: (Char, Int) -> Unit = { f, n ->
        Session.edit(t) {
            when (f) {
                'w' -> it.copy(w = Model.stepWeight(it.w, n))
                'r' -> it.copy(r = Model.stepReps(it.r, n))
                else -> it.copy(sec = Model.stepReps(it.sec, n * 5))
            }
        }
        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
    }
    TimeText()
    Column(
        Modifier.fillMaxSize()
            .onRotaryScrollEvent { e ->
                rotary += e.verticalScrollPixels
                val n = (rotary / PX_PER_ROTARY_STEP).toInt()
                if (n != 0 && picked in fields) { rotary -= n * PX_PER_ROTARY_STEP; step(picked, n) }
                true
            }
            .focusRequester(focus)
            .focusable()
            .padding(horizontal = 18.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("${t.number}/${t.count}", color = if (t.set.warmup) Label2 else accent, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(4.dp))
        if (fields.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            for (f in fields) {
                val (text, unit, perStep) = when (f) {
                    'w' -> Triple(v.w?.let { Model.weight(it) } ?: "0", snap.unit, DP_PER_TENTH)
                    'r' -> Triple((v.r ?: 0).toString(), stringResource(R.string.reps_unit), DP_PER_REP)
                    else -> Triple((v.sec ?: 0).toString(), "s", DP_PER_SEC_STEP)
                }
                ValueBox(text, unit, on = picked == f, accent = accent, dpPerStep = perStep,
                    onTap = { picked = f; onType(f) },
                    onStep = { n -> picked = f; step(f, n) })
            }
        } else {
            Text(Model.load(t.set, t.entry, snap.unit, stringResource(R.string.bodyweight)), color = Label, fontSize = 20.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
        }
        Spacer(Modifier.height(10.dp))
        Button(
            onClick = { haptic.performHapticFeedback(HapticFeedbackType.LongPress); onDone() },
            modifier = Modifier.size(56.dp),
            shape = CircleShape,
            colors = ButtonDefaults.buttonColors(backgroundColor = accent, contentColor = ink),
        ) { Text("✓", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = ink) }
        if (!st.hrAllowed) {
            Spacer(Modifier.height(4.dp))
            Text(stringResource(R.string.hr_off), color = Label2, fontSize = 10.sp, textAlign = TextAlign.Center, modifier = Modifier.clickable { onRequestHr() })
        }
    }
}

@Composable
private fun ValueBox(text: String, unit: String, on: Boolean, accent: Color, dpPerStep: Float, onTap: () -> Unit, onStep: (Int) -> Unit) {
    val px = with(LocalDensity.current) { dpPerStep.dp.toPx() }
    var acc by remember { mutableFloatStateOf(0f) }
    // The drag outlives a recomposition: it always steps the set on screen now.
    val stepNow by rememberUpdatedState(onStep)
    Column(
        Modifier.width(66.dp).height(60.dp)
            .background(Fill, RoundedCornerShape(16.dp))
            .border(if (on) 2.dp else 0.dp, if (on) accent else Fill, RoundedCornerShape(16.dp))
            .pointerInput(Unit) {
                detectVerticalDragGestures(onDragStart = { acc = 0f }) { change, dy ->
                    change.consume()
                    // Up adds, down takes away.
                    acc -= dy
                    val n = (acc / px).toInt()
                    if (n != 0) { acc -= n * px; stepNow(n) }
                }
            }
            .clickable { onTap() },
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(text, color = Label, fontSize = if (text.length > 4) 19.sp else 23.sp, fontWeight = FontWeight.Bold, maxLines = 1)
        Text(unit, color = Label2, fontSize = 11.sp, maxLines = 1)
    }
}

/** Typing a value: the digits, a dot for a weight, delete, and OK. Back leaves it as it was. */
@Composable
private fun Keypad(field: Char, now: SetEdit, unit: String, accent: Color, ink: Color, onDone: (String) -> Unit, onCancel: () -> Unit) {
    var text by remember { mutableStateOf("") }
    BackHandler { onCancel() }
    val decimal = field == 'w'
    val hint = when (field) {
        'w' -> now.w?.let { Model.weight(it) } ?: "0"
        'r' -> (now.r ?: 0).toString()
        else -> (now.sec ?: 0).toString()
    }
    val suffix = when (field) { 'w' -> unit; 'r' -> stringResource(R.string.reps_unit); else -> "s" }
    Column(Modifier.fillMaxSize().padding(vertical = 14.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            (text.ifEmpty { hint }) + " " + suffix,
            color = if (text.isEmpty()) Label2 else Label, fontSize = 18.sp, fontWeight = FontWeight.Bold, maxLines = 1,
        )
        Spacer(Modifier.height(4.dp))
        for (row in listOf("123<", "456.", "7890")) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                for (k in row) {
                    val enabled = k != '.' || decimal
                    Box(
                        Modifier.size(width = 36.dp, height = 32.dp)
                            .background(if (enabled) Fill else Bg, RoundedCornerShape(10.dp))
                            .clickable(enabled = enabled) { text = Model.keypad(text, k, decimal) },
                        contentAlignment = Alignment.Center,
                    ) { Text(if (k == '<') "⌫" else if (k == '.' && !decimal) "" else k.toString(), color = Label, fontSize = 16.sp, fontWeight = FontWeight.SemiBold) }
                }
            }
            Spacer(Modifier.height(4.dp))
        }
        Button(
            onClick = { if (text.isEmpty()) onCancel() else onDone(text) },
            modifier = Modifier.width(76.dp).height(32.dp),
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.buttonColors(backgroundColor = accent, contentColor = ink),
        ) { Text("OK", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = ink) }
    }
}

/** The rest: the time left in a ring, and Skip. */
@Composable
private fun RestScreen(rest: Rest, now: Long, accent: Color, onSkip: () -> Unit) {
    val left = rest.endsAt - now
    val progress = if (rest.totalMs > 0) (left.toFloat() / rest.totalMs).coerceIn(0f, 1f) else 0f
    CircularProgressIndicator(
        progress = progress,
        modifier = Modifier.fillMaxSize().padding(3.dp),
        startAngle = 270f,
        endAngle = 270f,
        indicatorColor = accent,
        trackColor = accent.copy(alpha = 0.18f),
        strokeWidth = 6.dp,
    )
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(stringResource(R.string.rest), color = Label2, fontSize = 13.sp)
        Text(Model.clock(left), color = Label, fontSize = 46.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        Button(
            onClick = onSkip,
            modifier = Modifier.width(84.dp).height(34.dp),
            shape = RoundedCornerShape(17.dp),
            colors = ButtonDefaults.buttonColors(backgroundColor = Fill, contentColor = Label),
        ) { Text(stringResource(R.string.skip), fontSize = 13.sp, fontWeight = FontWeight.SemiBold) }
    }
}

/** The screen dimmed: what is next, in grey on black, nothing to tap. A tap wakes the full screen. */
@Composable
private fun AmbientScreen(snap: Snapshot, st: UiState, t: Target?, resting: Boolean) {
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        when {
            resting -> Text(stringResource(R.string.rest), color = Label2, fontSize = 22.sp)
            t != null -> {
                val v = Session.valuesOf(st, t)
                Text("${t.number}/${t.count}", color = Label2, fontSize = 13.sp)
                Text(Model.load(WSet(v.w, v.r, v.sec, false, t.set.warmup), t.entry, snap.unit, stringResource(R.string.bodyweight)),
                    color = Label, fontSize = 20.sp, textAlign = TextAlign.Center)
            }
            else -> Text(stringResource(R.string.all_done_title), color = Label2, fontSize = 14.sp, textAlign = TextAlign.Center)
        }
    }
}
