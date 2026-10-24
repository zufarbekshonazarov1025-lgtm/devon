package uz.uchqur.devon;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Eslatma budilniklari: telefonning o'zi chaladi, internet bo'lmasa ham vaqtida.
 * Har eslatma uchun 3 bosqich: 15 daqiqa oldin, aynan vaqtida, 30 daqiqa o'tib (hali qabul qilinmagan bo'lsa).
 * Ro'yxat har sinxronlashda serverdan keladi; qabul qilinganlari ro'yxatda bo'lmaydi va ularning budilniklari bekor bo'ladi.
 */
public class Alarms extends BroadcastReceiver {
    static final String CHANNEL = "devon_eslatma";
    private static final String ACTION_FIRE = "uz.uchqur.devon.ALARM";
    private static final String ACTION_ACK = "uz.uchqur.devon.ACK";
    private static final long MIN = 60_000L;
    private static final int[] STAGE_OFFSET = {-15, 0, 30}; // daqiqa

    // ---------- Rejalashtirish ----------

    /** Serverdan kelgan ro'yxat bo'yicha hamma budilnikni qaytadan qo'yadi (eskilari bekor bo'ladi). */
    static synchronized void reschedule(Context c, JSONArray list) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        if (am == null) return;
        // Avvalgi qo'yilganlarni bekor qilamiz
        try {
            JSONArray old = new JSONArray(Store.prefs(c).getString("alarm_codes", "[]"));
            for (int i = 0; i < old.length(); i++) am.cancel(pending(c, old.getInt(i), null));
        } catch (Exception e) { /* bo'sh */ }
        JSONArray codes = new JSONArray();
        long now = System.currentTimeMillis();
        StringBuilder alive = new StringBuilder("|");
        if (list != null) for (int i = 0; i < list.length(); i++) {
            JSONObject a = list.optJSONObject(i);
            if (a == null) continue;
            String key = a.optString("key");
            long at = a.optLong("at");
            if (key.isEmpty() || at <= 0) continue;
            alive.append(key).append('|');
            boolean single = "muddat".equals(a.optString("kind"));
            for (int st = 0; st < 3; st++) {
                if (single && st != 1) continue;
                long when = at + STAGE_OFFSET[st] * MIN;
                if (when < now - MIN) continue; // o'tib ketgan bosqich
                int code = (key + "#" + st).hashCode();
                Intent it = new Intent(c, Alarms.class).setAction(ACTION_FIRE)
                        .putExtra("key", key).putExtra("stage", st).putExtra("kind", a.optString("kind", "eslatma"))
                        .putExtra("title", a.optString("title")).putExtra("time", a.optString("time"))
                        .putExtra("by", a.optString("by")).putExtra("text", a.optString("text"));
                PendingIntent pi = pending(c, code, it);
                long t = Math.max(when, now + 2000);
                try {
                    if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t, pi);
                    else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t, pi);
                } catch (SecurityException e) {
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t, pi);
                }
                codes.put(code);
            }
        }
        Store.prefs(c).edit().putString("alarm_codes", codes.toString()).putString("alarm_alive", alive.toString()).apply();
        // Qabul qilingan yoki o'chirilgan eslatmalarning ekrandagi xabarini ham olib tashlaymiz
        try {
            String shown = Store.prefs(c).getString("alarm_shown", "");
            StringBuilder keep = new StringBuilder();
            for (String k : shown.split("\n")) {
                if (k.isEmpty()) continue;
                if (alive.indexOf("|" + k + "|") >= 0) keep.append(k).append('\n');
                else NotificationManagerCompat.from(c).cancel(notifId(k));
            }
            Store.prefs(c).edit().putString("alarm_shown", keep.toString()).apply();
        } catch (Exception e) { /* bo'sh */ }
    }

    /** Telefon qayta yonganda yoki ilova yangilanganda: oxirgi saqlangan ro'yxatdan. */
    static void restore(Context c) {
        try {
            String snap = Store.snapshot(c);
            if (snap != null) reschedule(c, new JSONObject(snap).optJSONArray("alarms"));
        } catch (Exception e) { /* bo'sh */ }
    }

    static void cancelAll(Context c) { reschedule(c, null); }

    private static PendingIntent pending(Context c, int code, Intent it) {
        if (it == null) it = new Intent(c, Alarms.class).setAction(ACTION_FIRE);
        return PendingIntent.getBroadcast(c, code, it, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static int notifId(String key) { return 0x40000000 | (key.hashCode() & 0x3FFFFFFF); }

    // ---------- Chalinish va «Qabul qildim» ----------

    @Override
    public void onReceive(Context c, Intent it) {
        String a = it.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)
                || "android.intent.action.TIME_SET".equals(a) || "android.intent.action.TIMEZONE_CHANGED".equals(a)
                || "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED".equals(a)) {
            if (Store.registered(c)) { restore(c); Sync.now(c); }
            return;
        }
        String key = it.getStringExtra("key");
        if (key == null || !Store.registered(c)) return;
        if (ACTION_ACK.equals(a)) {
            NotificationManagerCompat.from(c).cancel(notifId(key));
            // Qolgan bosqichlarni darhol bekor qilamiz, serverga esa internet bo'lganda yetkaziladi
            AlarmManager am = c.getSystemService(AlarmManager.class);
            if (am != null) for (int st = 0; st < 3; st++) am.cancel(pending(c, (key + "#" + st).hashCode(), null));
            Sync.ack(c, key);
            return;
        }
        if (!ACTION_FIRE.equals(a)) return;
        // Server ro'yxatidan chiqib ketgan bo'lsa (qabul qilingan), chalmaymiz
        String alive = Store.prefs(c).getString("alarm_alive", "|");
        if (alive.indexOf("|" + key + "|") < 0) return;
        show(c, key, it.getIntExtra("stage", 1), it.getStringExtra("kind"), it.getStringExtra("title"),
                it.getStringExtra("time"), it.getStringExtra("by"), it.getStringExtra("text"));
    }

    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Eslatmalar (budilnik)", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Eslatma vaqtidan oldin, vaqtida va qabul qilinmasa — vaqti o'tganda");
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[]{0, 400, 200, 400, 200, 600});
        ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        ch.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    private static void show(Context c, String key, int stage, String kind, String title, String time, String by, String text) {
        try {
            ensureChannel(c);
            boolean due = "muddat".equals(kind);
            String head = due ? (title == null ? "Muddati yaqin topshiriqlar" : title)
                    : stage == 0 ? "15 daqiqadan keyin: " + title
                    : stage == 1 ? "Eslatma: " + title
                    : "Vaqti o'tib ketdi, qabul qilinmagan: " + title;
            String body = due ? (text == null ? "" : text)
                    : (stage == 0 ? "Soat " + time : stage == 1 ? "Hozir, soat " + time : "Vaqti " + time + " edi. «Qabul qildim»ni bosing.")
                    + (by != null && !by.isEmpty() ? " · " + by + " qo'ydi" : "");
            String route = due ? "#/eslatmalar" : "#/eslatmalar";
            Intent open = new Intent(c, MainActivity.class).putExtra("route", route).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent openPi = PendingIntent.getActivity(c, notifId(key), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Intent ack = new Intent(c, Alarms.class).setAction(ACTION_ACK).putExtra("key", key);
            PendingIntent ackPi = PendingIntent.getBroadcast(c, notifId(key) ^ 0x1000, ack, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL)
                    .setSmallIcon(R.drawable.ic_stat)
                    .setColor(stage == 2 ? 0xFFC0392B : 0xFF0B6B58)
                    .setContentTitle(head)
                    .setContentText(body)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_REMINDER)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setWhen(System.currentTimeMillis())
                    .setAutoCancel(false)
                    .setOngoing(stage == 2) // vaqti o'tgani qabul qilinmaguncha surib tashlanmaydi
                    .setContentIntent(openPi)
                    .addAction(0, due ? "Hammasini qabul qildim" : "Qabul qildim", ackPi);
            NotificationManagerCompat.from(c).notify(notifId(key), b.build());
            String shown = Store.prefs(c).getString("alarm_shown", "");
            if (!shown.contains(key + "\n")) Store.prefs(c).edit().putString("alarm_shown", shown + key + "\n").apply();
        } catch (SecurityException e) { /* bildirishnomaga ruxsat berilmagan */ } catch (Exception e) { /* o'tkazib yuboramiz */ }
    }
}
