package uz.uchqur.devon;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.TimeUnit;

/** Fonda serverdan yangi ma'lumot oladi: bildirishnoma chiqaradi va vidjetni yangilaydi. */
public class Sync extends Worker {
    static final String CHANNEL = "devon";

    public Sync(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }

    private static Constraints online() { return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(); }

    /** Har 15 daqiqada (Android ruxsat bergan eng qisqa oraliq). */
    static void schedule(Context c) {
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(Sync.class, 15, TimeUnit.MINUTES).setConstraints(online()).build();
        WorkManager.getInstance(c).enqueueUniquePeriodicWork("devon-sync", ExistingPeriodicWorkPolicy.KEEP, req);
    }

    static void now(Context c) { run(c, null); }

    static void toggle(Context c, String itemId) { run(c, itemId); }

    private static void run(Context c, String itemId) {
        Data.Builder d = new Data.Builder();
        if (itemId != null) d.putString("item", itemId);
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(Sync.class).setConstraints(online()).setInputData(d.build()).build();
        WorkManager.getInstance(c).enqueueUniqueWork(itemId == null ? "devon-sync-now" : "devon-toggle-" + itemId, ExistingWorkPolicy.REPLACE, req);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context c = getApplicationContext();
        if (!Store.registered(c)) return Result.success();
        String item = getInputData().getString("item");
        Api.Result r = Api.call(c, item == null ? "sync" : "toggle", item);
        if (r.code == 401) { // qurilma uzilgan yoki hisobdan chiqilgan
            Store.clear(c);
            Widgets.refreshAll(c);
            return Result.success();
        }
        if (r.code != 200) return item == null ? Result.success() : Result.retry();
        try {
            JSONObject j = new JSONObject(r.body);
            JSONArray ns = j.optJSONArray("notifications");
            if (ns != null) for (int i = 0; i < ns.length(); i++) show(c, ns.getJSONObject(i));
            j.remove("notifications");
            Store.saveSnapshot(c, j.toString());
            Widgets.refreshAll(c);
        } catch (Exception e) { /* javob buzilgan bo'lsa, keyingi safar */ }
        return Result.success();
    }

    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Devon xabarlari", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Yangi topshiriq, tasdiq so'rovi, javob va eslatmalar");
            c.getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
    }

    private static void show(Context c, JSONObject n) {
        try {
            ensureChannel(c);
            long id = n.optLong("id");
            String type = n.optString("ref_type", ""), ref = n.optString("ref_id", "");
            String route = "task".equals(type) && ref.length() > 10 && !"null".equals(ref) ? "#/ish/" + ref
                    : "request".equals(type) || "report".equals(type) ? "#/tasdiq" : "plan".equals(type) ? "#/hisobot" : "event".equals(type) ? "#/taqvim" : "#/xabarlar";
            Intent open = new Intent(c, MainActivity.class).putExtra("route", route).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent pi = PendingIntent.getActivity(c, (int) (id % Integer.MAX_VALUE), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            String body = n.isNull("body") ? "" : n.optString("body", "");
            NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL)
                    .setSmallIcon(R.drawable.ic_stat)
                    .setColor(0xFF0B6B58)
                    .setContentTitle(n.optString("title", "Devon"))
                    .setContentText(body)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setAutoCancel(true)
                    .setContentIntent(pi);
            NotificationManagerCompat.from(c).notify((int) (id % Integer.MAX_VALUE), b.build());
        } catch (SecurityException e) { /* bildirishnomaga ruxsat berilmagan */ } catch (Exception e) { /* o'tkazib yuboramiz */ }
    }
}
