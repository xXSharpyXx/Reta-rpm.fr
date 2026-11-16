package ch.duartesantos.opengym;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.View;
import android.widget.RemoteViews;
import java.lang.reflect.Method;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * "Workout in progress" on the lock screen while a workout runs (lib/live-activity.js sends what
 * it shows). Public on the lock screen, on a silent channel of its own, one card:
 *
 *   resting   the rest counting down (a Chronometer the system runs: nothing reposts it per
 *             second), then the exercise, the machine, the set number and the weight × reps
 *   rest over "Let's go" with the same lines, and one short buzz, no sound
 *   lifting   the exercise, its machine and the set to do
 *
 * Buttons: +30 s and Skip rest while resting, Set done otherwise. A tap is applied here at once
 * (the card moves on by itself, as the iPhone's does) and queued for the page, which applies it to
 * the workout when it can (drain/ack). Tapping the card opens the app on the workout.
 *
 * Android 16 and up show it as a Live Update (a promoted ongoing notification: the countdown in a
 * status bar chip and on the lock screen). It must use the system's own template for that, so the
 * dark custom layout is the card everywhere else, and wherever the system does not promote.
 *
 * Battery: no repost per second and no wake-up while lifting. A rest's end is one exact alarm
 * where the phone allows exact alarms, otherwise the CPU is held until that end (as the rest
 * countdown always did, RestCountdownPlan.cpuHoldMs) so the buzz is on time with the screen off.
 */
public class LiveSessionService extends Service {
    static final String ACTION_UPDATE = "opengym.live.UPDATE";
    static final String ACTION_END = "opengym.live.END";
    static final String ACTION_PLUS = "opengym.live.PLUS";
    static final String ACTION_SKIP = "opengym.live.SKIP";
    static final String ACTION_DONE = "opengym.live.DONE";
    static final String ACTION_REST_END = "opengym.live.REST_END";

    static final String CHANNEL_ID = "workout-session";
    static final int NOTIFICATION_ID = 4310;
    private static final String PREFS = "opengym_live_session";
    private static final int FLAGS = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
    private static final long BUZZ_MS = 180;
    // The navy of the cards and the coral accent of the app (brand.css), when the page sent none.
    private static final int BG = 0xFF131826;

    static volatile boolean running;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable restEnd = this::reachRestEnd;
    private PowerManager.WakeLock cpu;

    private String wid = "";
    private JSONObject attrs = new JSONObject();
    private JSONObject state = new JSONObject();
    // The end of the rest being counted (epoch ms), 0 when none; a paused rest holds its seconds.
    private long restEndsAt;
    private long restLeftMs;
    private long restTotalMs;
    // The rest ran out here: the card says "Let's go" until the set it names is done or changes.
    private boolean letsGo;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (action == null) {
            // Restarted by the system after the app was gone: back from what was saved.
            if (!restore()) {
                stopEverything();
                return START_NOT_STICKY;
            }
            show();
            scheduleRestEnd();
            return START_STICKY;
        }
        if (ACTION_END.equals(action)) {
            stopEverything();
            return START_NOT_STICKY;
        }
        if (ACTION_UPDATE.equals(action)) {
            applyUpdate(intent.getStringExtra("wid"), intent.getStringExtra("attributes"), intent.getStringExtra("state"));
        } else {
            // A button, or the rest's alarm, with nothing loaded (a process started just for it).
            if (attrs.length() == 0 && !restore()) {
                stopEverything();
                return START_NOT_STICKY;
            }
            if (ACTION_PLUS.equals(action)) plus30();
            else if (ACTION_SKIP.equals(action)) skipRest();
            else if (ACTION_DONE.equals(action)) setDone();
            else if (ACTION_REST_END.equals(action)) reachRestEnd();
        }
        save();
        show();
        scheduleRestEnd();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        handler.removeCallbacks(restEnd);
        releaseCpu();
        super.onDestroy();
    }

    /* ------------------------------------------------------------------ what the page sent -- */

    private void applyUpdate(String nextWid, String a, String s) {
        JSONObject prevCur = state.optJSONObject("cur");
        boolean wasLetsGo = letsGo;
        wid = nextWid == null ? "" : nextWid;
        attrs = parse(a);
        state = parse(s);
        long now = System.currentTimeMillis();
        long ends = state.optLong("restEndsAt", 0);
        double left = state.optDouble("restLeft", 0);
        restTotalMs = Math.round(state.optDouble("restTotal", 0) * 1000);
        if (ends > now) {
            restEndsAt = ends;
            restLeftMs = 0;
            letsGo = false;
        } else if (left > 0) {
            restEndsAt = 0;
            restLeftMs = Math.round(left * 1000);
            letsGo = false;
        } else {
            // No rest running in the page: "Let's go" stays while it is about the same set.
            boolean ranOutNow = restEndsAt > 0 && restEndsAt <= now + 500;
            restEndsAt = 0;
            restLeftMs = 0;
            letsGo = (wasLetsGo || ranOutNow || (ends > 0 && ends <= now)) && sameSet(prevCur, state.optJSONObject("cur"));
        }
    }

    /* ---------------------------------------------------------------------- the buttons -- */

    private void plus30() {
        long now = System.currentTimeMillis();
        if (restEndsAt > now) restEndsAt += 30_000;
        else if (restLeftMs > 0) restLeftMs += 30_000;
        else return;
        restTotalMs += 30_000;
        JSONObject ev = event("restAdd");
        put(ev, "sec", 30);
        queue(ev);
    }

    private void skipRest() {
        if (restEndsAt <= 0 && restLeftMs <= 0) return;
        restEndsAt = 0;
        restLeftMs = 0;
        letsGo = false;
        cancelRestEnd();
        queue(event("restSkip"));
    }

    /** Ticks the set on the card and moves on to the next one, with the rest that follows it. */
    private void setDone() {
        JSONObject cur = state.optJSONObject("cur");
        if (cur == null) return;
        JSONObject ev = event("setDone");
        put(ev, "exId", cur.optString("exId", ""));
        put(ev, "entryIdx", cur.optInt("entryIdx", -1));
        put(ev, "setIdx", cur.optInt("setIdx", -1));
        queue(ev);
        JSONArray ahead = state.optJSONArray("ahead");
        JSONObject next = ahead != null && ahead.length() > 0 ? ahead.optJSONObject(0) : null;
        JSONArray rest = new JSONArray();
        if (ahead != null) for (int k = 1; k < ahead.length(); k++) rest.put(ahead.opt(k));
        put(state, "cur", next == null ? JSONObject.NULL : next);
        put(state, "ahead", rest);
        put(state, "done", state.optInt("done", 0) + 1);
        letsGo = false;
        int restSec = cur.optInt("restAfter", 0);
        if (next != null && restSec > 0) {
            restTotalMs = restSec * 1000L;
            restEndsAt = System.currentTimeMillis() + restTotalMs;
            restLeftMs = 0;
        } else {
            restEndsAt = 0;
            restLeftMs = 0;
        }
    }

    /** The rest ran out: "Let's go", one short buzz, no sound. */
    private void reachRestEnd() {
        if (restEndsAt <= 0) return;
        long now = System.currentTimeMillis();
        if (restEndsAt > now + 500) {
            // Woken early (a +30 s since): wait for the real end.
            scheduleRestEnd();
            return;
        }
        restEndsAt = 0;
        restLeftMs = 0;
        letsGo = true;
        cancelRestEnd();
        save();
        show();
        // With the app on screen its own timer marks the end (sound and buzz as set in the app).
        if (!RestAlertPlugin.appInFront()) buzz();
        releaseCpu();
    }

    /* ----------------------------------------------------------------------- the card -- */

    private void show() {
        try {
            Notification n = build();
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(NOTIFICATION_ID, n);
            }
        } catch (Exception e) {
            stopEverything();
        }
    }

    private Notification build() {
        JSONObject labels = attrs.optJSONObject("labels");
        if (labels == null) labels = new JSONObject();
        int accent = color(attrs.optString("accent", ""), 0xFFE0524E);
        ensureChannel(this, labels.optString("title", "Workout in progress"));

        JSONObject cur = state.optJSONObject("cur");
        long now = System.currentTimeMillis();
        boolean resting = restEndsAt > now;
        boolean paused = !resting && restLeftMs > 0;
        String exName = cur == null ? labels.optString("allDone", "") : cur.optString("exName", "");
        String machine = cur == null ? "" : cur.optString("machine", "");
        String setLine = cur == null ? "" : cur.optString("setLine", "");
        String load = cur == null ? "" : cur.optString("load", cur.optString("target", ""));
        String setText = join(setLine, load);
        String label = resting || paused ? labels.optString("rest", "Rest")
                : letsGo ? labels.optString("letsGo", "Let's go")
                : labels.optString("title", "Workout in progress");

        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_stat_dumbbell)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(Build.VERSION.SDK_INT >= 30 ? "workout" : Notification.CATEGORY_PROGRESS)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setContentIntent(openApp())
                .setLocalOnly(true);
        if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_LOW);
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);

        // The rest's countdown, run by the system.
        if (resting) {
            b.setWhen(restEndsAt).setShowWhen(true).setUsesChronometer(true);
            if (Build.VERSION.SDK_INT >= 24) b.setChronometerCountDown(true);
        } else {
            b.setShowWhen(false).setUsesChronometer(false);
        }

        if (resting || paused) {
            b.addAction(action(labels.optString("plus30", "+30 s"), ACTION_PLUS, 61));
            b.addAction(action(labels.optString("skipRest", "Skip rest"), ACTION_SKIP, 62));
        } else if (cur != null) {
            b.addAction(action(labels.optString("setDone", "Set done"), ACTION_DONE, 63));
        }

        boolean promote = canPromote(this);
        if (promote) {
            // Android 16 Live Update: the system's template, the countdown in the header and in the
            // status bar chip, the exercise as the title, the set and the load underneath.
            String title = resting || paused || letsGo ? label + " · " + exName : exName;
            b.setContentTitle(title);
            b.setContentText(join(machine, setText));
            b.setColor(accent);
            Bundle extras = new Bundle();
            extras.putBoolean("android.requestPromotedOngoing", true);
            if (paused) extras.putString("android.shortCriticalText", clock(restLeftMs));
            else if (letsGo) extras.putString("android.shortCriticalText", label);
            b.addExtras(extras);
            return b.build();
        }

        // Everywhere else: the dark card, the countdown the largest thing on it. Collapsed (48dp
        // from Android 12 on) on one line, expanded with room for every line.
        RemoteViews small = new RemoteViews(getPackageName(), R.layout.live_session);
        RemoteViews big = new RemoteViews(getPackageName(), R.layout.live_session_big);
        // Running: the Chronometer's base. Paused: the time held, shown as a still m:ss.
        long base = paused ? restLeftMs : SystemClock.elapsedRealtime() + (restEndsAt - now);
        fill(small, true, label, accent, resting, paused, base, exName, machine, setText);
        fill(big, false, label, accent, resting, paused, base, exName, machine, setText);
        b.setContentTitle(resting || paused ? label : exName);
        b.setContentText(setText);
        b.setColor(BG);
        if (Build.VERSION.SDK_INT >= 26) b.setColorized(true);
        if (Build.VERSION.SDK_INT >= 24) {
            b.setCustomContentView(small);
            b.setCustomBigContentView(big);
            b.setStyle(new Notification.DecoratedCustomViewStyle());
        }
        return b.build();
    }

    // `compact`: the collapsed card, two lines beside the clock at most, so the machine rides on
    // the exercise's line.
    private static void fill(RemoteViews v, boolean compact, String label, int accent, boolean resting, boolean paused, long base,
                             String exName, String machine, String setText) {
        v.setTextViewText(R.id.live_label, label.toUpperCase());
        v.setTextColor(R.id.live_label, accent);
        String exLine;
        if (resting) {
            v.setViewVisibility(R.id.live_chrono, View.VISIBLE);
            v.setViewVisibility(R.id.live_big, View.GONE);
            v.setChronometer(R.id.live_chrono, base, null, true);
            if (Build.VERSION.SDK_INT >= 24) v.setChronometerCountDown(R.id.live_chrono, true);
            exLine = join(exName, machine);
        } else {
            v.setViewVisibility(R.id.live_chrono, View.GONE);
            v.setViewVisibility(R.id.live_big, View.VISIBLE);
            v.setChronometer(R.id.live_chrono, 0, null, false);
            v.setTextViewText(R.id.live_big, paused ? clock(base) : compact ? join(exName, machine) : exName);
            exLine = paused ? join(exName, machine) : compact ? "" : machine;
        }
        v.setTextViewText(R.id.live_ex, exLine);
        v.setViewVisibility(R.id.live_ex, exLine.isEmpty() ? View.GONE : View.VISIBLE);
        v.setTextViewText(R.id.live_set, setText);
        v.setViewVisibility(R.id.live_set, setText.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private Notification.Action action(String title, String act, int code) {
        Intent i = new Intent(this, LiveSessionService.class);
        i.setAction(act);
        PendingIntent pi = PendingIntent.getService(this, code, i, FLAGS);
        return new Notification.Action.Builder((Icon) null, title, pi).build();
    }

    private PendingIntent openApp() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        open.putExtra(LiveSessionPlugin.EXTRA_OPEN, true);
        return PendingIntent.getActivity(this, NOTIFICATION_ID, open, FLAGS);
    }

    /** Silent and low: no sound, no buzz, no pop-up on an update; public on the lock screen. */
    static void ensureChannel(Context ctx, String name) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel existing = nm.getNotificationChannel(CHANNEL_ID);
        if (existing != null) {
            // The name follows the app's language; everything else is the user's to change.
            if (!name.equals(String.valueOf(existing.getName()))) {
                existing.setName(name);
                nm.createNotificationChannel(existing);
            }
            return;
        }
        NotificationChannel c = new NotificationChannel(CHANNEL_ID, name, NotificationManager.IMPORTANCE_LOW);
        c.setSound(null, null);
        c.enableVibration(false);
        c.setShowBadge(false);
        c.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(c);
    }

    /** Whether this phone shows the card as a Live Update (Android 16 and the user allows it). */
    static boolean canPromote(Context ctx) {
        if (Build.VERSION.SDK_INT < 36) return false;
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            Method m = NotificationManager.class.getMethod("canPostPromotedNotifications");
            Object ok = m.invoke(nm);
            return ok instanceof Boolean && (Boolean) ok;
        } catch (Exception e) {
            return false;
        }
    }

    private void buzz() {
        try {
            Vibrator vib = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (vib == null || !vib.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= 26) vib.vibrate(VibrationEffect.createOneShot(BUZZ_MS, VibrationEffect.DEFAULT_AMPLITUDE));
            else vib.vibrate(BUZZ_MS);
        } catch (Exception ignored) { /* no buzz: the card still says it */ }
    }

    /* ----------------------------------------------------------------- the rest's end -- */

    private void scheduleRestEnd() {
        handler.removeCallbacks(restEnd);
        long left = restEndsAt - System.currentTimeMillis();
        if (restEndsAt <= 0 || left <= 0) {
            cancelAlarm();
            releaseCpu();
            if (restEndsAt > 0) reachRestEnd();
            return;
        }
        handler.postDelayed(restEnd, left);
        boolean exact = RestAlert.exactAllowed(this);
        if (exact) {
            try {
                AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
                if (Build.VERSION.SDK_INT >= 23) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, restEndsAt, alarmIntent());
                else am.setExact(AlarmManager.RTC_WAKEUP, restEndsAt, alarmIntent());
            } catch (Exception e) {
                exact = false;
            }
        }
        long hold = RestCountdownPlan.cpuHoldMs(exact, left);
        if (hold > 0) holdCpu(hold);
        else releaseCpu();
    }

    private void cancelRestEnd() {
        handler.removeCallbacks(restEnd);
        cancelAlarm();
        releaseCpu();
    }

    private PendingIntent alarmIntent() {
        Intent i = new Intent(this, LiveSessionService.class);
        i.setAction(ACTION_REST_END);
        // An exact alarm may start a foreground service from the background (the app gone).
        return Build.VERSION.SDK_INT >= 26 ? PendingIntent.getForegroundService(this, 64, i, FLAGS) : PendingIntent.getService(this, 64, i, FLAGS);
    }

    private void cancelAlarm() {
        try {
            AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
            if (am != null) am.cancel(alarmIntent());
        } catch (Exception ignored) { /* none set */ }
    }

    private void holdCpu(long ms) {
        try {
            if (cpu == null) {
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                cpu = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "opengym:live-session");
                cpu.setReferenceCounted(false);
            }
            cpu.acquire(ms);
        } catch (Exception ignored) { /* the alarm may still come */ }
    }

    private void releaseCpu() {
        try {
            if (cpu != null && cpu.isHeld()) cpu.release();
        } catch (Exception ignored) { /* released by its timeout */ }
    }

    private void stopEverything() {
        cancelRestEnd();
        clearSaved(this);
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        stopSelf();
    }

    /* ------------------------------------------------- saved state and the event queue -- */

    private void save() {
        try {
            JSONObject o = new JSONObject();
            o.put("wid", wid);
            o.put("attrs", attrs);
            o.put("state", state);
            o.put("restEndsAt", restEndsAt);
            o.put("restLeftMs", restLeftMs);
            o.put("restTotalMs", restTotalMs);
            o.put("letsGo", letsGo);
            prefs(this).edit().putString("session", o.toString()).apply();
        } catch (Exception ignored) { /* shown anyway */ }
    }

    private boolean restore() {
        JSONObject o = parse(prefs(this).getString("session", null));
        if (o.length() == 0) return false;
        wid = o.optString("wid", "");
        attrs = o.optJSONObject("attrs") == null ? new JSONObject() : o.optJSONObject("attrs");
        state = o.optJSONObject("state") == null ? new JSONObject() : o.optJSONObject("state");
        restEndsAt = o.optLong("restEndsAt", 0);
        restLeftMs = o.optLong("restLeftMs", 0);
        restTotalMs = o.optLong("restTotalMs", 0);
        letsGo = o.optBoolean("letsGo", false);
        return attrs.length() > 0;
    }

    static void clearSaved(Context ctx) {
        prefs(ctx).edit().remove("session").apply();
    }

    private JSONObject event(String type) {
        JSONObject ev = new JSONObject();
        put(ev, "id", UUID.randomUUID().toString());
        put(ev, "type", type);
        put(ev, "wid", wid);
        put(ev, "at", System.currentTimeMillis());
        return ev;
    }

    private void queue(JSONObject ev) {
        synchronized (LiveSessionService.class) {
            JSONArray q = readEvents(this);
            q.put(ev);
            prefs(this).edit().putString("events", q.toString()).apply();
        }
        LiveSessionPlugin.eventQueued();
    }

    static JSONArray readEvents(Context ctx) {
        try {
            String s = prefs(ctx).getString("events", null);
            return s == null ? new JSONArray() : new JSONArray(s);
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    static void ackEvents(Context ctx, JSONArray ids) {
        synchronized (LiveSessionService.class) {
            JSONArray q = readEvents(ctx);
            JSONArray keep = new JSONArray();
            for (int k = 0; k < q.length(); k++) {
                JSONObject ev = q.optJSONObject(k);
                if (ev == null) continue;
                String id = ev.optString("id", "");
                boolean acked = false;
                for (int j = 0; j < ids.length(); j++) if (id.equals(ids.optString(j))) { acked = true; break; }
                if (!acked) keep.put(ev);
            }
            prefs(ctx).edit().putString("events", keep.toString()).apply();
        }
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /* ---------------------------------------------------------------------- helpers -- */

    private static boolean sameSet(JSONObject a, JSONObject b) {
        if (a == null || b == null) return false;
        return a.optInt("entryIdx", -1) == b.optInt("entryIdx", -2) && a.optInt("setIdx", -1) == b.optInt("setIdx", -2);
    }

    private static JSONObject parse(String s) {
        if (s == null || s.isEmpty()) return new JSONObject();
        try {
            return new JSONObject(s);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static void put(JSONObject o, String k, Object v) {
        try { o.put(k, v); } catch (Exception ignored) { /* a plain key never fails */ }
    }

    private static int color(String hex, int fallback) {
        try {
            return hex == null || hex.isEmpty() ? fallback : Color.parseColor(hex);
        } catch (Exception e) {
            return fallback;
        }
    }

    private static String join(String a, String b) {
        boolean ha = a != null && !a.isEmpty(), hb = b != null && !b.isEmpty();
        return ha && hb ? a + " · " + b : ha ? a : hb ? b : "";
    }

    private static String clock(long ms) {
        long s = Math.max(0, (ms + 999) / 1000);
        return (s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
    }
}
