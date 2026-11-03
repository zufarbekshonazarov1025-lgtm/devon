package uz.uchqur.jarvis;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/** Bosh ekrandagi tugma: bossangiz JARVIS darhol tinglaydi. */
public class ListenWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        PendingIntent pi = PendingIntent.getForegroundService(c, 10,
                new Intent(c, JarvisService.class).setAction(JarvisService.ACT_LISTEN), PendingIntent.FLAG_IMMUTABLE);
        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget);
            v.setOnClickPendingIntent(R.id.w_btn, pi);
            m.updateAppWidget(id, v);
        }
    }
}
