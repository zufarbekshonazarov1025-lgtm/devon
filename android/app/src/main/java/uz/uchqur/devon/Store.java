package uz.uchqur.devon;

import android.content.Context;
import android.content.SharedPreferences;

import java.security.SecureRandom;

/** Qurilma kaliti va oxirgi olingan ma'lumot (vidjet shundan chiziladi). */
final class Store {
    private static final String FILE = "devon";

    private Store() {}

    static SharedPreferences prefs(Context c) { return c.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE); }

    static synchronized String key(Context c) {
        String k = prefs(c).getString("key", null);
        if (k == null) {
            byte[] raw = new byte[32];
            new SecureRandom().nextBytes(raw);
            StringBuilder sb = new StringBuilder();
            for (byte b : raw) sb.append(String.format("%02x", b));
            k = sb.toString();
            prefs(c).edit().putString("key", k).apply();
        }
        return k;
    }

    static boolean registered(Context c) { return prefs(c).getBoolean("registered", false); }

    static void setRegistered(Context c, boolean on) { prefs(c).edit().putBoolean("registered", on).apply(); }

    /** Hisobdan chiqilganda yoki qurilma uzilganda: kalit ham, ma'lumot ham o'chadi. */
    static void clear(Context c) { prefs(c).edit().clear().apply(); }

    static String snapshot(Context c) { return prefs(c).getString("snapshot", null); }

    static void saveSnapshot(Context c, String json) { prefs(c).edit().putString("snapshot", json).putLong("snapshot_at", System.currentTimeMillis()).apply(); }
}
