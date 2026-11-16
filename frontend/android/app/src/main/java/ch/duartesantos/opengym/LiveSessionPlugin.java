package ch.duartesantos.opengym;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The running workout on the lock screen, the Android side of lib/live-activity.js. It takes the
 * same calls as the iPhone's Live Activity (status, update, end, drain, ack) and sends the same
 * event, so the page drives both the same way:
 *
 *   update({ wid, attributes, state })  shows or refreshes the "Workout in progress" notification
 *   end()                               takes it away (workout finished or discarded)
 *   drain() / ack({ ids })              the taps on its buttons, queued until the page applies them
 *   consumeOpen()                       whether the app was opened from the notification
 *
 * The notification itself lives in LiveSessionService, a foreground service, so it keeps counting
 * the rest down and answering its buttons with the page asleep or the app gone.
 */
@CapacitorPlugin(name = "LiveActivity")
public class LiveSessionPlugin extends Plugin {
    static final String EXTRA_OPEN = "opengym.openWorkout";
    private static LiveSessionPlugin instance;
    private static volatile boolean openPending;

    @Override
    public void load() {
        instance = this;
        super.load();
        Activity a = getActivity();
        if (a != null && a.getIntent() != null && a.getIntent().getBooleanExtra(EXTRA_OPEN, false)) {
            openPending = true;
            a.getIntent().removeExtra(EXTRA_OPEN);
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent != null && intent.getBooleanExtra(EXTRA_OPEN, false)) {
            openPending = true;
            intent.removeExtra(EXTRA_OPEN);
            notifyListeners("liveActivityOpen", new JSObject());
        }
    }

    /** A button on the notification queued an event: the page drains it when it can. */
    static void eventQueued() {
        LiveSessionPlugin p = instance;
        if (p != null) p.notifyListeners("liveActivityEvent", new JSObject());
    }

    @PluginMethod
    public void status(PluginCall call) {
        Context ctx = getContext();
        JSObject out = new JSObject();
        out.put("supported", ctx != null);
        out.put("notifications", ctx != null && notificationsEnabled(ctx));
        out.put("promoted", ctx != null && LiveSessionService.canPromote(ctx));
        call.resolve(out);
    }

    @PluginMethod
    public void update(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) {
            call.reject("no context");
            return;
        }
        Intent i = new Intent(ctx, LiveSessionService.class);
        i.setAction(LiveSessionService.ACTION_UPDATE);
        i.putExtra("wid", call.getString("wid", ""));
        i.putExtra("attributes", call.getString("attributes", "{}"));
        i.putExtra("state", call.getString("state", "{}"));
        try {
            if (LiveSessionService.running || Build.VERSION.SDK_INT < 26) ctx.startService(i);
            else ctx.startForegroundService(i);
            call.resolve();
        } catch (Exception e) {
            // Android 12+ refuses a new foreground service from the background: the next update
            // made with the app in front starts it.
            call.reject("not started: " + e.getMessage());
        }
    }

    @PluginMethod
    public void end(PluginCall call) {
        Context ctx = getContext();
        if (ctx != null && LiveSessionService.running) {
            Intent i = new Intent(ctx, LiveSessionService.class);
            i.setAction(LiveSessionService.ACTION_END);
            try { ctx.startService(i); } catch (Exception ignored) { /* stopped already */ }
        }
        if (ctx != null) LiveSessionService.clearSaved(ctx);
        call.resolve();
    }

    @PluginMethod
    public void drain(PluginCall call) {
        Context ctx = getContext();
        JSObject out = new JSObject();
        JSArray events = new JSArray();
        if (ctx != null) {
            JSONArray q = LiveSessionService.readEvents(ctx);
            for (int k = 0; k < q.length(); k++) {
                JSONObject ev = q.optJSONObject(k);
                if (ev != null) events.put(ev);
            }
        }
        out.put("events", events);
        call.resolve(out);
    }

    @PluginMethod
    public void ack(PluginCall call) {
        Context ctx = getContext();
        JSArray ids = call.getArray("ids");
        if (ctx != null && ids != null) LiveSessionService.ackEvents(ctx, ids);
        call.resolve();
    }

    @PluginMethod
    public void consumeOpen(PluginCall call) {
        JSObject out = new JSObject();
        out.put("open", openPending);
        openPending = false;
        call.resolve(out);
    }

    private static boolean notificationsEnabled(Context ctx) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            return nm == null || Build.VERSION.SDK_INT < 24 || nm.areNotificationsEnabled();
        } catch (Exception e) {
            return true;
        }
    }
}
