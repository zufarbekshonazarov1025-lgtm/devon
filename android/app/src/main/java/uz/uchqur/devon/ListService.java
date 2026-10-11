package uz.uchqur.devon;

import android.content.Context;
import android.content.Intent;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Topshiriqlar, eslatmalar va taqvim vidjetlarining qatorlari. */
public class ListService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) { return new Factory(getApplicationContext(), intent.getStringExtra("kind")); }

    static final class Factory implements RemoteViewsFactory {
        private final Context c;
        private final String kind;
        private final List<JSONObject> rows = new ArrayList<>();
        private int today = 0;

        Factory(Context c, String kind) { this.c = c; this.kind = kind == null ? "tasks" : kind; }

        @Override public void onCreate() {}

        @Override
        public void onDataSetChanged() {
            rows.clear();
            try {
                JSONObject j = Widgets.snap(c);
                if (j == null) return;
                if ("cal".equals(kind)) {
                    JSONObject mo = j.optJSONObject("month");
                    if (mo == null) return;
                    today = mo.optInt("today");
                    JSONArray days = mo.getJSONArray("days");
                    int pad = mo.optInt("first", 1) - 1;
                    for (int i = 0; i < pad; i++) rows.add(new JSONObject());
                    for (int i = 0; i < days.length(); i++) rows.add(new JSONObject().put("n", i + 1).put("k", days.optString(i, "")));
                    return;
                }
                JSONArray a = j.optJSONArray(kind);
                if (a != null) for (int i = 0; i < a.length(); i++) rows.add(a.getJSONObject(i));
            } catch (Exception e) { /* bo'sh ro'yxat */ }
        }

        @Override public void onDestroy() { rows.clear(); }

        @Override public int getCount() { return rows.size(); }

        @Override
        public RemoteViews getViewAt(int pos) {
            if (pos < 0 || pos >= rows.size()) return new RemoteViews(c.getPackageName(), R.layout.widget_cal_cell);
            JSONObject it = rows.get(pos);
            if ("cal".equals(kind)) return cell(it);
            return "reminders".equals(kind) ? reminder(it) : task(it);
        }

        private RemoteViews task(JSONObject it) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_task_item);
            int lvl = it.optInt("lvl");
            String who = it.optString("who", "");
            v.setTextViewText(R.id.title, it.optString("title", ""));
            v.setTextViewText(R.id.chip, it.optString("pri", ""));
            v.setInt(R.id.chip, "setBackgroundResource", lvl == 2 ? R.drawable.w_chip_red : lvl == 1 ? R.drawable.w_chip_amber : R.drawable.w_chip_grey);
            v.setTextColor(R.id.chip, lvl == 2 ? 0xFFA31919 : lvl == 1 ? 0xFF7A4D00 : 0xFF3F4B47);
            v.setTextViewText(R.id.left, it.optString("left", ""));
            v.setViewVisibility(R.id.who, who.isEmpty() ? View.GONE : View.VISIBLE);
            v.setTextViewText(R.id.who, who);
            v.setOnClickFillInIntent(R.id.row, new Intent().putExtra("route", "#/ish/" + it.optString("id")));
            return v;
        }

        private RemoteViews reminder(JSONObject it) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_rem_item);
            String rep = it.optString("repeat", "");
            v.setTextViewText(R.id.title, it.optString("title", ""));
            v.setTextViewText(R.id.left, it.optString("when", "") + (rep.isEmpty() ? "" : " · " + rep));
            v.setViewVisibility(R.id.who, it.optBoolean("both") ? View.VISIBLE : View.GONE);
            v.setTextViewText(R.id.who, "ikkalamizga");
            v.setOnClickFillInIntent(R.id.row, new Intent().putExtra("route", "#/eslatmalar"));
            return v;
        }

        private RemoteViews cell(JSONObject it) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_cal_cell);
            int n = it.optInt("n", 0);
            if (n == 0) { v.setTextViewText(R.id.day, ""); v.setTextViewText(R.id.dots, ""); v.setInt(R.id.cell, "setBackgroundResource", 0); return v; }
            boolean isToday = n == today;
            v.setTextViewText(R.id.day, String.valueOf(n));
            v.setTextColor(R.id.day, isToday ? 0xFFFFFFFF : 0xFF14201D);
            v.setInt(R.id.cell, "setBackgroundResource", isToday ? R.drawable.w_today : 0);
            String k = it.optString("k", "");
            SpannableStringBuilder dots = new SpannableStringBuilder();
            for (int i = 0; i < k.length(); i++) {
                char ch = k.charAt(i);
                int color = isToday ? 0xFFFFFFFF : ch == 'm' ? 0xFFA31919 : ch == 'u' ? 0xFF1F4FD8 : ch == 'e' ? 0xFFB97A00 : 0xFF0B6B58;
                int at = dots.length();
                dots.append("●");
                dots.setSpan(new ForegroundColorSpan(color), at, at + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            }
            v.setTextViewText(R.id.dots, dots);
            v.setOnClickFillInIntent(R.id.cell, new Intent().putExtra("route", "#/taqvim"));
            return v;
        }

        @Override public RemoteViews getLoadingView() { return null; }

        @Override public int getViewTypeCount() { return 3; }

        @Override public long getItemId(int pos) { return pos; }

        @Override public boolean hasStableIds() { return false; }
    }
}
