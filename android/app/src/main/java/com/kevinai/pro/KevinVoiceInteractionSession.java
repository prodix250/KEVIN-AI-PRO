package com.kevinai.pro;

import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.service.voice.VoiceInteractionSession;

import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class KevinVoiceInteractionSession extends VoiceInteractionSession {

    public static final String ACTION_ASSIST_SCREENSHOT = "com.kevinai.pro.action.ASSIST_SCREENSHOT";
    public static final String ASSIST_SCREENSHOT_FILENAME = "assist_screen.jpg";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService screenshotExecutor = Executors.newSingleThreadExecutor();
    private final Runnable deferredFinishRunnable = () -> {
        try {
            hide();
        } catch (Throwable ignored) {}
        try {
            finish();
        } catch (Throwable ignored) {}
    };

    public KevinVoiceInteractionSession(Context context) {
        super(context);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        try {
            setUiEnabled(false);
        } catch (Throwable ignored) {}
    }

    @Override
    public void onShow(Bundle args, int showFlags) {
        super.onShow(args, showFlags);
        mainHandler.removeCallbacks(deferredFinishRunnable);

        // Clear stale cached assist screenshot before launching overlay
        try {
            File stale = new File(getContext().getCacheDir(), ASSIST_SCREENSHOT_FILENAME);
            if (stale.exists()) {
                stale.delete();
            }
        } catch (Throwable ignored) {}

        Intent overlayIntent = new Intent(getContext(), KevinAssistantActivity.class);
        overlayIntent.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_CLEAR_TOP
                        | Intent.FLAG_ACTIVITY_SINGLE_TOP
                        | Intent.FLAG_ACTIVITY_NO_ANIMATION
        );
        try {
            startAssistantActivity(overlayIntent);
        } catch (Throwable primaryError) {
            try {
                getContext().startActivity(overlayIntent);
            } catch (Throwable ignored) {}
        }

        // Wait briefly so onHandleScreenshot() can deliver the screen behind the box before finishing session.
        mainHandler.postDelayed(deferredFinishRunnable, 1800L);
    }

    @Override
    public void onHandleScreenshot(Bitmap screenshot) {
        super.onHandleScreenshot(screenshot);
        if (screenshot == null) {
            mainHandler.removeCallbacks(deferredFinishRunnable);
            mainHandler.post(deferredFinishRunnable);
            return;
        }

        final Context appContext = getContext().getApplicationContext();
        screenshotExecutor.execute(() -> {
            try {
                int maxDim = 1080;
                int w = screenshot.getWidth();
                int h = screenshot.getHeight();
                Bitmap toSave = screenshot;
                boolean createdScaled = false;
                if (w > maxDim || h > maxDim) {
                    float scale = Math.min((float) maxDim / w, (float) maxDim / h);
                    int targetW = Math.max(1, Math.round(w * scale));
                    int targetH = Math.max(1, Math.round(h * scale));
                    toSave = Bitmap.createScaledBitmap(screenshot, targetW, targetH, true);
                    createdScaled = toSave != screenshot;
                }

                File outFile = new File(appContext.getCacheDir(), ASSIST_SCREENSHOT_FILENAME);
                try (FileOutputStream fos = new FileOutputStream(outFile)) {
                    toSave.compress(Bitmap.CompressFormat.JPEG, 78, fos);
                }
                if (createdScaled) {
                    toSave.recycle();
                }

                Intent broadcast = new Intent(ACTION_ASSIST_SCREENSHOT);
                broadcast.setPackage(appContext.getPackageName());
                appContext.sendBroadcast(broadcast);
            } catch (Throwable ignored) {
            } finally {
                mainHandler.removeCallbacks(deferredFinishRunnable);
                mainHandler.post(deferredFinishRunnable);
            }
        });
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacks(deferredFinishRunnable);
        screenshotExecutor.shutdownNow();
        super.onDestroy();
    }
}
