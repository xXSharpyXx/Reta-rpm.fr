package ch.duartesantos.opengym;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import androidx.core.content.ContextCompat;
import androidx.wear.remote.interactions.RemoteActivityHelper;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.wearable.CapabilityClient;
import com.google.android.gms.wearable.CapabilityInfo;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.PutDataMapRequest;
import com.google.android.gms.wearable.PutDataRequest;
import com.google.android.gms.wearable.Wearable;
import com.google.common.util.concurrent.ListenableFuture;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONArray;
import org.json.JSONException;

/**
 * The phone's end of the Wear OS watch link: the Android twin of ios/App/App/WatchBridgePlugin.swift,
 * with the same calls, so lib/watch-sync.js drives both the same way. The watch app is
 * frontend/android/wear.
 *
 * Phone → watch: the snapshot of the running workout goes out as a Data Layer item
 * (/reta/snapshot). Google Play services keeps the latest one and hands it to the watch as soon as
 * it is in reach, so a watch that was away catches up by itself, and one without the app hears
 * nothing.
 *
 * Watch → phone: messages (/reta/events), received by WatchListenerService and written down in
 * WatchStore, even with the page asleep. The page drains and acknowledges them as on the iPhone.
 * The heart rate goes to its own file per workout (listHr, readHr).
 *
 * The link only works between two apps with the same applicationId and signed with the same key:
 * the watch module reuses app/reta-debug.keystore and the ".test" suffix of the debug build.
 *
 * Without a watch, or without Wear OS on the phone at all, every call resolves with "nothing
 * there" and the app behaves exactly as before.
 */
@CapacitorPlugin(name = "WatchBridge")
public class WatchBridgePlugin extends Plugin {
    static final String PATH_SNAPSHOT = "/reta/snapshot";
    static final String CAP_WATCH = "reta_wear";
    static final String OPEN_URI = "reta-wear://session";

    private static volatile WatchBridgePlugin instance;
    private CapabilityClient.OnCapabilityChangedListener capListener;

