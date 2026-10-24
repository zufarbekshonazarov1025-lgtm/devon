package uz.uchqur.devon;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

/** Eslatma budilnigi vaqtida chalishi uchun kerakli ruxsatlar: bildirishnoma, aniq vaqt, quvvat tejashdan chiqarish. */
final class Perms {
    private Perms() {}

    static boolean isXiaomi() {
        String m = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase();
        return m.contains("xiaomi") || m.contains("redmi") || m.contains("poco");
    }

    /** «ok» yoki yetishmayotganlar: bildirishnoma, aniq_vaqt, quvvat, xiaomi (vergul bilan). */
    static String status(Context c) {
        StringBuilder s = new StringBuilder();
        if (!NotificationManagerCompat.from(c).areNotificationsEnabled()) s.append("bildirishnoma,");
        if (Build.VERSION.SDK_INT >= 31) {
            AlarmManager am = c.getSystemService(AlarmManager.class);
            if (am != null && !am.canScheduleExactAlarms()) s.append("aniq_vaqt,");
        }
        PowerManager pm = c.getSystemService(PowerManager.class);
        if (pm != null && !pm.isIgnoringBatteryOptimizations(c.getPackageName())) s.append("quvvat,");
        if (isXiaomi() && !Store.prefs(c).getBoolean("xiaomi_autostart", false)) s.append("xiaomi,");
        return s.length() == 0 ? "ok" : s.substring(0, s.length() - 1);
    }

    /**
     * Ruxsatlarni so'raydi. force = false: ilova ochilganda, har biri faqat bir marta so'raladi.
     * force = true: dasturdagi «Sozlash» tugmasi — yetishmayotgan birinchisi ochiladi (Xiaomi'da avtoishga tushirish ham).
     */
    static void askAll(Activity a, boolean force) {
        try {
            if (Build.VERSION.SDK_INT >= 33 && a.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                if (force || !Store.prefs(a).getBoolean("asked_notif", false)) {
                    Store.prefs(a).edit().putBoolean("asked_notif", true).apply();
                    a.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7);
                    if (!force) return; // bittadan: keyingisi keyingi ochilishda
                }
            }
            if (force && !NotificationManagerCompat.from(a).areNotificationsEnabled()) {
                a.startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, a.getPackageName()));
                return;
            }
            if (Build.VERSION.SDK_INT >= 31) {
                AlarmManager am = a.getSystemService(AlarmManager.class);
                if (am != null && !am.canScheduleExactAlarms() && (force || !Store.prefs(a).getBoolean("asked_exact", false))) {
                    Store.prefs(a).edit().putBoolean("asked_exact", true).apply();
                    a.startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + a.getPackageName())));
                    return;
                }
            }
            PowerManager pm = a.getSystemService(PowerManager.class);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(a.getPackageName()) && (force || !Store.prefs(a).getBoolean("asked_battery", false))) {
                Store.prefs(a).edit().putBoolean("asked_battery", true).apply();
                a.startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + a.getPackageName())));
                return;
            }
            if (force && isXiaomi()) {
                Store.prefs(a).edit().putBoolean("xiaomi_autostart", true).apply();
                Intent auto = new Intent().setComponent(new ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"));
                try { a.startActivity(auto); }
                catch (Exception e) { a.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + a.getPackageName()))); }
            }
        } catch (Exception e) { /* sozlama sahifasi topilmasa — o'tkazib yuboramiz */ }
    }
}
