package ch.duartesantos.opengym.wear

import android.content.Context
import android.net.Uri
import com.google.android.gms.wearable.CapabilityInfo
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataItem
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import kotlinx.coroutines.tasks.await

/**
 * The phone's workout (the Data Layer item /reta/snapshot, sent by WatchBridgePlugin on the phone),
 * received also with the watch app closed: Google Play services starts this service for it.
 */
class PhoneListenerService : WearableListenerService() {
    companion object {
        const val PATH_SNAPSHOT = "/reta/snapshot"

        fun apply(ctx: Context, item: DataItem) {
            if (item.uri.path != PATH_SNAPSHOT) return
            val map = DataMapItem.fromDataItem(item).dataMap
            val json = map.getString("json") ?: return
            Session.onSnapshot(ctx, json, map.getLong("at", 0L))
        }

        /** The latest snapshot the Data Layer holds, when the app opens. */
        suspend fun pull(ctx: Context) {
            try {
                val items = Wearable.getDataClient(ctx).getDataItems(Uri.parse("wear://*$PATH_SNAPSHOT")).await()
                try {
                    items.forEach { apply(ctx, it) }
                } finally {
                    items.release()
                }
            } catch (e: Exception) {
                // no phone yet: the app shows there is no workout
            }
        }
    }

    override fun onDataChanged(events: DataEventBuffer) {
        events.forEach { ev ->
            if (ev.type == DataEvent.TYPE_CHANGED) apply(applicationContext, ev.dataItem)
        }
        SessionService.sync(applicationContext)
        // The phone is there: what waited in the outbox can go.
        PhoneLink.flush(applicationContext)
    }

    override fun onCapabilityChanged(info: CapabilityInfo) {
        if (info.nodes.isNotEmpty()) PhoneLink.flush(applicationContext)
    }
}
