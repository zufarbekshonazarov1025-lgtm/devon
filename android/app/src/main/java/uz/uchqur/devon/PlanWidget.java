package uz.uchqur.devon;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/** «Bugungi reja» vidjeti. */
public class PlanWidget extends AppWidgetProvider {
    static final String TOGGLE = "uz.uchqur.devon.TOGGLE";
    private static final String[] OY = {"yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"};

    static void refresh(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, PlanWidget.class));
        if (ids.length == 0) return;
        for (int id : ids) m.updateAppWidget(id, build(c, id));
        m.notifyAppWidgetViewDataChanged(ids, R.id.list);
    }

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) m.updateAppWidget(id, build(c, id));
        m.notifyAppWidgetViewDataChanged(ids, R.id.list);
        if (Store.registered(c)) Sync.now(c);
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        super.onReceive(c, intent);
        if (!TOGGLE.equals(intent.getAction())) return;
        String id = intent.getStringExtra("item");
        if (id == null) return;
        // Avval ekranda darhol belgilaymiz, keyin serverga yuboramiz
        try {
            JSONObject j = new JSONObject(Store.snapshot(c));
            JSONArray plan = j.getJSONArray("plan");
            for (int i = 0; i < plan.length(); i++) {
                JSONObject it = plan.getJSONObject(i);
                if (id.equals(it.optString("id"))) it.put("done", !it.optBoolean("done"));
            }
            Store.saveSnapshot(c, j.toString());
        } catch (Exception e) { /* ma'lumot yo'q */ }
        refresh(c);
        Sync.toggle(c, id);
    }

    private static PendingIntent open(Context c, String route, int code) {
        Intent i = new Intent(c, MainActivity.class).putExtra("route", route).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static RemoteViews build(Context c, int widgetId) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_plan);
        String sub = "Ilovani ochib, hisobga kiring";
        int total = 0;
        try {
            String snap = Store.registered(c) ? Store.snapshot(c) : null;
            if (snap != null) {
                JSONObject j = new JSONObject(snap);
                JSONArray plan = j.getJSONArray("plan");
                total = plan.length();
                int done = 0;
                for (int i = 0; i < total; i++) if (plan.getJSONObject(i).optBoolean("done")) done++;
                String d = j.optString("date", "");
                String day = d.length() == 10 ? Integer.parseInt(d.substring(8)) + "-" + OY[Integer.parseInt(d.substring(5, 7)) - 1] : "";
                sub = total == 0 ? day + " · reja kiritilmagan" : day + " · " + total + " tadan " + done + " tasi";
            } else if (Store.registered(c)) {
                sub = "Yuklanmoqda…";
            }
        } catch (Exception e) { sub = "Ma'lumotni o'qib bo'lmadi"; }
        v.setTextViewText(R.id.sub, sub);
        v.setViewVisibility(R.id.empty, total == 0 ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.list, total == 0 ? View.GONE : View.VISIBLE);
        v.setTextViewText(R.id.empty, Store.registered(c) ? "Bugunga band yo'q. «+» bilan qo'shing." : "Devon ilovasini ochib, hisobga kiring.");

        Intent svc = new Intent(c, PlanWidgetService.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
        v.setRemoteAdapter(R.id.list, svc);

        Intent tap = new Intent(c, PlanWidget.class).setAction(TOGGLE);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        v.setPendingIntentTemplate(R.id.list, PendingIntent.getBroadcast(c, 0, tap, flags));

        v.setOnClickPendingIntent(R.id.head, open(c, "#/bugun", 1));
        v.setOnClickPendingIntent(R.id.add, open(c, "#/hisobot", 2));
        v.setOnClickPendingIntent(R.id.empty, open(c, "#/bugun", 3));
        return v;
    }
}
