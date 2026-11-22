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
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognitionService;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.text.TextUtils;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
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

    private static final Pattern WAKE_PATTERN = Pattern.compile(
            "(?:^|\\s)(?:hi|hey|hello|ok|okay|i|ai|aye|hay|high|eye|my|bye|aie|eh|yo)\\s+(?:kevin|keven|kevine|kebin|kelvin|calvin|gavin|kavin|kev)(?:[,.!?\\s]*(.*))?$",
            Pattern.CASE_INSENSITIVE
    );
    private static final Pattern DIRECT_KEVIN_COMMAND_PATTERN = Pattern.compile(
            "^(?:kevin|keven|kevine|kebin|kelvin|calvin)\\s+(.+)$",
            Pattern.CASE_INSENSITIVE
    );

    public static volatile boolean isRunning = false;
    public static volatile boolean isOverlayVisible = false;
    public static volatile boolean isMainVisible = false;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private SpeechRecognizer speechRecognizer;
    private boolean isListening = false;
    private boolean isPaused = false;
    private boolean restartScheduled = false;
    private boolean useDefaultLocaleFallback = false;
    private boolean preferExplicitService = false;
    private int cyclesSinceCreate = 0;
    private int consecutiveClientErrors = 0;
    private long lastWakeLaunchAt = 0L;

    private final Runnable restartRunnable = () -> {
        restartScheduled = false;
        startListeningCycle();
    };

    private final Runnable listeningWatchdogRunnable = () -> {
        if (isListening && !isPaused) {
            isListening = false;
            destroyRecognizer();
            scheduleRestart(350L);
        }
    };

    private final Runnable launchVerifyRunnable = () -> {
        if (isPaused && !isOverlayVisible && KevinAgentPrefs.isWakeWordEnabled(this)) {
            isPaused = false;
            scheduleRestart(400L);
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
            return;
        }
        try {
            Intent intent = new Intent(app, KevinWakeWordService.class).setAction(ACTION_START);
            ContextCompat.startForegroundService(app, intent);
        } catch (Throwable ignored) {}
    }

    public static void stopService(Context context) {
        if (context == null) return;
        Context app = context.getApplicationContext();
        try {
            app.stopService(new Intent(app, KevinWakeWordService.class));
        } catch (Throwable ignored) {}
    }

    public static void pauseListening(Context context) {
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
    public int onStartCommand(Intent intent, int flags, int startId) {
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
            mainHandler.removeCallbacks(launchVerifyRunnable);
            mainHandler.post(this::destroyRecognizer);
            return START_STICKY;
        }

        if (ACTION_RESUME.equals(action)) {
            if (isOverlayVisible) {
                return START_STICKY;
            }
            boolean wasPaused = isPaused;
            isPaused = false;
            mainHandler.removeCallbacks(launchVerifyRunnable);
            if (wasPaused || (!isListening && !restartScheduled)) {
                scheduleRestart(350L);
            }
            return START_STICKY;
        }

        isPaused = false;
        mainHandler.removeCallbacks(launchVerifyRunnable);
        if (!isListening && !restartScheduled) {
            scheduleRestart(250L);
        }
        return START_STICKY;
    }

    private void ensureForegroundStarted() {
        createNotificationChannels();
        Notification notification = buildNotification();
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

    private void scheduleRestart(long delayMs) {
        mainHandler.removeCallbacks(restartRunnable);
        restartScheduled = false;
        if (!isPaused && !isOverlayVisible && KevinAgentPrefs.isWakeWordEnabled(this)) {
            restartScheduled = true;
            mainHandler.postDelayed(restartRunnable, delayMs);
        }
    }

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
            for (ResolveInfo info : services) {
                if (info.serviceInfo == null) continue;
                String pkg = info.serviceInfo.packageName;
                if ("com.google.android.tts".equals(pkg)) {
                    googleTts = info;
                } else if ("com.google.android.googlequicksearchbox".equals(pkg)) {
                    googleSearch = info;
                }
            }
            ResolveInfo chosen = googleSearch != null ? googleSearch : (googleTts != null ? googleTts : services.get(0));
            if (chosen != null && chosen.serviceInfo != null) {
                return new ComponentName(chosen.serviceInfo.packageName, chosen.serviceInfo.name);
            }
        } catch (Throwable ignored) {}
        return null;
    }

    private void createRecognizerIfNeeded() {
        if (speechRecognizer != null) return;
        if (preferExplicitService) {
            ComponentName serviceComponent = findPreferredRecognitionService();
            if (serviceComponent != null) {
                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this, serviceComponent);
            }
        }
        if (speechRecognizer == null) {
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
        }
        speechRecognizer.setRecognitionListener(recognitionListener);
        cyclesSinceCreate = 0;
    }

    private void startListeningCycle() {
        if (isPaused || isOverlayVisible || isListening || !KevinAgentPrefs.isWakeWordEnabled(this)) {
            return;
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            stopWakeWordService();
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
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
            intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1200L);
            intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1000L);
            intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 1500L);

            isListening = true;
            mainHandler.removeCallbacks(listeningWatchdogRunnable);
            mainHandler.postDelayed(listeningWatchdogRunnable, 18_000L);
            speechRecognizer.startListening(intent);
        } catch (Throwable t) {
            isListening = false;
            mainHandler.removeCallbacks(listeningWatchdogRunnable);
            destroyRecognizer();
            scheduleRestart(1500L);
        }
    }

    private void destroyRecognizer() {
        mainHandler.removeCallbacks(restartRunnable);
        mainHandler.removeCallbacks(listeningWatchdogRunnable);
        restartScheduled = false;
        isListening = false;
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
            isListening = false;
        }

        @Override
        public void onError(int error) {
            isListening = false;
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
            if (error == 12 || error == 13) { // ERROR_LANGUAGE_NOT_SUPPORTED / ERROR_LANGUAGE_UNAVAILABLE
                useDefaultLocaleFallback = !useDefaultLocaleFallback;
                preferExplicitService = true;
                destroyRecognizer();
                scheduleRestart(600L);
                return;
            }
            consecutiveClientErrors++;
            if (consecutiveClientErrors >= 2) {
                preferExplicitService = !preferExplicitService;
            }
            destroyRecognizer();
            long backoffMs = (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY || error == SpeechRecognizer.ERROR_CLIENT)
                    ? 1100L
                    : Math.min(4000L, 700L * consecutiveClientErrors);
            scheduleRestart(backoffMs);
        }

        @Override
        public void onResults(Bundle results) {
            isListening = false;
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
            String normalized = Normalizer.normalize(candidate, Normalizer.Form.NFD)
                    .replaceAll("\\p{M}+", "")
                    .toLowerCase(Locale.US)
                    .replaceAll("[^a-z0-9\\s]", " ")
                    .replaceAll("\\s+", " ")
                    .trim();

            Matcher m = WAKE_PATTERN.matcher(normalized);
            if (m.find()) {
                long now = System.currentTimeMillis();
                if (now - lastWakeLaunchAt < 2500L) {
                    return true;
                }
                lastWakeLaunchAt = now;
                String trailingCommand = m.group(1) != null ? m.group(1).trim() : "";
                // On partial results, wait briefly for trailing words unless it's just "hi kevin" cleanly
                triggerAssistantOverlay(trailingCommand);
                return true;
            }

            if (isFinal) {
                Matcher direct = DIRECT_KEVIN_COMMAND_PATTERN.matcher(normalized);
                if (direct.find()) {
                    long now = System.currentTimeMillis();
                    if (now - lastWakeLaunchAt < 2500L) {
                        return true;
                    }
                    lastWakeLaunchAt = now;
                    String trailingCommand = direct.group(1) != null ? direct.group(1).trim() : "";
                    triggerAssistantOverlay(trailingCommand);
                    return true;
                }
            }
        }
        return false;
    }

    private void triggerAssistantOverlay(String trailingCommand) {
        isPaused = true;
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
            // Try direct startActivity AND also post full-screen intent notification so Android 10+ allows launch
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
        mainHandler.removeCallbacks(launchVerifyRunnable);
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

    private Notification buildNotification() {
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
                .setContentText("Vuga \"Hi Kevin\" kugira ngo ufungure Assistant AI")
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
        mainHandler.removeCallbacks(launchVerifyRunnable);
        destroyRecognizer();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
