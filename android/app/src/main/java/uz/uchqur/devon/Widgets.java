package uz.uchqur.devon;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/** Vidjetlar uchun umumiy yordamchi. */
final class Widgets {
    private Widgets() {}

    static JSONObject snap(Context c) {
        try { String s = Store.registered(c) ? Store.snapshot(c) : null; return s == null ? null : new JSONObject(s); }
        catch (Exception e) { return null; }
    }

    static PendingIntent open(Context c, String route, int code) {
        Intent i = new Intent(c, MainActivity.class).putExtra("route", route).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Ro'yxat qatori bosilganda ilovani ochadigan qolip; qator o'z manzilini («route») qo'shadi. */
    static PendingIntent openTemplate(Context c, int code) {
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0));
    }

    static Intent service(Context c, String kind, int widgetId) {
        Intent svc = new Intent(c, ListService.class).putExtra("kind", kind).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        svc.setData(Uri.parse("devon://" + kind + "/" + widgetId));
        return svc;
    }

    static String noData(Context c) { return Store.registered(c) ? "Yuklanmoqda…" : "Devon ilovasini ochib, hisobga kiring."; }

    private static void one(Context c, Class<?> cls, int viewId) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, cls));
        if (ids.length == 0) return;
        for (int id : ids) {
            RemoteViews v = cls == TasksWidget.class ? TasksWidget.build(c, id) : cls == RemindersWidget.class ? RemindersWidget.build(c, id) : CalendarWidget.build(c, id);
            m.updateAppWidget(id, v);
        }
        m.notifyAppWidgetViewDataChanged(ids, viewId);
    }

    static void refreshAll(Context c) {
        PlanWidget.refresh(c);
        one(c, TasksWidget.class, R.id.list);
        one(c, RemindersWidget.class, R.id.list);
        one(c, CalendarWidget.class, R.id.grid);
    }

    /** Sarlavha, izoh, ro'yxat va bo'sh holat: topshiriqlar va eslatmalar vidjeti uchun bir xil. */
    static RemoteViews list(Context c, int widgetId, String kind, String title, String sub, int count, String emptyText, String headRoute, String addRoute, int code) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_list);
        v.setTextViewText(R.id.ttl, title);
        v.setTextViewText(R.id.sub, sub);
        v.setViewVisibility(R.id.empty, count == 0 ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.list, count == 0 ? View.GONE : View.VISIBLE);
        v.setTextViewText(R.id.empty, emptyText);
        v.setRemoteAdapter(R.id.list, service(c, kind, widgetId));
        v.setPendingIntentTemplate(R.id.list, openTemplate(c, code));
        v.setOnClickPendingIntent(R.id.head, open(c, headRoute, code + 1));
        v.setOnClickPendingIntent(R.id.add, open(c, addRoute, code + 2));
        v.setOnClickPendingIntent(R.id.empty, open(c, headRoute, code + 3));
        return v;
    }

    static JSONArray arr(JSONObject j, String key) { return j == null ? null : j.optJSONArray(key); }
}
