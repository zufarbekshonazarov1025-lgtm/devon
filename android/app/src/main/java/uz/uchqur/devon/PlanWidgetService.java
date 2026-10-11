package uz.uchqur.devon;

import android.content.Context;
import android.content.Intent;
import android.graphics.Paint;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Vidjetdagi bandlar ro'yxati. */
public class PlanWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) { return new Factory(getApplicationContext()); }

    static final class Factory implements RemoteViewsFactory {
        private final Context c;
        private final List<JSONObject> rows = new ArrayList<>();

        Factory(Context c) { this.c = c; }

        @Override public void onCreate() {}

        @Override
        public void onDataSetChanged() {
            rows.clear();
            try {
                String snap = Store.registered(c) ? Store.snapshot(c) : null;
                if (snap == null) return;
                JSONArray plan = new JSONObject(snap).getJSONArray("plan");
                for (int i = 0; i < plan.length(); i++) rows.add(plan.getJSONObject(i));
            } catch (Exception e) { /* bo'sh ro'yxat */ }
        }

        @Override public void onDestroy() { rows.clear(); }

        @Override public int getCount() { return rows.size(); }

        @Override
        public RemoteViews getViewAt(int pos) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_plan_item);
            if (pos < 0 || pos >= rows.size()) return v;
            JSONObject it = rows.get(pos);
            boolean done = it.optBoolean("done");
            String time = it.optString("time", ""), who = it.optString("who", "");
            v.setImageViewResource(R.id.mark, done ? R.drawable.w_done : R.drawable.w_todo);
            v.setTextViewText(R.id.time, time.isEmpty() ? "—" : time);
            v.setTextViewText(R.id.title, it.optString("title", ""));
            v.setTextColor(R.id.title, done ? 0xFF8A9692 : 0xFF14201D);
            v.setInt(R.id.title, "setPaintFlags", done ? Paint.STRIKE_THRU_TEXT_FLAG | Paint.ANTI_ALIAS_FLAG : Paint.ANTI_ALIAS_FLAG);
            v.setViewVisibility(R.id.who, who.isEmpty() ? View.GONE : View.VISIBLE);
            v.setTextViewText(R.id.who, who);
            if (it.optBoolean("mine", true)) v.setOnClickFillInIntent(R.id.row, new Intent().putExtra("item", it.optString("id")));
            return v;
        }

        @Override public RemoteViews getLoadingView() { return null; }

        @Override public int getViewTypeCount() { return 1; }

        @Override public long getItemId(int pos) { return pos < rows.size() ? rows.get(pos).optString("id").hashCode() : pos; }

        @Override public boolean hasStableIds() { return true; }
    }
}
