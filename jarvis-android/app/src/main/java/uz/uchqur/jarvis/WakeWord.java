package uz.uchqur.jarvis;

import android.content.Context;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.FloatBuffer;
import java.util.Collections;

/**
 * "Hey Jarvis" so'zini telefonning o'zida, internetsiz aniqlaydi (openWakeWord modellari).
 * Har 1280 namuna (80 ms, 16 kHz) uchun bitta baho qaytaradi: 0..1.
 */
public class WakeWord implements AutoCloseable {
    public static final int CHUNK = 1280;
    private static final int CTX = 480; // 3 x 160 namuna oldingi kontekst
    private final OrtEnvironment env = OrtEnvironment.getEnvironment();
    private final OrtSession mel, emb, ww;
    private final String wwInput;
    private final float[] raw = new float[CHUNK + CTX];
    private final float[][] melBuf = new float[76][32];
    private final float[][] embBuf = new float[16][96];

    public WakeWord(Context c) throws Exception {
        OrtSession.SessionOptions o = new OrtSession.SessionOptions();
        o.setIntraOpNumThreads(1);
        mel = env.createSession(asset(c, "melspectrogram.onnx"), o);
        emb = env.createSession(asset(c, "embedding_model.onnx"), o);
        ww = env.createSession(asset(c, "hey_jarvis.onnx"), o);
        wwInput = ww.getInputNames().iterator().next();
        reset();
    }

    public void reset() {
        java.util.Arrays.fill(raw, 0f);
        for (float[] r : melBuf) java.util.Arrays.fill(r, 1f);
        for (float[] r : embBuf) java.util.Arrays.fill(r, 0f);
    }

    private static byte[] asset(Context c, String n) throws Exception {
        try (InputStream in = c.getAssets().open(n)) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int k;
            while ((k = in.read(buf)) > 0) b.write(buf, 0, k);
            return b.toByteArray();
        }
    }

    /** pcm: aynan CHUNK ta 16-bit namuna. */
    public float process(short[] pcm) throws Exception {
        System.arraycopy(raw, CHUNK, raw, 0, CTX);
        for (int i = 0; i < CHUNK; i++) raw[CTX + i] = pcm[i];

        // 1) melspektrogramma: [1, 1760] -> [1,1,8,32]
        float[][] frames;
        try (OnnxTensor t = OnnxTensor.createTensor(env, FloatBuffer.wrap(raw), new long[]{1, raw.length});
             OrtSession.Result r = mel.run(Collections.singletonMap("input", t))) {
            float[][][][] out = (float[][][][]) r.get(0).getValue();
            frames = out[0][0];
        }
        int n = frames.length;
        System.arraycopy(melBuf, n, melBuf, 0, 76 - n);
        for (int i = 0; i < n; i++) {
            float[] row = new float[32];
            for (int j = 0; j < 32; j++) row[j] = frames[i][j] / 10f + 2f;
            melBuf[76 - n + i] = row;
        }

        // 2) embedding: [1,76,32,1] -> [1,1,1,96]
        float[] flat = new float[76 * 32];
        for (int i = 0; i < 76; i++) System.arraycopy(melBuf[i], 0, flat, i * 32, 32);
        float[] e;
        try (OnnxTensor t = OnnxTensor.createTensor(env, FloatBuffer.wrap(flat), new long[]{1, 76, 32, 1});
             OrtSession.Result r = emb.run(Collections.singletonMap("input_1", t))) {
            e = ((float[][][][]) r.get(0).getValue())[0][0][0];
        }
        System.arraycopy(embBuf, 1, embBuf, 0, 15);
        embBuf[15] = e.clone();

        // 3) "hey jarvis" bahosi: [1,16,96] -> [1,1]
        float[] f = new float[16 * 96];
        for (int i = 0; i < 16; i++) System.arraycopy(embBuf[i], 0, f, i * 96, 96);
        try (OnnxTensor t = OnnxTensor.createTensor(env, FloatBuffer.wrap(f), new long[]{1, 16, 96});
             OrtSession.Result r = ww.run(Collections.singletonMap(wwInput, t))) {
            return ((float[][]) r.get(0).getValue())[0][0];
        }
    }

    @Override
    public void close() {
        try { mel.close(); emb.close(); ww.close(); } catch (Exception ignored) { }
    }
}
