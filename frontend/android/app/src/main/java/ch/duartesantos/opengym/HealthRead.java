package ch.duartesantos.opengym;

import androidx.health.connect.client.records.HeartRateRecord;
import androidx.health.connect.client.records.WeightRecord;
import androidx.health.connect.client.records.metadata.Metadata;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * What HealthConnectPlugin hands to JS when it reads (v1.4.3): plain values, no Android classes,
 * so it is tested on the JVM (HealthReadTest). Heart rate as [ms, bpm] pairs inside the window
 * asked for; weigh-ins as { t, kg, id, origin, clientId }. Which of them openGym takes, and how,
 * is decided in JS (lib/health-read.js), which also skips openGym's own records.
 */
final class HealthRead {
    private HealthRead() {}

    // Beyond this no reading is plausible; lib/heart-rate.js applies the same bounds again.
    static final long BPM_MIN = 25;
    static final long BPM_MAX = 250;
    // A workout of a few hours at one sample a second is well under this.
    static final int MAX_SAMPLES = 50000;

    /** The samples of these records that lie in [from, to], oldest first. */
    static List<long[]> samples(List<HeartRateRecord> records, long from, long to) {
        List<long[]> out = new ArrayList<>();
        for (HeartRateRecord r : records) {
            for (HeartRateRecord.Sample s : r.getSamples()) {
                long t = s.getTime().toEpochMilli();
                long bpm = s.getBeatsPerMinute();
                if (t < from || t > to || bpm < BPM_MIN || bpm > BPM_MAX) continue;
                out.add(new long[] { t, bpm });
                if (out.size() >= MAX_SAMPLES) break;
            }
            if (out.size() >= MAX_SAMPLES) break;
        }
        out.sort((a, b) -> Long.compare(a[0], b[0]));
        return out;
    }

    /** One weigh-in as JS gets it. */
    static final class Weight {
        final long t;
        final double kg;
        final String id, origin, clientId;

        Weight(long t, double kg, String id, String origin, String clientId) {
            this.t = t; this.kg = kg; this.id = id; this.origin = origin; this.clientId = clientId;
        }
    }

    static List<Weight> weights(List<WeightRecord> records) {
        List<Weight> out = new ArrayList<>();
        for (WeightRecord r : records) {
            Metadata m = r.getMetadata();
            double kg = r.getWeight().getKilograms();
            if (!(kg > 0)) continue;
            out.add(new Weight(r.getTime().toEpochMilli(), kg, m.getId(),
                    m.getDataOrigin().getPackageName(), m.getClientRecordId()));
        }
        return out;
    }

    /**
     * One body-composition reading as JS gets it (what a smart scale's app, Renpho Health for
     * one, saves next to the weight): its type is fat (%), lean, bone, water (kg), bmr (kcal a
     * day) or height (m). lib/health-read.js mergeBodyComp decides what goes into the log.
     */
    static final class Body {
        final String type;
        final long t;
        final double v;
        final String id, origin, clientId;

        Body(String type, long t, double v, String id, String origin, String clientId) {
            this.type = type; this.t = t; this.v = v; this.id = id; this.origin = origin; this.clientId = clientId;
        }
    }

    private static void add(List<Body> out, String type, Instant time, double v, Metadata m) {
        if (!(v > 0) || Double.isInfinite(v)) return;
        out.add(new Body(type, time.toEpochMilli(), v, m.getId(), m.getDataOrigin().getPackageName(), m.getClientRecordId()));
    }

    static List<Body> bodyFat(List<BodyFatRecord> records) {
        List<Body> out = new ArrayList<>();
        for (BodyFatRecord r : records) add(out, "fat", r.getTime(), r.getPercentage().getValue(), r.getMetadata());
        return out;
    }

    static List<Body> leanMass(List<LeanBodyMassRecord> records) {
        List<Body> out = new ArrayList<>();
        for (LeanBodyMassRecord r : records) add(out, "lean", r.getTime(), r.getMass().getKilograms(), r.getMetadata());
        return out;
    }

    static List<Body> boneMass(List<BoneMassRecord> records) {
        List<Body> out = new ArrayList<>();
        for (BoneMassRecord r : records) add(out, "bone", r.getTime(), r.getMass().getKilograms(), r.getMetadata());
        return out;
    }

    static List<Body> bodyWater(List<BodyWaterMassRecord> records) {
        List<Body> out = new ArrayList<>();
        for (BodyWaterMassRecord r : records) add(out, "water", r.getTime(), r.getMass().getKilograms(), r.getMetadata());
        return out;
    }

    static List<Body> bmr(List<BasalMetabolicRateRecord> records) {
        List<Body> out = new ArrayList<>();
        for (BasalMetabolicRateRecord r : records) add(out, "bmr", r.getTime(), r.getBasalMetabolicRate().getKilocaloriesPerDay(), r.getMetadata());
        return out;
    }

    static List<Body> height(List<HeightRecord> records) {
        List<Body> out = new ArrayList<>();
        for (HeightRecord r : records) add(out, "height", r.getTime(), r.getHeight().getMeters(), r.getMetadata());
        return out;
    }

    /** The body-composition read permissions, by their JS names (readBody reads those granted). */
    static final String[] BODY = { "bodyFat", "leanMass", "boneMass", "bodyWater", "bmr", "height" };

    /** The JS names of the read permissions, as the manifest declares them. */
    static String readPermission(String name) {
        switch (name) {
            case "heartRate": return "android.permission.health.READ_HEART_RATE";
            case "weight": return "android.permission.health.READ_WEIGHT";
            case "bodyFat": return "android.permission.health.READ_BODY_FAT";
            case "leanMass": return "android.permission.health.READ_LEAN_BODY_MASS";
            case "boneMass": return "android.permission.health.READ_BONE_MASS";
            case "bodyWater": return "android.permission.health.READ_BODY_WATER_MASS";
            case "bmr": return "android.permission.health.READ_BASAL_METABOLIC_RATE";
            case "height": return "android.permission.health.READ_HEIGHT";
            // Not a data type: data older than 30 days before the first grant (#801).
            case "history": return "android.permission.health.READ_HEALTH_DATA_HISTORY";
            default: return null;
        }
    }

    static String writePermission(String name) {
        switch (name) {
            case "exercise": return "android.permission.health.WRITE_EXERCISE";
            case "weight": return "android.permission.health.WRITE_WEIGHT";
            default: return null;
        }
    }
}
