package ch.duartesantos.opengym.wear

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat

/**
 * Opens the watch app when a workout starts on the phone. The phone asks for it too
 * (WatchBridgePlugin.openOnWatch), but a watch out of reach at that moment, or one where that
 * request did not get through, would stay on its watch face. So the watch does it itself when the
 * new workout arrives: it starts the screen, and in case Android keeps an app in the background
 * from doing that, it posts a notification that opens it, full screen where the watch allows it.
 * The notification goes as soon as the screen is in front.
 */
object Launcher {
    private const val CHANNEL = "open"
    private const val NOTIF_ID = 8

    /** The screen is in front (MainActivity onResume … onPause). */
    @Volatile var visible = false

    fun onNewWorkout(ctx: Context) {
        if (visible) return
        val app = ctx.applicationContext
        val intent = Intent(app, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        try {
            val nm = app.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, app.getString(R.string.open_channel), NotificationManager.IMPORTANCE_HIGH))
            val pi = PendingIntent.getActivity(app, 1, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val n = NotificationCompat.Builder(app, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_dumbbell)
                .setContentTitle(app.getString(R.string.notif_title))
                .setContentText(app.getString(R.string.open_text))
                .setCategory(NotificationCompat.CATEGORY_WORKOUT)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .setFullScreenIntent(pi, true)
                .build()
            nm.notify(NOTIF_ID, n)
        } catch (e: Exception) {
            // no notification permission: the start below may still bring the screen up
        }
        try {
            app.startActivity(intent)
        } catch (e: Exception) {
            // kept in the background: the notification is there
        }
    }

    fun clear(ctx: Context) {
        try {
            ctx.getSystemService(NotificationManager::class.java).cancel(NOTIF_ID)
        } catch (e: Exception) {
            // nothing to clear
        }
    }
}
