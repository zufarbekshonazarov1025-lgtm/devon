package uz.uchqur.jarvis;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Joylashuvni fonda yozib boradi (ekran o'chiq bo'lsa ham): har ~1 daqiqada bitta nuqta,
 * ularni telefonda yig'ib, har 5 daqiqada serverga yuboradi. Internet bo'lmasa — keyin yuboradi.
 */
public class GpsService extends Service implements LocationListener {
    static final String CH = "jarvis_gps";
    static final int NID = 9;
    static final long INTERVAL = 60_000, UPLOAD = 5 * 60_000;
    static volatile boolean running;
    static volatile long lastFix, lastUpload;
    static volatile int pending;

    private LocationManager lm;
    private HandlerThread ht;
    private Handler h;
    private Location best;
    private final Object lock = new Object();

    static boolean hasPerm(Context c) {
        return c.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    static void start(Context c) {
        if (!hasPerm(c) || Api.key(c).isEmpty()) return;
        try { c.startForegroundService(new Intent(c, GpsService.class)); } catch (Exception ignored) { }
    }

    static void stop(Context c) { c.stopService(new Intent(c, GpsService.class)); }

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel ch = new NotificationChannel(CH, "JARVIS joylashuv", NotificationManager.IMPORTANCE_MIN);
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
        PendingIntent pi = PendingIntent.getActivity(this, 1, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, CH).setSmallIcon(R.drawable.ic_jarvis)
                .setContentTitle("JARVIS").setContentText("Qayerda yurganingizni yozib boryapman")
                .setContentIntent(pi).setOngoing(true).build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(NID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        else startForeground(NID, n);
        ht = new HandlerThread("gps");
        ht.start();
        h = new Handler(ht.getLooper());
        lm = (LocationManager) getSystemService(LOCATION_SERVICE);
        pending = buffer().length();
    }

    @Override
    public int onStartCommand(Intent i, int f, int id) {
        if (!running) {
            running = true;
            try {
                // GPS o'chiq bo'lsa ham so'rov qo'yiladi — yoqilishi bilan nuqtalar kela boshlaydi
                for (String pr : new String[]{LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER})
                    if (lm.getAllProviders().contains(pr)) lm.requestLocationUpdates(pr, INTERVAL / 2, 0, this, ht.getLooper());
            } catch (SecurityException e) { stopSelf(); return START_NOT_STICKY; }
            h.postDelayed(tick, INTERVAL);
            h.postDelayed(upload, 30_000);
        }
        return START_STICKY;
    }

    @Override
    public void onLocationChanged(Location l) {
        synchronized (lock) {
            if (best == null || l.getAccuracy() <= best.getAccuracy() || l.getTime() - best.getTime() > 45_000) best = l;
        }
    }
    @Override public void onProviderEnabled(String p) { }
    @Override public void onProviderDisabled(String p) { }
    @Override public void onStatusChanged(String p, int s, android.os.Bundle b) { }

    /** Har daqiqada eng aniq nuqtani buferga yozadi (ko'p qimirlamasa ham — bir joyda turganini bilish uchun). */
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            Location l;
            synchronized (lock) { l = best; best = null; }
            if (l != null && System.currentTimeMillis() - l.getTime() < 3 * 60_000) save(l);
            h.postDelayed(this, INTERVAL);
        }
    };

    private final Runnable upload = new Runnable() {
        @Override public void run() {
            send();
            h.postDelayed(this, UPLOAD);
        }
    };

    private void save(Location l) {
        try {
            JSONObject p = new JSONObject().put("t", l.getTime()).put("lat", l.getLatitude()).put("lng", l.getLongitude())
                    .put("acc", Math.round(l.getAccuracy())).put("batt", battery());
            if (l.hasSpeed()) p.put("speed", Math.round(l.getSpeed() * 10) / 10.0);
            JSONArray a = buffer();
            a.put(p);
            while (a.length() > 8000) a.remove(0);
            write(a);
            pending = a.length();
            lastFix = l.getTime();
        } catch (Exception ignored) { }
    }

    private void send() {
        JSONArray a = buffer();
        if (a.length() == 0) return;
        try {
            int n = Math.min(a.length(), 1500);
            JSONArray part = new JSONArray();
            for (int i = 0; i < n; i++) part.put(a.get(i));
            JSONObject r = Api.loc(this, new JSONObject().put("points", part));
            if (r.optBoolean("ok")) {
                JSONArray rest = new JSONArray();
                JSONArray now = buffer(); // yuborish paytida yangi nuqtalar qo'shilgan bo'lishi mumkin
                for (int i = n; i < now.length(); i++) rest.put(now.get(i));
                write(rest);
                pending = rest.length();
                lastUpload = System.currentTimeMillis();
                if (rest.length() > 0) h.post(this::send);
            }
        } catch (Exception ignored) { }
    }

    private int battery() {
        try { return ((BatteryManager) getSystemService(BATTERY_SERVICE)).getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY); }
        catch (Exception e) { return -1; }
    }

    private File file() { return new File(getFilesDir(), "gps_buf.json"); }

    private JSONArray buffer() {
        synchronized (lock) {
            try (FileInputStream in = new FileInputStream(file())) {
                byte[] b = new byte[(int) file().length()];
                int off = 0, k;
                while (off < b.length && (k = in.read(b, off, b.length - off)) > 0) off += k;
                return new JSONArray(new String(b, 0, off, StandardCharsets.UTF_8));
            } catch (Exception e) { return new JSONArray(); }
        }
    }

    private void write(JSONArray a) {
        synchronized (lock) {
            try (FileOutputStream o = new FileOutputStream(file())) { o.write(a.toString().getBytes(StandardCharsets.UTF_8)); }
            catch (Exception ignored) { }
        }
    }

    @Override
    public void onDestroy() {
        running = false;
        try { lm.removeUpdates(this); } catch (Exception ignored) { }
        if (h != null) { h.removeCallbacksAndMessages(null); h.post(this::send); }
        if (ht != null) ht.quitSafely();
        super.onDestroy();
    }
}