    @Override
    public void load() {
        instance = this;
        super.load();
        capListener = (CapabilityInfo info) -> notifyListeners("watchState", new JSObject());
        try {
            Wearable.getCapabilityClient(getContext()).addListener(capListener, CAP_WATCH);
        } catch (Exception ignored) {
            // no Wear OS here: there will be nothing to hear
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
        try {
            if (capListener != null) Wearable.getCapabilityClient(getContext()).removeListener(capListener);
        } catch (Exception ignored) {
            // already gone
        }
        super.handleOnDestroy();
    }

    /** WatchListenerService queued an event: the page drains it if it is there. */
    static void eventQueued() {
        WatchBridgePlugin p = instance;
        if (p != null) p.notifyListeners("watchEvent", new JSObject());
    }

    /** WatchListenerService stored heart rate: the page reads it into the saved workout. */
    static void heartRateStored() {
        WatchBridgePlugin p = instance;
        if (p != null) p.notifyListeners("watchHr", new JSObject());
    }

    private static JSObject nothing() {
        JSObject r = new JSObject();
        r.put("supported", false);
        r.put("activated", true);
        r.put("paired", false);
        r.put("installed", false);
        r.put("reachable", false);
        return r;
    }

    /** { supported, activated, paired, installed, reachable }: a watch with the app is known / in reach. */
    @PluginMethod
    public void status(PluginCall call) {
        Context ctx = getContext();
        try {
            Wearable.getCapabilityClient(ctx).getCapability(CAP_WATCH, CapabilityClient.FILTER_ALL)
                .addOnSuccessListener(all -> Wearable.getCapabilityClient(ctx).getCapability(CAP_WATCH, CapabilityClient.FILTER_REACHABLE)
                    .addOnSuccessListener(near -> {
                        JSObject r = new JSObject();
                        boolean installed = !all.getNodes().isEmpty();
                        r.put("supported", true);
                        r.put("activated", true);
                        r.put("paired", installed);
                        r.put("installed", installed);
                        r.put("reachable", !near.getNodes().isEmpty());
                        call.resolve(r);
                    })
                    .addOnFailureListener(e -> call.resolve(nothing())))
                .addOnFailureListener(e -> call.resolve(nothing()));
        } catch (Exception e) {
            call.resolve(nothing());
        }
    }

    @PluginMethod
    public void sendSnapshot(PluginCall call) {
        String json = call.getString("json");
        if (json == null) {
            call.reject("json is required");
            return;
        }
        try {
            PutDataMapRequest req = PutDataMapRequest.create(PATH_SNAPSHOT);
            req.getDataMap().putString("json", json);
            // Stamped: the Data Layer does not pass on an item equal to the one before, and the
            // page sends the same snapshot again on purpose when the watch app was reinstalled.
            req.getDataMap().putLong("at", System.currentTimeMillis());
            PutDataRequest put = req.asPutDataRequest().setUrgent();
            Wearable.getDataClient(getContext()).putDataItem(put)
                .addOnSuccessListener(item -> { JSObject r = new JSObject(); r.put("sent", true); call.resolve(r); })
                .addOnFailureListener(e -> { JSObject r = new JSObject(); r.put("sent", false); r.put("error", String.valueOf(e.getMessage())); call.resolve(r); });
        } catch (Exception e) {
            JSObject r = new JSObject();
            r.put("sent", false);
            call.resolve(r);
        }
    }

    @PluginMethod
    public void drain(PluginCall call) {
        JSObject r = new JSObject();
        try {
            r.put("events", new JSArray(WatchStore.events(getContext()).toString()));
        } catch (JSONException e) {
            r.put("events", new JSArray());
        }
        call.resolve(r);
    }

    @PluginMethod
    public void ack(PluginCall call) {
        JSArray ids = call.getArray("ids");
        Set<String> set = WatchStore.idsOf(ids);
        if (!set.isEmpty()) WatchStore.ack(getContext(), set);
        call.resolve();
    }

    /** A workout started on the phone: the watch app opens with it, on each watch in reach that has it. */
    @PluginMethod
    public void openOnWatch(PluginCall call) {
        Context ctx = getContext();
        try {
            Wearable.getCapabilityClient(ctx).getCapability(CAP_WATCH, CapabilityClient.FILTER_REACHABLE)
                .addOnSuccessListener(info -> {
                    Set<Node> nodes = info.getNodes();
                    JSObject r = new JSObject();
                    if (nodes.isEmpty()) { r.put("ok", false); call.resolve(r); return; }
                    RemoteActivityHelper helper = new RemoteActivityHelper(ctx, ContextCompat.getMainExecutor(ctx));
                    Intent open = new Intent(Intent.ACTION_VIEW)
                        .addCategory(Intent.CATEGORY_BROWSABLE)
                        .setData(Uri.parse(OPEN_URI));
                    AtomicInteger left = new AtomicInteger(nodes.size());
                    for (Node n : nodes) {
                        ListenableFuture<Void> f = helper.startRemoteActivity(open, n.getId());
                        f.addListener(() -> {
                            if (left.decrementAndGet() == 0) { r.put("ok", true); call.resolve(r); }
                        }, ContextCompat.getMainExecutor(ctx));
                    }
                })
                .addOnFailureListener(e -> { JSObject r = new JSObject(); r.put("ok", false); call.resolve(r); });
        } catch (Exception e) {
            JSObject r = new JSObject();
            r.put("ok", false);
            call.resolve(r);
        }
    }

    /** The watch shows no animations (text only): nothing to send. */
    @PluginMethod
    public void sendClips(PluginCall call) {
        JSObject r = new JSObject();
        r.put("sent", 0);
        call.resolve(r);
    }

    @PluginMethod
    public void dropClips(PluginCall call) {
        call.resolve();
    }

    /** { files: [{ wid, n, at }] }: the workouts the watch measured a heart rate for. */
    @PluginMethod
    public void listHr(PluginCall call) {
        JSObject r = new JSObject();
        try {
            r.put("files", new JSArray(WatchStore.listSamples(getContext()).toString()));
        } catch (JSONException e) {
            r.put("files", new JSArray());
        }
        call.resolve(r);
    }

    /** { samples: [[epochMs, bpm], ...] } of workout `wid`, oldest first. */
    @PluginMethod
    public void readHr(PluginCall call) {
        String wid = call.getString("wid");
        JSObject r = new JSObject();
        JSONArray s = WatchStore.readSamples(getContext(), wid);
        try {
            r.put("samples", new JSArray(s.toString()));
        } catch (JSONException e) {
            r.put("samples", new JSArray());
        }
        call.resolve(r);
    }
}
