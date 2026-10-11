package uz.uchqur.devon;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/** «Eslatmalar» vidjeti: eng yaqin eslatmalar. */
public class RemindersWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) m.updateAppWidget(id, build(c, id));
        m.notifyAppWidgetViewDataChanged(ids, R.id.list);
        if (Store.registered(c)) Sync.now(c);
    }

    static RemoteViews build(Context c, int id) {
        JSONObject j = Widgets.snap(c);
        JSONArray a = Widgets.arr(j, "reminders");
        int n = a == null ? 0 : a.length(), today = 0;
        String next = "";
        for (int i = 0; i < n; i++) { JSONObject r = a.optJSONObject(i); if (r.optBoolean("today")) { today++; if (next.isEmpty()) next = r.optString("time"); } }
        String sub = j == null ? Widgets.noData(c) : n == 0 ? "Eslatma yo'q" : today > 0 ? "Bugun " + today + " ta · keyingisi " + next : "Bugunga eslatma yo'q";
        return Widgets.list(c, id, "reminders", "Eslatmalar", sub, n, j == null ? Widgets.noData(c) : "Eslatma qo'shilmagan.", "#/eslatmalar", "#/eslatmalar", 200);
    }
}
