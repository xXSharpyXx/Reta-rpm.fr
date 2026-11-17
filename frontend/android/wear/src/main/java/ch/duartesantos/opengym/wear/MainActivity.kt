package ch.duartesantos.opengym.wear

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
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
private val Heart = Color(0xFFFF453A)
private const val DEFAULT_ACCENT = 0xFF30D158L
private const val DEFAULT_INK = 0xFF000000L

class MainActivity : ComponentActivity() {
    private val askPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        Session.setHrAllowed(SessionService.hrPermitted(this))
        SessionService.sync(this)
    }

    private fun permissionsToAsk(): Array<String> = buildList {
        add(Manifest.permission.BODY_SENSORS)
        add(Manifest.permission.ACTIVITY_RECOGNITION)
        if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
        if (Build.VERSION.SDK_INT >= 36) add("android.permission.health.READ_HEART_RATE")
    }.toTypedArray()

    fun requestHr() = askPermissions.launch(permissionsToAsk())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!SessionService.hrPermitted(this)) requestHr()
        setContent { App(onRequestHr = { requestHr() }) }
    }

    override fun onResume() {
        super.onResume()
        Session.setHrAllowed(SessionService.hrPermitted(this))
        lifecycleScope.launch {
            PhoneListenerService.pull(this@MainActivity)
            // In front: the one moment Android lets the app start its foreground service.
            SessionService.sync(this@MainActivity)
        }
        PhoneLink.flush(this)
    }
}

@Composable
private fun App(onRequestHr: () -> Unit) {
    val st by Session.state.collectAsState()
    val ctx = LocalContext.current
    val accent = Color(st.snap?.accent ?: DEFAULT_ACCENT)
    val ink = Color(st.snap?.ink ?: DEFAULT_INK)
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(st.rest) {
        while (true) {
            now = System.currentTimeMillis()
            val r = st.rest ?: break
            if (r.endsAt <= now) break
            delay(200)
        }
    }
    MaterialTheme {
        Box(Modifier.fillMaxSize().background(Bg), contentAlignment = Alignment.Center) {
            val snap = st.snap
            val rest = st.rest?.takeIf { it.endsAt > now }
            when {
                snap == null || !snap.active -> Message(stringResource(R.string.no_session_title), stringResource(R.string.no_session_body))
                rest != null -> RestScreen(snap, st, rest, now, accent,
                    onAdd = { Session.restAdd(ctx, it) }, onSkip = { Session.restSkip(ctx) })
                else -> {
                    val t = Model.nextTarget(snap, st.pending.keys)
                    if (t == null) Message(stringResource(R.string.all_done_title), stringResource(R.string.all_done_body))
                    else SetScreen(snap, t, st, accent, ink, onDone = { Session.tapDone(ctx) }, onRequestHr = onRequestHr)
                }
            }
        }
    }
}

@Composable
private fun Message(title: String, body: String) {
    TimeText()
    Column(Modifier.fillMaxSize().padding(horizontal = 28.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, color = Label, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        Spacer(Modifier.height(6.dp))
        Text(body, color = Label2, fontSize = 14.sp, textAlign = TextAlign.Center)
    }
}

@Composable
private fun setLabel(t: Target): String =
    stringResource(if (t.set.warmup) R.string.warmup_of else R.string.set_of, t.number, t.count)

@Composable
private fun SetScreen(snap: Snapshot, t: Target, st: UiState, accent: Color, ink: Color, onDone: () -> Unit, onRequestHr: () -> Unit) {
    val haptic = LocalHapticFeedback.current
    TimeText()
    Column(
        Modifier.fillMaxSize().padding(horizontal = 22.dp, vertical = 30.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(t.entry.name, color = Label2, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
        Text(setLabel(t), color = accent, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
        Text(
            Model.load(t.set, t.entry, snap.unit, stringResource(R.string.bodyweight)),
            color = Label, fontSize = 27.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(8.dp))
        Button(
            onClick = { haptic.performHapticFeedback(HapticFeedbackType.LongPress); onDone() },
            modifier = Modifier.fillMaxWidth().height(54.dp),
            shape = RoundedCornerShape(27.dp),
            colors = ButtonDefaults.buttonColors(backgroundColor = accent, contentColor = ink),
        ) {
            Text(stringResource(R.string.done_button), fontSize = 16.sp, fontWeight = FontWeight.Bold, color = ink)
        }
        Spacer(Modifier.height(6.dp))
        HeartLine(st, onRequestHr)
    }
}

@Composable
private fun HeartLine(st: UiState, onRequestHr: () -> Unit) {
    when {
        !st.hrAllowed -> Text(stringResource(R.string.hr_off), color = Label2, fontSize = 11.sp, textAlign = TextAlign.Center, modifier = Modifier.clickable { onRequestHr() })
        st.bpm != null -> Text("♥ ${st.bpm}", color = Heart, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun RestScreen(snap: Snapshot, st: UiState, rest: Rest, now: Long, accent: Color, onAdd: (Int) -> Unit, onSkip: () -> Unit) {
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
    Column(Modifier.fillMaxSize().padding(horizontal = 26.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(stringResource(R.string.rest), color = Label2, fontSize = 14.sp)
        Text(Model.clock(left), color = Label, fontSize = 50.sp, fontWeight = FontWeight.Bold)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Small("−15") { onAdd(-15) }
            Small("+15") { onAdd(15) }
        }
        Spacer(Modifier.height(8.dp))
        Button(
            onClick = onSkip,
            modifier = Modifier.fillMaxWidth(0.7f).height(40.dp),
            shape = RoundedCornerShape(20.dp),
            colors = ButtonDefaults.buttonColors(backgroundColor = Fill, contentColor = Label),
        ) { Text(stringResource(R.string.skip), fontSize = 14.sp, fontWeight = FontWeight.SemiBold) }
        val next = Model.nextTarget(snap, st.pending.keys)
        if (next != null) {
            Spacer(Modifier.height(6.dp))
            Text(
                stringResource(R.string.next, next.entry.name + " · " + Model.load(next.set, next.entry, snap.unit, stringResource(R.string.bodyweight))),
                color = Label2, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun Small(label: String, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        modifier = Modifier.size(48.dp),
        colors = ButtonDefaults.buttonColors(backgroundColor = Fill, contentColor = Label),
    ) { Text(label, fontSize = 15.sp, fontWeight = FontWeight.SemiBold) }
}
