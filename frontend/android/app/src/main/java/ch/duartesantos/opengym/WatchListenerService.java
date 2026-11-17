package ch.duartesantos.opengym;

import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.WearableListenerService;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Receives what the Wear OS watch sends (frontend/android/wear), even with the page asleep or the
 * app closed: Google Play services starts this service for each message. Nothing is applied here;
 * it is written down (WatchStore) and the page is told if it is there (WatchBridgePlugin), so the
 * phone stays the one place where the workout changes.
 *
 * One message is a batch: a JSON array of events, each with its own id.
 *   { id, type: 'hrSamples', wid, samples: [[epochMs, bpm], ...] }   into heart-rate/<wid>.json
 *   anything else (setDone, restAdd, restSkip...)                     into the event queue
 */
public class WatchListenerService extends WearableListenerService {
    static final String PATH_EVENTS = "/reta/events";

    @Override
    public void onMessageReceived(MessageEvent ev) {
        if (!PATH_EVENTS.equals(ev.getPath())) return;
        JSONArray batch;
        try {
            batch = new JSONArray(new String(ev.getData(), StandardCharsets.UTF_8));
        } catch (JSONException e) {
            return;
        }
        boolean queued = false, hr = false;
        for (int i = 0; i < batch.length(); i++) {
            JSONObject e = batch.optJSONObject(i);
            if (e == null) continue;
            if ("hrSamples".equals(e.optString("type"))) {
                if (WatchStore.addSamples(this, e.optString("wid", null), e.optJSONArray("samples")) >= 0) hr = true;
            } else {
                WatchStore.queue(this, e);
                queued = true;
            }
        }
        if (queued) WatchBridgePlugin.eventQueued();
        if (hr) WatchBridgePlugin.heartRateStored();
    }
}
