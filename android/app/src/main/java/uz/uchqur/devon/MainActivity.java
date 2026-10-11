package uz.uchqur.devon;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;

/** Devon qobig'i: dastur ekranlarini internetdan yuklaydi, shuning uchun yangilanish qayta o'rnatishni talab qilmaydi. */
public class MainActivity extends AppCompatActivity {
    private static final String HOME = "https://zufarbekshonazarov1025-lgtm.github.io/devon/";
    private static final String HOST = "zufarbekshonazarov1025-lgtm.github.io";

    private WebView web;
    private LinearLayout offline;
    private ValueCallback<Uri[]> fileCallback;
    private ActivityResultLauncher<Intent> filePicker;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.parseColor("#0B6B58"));

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#F4F7F6"));
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        offline = buildOffline();
        root.addView(offline, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setSupportZoom(false);
        s.setUserAgentString(s.getUserAgentString() + " DevonApp/1");
        CookieManager.getInstance().setAcceptCookie(true);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        filePicker = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            if (fileCallback == null) return;
            Uri[] uris = null;
            Intent data = result.getData();
            if (result.getResultCode() == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    uris = new Uri[n];
                    for (int i = 0; i < n; i++) uris[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    uris = new Uri[]{data.getData()};
                }
            }
            fileCallback.onReceiveValue(uris);
            fileCallback = null;
        });

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                // Dasturning o'z sahifalari ichkarida, qolgan hamma havola (Drive va boshqalar) tashqarida ochiladi
                if ("https".equals(uri.getScheme()) && HOST.equals(uri.getHost())) return false;
                openOutside(uri);
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) { web.setVisibility(View.INVISIBLE); offline.setVisibility(View.VISIBLE); }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (offline.getVisibility() != View.VISIBLE) web.setVisibility(View.VISIBLE);
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType("*/*");
                pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    filePicker.launch(Intent.createChooser(pick, "Fayl tanlang"));
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    callback.onReceiveValue(null);
                    Toast.makeText(MainActivity.this, "Fayl tanlash ilovasi topilmadi", Toast.LENGTH_LONG).show();
                }
                return true;
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
                // target="_blank" havolalar: manzilni olib, tashqarida ochamiz
                WebView.HitTestResult hit = view.getHitTestResult();
                String url = hit != null ? hit.getExtra() : null;
                if (url != null) { openOutside(Uri.parse(url)); return false; }
                WebView temp = new WebView(MainActivity.this);
                temp.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { openOutside(r.getUrl()); v.destroy(); return true; }
                });
                ((WebView.WebViewTransport) resultMsg.obj).setWebView(temp);
                resultMsg.sendToTarget();
                return true;
            }
        });
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(false);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (offline.getVisibility() == View.VISIBLE) { finish(); return; }
                if (web.canGoBack()) web.goBack(); else moveTaskToBack(true);
            }
        });

        web.addJavascriptInterface(new Bridge(), "DevonNative");
        Sync.ensureChannel(this);
        Sync.schedule(this);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7);

        String route = getIntent() != null ? getIntent().getStringExtra("route") : null;
        if (state != null && route == null) web.restoreState(state); else web.loadUrl(HOME + (route != null ? route : ""));
    }

    /** Bildirishnoma yoki vidjet bosilganda kerakli sahifani ochadi. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String route = intent.getStringExtra("route");
        if (route != null && route.matches("#/[A-Za-z0-9/_-]*")) web.evaluateJavascript("location.hash='" + route + "'", null);
    }

    /** Dastur sahifasi chaqiradigan amallar. Faqat o'z saytimiz ichkarida ochiladi, begona sahifa bunga yeta olmaydi. */
    private final class Bridge {
        @JavascriptInterface public String deviceKey() { return Store.key(MainActivity.this); }

        @JavascriptInterface public String deviceName() { return Build.MANUFACTURER + " " + Build.MODEL; }

        @JavascriptInterface public void registered() { Store.setRegistered(MainActivity.this, true); Sync.now(MainActivity.this); }

        @JavascriptInterface public void signedOut() { Store.clear(MainActivity.this); PlanWidget.refresh(MainActivity.this); }

        @JavascriptInterface public void sync() { if (Store.registered(MainActivity.this)) Sync.now(MainActivity.this); }

        @JavascriptInterface public int version() { return 2; }
    }

    private void openOutside(Uri uri) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
        catch (ActivityNotFoundException e) { Toast.makeText(this, "Havolani ochadigan ilova topilmadi", Toast.LENGTH_LONG).show(); }
    }

    private LinearLayout buildOffline() {
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(android.view.Gravity.CENTER);
        box.setPadding(pad, pad, pad, pad);
        box.setBackgroundColor(Color.parseColor("#F4F7F6"));
        box.setVisibility(View.GONE);
        TextView title = new TextView(this);
        title.setText("Internetga ulanib bo'lmadi");
        title.setTextSize(20);
        title.setTextColor(Color.parseColor("#14201D"));
        title.setGravity(android.view.Gravity.CENTER);
        TextView text = new TextView(this);
        text.setText("Aloqani tekshirib, qayta urinib ko'ring.");
        text.setTextSize(15);
        text.setTextColor(Color.parseColor("#56645F"));
        text.setGravity(android.view.Gravity.CENTER);
        text.setPadding(0, pad / 3, 0, pad);
        Button retry = new Button(this);
        retry.setText("Qayta urinish");
        retry.setAllCaps(false);
        retry.setOnClickListener(v -> { box.setVisibility(View.GONE); web.setVisibility(View.VISIBLE); web.loadUrl(HOME); });
        box.addView(title); box.addView(text); box.addView(retry);
        return box;
    }

    @Override
    protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override
    protected void onResume() { super.onResume(); web.onResume(); }

    @Override
    protected void onPause() { web.onPause(); if (Store.registered(this)) Sync.now(this); super.onPause(); }

    @Override
    protected void onDestroy() { if (web != null) web.destroy(); super.onDestroy(); }
}
