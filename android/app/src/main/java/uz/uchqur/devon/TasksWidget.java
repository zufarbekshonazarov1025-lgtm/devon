package uz.uchqur.devon;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/** «Topshiriqlar» vidjeti: ochiq topshiriqlar, muddati yaqini tepada. */
public class TasksWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) m.updateAppWidget(id, build(c, id));
        m.notifyAppWidgetViewDataChanged(ids, R.id.list);
        if (Store.registered(c)) Sync.now(c);
    }

    static RemoteViews build(Context c, int id) {
        JSONObject j = Widgets.snap(c);
        JSONArray a = Widgets.arr(j, "tasks");
        int n = a == null ? 0 : a.length(), muhim = 0;
        for (int i = 0; i < n; i++) if (a.optJSONObject(i).optInt("lvl") == 2) muhim++;
        String sub = j == null ? Widgets.noData(c) : n == 0 ? "Ochiq topshiriq yo'q" : n + " ta ochiq" + (muhim > 0 ? " · " + muhim + " tasi muhim" : "");
        return Widgets.list(c, id, "tasks", "Topshiriqlar", sub, n, j == null ? Widgets.noData(c) : "Hammasi bajarilgan.", "#/ishlar", "#/ishlar/yangi", 100);
    }
}
