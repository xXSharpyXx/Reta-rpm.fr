package ch.duartesantos.opengym.wear

import android.content.Context
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.tasks.await
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/**
 * What the watch sends the phone (a set ticked, a rest button, heart-rate samples), through an
 * outbox on the watch's own storage: an event leaves it only once the Data Layer took the message
 * for the phone. With the phone out of reach (Bluetooth off, phone left in the locker) the events
 * wait, in order, and go when the phone is back. The phone applies each once, by its id.
 *
 * Received on the phone by WatchListenerService (frontend/android/app).
 */
object PhoneLink {
    const val PATH_EVENTS = "/reta/events"
    const val CAP_PHONE = "reta_phone"
    private const val OUTBOX = "outbox.json"
    private const val OUTBOX_MAX = 3000
    private const val BATCH_BYTES = 60_000
    private const val BATCH_MAX = 100

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Mutex()

    fun newId(): String = "wear-" + UUID.randomUUID().toString()

    fun send(ctx: Context, ev: JSONObject) {
        val app = ctx.applicationContext
        scope.launch {
            lock.withLock {
                val all = read(app)
                all.put(ev)
                write(app, trimmed(all))
                flushLocked(app)
            }
        }
    }

    fun flush(ctx: Context) {
        val app = ctx.applicationContext
        scope.launch { lock.withLock { flushLocked(app) } }
    }

    private suspend fun flushLocked(ctx: Context) {
        var all = read(ctx)
        if (all.length() == 0) return
        val node = try {
            val nodes = Wearable.getCapabilityClient(ctx).getCapability(CAP_PHONE, CapabilityClient.FILTER_REACHABLE).await().nodes
            nodes.firstOrNull { it.isNearby } ?: nodes.firstOrNull()
        } catch (e: Exception) {
            null
        } ?: return
        val client = Wearable.getMessageClient(ctx)
        while (all.length() > 0) {
            val batch = JSONArray()
            var bytes = 2
            for (i in 0 until all.length()) {
                val s = all.optJSONObject(i)?.toString() ?: continue
                if (batch.length() > 0 && (bytes + s.length > BATCH_BYTES || batch.length() >= BATCH_MAX)) break
                batch.put(JSONObject(s))
                bytes += s.length + 1
            }
            try {
                client.sendMessage(node.id, PATH_EVENTS, batch.toString().toByteArray(Charsets.UTF_8)).await()
            } catch (e: Exception) {
                return
            }
            val sent = (0 until batch.length()).map { batch.getJSONObject(it).optString("id") }.toSet()
            // Read again: an event may have been added meanwhile (it is not in `batch`).
            val left = JSONArray()
            val cur = read(ctx)
            for (i in 0 until cur.length()) {
                val e = cur.optJSONObject(i) ?: continue
                if (e.optString("id") !in sent) left.put(e)
            }
            write(ctx, left)
            all = left
        }
    }

    private fun trimmed(a: JSONArray): JSONArray {
        if (a.length() <= OUTBOX_MAX) return a
        val out = JSONArray()
        for (i in a.length() - OUTBOX_MAX until a.length()) out.put(a.opt(i))
        return out
    }

    private fun read(ctx: Context): JSONArray = try {
        val f = File(ctx.filesDir, OUTBOX)
        if (f.isFile) JSONArray(f.readText()) else JSONArray()
    } catch (e: Exception) {
        JSONArray()
    }

    private fun write(ctx: Context, a: JSONArray) {
        val f = File(ctx.filesDir, OUTBOX)
        val tmp = File(ctx.filesDir, "$OUTBOX.tmp")
        try {
            tmp.writeText(a.toString())
            if (!tmp.renameTo(f)) tmp.delete()
        } catch (e: Exception) {
            tmp.delete()
        }
    }
}
