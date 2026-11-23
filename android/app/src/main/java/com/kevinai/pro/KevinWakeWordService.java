package com.kevinai.pro;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.pm.ServiceInfo;
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
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognitionService;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.text.TextUtils;
import android.util.Base64;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class KevinWakeWordService extends Service {

    public static final String ACTION_START = "com.kevinai.pro.action.START_WAKE_WORD";
    public static final String ACTION_STOP = "com.kevinai.pro.action.STOP_WAKE_WORD";
    public static final String ACTION_PAUSE = "com.kevinai.pro.action.PAUSE_WAKE_WORD";
    public static final String ACTION_RESUME = "com.kevinai.pro.action.RESUME_WAKE_WORD";

    public static final String EXTRA_WAKE_WORD_TRIGGERED = "kevin_wake_word_triggered";
    public static final String EXTRA_WAKE_COMMAND = "kevin_wake_command";

    public static final int TRIGGER_NOTIFICATION_ID = 2403;

    private static final int NOTIFICATION_ID = 2402;
    private static final String CHANNEL_ID = "kevin_wake_word";
    private static final String TRIGGER_CHANNEL_ID = "kevin_wake_trigger";

    private static final int SAMPLE_RATE = 16000;
    private static final int FRAME_SAMPLES = 640; // 40ms @ 16kHz
    private static final int PRE_ROLL_FRAMES = 12; // 480ms pre-roll
    private static final int MAX_SPEECH_FRAMES = 75; // 3.0s max utterance
    private static final int END_SILENCE_FRAMES = 11; // 440ms silence

    private static final Pattern WAKE_PATTERN = Pattern.compile(
            "(?:^|\\s)(?:hi|hey|hello|ok|okay)\\s+(?:kevin|keven|kevine)(?:[,.!?\\s]*(.*))?$",
            Pattern.CASE_INSENSITIVE
    );
    private static final Pattern STRICT_GEMINI_WAKE_PATTERN = Pattern.compile(
            "(?:^|\\s)(?:hi|hey|hello|ok|okay|hai|hay)\\s+(?:kevin|keven|kevine)\\b",
            Pattern.CASE_INSENSITIVE
    );

    public static volatile boolean isRunning = false;
    public static volatile boolean isOverlayVisible = false;
    public static volatile boolean isMainVisible = false;
    public static volatile String activeEngine = "Idle";
    public static volatile String lastDiagnostic = "";

    private static volatile KevinWakeWordService activeInstance = null;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Object audioLock = new Object();
    private final AtomicBoolean audioLoopActive = new AtomicBoolean(false);
    private final AtomicBoolean checkInFlight = new AtomicBoolean(false);
    private final ExecutorService wakeCheckExecutor = Executors.newSingleThreadExecutor();

    private Thread audioCaptureThread;
    private AudioRecord activeAudioRecord;
    private long lastCheckSentAt = 0L;

    // Fallback SpeechRecognizer fields (used only if AudioRecord cannot open on device)
    private SpeechRecognizer speechRecognizer;
    private boolean isSpeechRecognizerListening = false;
    private boolean useDefaultLocaleFallback = false;
    private int consecutiveClientErrors = 0;
    private int cyclesSinceCreate = 0;

    private volatile boolean isPaused = false;
    private boolean restartScheduled = false;
    private long lastWakeLaunchAt = 0L;

    private final Runnable restartRunnable = () -> {
        restartScheduled = false;
        startListeningEngine();
    };

    private final Runnable listeningWatchdogRunnable = () -> {
        if (isSpeechRecognizerListening && !isPaused && !isOverlayVisible) {
            isSpeechRecognizerListening = false;
            destroyRecognizer();
            scheduleRestart(400L);
        }
    };

    private final Runnable launchVerifyRunnable = () -> {
        if (isPaused && !isOverlayVisible && KevinAgentPrefs.isWakeWordEnabled(this)) {
            isPaused = false;
            activeEngine = "Resuming";
            scheduleRestart(350L);
        }
    };

    public static void setOverlayVisible(boolean visible) {
        isOverlayVisible = visible;
    }

    public static void setMainVisible(boolean visible) {
        isMainVisible = visible;
    }

    public static void syncWithPreferences(Context context) {
        if (context == null) return;
        Context app = context.getApplicationContext();
        boolean hasMic = ContextCompat.checkSelfPermission(app, Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;
        if (KevinAgentPrefs.isWakeWordEnabled(app) && hasMic) {
            startService(app);
        } else {
            stopService(app);
        }
    }

    public static void startService(Context context) {
        if (context == null) return;
        Context app = context.getApplicationContext();
        if (ContextCompat.checkSelfPermission(app, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            lastDiagnostic = "Ikeneye uruhushya rwa Microphone";
            return;
        }
        try {
            Intent intent = new Intent(app, KevinWakeWordService.class).setAction(ACTION_START);
            ContextCompat.startForegroundService(app, intent);
        } catch (Throwable t) {
            lastDiagnostic = "Service launch error: " + t.getClass().getSimpleName();
        }
    }

    public static void stopService(Context context) {
        if (context == null) return;
        Context app = context.getApplicationContext();
        KevinWakeWordService inst = activeInstance;
        if (inst != null) {
            inst.stopAudioCaptureSync();
        }
        try {
            app.stopService(new Intent(app, KevinWakeWordService.class));
        } catch (Throwable ignored) {}
    }

    public static void pauseListening(Context context) {
        KevinWakeWordService inst = activeInstance;
        if (inst != null) {
            inst.isPaused = true;
            inst.stopAudioCaptureSync();
        }
        if (context == null || !isRunning) return;
        try {
            Intent intent = new Intent(context.getApplicationContext(), KevinWakeWordService.class)
                    .setAction(ACTION_PAUSE);
            context.getApplicationContext().startService(intent);
        } catch (Throwable ignored) {}
    }

    public static void resumeListening(Context context) {
        if (context == null || isOverlayVisible) return;
        Context app = context.getApplicationContext();
        if (!KevinAgentPrefs.isWakeWordEnabled(app)) return;
        if (ContextCompat.checkSelfPermission(app, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        try {
            if (isRunning) {
                Intent intent = new Intent(app, KevinWakeWordService.class).setAction(ACTION_RESUME);
                app.startService(intent);
            } else {
                Intent intent = new Intent(app, KevinWakeWordService.class).setAction(ACTION_START);
                ContextCompat.startForegroundService(app, intent);
            }
        } catch (Throwable ignored) {}
    }

    @Override
    public void onCreate() {
        super.onCreate();
        activeInstance = this;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        activeInstance = this;
        String action = intent != null ? intent.getAction() : ACTION_START;

        if (ACTION_STOP.equals(action)) {
            stopWakeWordService();
            return START_NOT_STICKY;
        }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED
                || !KevinAgentPrefs.isWakeWordEnabled(this)) {
            stopWakeWordService();
            return START_NOT_STICKY;
        }

        ensureForegroundStarted();

        if (ACTION_PAUSE.equals(action)) {
            isPaused = true;
            activeEngine = "Paused";
            mainHandler.removeCallbacks(launchVerifyRunnable);
            stopAudioCaptureSync();
            mainHandler.post(this::destroyRecognizer);
            return START_STICKY;
        }

        if (ACTION_RESUME.equals(action)) {
            if (isOverlayVisible) {
                return START_STICKY;
            }
            isPaused = false;
            mainHandler.removeCallbacks(launchVerifyRunnable);
            if (!audioLoopActive.get() && !isSpeechRecognizerListening && !restartScheduled) {
                scheduleRestart(250L);
            }
            return START_STICKY;
        }

        isPaused = false;
        mainHandler.removeCallbacks(launchVerifyRunnable);
        if (!audioLoopActive.get() && !isSpeechRecognizerListening && !restartScheduled) {
            scheduleRestart(180L);
        }
        return START_STICKY;
    }

    private void ensureForegroundStarted() {
        createNotificationChannels();
        Notification notification = buildNotification("Vuga \"Hi Kevin\" kugira ngo ufungure Assistant AI");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        isRunning = true;
    }

    private void updateStatusNotification(String statusText) {
        try {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null && isRunning) {
                manager.notify(NOTIFICATION_ID, buildNotification(statusText));
            }
        } catch (Throwable ignored) {}
    }

    private void scheduleRestart(long delayMs) {
        mainHandler.removeCallbacks(restartRunnable);
        restartScheduled = false;
        if (!isPaused && !isOverlayVisible && KevinAgentPrefs.isWakeWordEnabled(this)) {
            restartScheduled = true;
            mainHandler.postDelayed(restartRunnable, delayMs);
        }
    }

    private void startListeningEngine() {
        if (isPaused || isOverlayVisible || !KevinAgentPrefs.isWakeWordEnabled(this)) {
            return;
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            stopWakeWordService();
            return;
        }
        if (audioLoopActive.get() || isSpeechRecognizerListening) {
            return;
        }

        if (startAudioRecordEngine()) {
            return;
        }

        startSpeechRecognizerCycle();
    }

    private AudioRecord createAudioRecordInstance() {
        int minBuf = AudioRecord.getMinBufferSize(
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT
        );
        if (minBuf <= 0) {
            minBuf = FRAME_SAMPLES * 4;
        }
        int bufferBytes = Math.max(minBuf * 2, FRAME_SAMPLES * 2 * 8);
        int[] sources = new int[] {
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                MediaRecorder.AudioSource.MIC
        };
        for (int source : sources) {
            try {
                AudioRecord rec = new AudioRecord(
                        source,
                        SAMPLE_RATE,
                        AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT,
                        bufferBytes
                );
                if (rec.getState() == AudioRecord.STATE_INITIALIZED) {
                    return rec;
                }
                rec.release();
            } catch (Throwable ignored) {}
        }
        return null;
    }

    private boolean startAudioRecordEngine() {
        synchronized (audioLock) {
            if (audioLoopActive.get()) return true;
            AudioRecord recorder = createAudioRecordInstance();
            if (recorder == null) {
                return false;
            }
            try {
                recorder.startRecording();
                if (recorder.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                    recorder.release();
                    return false;
                }
            } catch (Throwable t) {
                try {
                    recorder.release();
                } catch (Throwable ignored) {}
                return false;
            }

            activeAudioRecord = recorder;
            audioLoopActive.set(true);
            activeEngine = "AudioRecord";
            lastDiagnostic = "Irumva mic neza (AudioRecord)";
            updateStatusNotification("Irumva mic... Vuga \"Hi Kevin\"");

            audioCaptureThread = new Thread(this::runAudioRecordLoop, "KevinWakeAudioThread");
            audioCaptureThread.start();
            return true;
        }
    }

    private void stopAudioCaptureSync() {
        audioLoopActive.set(false);
        synchronized (audioLock) {
            if (activeAudioRecord != null) {
                try {
                    activeAudioRecord.stop();
                } catch (Throwable ignored) {}
                try {
                    activeAudioRecord.release();
                } catch (Throwable ignored) {}
                activeAudioRecord = null;
            }
        }
    }

    private void runAudioRecordLoop() {
        short[] frame = new short[FRAME_SAMPLES];
        ArrayDeque<short[]> preRoll = new ArrayDeque<>(PRE_ROLL_FRAMES + 2);
        List<short[]> speechFrames = new ArrayList<>();

        double noiseFloor = 130.0;
        boolean inSpeech = false;
        int startStreak = 0;
        int silenceStreak = 0;
        int voicedFrames = 0;
        double peakRms = 0.0;

        while (audioLoopActive.get() && !isPaused && !isOverlayVisible) {
            AudioRecord rec;
            synchronized (audioLock) {
                rec = activeAudioRecord;
            }
            if (rec == null) break;

            int read = 0;
            try {
                read = rec.read(frame, 0, FRAME_SAMPLES);
            } catch (Throwable ignored) {
                break;
            }

            if (read <= 0) {
                if (read == AudioRecord.ERROR_INVALID_OPERATION || read == AudioRecord.ERROR_DEAD_OBJECT) {
                    break;
                }
                continue;
            }

            double sumSq = 0.0;
            for (int i = 0; i < read; i++) {
                double s = frame[i];
                sumSq += s * s;
            }
            double rms = Math.sqrt(sumSq / read);

            short[] copy = new short[read];
            System.arraycopy(frame, 0, copy, 0, read);

            if (!inSpeech) {
                noiseFloor = noiseFloor * 0.95 + Math.min(rms, 650.0) * 0.05;
                if (noiseFloor < 75.0) noiseFloor = 75.0;

                if (preRoll.size() >= PRE_ROLL_FRAMES) {
                    preRoll.pollFirst();
                }
                preRoll.addLast(copy);

                double startThresh = Math.max(320.0, noiseFloor * 2.55);
                if (rms > startThresh) {
                    startStreak++;
                    if (startStreak >= 3) {
                        inSpeech = true;
                        speechFrames.clear();
                        speechFrames.addAll(preRoll);
                        speechFrames.add(copy);
                        voicedFrames = 3;
                        silenceStreak = 0;
                        peakRms = rms;
                    }
                } else {
                    startStreak = 0;
                }
            } else {
                speechFrames.add(copy);
                double keepThresh = Math.max(240.0, noiseFloor * 1.9);
                if (rms > keepThresh) {
                    voicedFrames++;
                    silenceStreak = 0;
                    if (rms > peakRms) peakRms = rms;
                } else {
                    silenceStreak++;
                }

                if (silenceStreak >= END_SILENCE_FRAMES || speechFrames.size() >= MAX_SPEECH_FRAMES) {
                    inSpeech = false;
                    startStreak = 0;
                    silenceStreak = 0;

                    long now = System.currentTimeMillis();
                    if (voicedFrames >= 8
                            && peakRms >= 380.0
                            && (now - lastCheckSentAt >= 850L)
                            && checkInFlight.compareAndSet(false, true)) {
                        lastCheckSentAt = now;
                        final byte[] wavBytes = encodePcmToWav(speechFrames);
                        speechFrames.clear();
                        wakeCheckExecutor.execute(() -> {
                            try {
                                inspectWavForWakeWord(wavBytes);
                            } finally {
                                checkInFlight.set(false);
                            }
                        });
                    } else {
                        speechFrames.clear();
                    }
                }
            }
        }

        stopAudioCaptureSync();
        if (!isPaused && !isOverlayVisible && KevinAgentPrefs.isWakeWordEnabled(this) && isRunning) {
            scheduleRestart(600L);
        }
    }

    private byte[] encodePcmToWav(List<short[]> chunks) {
        int totalSamples = 0;
        for (short[] c : chunks) {
            totalSamples += c.length;
        }
        int dataSize = totalSamples * 2;
        ByteArrayOutputStream out = new ByteArrayOutputStream(44 + dataSize);

        try {
            // RIFF header
            out.write(new byte[] { 'R', 'I', 'F', 'F' });
            writeIntLE(out, 36 + dataSize);
            out.write(new byte[] { 'W', 'A', 'V', 'E' });
            out.write(new byte[] { 'f', 'm', 't', ' ' });
            writeIntLE(out, 16); // PCM chunk size
            writeShortLE(out, (short) 1); // PCM format
            writeShortLE(out, (short) 1); // Mono
            writeIntLE(out, SAMPLE_RATE);
            writeIntLE(out, SAMPLE_RATE * 2); // Byte rate
            writeShortLE(out, (short) 2); // Block align
            writeShortLE(out, (short) 16); // Bits per sample
            out.write(new byte[] { 'd', 'a', 't', 'a' });
            writeIntLE(out, dataSize);

            for (short[] c : chunks) {
                for (short s : c) {
                    out.write(s & 0xFF);
                    out.write((s >> 8) & 0xFF);
                }
            }
        } catch (Exception ignored) {}
        return out.toByteArray();
    }

    private static void writeIntLE(ByteArrayOutputStream out, int v) {
        out.write(v & 0xFF);
        out.write((v >> 8) & 0xFF);
        out.write((v >> 16) & 0xFF);
        out.write((v >> 24) & 0xFF);
    }

    private static void writeShortLE(ByteArrayOutputStream out, short v) {
        out.write(v & 0xFF);
        out.write((v >> 8) & 0xFF);
    }

    private void inspectWavForWakeWord(byte[] wavBytes) {
        if (wavBytes == null || wavBytes.length < 1000 || isPaused || isOverlayVisible) {
            return;
        }
        String audioBase64 = Base64.encodeToString(wavBytes, Base64.NO_WRAP);
        List<String> userKeys = KevinAgentPrefs.getApiKeysList(this);

        WakeCheckResult result = null;
        if (!userKeys.isEmpty()) {
            result = callGeminiDirectWakeCheck(audioBase64, userKeys);
        }
        if (result == null) {
            result = callBackendWakeCheck(audioBase64, userKeys);
        }
        if (result == null) {
            return;
        }

        if (!TextUtils.isEmpty(result.transcript)) {
            String trimmed = result.transcript.length() > 36
                    ? result.transcript.substring(0, 36) + "..."
                    : result.transcript;
            lastDiagnostic = "Byavuzwe: \"" + trimmed + "\"";
        }

        String matchedCommand = extractWakeCommandFromText(result.transcript);
        String normalizedTranscript = normalizeTranscript(result.transcript);
        boolean strictGeminiMatch = result.wake && STRICT_GEMINI_WAKE_PATTERN.matcher(normalizedTranscript).find();
        boolean triggered = matchedCommand != null || strictGeminiMatch;
        if (triggered) {
            String cmd = !TextUtils.isEmpty(result.command)
                    ? result.command.trim()
                    : (matchedCommand != null ? matchedCommand.trim() : "");
            lastDiagnostic = "Hi Kevin yumvikanye!";
            mainHandler.post(() -> {
                if (isPaused || isOverlayVisible) return;
                long now = System.currentTimeMillis();
                if (now - lastWakeLaunchAt < 2500L) return;
                lastWakeLaunchAt = now;
                playWakeFeedback();
                triggerAssistantOverlay(cmd);
            });
        }
    }

    private static final class WakeCheckResult {
        final boolean wake;
        final String command;
        final String transcript;

        WakeCheckResult(boolean wake, String command, String transcript) {
            this.wake = wake;
            this.command = command != null ? command : "";
            this.transcript = transcript != null ? transcript : "";
        }
    }

    private WakeCheckResult callGeminiDirectWakeCheck(String audioBase64, List<String> keys) {
        String[] models = new String[] {
                "gemini-2.5-flash",
                "gemini-2.5-flash-lite",
                "gemini-2.0-flash",
                "gemini-4-hydrogen",
                "gemini-3.1-flash-lite"
        };
        String prompt = "Listen strictly to this short audio clip. "
                + "Set \"wake\":true ONLY if the speaker clearly and intentionally calls the assistant by saying \"Hi Kevin\", \"Hey Kevin\", \"Hello Kevin\", or \"OK Kevin\". "
                + "Do NOT trigger on ambient Kinyarwanda conversation, background TV/music, breathing, coughs, random noise, or someone just mentioning the name Kevin inside a sentence without saying Hi/Hey/Hello/OK Kevin. "
                + "Return ONLY raw JSON: {\"wake\":true|false,\"command\":\"\",\"transcript\":\"exact words heard\"}. "
                + "Leave \"command\" empty unless a clear full request (at least 2 words) immediately follows \"Hi Kevin\". "
                + "If unsure, noisy, or silent, return {\"wake\":false,\"command\":\"\",\"transcript\":\"\"}.";

        for (String model : models) {
            for (int i = 0; i < Math.min(keys.size(), 2); i++) {
                String key = keys.get(i);
                HttpURLConnection conn = null;
                try {
                    URL url = new URL("https://generativelanguage.googleapis.com/v1beta/models/"
                            + model + ":generateContent?key=" + URLEncoder.encode(key, "UTF-8"));
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setConnectTimeout(3500);
                    conn.setReadTimeout(5000);
                    conn.setRequestProperty("Content-Type", "application/json");
                    conn.setDoOutput(true);

                    JSONObject inlineData = new JSONObject();
                    inlineData.put("mimeType", "audio/wav");
                    inlineData.put("data", audioBase64);

                    JSONObject audioPart = new JSONObject();
                    audioPart.put("inlineData", inlineData);

                    JSONObject textPart = new JSONObject();
                    textPart.put("text", prompt);

                    JSONArray parts = new JSONArray();
                    parts.put(audioPart);
                    parts.put(textPart);

                    JSONObject content = new JSONObject();
                    content.put("parts", parts);

                    JSONArray contents = new JSONArray();
                    contents.put(content);

                    JSONObject body = new JSONObject();
                    body.put("contents", contents);

                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(body.toString().getBytes(StandardCharsets.UTF_8));
                    }

                    int code = conn.getResponseCode();
                    if (code >= 200 && code < 300) {
                        String respStr = readHttpStream(conn);
                        JSONObject root = new JSONObject(respStr);
                        JSONArray candidates = root.optJSONArray("candidates");
                        if (candidates != null && candidates.length() > 0) {
                            JSONObject cand = candidates.getJSONObject(0);
                            JSONObject candContent = cand.optJSONObject("content");
                            JSONArray respParts = candContent != null ? candContent.optJSONArray("parts") : null;
                            if (respParts != null && respParts.length() > 0) {
                                String rawText = respParts.getJSONObject(0).optString("text", "").trim();
                                return parseWakeJson(rawText);
                            }
                        }
                    }
                } catch (Throwable t) {
                    lastDiagnostic = "Direct check wait: " + t.getClass().getSimpleName();
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }
        }
        return null;
    }

    private WakeCheckResult callBackendWakeCheck(String audioBase64, List<String> userKeys) {
        HttpURLConnection conn = null;
        try {
            String base = KevinAgentPrefs.getEffectiveBackendBaseUrl(this);
            String endpoint = base.endsWith("/") ? base + "api/wake-check" : base + "/api/wake-check";
            conn = (HttpURLConnection) new URL(endpoint).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(4000);
            conn.setReadTimeout(6000);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setDoOutput(true);

            JSONObject payload = new JSONObject();
            payload.put("audioBase64", audioBase64);
            payload.put("audioMimeType", "audio/wav");
            if (!userKeys.isEmpty()) {
                JSONArray arr = new JSONArray();
                for (String k : userKeys) arr.put(k);
                payload.put("customApiKeys", arr);
            }

            try (OutputStream os = conn.getOutputStream()) {
                os.write(payload.toString().getBytes(StandardCharsets.UTF_8));
            }

            int code = conn.getResponseCode();
            if (code >= 200 && code < 300) {
                JSONObject json = new JSONObject(readHttpStream(conn));
                return new WakeCheckResult(
                        json.optBoolean("wake", false),
                        json.optString("command", ""),
                        json.optString("transcript", "")
                );
            } else {
                lastDiagnostic = "Server wake check HTTP " + code;
            }
        } catch (Throwable t) {
            lastDiagnostic = "Network check wait: " + t.getClass().getSimpleName();
        } finally {
            if (conn != null) conn.disconnect();
        }
        return null;
    }

    private static String readHttpStream(HttpURLConnection conn) throws Exception {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line);
            }
        }
        return sb.toString();
    }

    private static WakeCheckResult parseWakeJson(String raw) {
        if (TextUtils.isEmpty(raw)) return new WakeCheckResult(false, "", "");
        String cleaned = raw.trim()
                .replaceAll("^```(?:json)?\\s*", "")
                .replaceAll("\\s*```$", "")
                .trim();
        try {
            JSONObject obj = new JSONObject(cleaned);
            return new WakeCheckResult(
                    obj.optBoolean("wake", false),
                    obj.optString("command", ""),
                    obj.optString("transcript", "")
            );
        } catch (Exception e) {
            return new WakeCheckResult(false, "", cleaned);
        }
    }

    private void playWakeFeedback() {
        try {
            ToneGenerator tone = new ToneGenerator(AudioManager.STREAM_MUSIC, 85);
            tone.startTone(ToneGenerator.TONE_PROP_ACK, 140);
            mainHandler.postDelayed(tone::release, 350L);
        } catch (Throwable ignored) {}

        try {
            Vibrator vibrator = getSystemService(Vibrator.class);
            if (vibrator != null && vibrator.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createOneShot(55L, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    vibrator.vibrate(55L);
                }
            }
        } catch (Throwable ignored) {}
    }

    // ===== Backup SpeechRecognizer Engine (only if AudioRecord cannot initialize) =====

    private @Nullable ComponentName findPreferredRecognitionService() {
        try {
            PackageManager pm = getPackageManager();
            List<ResolveInfo> services = pm.queryIntentServices(
                    new Intent(RecognitionService.SERVICE_INTERFACE),
                    0
            );
            if (services == null || services.isEmpty()) return null;
            ResolveInfo googleTts = null;
            ResolveInfo googleSearch = null;
            ResolveInfo anyOther = null;
            String myPkg = getPackageName();
            for (ResolveInfo info : services) {
                if (info.serviceInfo == null) continue;
                String pkg = info.serviceInfo.packageName;
                if (myPkg.equals(pkg)) continue; // Never bind to our own stub RecognitionService!
                if ("com.google.android.tts".equals(pkg)) {
                    googleTts = info;
                } else if ("com.google.android.googlequicksearchbox".equals(pkg)) {
                    googleSearch = info;
                } else if (anyOther == null) {
                    anyOther = info;
                }
            }
            ResolveInfo chosen = googleSearch != null ? googleSearch : (googleTts != null ? googleTts : anyOther);
            if (chosen != null && chosen.serviceInfo != null) {
                return new ComponentName(chosen.serviceInfo.packageName, chosen.serviceInfo.name);
            }
        } catch (Throwable ignored) {}
        return null;
    }

    private void createRecognizerIfNeeded() {
        if (speechRecognizer != null) return;
        ComponentName serviceComponent = findPreferredRecognitionService();
        if (serviceComponent != null) {
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this, serviceComponent);
        }
        if (speechRecognizer == null) {
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
        }
        speechRecognizer.setRecognitionListener(recognitionListener);
        cyclesSinceCreate = 0;
    }

    private void startSpeechRecognizerCycle() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            activeEngine = "Unavailable";
            lastDiagnostic = "Mic/SpeechRecognizer ntibonetse";
            return;
        }
        try {
            if (cyclesSinceCreate >= 8) {
                destroyRecognizer();
            }
            createRecognizerIfNeeded();
            cyclesSinceCreate++;

            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            if (!useDefaultLocaleFallback) {
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US");
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "en-US");
            }
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
            intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());

            isSpeechRecognizerListening = true;
            activeEngine = "SpeechRecognizer";
            lastDiagnostic = "Irumva (SpeechRecognizer)";
            mainHandler.removeCallbacks(listeningWatchdogRunnable);
            mainHandler.postDelayed(listeningWatchdogRunnable, 16_000L);
            speechRecognizer.startListening(intent);
        } catch (Throwable t) {
            isSpeechRecognizerListening = false;
            mainHandler.removeCallbacks(listeningWatchdogRunnable);
            destroyRecognizer();
            scheduleRestart(1500L);
        }
    }

    private void destroyRecognizer() {
        mainHandler.removeCallbacks(restartRunnable);
        mainHandler.removeCallbacks(listeningWatchdogRunnable);
        restartScheduled = false;
        isSpeechRecognizerListening = false;
        if (speechRecognizer != null) {
            try {
                speechRecognizer.cancel();
            } catch (Throwable ignored) {}
            try {
                speechRecognizer.destroy();
            } catch (Throwable ignored) {}
            speechRecognizer = null;
        }
    }

    private final RecognitionListener recognitionListener = new RecognitionListener() {
        @Override
        public void onReadyForSpeech(Bundle params) {
            consecutiveClientErrors = 0;
        }

        @Override
        public void onBeginningOfSpeech() {}

        @Override
        public void onRmsChanged(float rmsdB) {}

        @Override
        public void onBufferReceived(byte[] buffer) {}

        @Override
        public void onEndOfSpeech() {
            isSpeechRecognizerListening = false;
        }

        @Override
        public void onError(int error) {
            isSpeechRecognizerListening = false;
            mainHandler.removeCallbacks(listeningWatchdogRunnable);
            if (isPaused || isOverlayVisible || !KevinAgentPrefs.isWakeWordEnabled(KevinWakeWordService.this)) {
                return;
            }
            if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                stopWakeWordService();
                return;
            }
            if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                consecutiveClientErrors = 0;
                scheduleRestart(250L);
                return;
            }
            if (error == 12 || error == 13) {
                useDefaultLocaleFallback = !useDefaultLocaleFallback;
                destroyRecognizer();
                scheduleRestart(600L);
                return;
            }
            consecutiveClientErrors++;
            destroyRecognizer();
            scheduleRestart(Math.min(4000L, 900L * consecutiveClientErrors));
        }

        @Override
        public void onResults(Bundle results) {
            isSpeechRecognizerListening = false;
            mainHandler.removeCallbacks(listeningWatchdogRunnable);
            consecutiveClientErrors = 0;
            if (handleBundleForWakeWord(results, true)) {
                return;
            }
            scheduleRestart(250L);
        }

        @Override
        public void onPartialResults(Bundle partialResults) {
            handleBundleForWakeWord(partialResults, false);
        }

        @Override
        public void onEvent(int eventType, Bundle params) {}
    };

    private boolean handleBundleForWakeWord(@Nullable Bundle bundle, boolean isFinal) {
        if (bundle == null || isPaused || isOverlayVisible) return false;
        ArrayList<String> matches = bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (matches == null || matches.isEmpty()) return false;

        for (String candidate : matches) {
            if (TextUtils.isEmpty(candidate)) continue;
            String cmd = extractWakeCommandFromText(candidate);
            if (cmd != null && (isFinal || WAKE_PATTERN.matcher(normalizeTranscript(candidate)).find())) {
                long now = System.currentTimeMillis();
                if (now - lastWakeLaunchAt < 2500L) {
                    return true;
                }
                lastWakeLaunchAt = now;
                playWakeFeedback();
                triggerAssistantOverlay(cmd);
                return true;
            }
        }
        return false;
    }

    private static String normalizeTranscript(String text) {
        if (TextUtils.isEmpty(text)) return "";
        return Normalizer.normalize(text, Normalizer.Form.NFD)
                .replaceAll("\\p{M}+", "")
                .toLowerCase(Locale.US)
                .replaceAll("[^a-z0-9\\s]", " ")
                .replaceAll("\\s+", " ")
                .trim();
    }

    private static @Nullable String extractWakeCommandFromText(String rawText) {
        String normalized = normalizeTranscript(rawText);
        if (TextUtils.isEmpty(normalized)) return null;

        Matcher m = WAKE_PATTERN.matcher(normalized);
        if (m.find()) {
            return m.group(1) != null ? m.group(1).trim() : "";
        }
        return null;
    }

    private void triggerAssistantOverlay(String trailingCommand) {
        isPaused = true;
        activeEngine = "Launching";
        stopAudioCaptureSync();
        destroyRecognizer();

        Intent assistIntent = new Intent(this, KevinAssistantActivity.class);
        assistIntent.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_SINGLE_TOP
                        | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                        | Intent.FLAG_ACTIVITY_CLEAR_TOP
        );
        assistIntent.putExtra(EXTRA_WAKE_WORD_TRIGGERED, true);
        if (!TextUtils.isEmpty(trailingCommand)) {
            assistIntent.putExtra(EXTRA_WAKE_COMMAND, trailingCommand);
        }

        boolean canDrawOverlays = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this);

        if (canDrawOverlays || isMainVisible) {
            try {
                startActivity(assistIntent);
            } catch (Throwable ignored) {}
        }

        if (!canDrawOverlays && !isMainVisible) {
            try {
                startActivity(assistIntent);
            } catch (Throwable ignored) {}

            try {
                PendingIntent fullScreenPending = PendingIntent.getActivity(
                        this,
                        TRIGGER_NOTIFICATION_ID,
                        assistIntent,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                );
                Notification triggerNotif = new NotificationCompat.Builder(this, TRIGGER_CHANNEL_ID)
                        .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                        .setContentTitle("Kevin AI Assistant irafunguye")
                        .setContentText(TextUtils.isEmpty(trailingCommand)
                                ? "Kanda hano uvuge icyo ushaka"
                                : trailingCommand)
                        .setPriority(NotificationCompat.PRIORITY_HIGH)
                        .setCategory(NotificationCompat.CATEGORY_CALL)
                        .setAutoCancel(true)
                        .setTimeoutAfter(8000L)
                        .setFullScreenIntent(fullScreenPending, true)
                        .setContentIntent(fullScreenPending)
                        .build();
                NotificationManager manager = getSystemService(NotificationManager.class);
                if (manager != null) {
                    manager.notify(TRIGGER_NOTIFICATION_ID, triggerNotif);
                }
            } catch (Throwable ignored) {}
        }

        mainHandler.removeCallbacks(launchVerifyRunnable);
        mainHandler.postDelayed(launchVerifyRunnable, 2400L);
    }

    private void stopWakeWordService() {
        isRunning = false;
        isPaused = true;
        activeEngine = "Stopped";
        mainHandler.removeCallbacks(launchVerifyRunnable);
        stopAudioCaptureSync();
        mainHandler.post(this::destroyRecognizer);
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager == null) return;

            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Kevin AI Wake Word (\"Hi Kevin\")",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Kumva ijwi rya \"Hi Kevin\" kugira ngo Kevin AI Assistant ifunguke.");
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);

            NotificationChannel triggerChannel = new NotificationChannel(
                    TRIGGER_CHANNEL_ID,
                    "Kevin AI Assistant Launch",
                    NotificationManager.IMPORTANCE_HIGH
            );
            triggerChannel.setDescription("Gufungura Kevin AI Assistant ako kanya uvuze \"Hi Kevin\".");
            triggerChannel.setShowBadge(false);
            manager.createNotificationChannel(triggerChannel);
        }
    }

    private Notification buildNotification(String text) {
        Intent openIntent = new Intent(this, KevinAssistantActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPending = PendingIntent.getActivity(
                this,
                0,
                openIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        Intent stopIntent = new Intent(this, KevinWakeWordService.class).setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(
                this,
                1,
                stopIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("Kevin AI: \"Hi Kevin\" iriteguye")
                .setContentText(text)
                .setOngoing(true)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setContentIntent(openPending)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Hagarika", stopPending)
                .build();
    }

    @Override
    public void onDestroy() {
        isRunning = false;
        activeEngine = "Stopped";
        if (activeInstance == this) {
            activeInstance = null;
        }
        mainHandler.removeCallbacks(launchVerifyRunnable);
        stopAudioCaptureSync();
        destroyRecognizer();
        wakeCheckExecutor.shutdownNow();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
