package com.kevinai.pro;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.text.TextUtils;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import java.util.ArrayList;
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

    private static final int NOTIFICATION_ID = 2402;
    private static final String CHANNEL_ID = "kevin_wake_word";
    private static final Pattern WAKE_PATTERN = Pattern.compile(
            "(?:^|\\s)(?:hi|hey|hello|ok|okay|ai|aye|hay|high|eye)\\s+kevin(?:[,.!?\\s]*(.*))?$",
            Pattern.CASE_INSENSITIVE
    );

    public static volatile boolean isRunning = false;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private SpeechRecognizer speechRecognizer;
    private boolean isListening = false;
    private boolean isPaused = false;
    private boolean restartScheduled = false;
    private long lastWakeLaunchAt = 0L;

    private final Runnable restartRunnable = () -> {
        restartScheduled = false;
        startListeningCycle();
    };

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
        if (context == null) return;
        Context app = context.getApplicationContext();
        if (!KevinAgentPrefs.isWakeWordEnabled(app)) return;
        if (ContextCompat.checkSelfPermission(app, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        try {
            Intent intent = new Intent(app, KevinWakeWordService.class)
                    .setAction(isRunning ? ACTION_RESUME : ACTION_START);
            ContextCompat.startForegroundService(app, intent);
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
            mainHandler.post(this::destroyRecognizer);
            return START_STICKY;
        }

        if (ACTION_RESUME.equals(action)) {
            boolean wasPaused = isPaused;
            isPaused = false;
            if (wasPaused || (!isListening && !restartScheduled)) {
                scheduleRestart(450L);
            }
            return START_STICKY;
        }

        isPaused = false;
        if (!isListening && !restartScheduled) {
            scheduleRestart(250L);
        }
        return START_STICKY;
    }

    private void ensureForegroundStarted() {
        createNotificationChannel();
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
        if (!isPaused && KevinAgentPrefs.isWakeWordEnabled(this)) {
            restartScheduled = true;
            mainHandler.postDelayed(restartRunnable, delayMs);
        }
    }

    private void startListeningCycle() {
        if (isPaused || isListening || !KevinAgentPrefs.isWakeWordEnabled(this)) {
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
            if (speechRecognizer == null) {
                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
                speechRecognizer.setRecognitionListener(recognitionListener);
            }

            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag());
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
            intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());

            isListening = true;
            speechRecognizer.startListening(intent);
        } catch (Throwable t) {
            isListening = false;
            destroyRecognizer();
            scheduleRestart(2000L);
        }
    }

    private void destroyRecognizer() {
        mainHandler.removeCallbacks(restartRunnable);
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
        public void onReadyForSpeech(Bundle params) {}

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
            if (isPaused || !KevinAgentPrefs.isWakeWordEnabled(KevinWakeWordService.this)) {
                return;
            }
            if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                stopWakeWordService();
                return;
            }
            if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY || error == SpeechRecognizer.ERROR_CLIENT) {
                destroyRecognizer();
                scheduleRestart(1500L);
                return;
            }
            scheduleRestart(600L);
        }

        @Override
        public void onResults(Bundle results) {
            isListening = false;
            if (handleBundleForWakeWord(results)) {
                return;
            }
            scheduleRestart(350L);
        }

        @Override
        public void onPartialResults(Bundle partialResults) {
            handleBundleForWakeWord(partialResults);
        }

        @Override
        public void onEvent(int eventType, Bundle params) {}
    };

    private boolean handleBundleForWakeWord(@Nullable Bundle bundle) {
        if (bundle == null || isPaused) return false;
        ArrayList<String> matches = bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (matches == null || matches.isEmpty()) return false;

        for (String candidate : matches) {
            if (TextUtils.isEmpty(candidate)) continue;
            String normalized = candidate.toLowerCase(Locale.US)
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
                triggerAssistantOverlay(trailingCommand);
                return true;
            }
        }
        return false;
    }

    private void triggerAssistantOverlay(String trailingCommand) {
        isPaused = true;
        destroyRecognizer();

        try {
            Intent assistIntent = new Intent(this, KevinAssistantActivity.class);
            assistIntent.addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK
                            | Intent.FLAG_ACTIVITY_SINGLE_TOP
                            | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
            );
            assistIntent.putExtra(EXTRA_WAKE_WORD_TRIGGERED, true);
            if (!TextUtils.isEmpty(trailingCommand)) {
                assistIntent.putExtra(EXTRA_WAKE_COMMAND, trailingCommand);
            }
            startActivity(assistIntent);
        } catch (Throwable ignored) {
            isPaused = false;
            scheduleRestart(1500L);
        }
    }

    private void stopWakeWordService() {
        isRunning = false;
        isPaused = true;
        mainHandler.post(this::destroyRecognizer);
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Kevin AI Wake Word (\"Hi Kevin\")",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Kumva ijwi rya \"Hi Kevin\" kugira ngo Kevin AI Assistant ifunguke.");
            channel.setShowBadge(false);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
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
        destroyRecognizer();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
