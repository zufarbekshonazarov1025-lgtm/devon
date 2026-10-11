package uz.uchqur.devon;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** «Taqvim» vidjeti: joriy oy, kunlarda muddat, uchrashuv, eslatma va takroriy topshiriq belgilari. */
public class CalendarWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) m.updateAppWidget(id, build(c, id));
        m.notifyAppWidgetViewDataChanged(ids, R.id.grid);
        if (Store.registered(c)) Sync.now(c);
    }

    static RemoteViews build(Context c, int id) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_cal);
        JSONObject j = Widgets.snap(c), mo = j == null ? null : j.optJSONObject("month");
        v.setTextViewText(R.id.ttl, mo == null ? "Taqvim" : mo.optString("label", "Taqvim"));
        v.setTextViewText(R.id.sub, mo == null ? Widgets.noData(c) : mo.optString("sum", ""));
        v.setRemoteAdapter(R.id.grid, Widgets.service(c, "cal", id));
        v.setPendingIntentTemplate(R.id.grid, Widgets.openTemplate(c, 300));
        v.setOnClickPendingIntent(R.id.head, Widgets.open(c, "#/taqvim", 301));
        v.setOnClickPendingIntent(R.id.add, Widgets.open(c, "#/taqvim", 302));
        return v;
    }
}
