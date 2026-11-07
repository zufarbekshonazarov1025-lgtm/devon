package uz.uchqur.jarvis;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/** JARVIS serveri bilan aloqa (Supabase "jarvis" funksiyasi). */
public class Api {
    static final String URL_BASE = "https://wjqxqswmpxsaodcnjsrf.supabase.co/functions/v1/jarvis";

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("jarvis", Context.MODE_PRIVATE); }
    static String key(Context c) { return prefs(c).getString("device_key", ""); }
    static volatile String voiceLang = "uz";
    static void loadLang(Context c) { voiceLang = prefs(c).getString("voice_lang", "uz"); }

    private static JSONObject post(String action, String key, String contentType, byte[] body) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(URL_BASE + "?action=" + action).openConnection();
        h.setConnectTimeout(15000);
        h.setReadTimeout(120000);
        h.setDoOutput(true);
        h.setRequestMethod("POST");
        h.setRequestProperty("Content-Type", contentType);
        if (key != null && !key.isEmpty()) h.setRequestProperty("x-device-key", key);
        h.setRequestProperty("x-voice", voiceLang);
        try (OutputStream o = h.getOutputStream()) { o.write(body); }
        int code = h.getResponseCode();
        InputStream in = code < 400 ? h.getInputStream() : h.getErrorStream();
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        if (in != null) { byte[] buf = new byte[8192]; int k; while ((k = in.read(buf)) > 0) b.write(buf, 0, k); }
        String s = b.toString("UTF-8");
        if (code == 403) throw new Exception("Ulanish bekor bo'lgan. Ilovada qayta ulang.");
        return new JSONObject(s.isEmpty() ? "{}" : s);
    }

    /** Telegram'dagi /ulash kodi bilan telefonni bog'lash. */
    static String pair(Context c, String code) throws Exception {
        JSONObject j = new JSONObject().put("code", code.trim()).put("device", android.os.Build.MODEL);
        JSONObject r = post("pair", null, "application/json", j.toString().getBytes("UTF-8"));
        if (!r.optBoolean("ok")) throw new Exception(r.optString("error", "Kod noto'g'ri yoki eskirgan"));
        String k = r.getString("key");
        prefs(c).edit().putString("device_key", k).apply();
        return k;
    }

    /** Ovozli buyruq: WAV yuboradi, {heard, text, speak} qaytaradi. */
    static JSONObject voice(Context c, short[] pcm, int n) throws Exception {
        loadLang(c);
        return post("voice", key(c), "audio/wav", wav(pcm, n));
    }

    static JSONObject ask(Context c, String text) throws Exception {
        loadLang(c);
        return post("ask", key(c), "application/json", new JSONObject().put("text", text).toString().getBytes("UTF-8"));
    }

    /** Joylashuv nuqtalarini yuborish. */
    static JSONObject loc(Context c, JSONObject body) throws Exception {
        return post("loc", key(c), "application/json", body.toString().getBytes("UTF-8"));
    }

    static byte[] wav(short[] pcm, int n) {
        int dataLen = n * 2;
        ByteBuffer b = ByteBuffer.allocate(44 + dataLen).order(ByteOrder.LITTLE_ENDIAN);
        b.put("RIFF".getBytes()).putInt(36 + dataLen).put("WAVE".getBytes());
        b.put("fmt ".getBytes()).putInt(16).putShort((short) 1).putShort((short) 1).putInt(16000).putInt(32000).putShort((short) 2).putShort((short) 16);
        b.put("data".getBytes()).putInt(dataLen);
        for (int i = 0; i < n; i++) b.putShort(pcm[i]);
        return b.array();
    }
}
