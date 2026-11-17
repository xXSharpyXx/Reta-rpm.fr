package ch.duartesantos.opengym;

import android.content.Context;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * What the Wear OS watch sent, kept on the phone's own storage (the app's private files, never
 * anywhere else) until the page has used it.
 *
 *   watch-events.json        the watch's events (a set ticked, a rest button), in order, until the
 *                            page applies and acknowledges them (lib/watch-sync.js drain/ack)
 *   heart-rate/<wid>.json    the heart rate measured during workout <wid>:
 *                            { "wid": "...", "samples": [[epochMs, bpm], ...] }, oldest first, one
 *                            sample per instant (a batch sent twice is stored once)
 *
 * Written by WatchListenerService, which Google Play services starts when a message comes in, so
 * nothing is lost while the page sleeps or the app is closed. Every write goes to a temporary file
 * first and is then renamed over the old one, so a crash never leaves half a file.
 */
final class WatchStore {
    private WatchStore() {}

    private static final String EVENTS = "watch-events.json";
    private static final String HR_DIR = "heart-rate";
    // Far more than a workout makes; a page that never comes back cannot fill the phone.
    private static final int EVENTS_MAX = 1000;
    // A workout id as the page makes them: nothing that could reach outside the folder.
    private static final Pattern WID = Pattern.compile("^[A-Za-z0-9_-]{1,80}$");
    private static final int BPM_MIN = 25, BPM_MAX = 250;

    static boolean okWid(String wid) { return wid != null && WID.matcher(wid).matches(); }

    /* ---------- events ---------- */

    static synchronized JSONArray events(Context ctx) {
        JSONArray a = readArray(new File(ctx.getFilesDir(), EVENTS));
        return a != null ? a : new JSONArray();
    }

    /** Adds one event, unless an event with its id is already waiting. */
    static synchronized void queue(Context ctx, JSONObject ev) {
        String id = ev.optString("id", "");
        if (id.isEmpty()) return;
        JSONArray cur = events(ctx);
        for (int i = 0; i < cur.length(); i++) {
            JSONObject e = cur.optJSONObject(i);
            if (e != null && id.equals(e.optString("id"))) return;
        }
        JSONArray out = new JSONArray();
        int from = Math.max(0, cur.length() + 1 - EVENTS_MAX);
        for (int i = from; i < cur.length(); i++) out.put(cur.opt(i));
        out.put(ev);
        write(new File(ctx.getFilesDir(), EVENTS), out.toString());
    }

    /** The page applied these: they leave the queue. */
    static synchronized void ack(Context ctx, Set<String> ids) {
        JSONArray cur = events(ctx), left = new JSONArray();
        for (int i = 0; i < cur.length(); i++) {
            JSONObject e = cur.optJSONObject(i);
            if (e != null && !ids.contains(e.optString("id"))) left.put(e);
        }
        write(new File(ctx.getFilesDir(), EVENTS), left.toString());
    }

    /* ---------- heart rate ---------- */

    private static File hrFile(Context ctx, String wid) {
        return new File(new File(ctx.getFilesDir(), HR_DIR), wid + ".json");
    }

    /** Merges a batch of [epochMs, bpm] into the workout's file. Returns how many it holds now. */
    static synchronized int addSamples(Context ctx, String wid, JSONArray batch) {
        if (!okWid(wid) || batch == null) return -1;
        TreeMap<Long, Integer> all = new TreeMap<>();
        for (JSONArray s : new JSONArray[] { readSamples(ctx, wid), batch }) {
            for (int i = 0; i < s.length(); i++) {
                JSONArray p = s.optJSONArray(i);
                if (p == null || p.length() < 2) continue;
                long t = p.optLong(0, 0);
                int bpm = (int) Math.round(p.optDouble(1, 0));
                if (t > 0 && bpm >= BPM_MIN && bpm <= BPM_MAX) all.put(t, bpm);
            }
        }
        JSONArray samples = new JSONArray();
        for (Map.Entry<Long, Integer> e : all.entrySet()) samples.put(new JSONArray().put(e.getKey()).put(e.getValue()));
        try {
            JSONObject doc = new JSONObject().put("wid", wid).put("samples", samples);
            File f = hrFile(ctx, wid);
            File dir = f.getParentFile();
            if (dir != null && !dir.isDirectory() && !dir.mkdirs()) return -1;
            write(f, doc.toString());
        } catch (JSONException e) {
            return -1;
        }
        return samples.length();
    }

    static synchronized JSONArray readSamples(Context ctx, String wid) {
        if (!okWid(wid)) return new JSONArray();
        JSONObject doc = readObject(hrFile(ctx, wid));
        JSONArray s = doc != null ? doc.optJSONArray("samples") : null;
        return s != null ? s : new JSONArray();
    }

    /** [{ wid, n, at }] for each workout with a heart-rate file. */
    static synchronized JSONArray listSamples(Context ctx) {
        JSONArray out = new JSONArray();
        File[] files = new File(ctx.getFilesDir(), HR_DIR).listFiles();
        if (files == null) return out;
        for (File f : files) {
            String name = f.getName();
            if (!name.endsWith(".json")) continue;
            String wid = name.substring(0, name.length() - 5);
            if (!okWid(wid)) continue;
            try {
                out.put(new JSONObject().put("wid", wid).put("n", readSamples(ctx, wid).length()).put("at", f.lastModified()));
            } catch (JSONException ignored) {
                // left out of the list, read next time
            }
        }
        return out;
    }

    /* ---------- files ---------- */

    private static String read(File f) {
        if (!f.isFile()) return null;
        try {
            return new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
        } catch (IOException e) {
            return null;
        }
    }

    private static JSONArray readArray(File f) {
        String s = read(f);
        if (s == null) return null;
        try { return new JSONArray(s); } catch (JSONException e) { return null; }
    }

    private static JSONObject readObject(File f) {
        String s = read(f);
        if (s == null) return null;
        try { return new JSONObject(s); } catch (JSONException e) { return null; }
    }

    private static void write(File f, String body) {
        File tmp = new File(f.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(body.getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        } catch (IOException e) {
            tmp.delete();
            return;
        }
        if (!tmp.renameTo(f)) tmp.delete();
    }

    /** The ids of a JS array of strings. */
    static Set<String> idsOf(JSONArray a) {
        Set<String> ids = new HashSet<>();
        if (a == null) return ids;
        for (int i = 0; i < a.length(); i++) {
            String s = a.optString(i, null);
            if (s != null) ids.add(s);
        }
        return ids;
    }
}
