package uz.uchqur.devon;

import android.content.Context;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Server bilan aloqa: qurilma kaliti orqali. */
final class Api {
    private static final String URL_ = "https://wjqxqswmpxsaodcnjsrf.supabase.co/functions/v1/qurilma";

    static final class Result {
        final int code; final String body;
        Result(int code, String body) { this.code = code; this.body = body; }
    }

    private Api() {}

    static Result call(Context c, String action, String itemId) {
        HttpURLConnection con = null;
        try {
            JSONObject req = new JSONObject();
            req.put("key", Store.key(c));
            req.put("action", action);
            if (itemId != null) req.put("item_id", itemId);
            con = (HttpURLConnection) new URL(URL_).openConnection();
            con.setRequestMethod("POST");
            con.setConnectTimeout(15000);
            con.setReadTimeout(20000);
            con.setDoOutput(true);
            con.setRequestProperty("Content-Type", "application/json");
            try (OutputStream os = con.getOutputStream()) { os.write(req.toString().getBytes(StandardCharsets.UTF_8)); }
            int code = con.getResponseCode();
            InputStream in = code >= 400 ? con.getErrorStream() : con.getInputStream();
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            if (in != null) { byte[] b = new byte[4096]; int n; while ((n = in.read(b)) > 0) buf.write(b, 0, n); in.close(); }
            return new Result(code, new String(buf.toByteArray(), StandardCharsets.UTF_8));
        } catch (Exception e) {
            return new Result(0, "");
        } finally {
            if (con != null) con.disconnect();
        }
    }
}
