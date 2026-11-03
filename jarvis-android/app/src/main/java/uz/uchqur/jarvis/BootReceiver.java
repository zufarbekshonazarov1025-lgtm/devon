package uz.uchqur.jarvis;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Telefon qayta yoqilganda: Android mikrofonni fonda o'zi yoqishga ruxsat bermaydi, shuning uchun bitta bosish so'raymiz. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        if (!Api.prefs(c).getBoolean("enabled", false)) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("jarvis_boot", "JARVIS ishga tushirish", NotificationManager.IMPORTANCE_HIGH));
        PendingIntent pi = PendingIntent.getActivity(c, 0, new Intent(c, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        nm.notify(8, new Notification.Builder(c, "jarvis_boot").setSmallIcon(R.drawable.ic_jarvis)
                .setContentTitle("JARVIS'ni yoqish").setContentText("Telefon qayta yoqildi. Tinglashni davom ettirish uchun bosing.")
                .setContentIntent(pi).setAutoCancel(true).build());
    }
}
