package uz.uchqur.jarvis;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    static final int BG = Color.parseColor("#0B1220"), CARD = Color.parseColor("#131C2E"), ACC = Color.parseColor("#38BDF8"), TXT = Color.parseColor("#E2E8F0"), MUTED = Color.parseColor("#94A3B8");
    private TextView statusV, lastV;
    private Button toggle;
    private LinearLayout pairBox;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(BG);
        SharedPreferences p = Api.prefs(this);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(28), dp(20), dp(20));
        root.setBackgroundColor(BG);

        TextView title = tv("JARVIS", 30, ACC);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setLetterSpacing(0.2f);
        root.addView(title);
        statusV = tv("…", 15, MUTED);
        root.addView(statusV);

        // --- ulash ---
        pairBox = card();
        pairBox.addView(tv("Telefonni ulash", 17, TXT));
        pairBox.addView(tv("Telegram'da JARVIS botiga /ulash deb yozing va kelgan 6 xonali kodni shu yerga kiriting.", 13, MUTED));
        EditText code = new EditText(this);
        code.setInputType(InputType.TYPE_CLASS_NUMBER);
        code.setTextColor(TXT); code.setHintTextColor(MUTED); code.setHint("123456");
        pairBox.addView(code);
        Button pb = btn("Ulash", true);
        pb.setOnClickListener(v -> new Thread(() -> {
            try { Api.pair(this, code.getText().toString()); runOnUiThread(this::refresh); }
            catch (Exception e) { runOnUiThread(() -> lastV.setText("⚠️ " + e.getMessage())); }
        }).start());
        pairBox.addView(pb);
        root.addView(pairBox);

        // --- asosiy tugmalar ---
        toggle = btn("", true);
        toggle.setOnClickListener(v -> {
            if (JarvisService.running) { JarvisService.start(this, JarvisService.ACT_STOP); }
            else { if (askPerms()) { p.edit().putBoolean("enabled", true).apply(); JarvisService.start(this, null); } }
            toggle.postDelayed(this::refresh, 600);
        });
        root.addView(toggle, lp());
        Button talk = btn("🎙  Gapirish", false);
        talk.setOnClickListener(v -> { if (askPerms()) { p.edit().putBoolean("enabled", true).apply(); JarvisService.start(this, JarvisService.ACT_LISTEN); } });
        root.addView(talk, lp());

        // --- yozib so'rash ---
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        EditText q = new EditText(this);
        q.setHint("Yoki yozing…"); q.setTextColor(TXT); q.setHintTextColor(MUTED);
        row.addView(q, new LinearLayout.LayoutParams(0, -2, 1));
        Button send = btn("➤", true);
        send.setOnClickListener(v -> {
            String t = q.getText().toString().trim();
            if (t.isEmpty()) return;
            q.setText(""); lastV.setText("…");
            new Thread(() -> {
                try { JSONObject r = Api.ask(this, t); String s = r.optBoolean("ok") ? r.optString("text") : "⚠️ " + r.optString("error"); runOnUiThread(() -> lastV.setText(s)); }
                catch (Exception e) { runOnUiThread(() -> lastV.setText("⚠️ " + e.getMessage())); }
            }).start();
        });
        row.addView(send);
        root.addView(row, lp());

        LinearLayout lastCard = card();
        lastV = tv(JarvisService.last.isEmpty() ? "Bu yerda oxirgi suhbat ko'rinadi." : JarvisService.last, 15, TXT);
        lastV.setTextIsSelectable(true);
        lastCard.addView(lastV);
        root.addView(lastCard);

        // --- sozlamalar ---
        LinearLayout set = card();
        set.addView(tv("Sozlamalar", 17, TXT));
        Switch bt = new Switch(this);
        bt.setText("Bluetooth quloqchin mikrofonidan foydalanish"); bt.setTextColor(TXT);
        bt.setChecked(p.getBoolean("bt_mic", true));
        bt.setOnCheckedChangeListener((x, on) -> { p.edit().putBoolean("bt_mic", on).apply(); restartIfRunning(); });
        set.addView(bt);
        TextView sens = tv("", 14, MUTED);
        set.addView(sens);
        SeekBar sb = new SeekBar(this);
        sb.setMax(50);
        float thr = p.getFloat("threshold", 0.5f);
        sb.setProgress(Math.round((0.8f - thr) * 100));
        sens.setText(sensText(thr));
        sb.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            public void onProgressChanged(SeekBar s, int v, boolean u) { float t = 0.8f - v / 100f; p.edit().putFloat("threshold", t).apply(); sens.setText(sensText(t)); }
            public void onStartTrackingTouch(SeekBar s) { }
            public void onStopTrackingTouch(SeekBar s) { }
        });
        set.addView(sb);
        Button xi = btn("Fonda ishlash sozlamalari (Xiaomi)", false);
        xi.setOnClickListener(v -> openBackgroundSettings());
        set.addView(xi, lp());
        Button ttsB = btn("Turkcha ovozni sozlash", false);
        ttsB.setOnClickListener(v -> { try { startActivity(new Intent("com.android.settings.TTS_SETTINGS")); } catch (Exception e) { startActivity(new Intent(Settings.ACTION_SETTINGS)); } });
        set.addView(ttsB, lp());
        root.addView(set);

        ScrollView sv = new ScrollView(this);
        sv.setBackgroundColor(BG);
        sv.addView(root);
        setContentView(sv);

        JarvisService.listener = (s, l) -> { statusV.setText(s); if (!l.isEmpty()) lastV.setText(l); refreshToggle(); };
        refresh();
        if (p.getBoolean("enabled", false) && !JarvisService.running && hasMic() && !Api.key(this).isEmpty()) JarvisService.start(this, null);
    }

    private String sensText(float t) {
        return "Sezgirlik: " + (t <= 0.4f ? "yuqori (tez uyg'onadi, ba'zan bekorga)" : t >= 0.65f ? "past (aniq chaqirish kerak)" : "o'rtacha");
    }

    private void restartIfRunning() {
        if (!JarvisService.running) return;
        JarvisService.start(this, JarvisService.ACT_STOP);
        toggle.postDelayed(() -> JarvisService.start(this, null), 1200);
    }

    private void refresh() {
        boolean paired = !Api.key(this).isEmpty();
        pairBox.setVisibility(paired ? View.GONE : View.VISIBLE);
        statusV.setText(paired ? JarvisService.status : "Ulanmagan");
        refreshToggle();
    }

    private void refreshToggle() { toggle.setText(JarvisService.running ? "⏹  O'chirish" : "▶  Doimiy tinglashni yoqish"); }

    private boolean hasMic() { return checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED; }

    private boolean askPerms() {
        if (Api.key(this).isEmpty()) { lastV.setText("Avval telefonni ulang (yuqorida)."); return false; }
        List<String> need = new ArrayList<>();
        if (!hasMic()) need.add(Manifest.permission.RECORD_AUDIO);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) need.add(Manifest.permission.POST_NOTIFICATIONS);
        if (Build.VERSION.SDK_INT >= 31 && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) need.add(Manifest.permission.BLUETOOTH_CONNECT);
        if (!need.isEmpty()) { requestPermissions(need.toArray(new String[0]), 1); return false; }
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (!pm.isIgnoringBatteryOptimizations(getPackageName())) {
            try { startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()))); } catch (Exception ignored) { }
        }
        return true;
    }

    @Override
    public void onRequestPermissionsResult(int c, String[] perms, int[] res) {
        if (hasMic()) { Api.prefs(this).edit().putBoolean("enabled", true).apply(); JarvisService.start(this, null); toggle.postDelayed(this::refresh, 600); }
        else lastV.setText("Mikrofon ruxsatisiz JARVIS eshita olmaydi.");
    }

    private void openBackgroundSettings() {
        Intent[] tries = {
                new Intent().setClassName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
                new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))
        };
        for (Intent i : tries) { try { startActivity(i); lastV.setText("1) Avtozapusk: JARVIS'ni yoqing.\n2) Ilova sozlamalari → Batareya → «Cheklovsiz».\n3) «Foydalanilmasa to'xtatish»ni o'chiring."); return; } catch (Exception ignored) { } }
    }

    @Override protected void onResume() { super.onResume(); refresh(); }
    @Override protected void onDestroy() { JarvisService.listener = null; super.onDestroy(); }

    // --- kichik yordamchilar ---
    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
    private TextView tv(String s, int size, int color) { TextView t = new TextView(this); t.setText(s); t.setTextSize(size); t.setTextColor(color); t.setPadding(0, dp(4), 0, dp(4)); return t; }
    private LinearLayout.LayoutParams lp() { LinearLayout.LayoutParams l = new LinearLayout.LayoutParams(-1, -2); l.topMargin = dp(10); return l; }
    private LinearLayout card() {
        LinearLayout c = new LinearLayout(this); c.setOrientation(LinearLayout.VERTICAL); c.setPadding(dp(16), dp(14), dp(16), dp(14));
        GradientDrawable g = new GradientDrawable(); g.setColor(CARD); g.setCornerRadius(dp(16)); c.setBackground(g);
        LinearLayout.LayoutParams l = lp(); l.topMargin = dp(14); c.setLayoutParams(l); return c;
    }
    private Button btn(String s, boolean primary) {
        Button b = new Button(this); b.setText(s); b.setAllCaps(false); b.setTextSize(16); b.setGravity(Gravity.CENTER);
        b.setTextColor(primary ? BG : TXT);
        GradientDrawable g = new GradientDrawable(); g.setColor(primary ? ACC : CARD); g.setCornerRadius(dp(14)); if (!primary) g.setStroke(dp(1), ACC);
        b.setBackground(g); b.setPadding(dp(14), dp(12), dp(14), dp(12)); return b;
    }
}
