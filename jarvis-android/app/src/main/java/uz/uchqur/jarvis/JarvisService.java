package uz.uchqur.jarvis;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import org.json.JSONObject;

import java.util.Locale;

/**
 * Fonda doim ishlaydigan qism: "Hey Jarvis"ni kutadi, buyruqni yozadi, serverga yuboradi
 * va javobni ovoz bilan aytadi. Ekran o'chiq bo'lsa ham ishlaydi.
 */
public class JarvisService extends Service {
    public static final String ACT_LISTEN = "uz.uchqur.jarvis.LISTEN";
    public static final String ACT_STOP = "uz.uchqur.jarvis.STOP";
    static final String CH = "jarvis";
    static final int NID = 7;

    /** Ilova oynasi holatni ko'rsatishi uchun. */
    public interface Listener { void onStatus(String status, String last); }
    static volatile Listener listener;
    static volatile String status = "O'chiq", last = "";
    static volatile boolean running;

    private enum S { WAIT, COMMAND, BUSY }
    private volatile S state = S.WAIT;
    private volatile boolean manualTrigger;
    private Thread loop;
    private TextToSpeech tts;
    private boolean ttsReady;
    private PowerManager.WakeLock wl;
    private AudioManager am;
    private final Handler ui = new Handler(Looper.getMainLooper());

