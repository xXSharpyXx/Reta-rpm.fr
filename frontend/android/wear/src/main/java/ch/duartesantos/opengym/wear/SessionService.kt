package ch.duartesantos.opengym.wear

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.health.services.client.ExerciseUpdateCallback
import androidx.health.services.client.HealthServices
import androidx.health.services.client.clearUpdateCallback
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.ExerciseConfig
import androidx.health.services.client.data.ExerciseLapSummary
import androidx.health.services.client.data.ExerciseType
import androidx.health.services.client.data.ExerciseUpdate
import androidx.health.services.client.endExercise
import androidx.health.services.client.getCapabilities
import androidx.health.services.client.startExercise
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.TreeMap
import kotlin.math.roundToInt

/**
 * Runs for as long as the phone's workout does: a foreground service of the health type, so the
 * heart rate goes on with the screen off. It measures through Health Services (an exercise of the
 * strength-training type, the watch's own sensor) and sends the samples with the time of each,
 * every few seconds, to the phone (PhoneLink), which keeps them in one file per workout. Nothing
 * leaves the watch and the phone.
 *
 * It stops by itself when the workout is over on the phone (finished or discarded), when another
 * workout starts (a new one starts then), or when the phone has said nothing for hours.
 */
class SessionService : Service() {
    companion object {
        private const val CHANNEL = "session"
        private const val NOTIF_ID = 7
        private const val SEND_EVERY_MS = 10_000L
        private const val GIVE_UP_MS = 4 * 3600_000L

        @Volatile private var running: String? = null

        fun hrPermitted(ctx: Context): Boolean {
            val body = ContextCompat.checkSelfPermission(ctx, Manifest.permission.BODY_SENSORS) == PackageManager.PERMISSION_GRANTED
            val health = Build.VERSION.SDK_INT >= 36 &&
                ContextCompat.checkSelfPermission(ctx, "android.permission.health.READ_HEART_RATE") == PackageManager.PERMISSION_GRANTED
            return body || health
        }

        /** Starts or stops the service to match the workout the phone said is running. */
        fun sync(ctx: Context) {
            val wid = Session.state.value.snap?.wid
            if (wid != null && hrPermitted(ctx)) {
                if (running == wid) return
                try {
                    ContextCompat.startForegroundService(ctx, Intent(ctx, SessionService::class.java))
                } catch (e: Exception) {
                    // Android does not let a service start one from the background: the phone opens
                    // the watch app with the workout, and the app starts it then.
                }
            } else if (running != null) {
                ctx.stopService(Intent(ctx, SessionService::class.java))
            }
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val buffer = TreeMap<Long, Int>()
    private var wid: String? = null
    private var measuring = false

    private val callback = object : ExerciseUpdateCallback {
        override fun onExerciseUpdateReceived(update: ExerciseUpdate) {
            val points = update.latestMetrics.getData(DataType.HEART_RATE_BPM)
            if (points.isEmpty()) return
            val boot = Instant.ofEpochMilli(System.currentTimeMillis() - SystemClock.elapsedRealtime())
            var last: Int? = null
            for (p in points) {
                val bpm = p.value.roundToInt()
                if (bpm !in 25..250) continue
                buffer[p.getTimeInstant(boot).toEpochMilli()] = bpm
                last = bpm
            }
            last?.let { Session.onBpm(it) }
        }

        override fun onLapSummaryReceived(lapSummary: ExerciseLapSummary) {}
        override fun onRegistered() {}
        override fun onRegistrationFailed(throwable: Throwable) {}
        override fun onAvailabilityChanged(dataType: DataType<*, *>, availability: Availability) {}
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val current = Session.state.value.snap?.wid
        if (!goForeground() || current == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (wid == null) {
            wid = current
            running = current
            scope.launch { startMeasuring() }
            scope.launch { watchWorkout() }
            scope.launch { sendLoop() }
        }
        return START_NOT_STICKY
    }

    private fun goForeground(): Boolean {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.notif_channel), NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_dumbbell)
            .setContentTitle(getString(R.string.notif_title))
            .setContentText(getString(R.string.notif_text))
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setOngoing(true)
            .setContentIntent(open)
            .build()
        return try {
            val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH else 0
            ServiceCompat.startForeground(this, NOTIF_ID, n, type)
            true
        } catch (e: Exception) {
            false
        }
    }

    private suspend fun startMeasuring() {
        try {
            val client = HealthServices.getClient(this).exerciseClient
            val caps = client.getCapabilities()
            // Strength training where the watch knows it, else the closest it has; always with the heart rate.
            val type = listOf(ExerciseType.STRENGTH_TRAINING, ExerciseType.WEIGHTLIFTING, ExerciseType.WORKOUT).firstOrNull {
                it in caps.supportedExerciseTypes && DataType.HEART_RATE_BPM in caps.getExerciseTypeCapabilities(it).supportedDataTypes
            } ?: return
            client.setUpdateCallback(ContextCompat.getMainExecutor(this), callback)
            client.startExercise(
                ExerciseConfig.builder(type)
                    .setDataTypes(setOf(DataType.HEART_RATE_BPM))
                    .setIsAutoPauseAndResumeEnabled(false)
                    .setIsGpsEnabled(false)
                    .build(),
            )
            measuring = true
        } catch (e: Exception) {
            // No sensor, no permission, or another app's exercise holds it: the workout goes on
            // without a heart rate.
        }
    }

    /** Ends with the workout: over on the phone, another one, or nothing heard for hours. */
    private suspend fun watchWorkout() {
        while (scope.isActive) {
            val now = Session.state.value.snap?.wid
            if (now != wid || System.currentTimeMillis() - Session.receivedAt > GIVE_UP_MS) {
                stopSelf()
                return
            }
            delay(1_000)
        }
    }

    private suspend fun sendLoop() {
        while (scope.isActive) {
            delay(SEND_EVERY_MS)
            sendSamples()
            PhoneLink.flush(this)
        }
    }

    private fun sendSamples() {
        val id = wid ?: return
        if (buffer.isEmpty()) return
        val samples = JSONArray()
        for ((t, bpm) in buffer) samples.put(JSONArray().put(t).put(bpm))
        buffer.clear()
        PhoneLink.send(this, JSONObject().put("id", PhoneLink.newId()).put("type", "hrSamples").put("wid", id).put("samples", samples))
    }

    override fun onDestroy() {
        sendSamples()
        val app = applicationContext
        if (measuring) {
            // Not on this service's scope, which is cancelled below.
            CoroutineScope(Dispatchers.Main).launch {
                try {
                    val client = HealthServices.getClient(app).exerciseClient
                    client.endExercise()
                    client.clearUpdateCallback(callback)
                } catch (e: Exception) {
                    // already ended
                }
            }
        }
        scope.cancel()
        running = null
        Session.clearBpm()
        super.onDestroy()
        // Another workout started meanwhile: its own service.
        if (Session.state.value.snap?.wid != null && Session.state.value.snap?.wid != wid) sync(app)
    }
}