    static void setStatus(String s, String l) {
        status = s;
        if (l != null) last = l;
        Listener x = listener;
        if (x != null) new Handler(Looper.getMainLooper()).post(() -> x.onStatus(status, last));
    }

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        am = (AudioManager) getSystemService(AUDIO_SERVICE);
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel ch = new NotificationChannel(CH, "JARVIS", NotificationManager.IMPORTANCE_LOW);
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
        tts = new TextToSpeech(this, st -> {
            if (st == TextToSpeech.SUCCESS) {
                int r = tts.setLanguage(new Locale("tr", "TR"));
                ttsReady = true;
                if (r < 0) setStatus(status, "Diqqat: telefonda turkcha ovoz o'rnatilmagan. Sozlamalar → Matnni nutqqa aylantirish → Turkcha ovozni yuklab oling.");
            }
        });
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) { }
            @Override public void onDone(String id) { backToWait(); }
            @Override public void onError(String id) { backToWait(); }
        });
    }

    private Notification notif(String text) {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent po = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE);
        PendingIntent pl = PendingIntent.getService(this, 1, new Intent(this, JarvisService.class).setAction(ACT_LISTEN), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent ps = PendingIntent.getService(this, 2, new Intent(this, JarvisService.class).setAction(ACT_STOP), PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CH)
                .setSmallIcon(R.drawable.ic_jarvis)
                .setContentTitle("JARVIS tinglayapti")
                .setContentText(text)
                .setOngoing(true)
                .setContentIntent(po)
                .addAction(new Notification.Action.Builder(null, "🎙 Gapirish", pl).build())
                .addAction(new Notification.Action.Builder(null, "To'xtatish", ps).build())
                .build();
    }

    private void updateNotif(String t) {
        getSystemService(NotificationManager.class).notify(NID, notif(t));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent != null ? intent.getAction() : null;
        if (ACT_STOP.equals(a)) {
            Api.prefs(this).edit().putBoolean("enabled", false).apply();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!running) {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NID, notif("\"Hey Jarvis\" deb chaqiring"), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            else startForeground(NID, notif("\"Hey Jarvis\" deb chaqiring"));
            running = true;
            wl = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "jarvis:listen");
            wl.acquire();
            loop = new Thread(this::run, "jarvis-audio");
            loop.start();
        }
        if (ACT_LISTEN.equals(a)) manualTrigger = true;
        return START_STICKY;
    }

    // ---------- Bluetooth quloqchin ----------
    private boolean useHeadset() {
        if (!Api.prefs(this).getBoolean("bt_mic", true)) return false;
        if (Build.VERSION.SDK_INT >= 31) {
            for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) {
                if (d.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || d.getType() == AudioDeviceInfo.TYPE_BLE_HEADSET) {
                    am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                    return am.setCommunicationDevice(d);
                }
            }
            return false;
        } else {
            if (!am.isBluetoothScoAvailableOffCall()) return false;
            am.setMode(AudioManager.MODE_IN_COMMUNICATION);
            am.startBluetoothSco();
            am.setBluetoothScoOn(true);
            return true;
        }
    }

    private void releaseHeadset() {
        try {
            if (Build.VERSION.SDK_INT >= 31) am.clearCommunicationDevice();
            else { am.setBluetoothScoOn(false); am.stopBluetoothSco(); }
            am.setMode(AudioManager.MODE_NORMAL);
        } catch (Exception ignored) { }
    }

    // ---------- asosiy tinglash sikli ----------
    private void run() {
        WakeWord ww = null;
        AudioRecord rec = null;
        boolean headset = false;
        try {
            ww = new WakeWord(this);
            while (running) {
                headset = useHeadset();
                int src = headset ? MediaRecorder.AudioSource.VOICE_COMMUNICATION : MediaRecorder.AudioSource.VOICE_RECOGNITION;
                int min = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                rec = new AudioRecord(src, 16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min, WakeWord.CHUNK * 8));
                rec.startRecording();
                String where = headset ? "quloqchin mikrofoni" : "telefon mikrofoni";
                setStatus("Tinglayapman (" + where + ")", null);
                updateNotif("\"Hey Jarvis\" deb chaqiring · " + where);
                boolean restart = listenLoop(ww, rec);
                rec.stop(); rec.release(); rec = null;
                if (headset) releaseHeadset();
                if (!restart) break;
            }
        } catch (SecurityException e) {
            setStatus("Mikrofonga ruxsat yo'q", "Ilovani ochib, mikrofon ruxsatini bering.");
        } catch (Exception e) {
            setStatus("Xato", String.valueOf(e.getMessage()));
        } finally {
            if (rec != null) try { rec.release(); } catch (Exception ignored) { }
            if (headset) releaseHeadset();
            if (ww != null) ww.close();
            running = false;
            ui.post(this::stopSelf);
        }
    }

    /** true qaytarsa — mikrofon qayta ochiladi (masalan, quloqchin ulandi/uzildi). */
    private boolean listenLoop(WakeWord ww, AudioRecord rec) throws Exception {
        short[] chunk = new short[WakeWord.CHUNK];
        short[] cmd = new short[16000 * 15];
        int cmdLen = 0, silent = 0, waited = 0;
        boolean heard = false;
        float noise = 300f;
        int cooldown = 0;
        long lastDevCheck = System.currentTimeMillis();
        boolean hadHeadset = isHeadsetConnected();

        while (running) {
            int got = 0;
            while (got < chunk.length) {
                int k = rec.read(chunk, got, chunk.length - got);
                if (k <= 0) throw new Exception("Mikrofon o'qilmadi (" + k + ")");
                got += k;
            }
            double sum = 0;
            for (short s : chunk) sum += (double) s * s;
            float rms = (float) Math.sqrt(sum / chunk.length);

            if (state == S.WAIT) {
                noise = noise * 0.98f + Math.min(rms, noise * 2f) * 0.02f;
                float thr = Api.prefs(this).getFloat("threshold", 0.5f);
                float score = ww.process(chunk);
                if (cooldown > 0) cooldown--;
                if (manualTrigger || (score >= thr && cooldown == 0)) {
                    manualTrigger = false;
                    beep(ToneGenerator.TONE_PROP_ACK);
                    state = S.COMMAND;
                    cmdLen = 0; silent = 0; waited = 0; heard = false;
                    setStatus("Eshitayapman…", null);
                    updateNotif("Eshitayapman…");
                }
                // har 3 soniyada quloqchin ulanganini tekshiramiz
                if (System.currentTimeMillis() - lastDevCheck > 3000) {
                    lastDevCheck = System.currentTimeMillis();
                    if (isHeadsetConnected() != hadHeadset) return true;
                }
            } else if (state == S.COMMAND) {
                if (cmdLen + chunk.length <= cmd.length) { System.arraycopy(chunk, 0, cmd, cmdLen, chunk.length); cmdLen += chunk.length; }
                boolean speech = rms > Math.max(450f, noise * 3f);
                if (speech) { heard = true; silent = 0; } else if (heard) silent++; else waited++;
                boolean end = (heard && silent >= 15) || cmdLen + chunk.length > cmd.length;
                if (!heard && waited >= 62) { // ~5 soniya jimlik
                    beep(ToneGenerator.TONE_PROP_NACK);
                    backToWait();
                    ww.reset();
                    cooldown = 12;
                    continue;
                }
                if (end) {
                    state = S.BUSY;
                    beep(ToneGenerator.TONE_PROP_BEEP);
                    setStatus("O'ylayapman…", null);
                    updateNotif("O'ylayapman…");
                    final short[] copy = java.util.Arrays.copyOf(cmd, cmdLen);
                    final int n = cmdLen;
                    new Thread(() -> send(copy, n)).start();
                    ww.reset();
                    cooldown = 25;
                }
            }
            // BUSY holatida ovoz tashlab yuboriladi (JARVIS o'zini eshitib qolmasligi uchun)
        }
        return false;
    }

    private boolean isHeadsetConnected() {
        for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_INPUTS))
            if (d.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || d.getType() == AudioDeviceInfo.TYPE_BLE_HEADSET) return true;
        return false;
    }

    private void send(short[] pcm, int n) {
        try {
            JSONObject r = Api.voice(this, pcm, n);
            if (!r.optBoolean("ok")) throw new Exception(r.optString("error", "server javob bermadi"));
            String heard = r.optString("heard"), text = r.optString("text"), speak = r.optString("speak", text);
            setStatus("Tayyor", "🎙 " + heard + "\n\n" + text);
            say(speak);
        } catch (Exception e) {
            setStatus("Xato", "⚠️ " + e.getMessage());
            say("Bağlantı kurulamadı.");
        }
    }

    private void say(String text) {
        if (!ttsReady || text == null || text.isEmpty()) { backToWait(); return; }
        Bundle p = new Bundle();
        p.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_VOICE_CALL);
        tts.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
        updateNotif("Gapiryapman…");
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, p, "j" + System.currentTimeMillis());
    }

    private void backToWait() {
        state = S.WAIT;
        setStatus("Tinglayapman", null);
        updateNotif("\"Hey Jarvis\" deb chaqiring");
    }

    private void beep(int tone) {
        try {
            ToneGenerator t = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 70);
            t.startTone(tone, 150);
            ui.postDelayed(t::release, 400);
        } catch (Exception ignored) { }
    }

    @Override
    public void onDestroy() {
        running = false;
        if (wl != null && wl.isHeld()) wl.release();
        if (tts != null) tts.shutdown();
        setStatus("O'chiq", null);
        super.onDestroy();
    }

    static void start(Context c, String action) {
        Intent i = new Intent(c, JarvisService.class);
        if (action != null) i.setAction(action);
        c.startForegroundService(i);
    }
}
