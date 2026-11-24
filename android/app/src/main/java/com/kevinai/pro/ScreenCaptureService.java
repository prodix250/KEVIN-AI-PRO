package com.kevinai.pro;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;
import android.util.Base64;
import android.util.DisplayMetrics;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

public class ScreenCaptureService extends Service {

    public static final String ACTION_START = "com.kevinai.pro.action.START_SCREEN_CAPTURE";
    public static final String ACTION_STOP = "com.kevinai.pro.action.STOP_SCREEN_CAPTURE";
    public static final String ACTION_SCREEN_FRAME = "com.kevinai.pro.action.SCREEN_FRAME";
    public static final String ACTION_CAPTURE_READY = "com.kevinai.pro.action.CAPTURE_READY";
    public static final String ACTION_CLEAN_FRAME_CAPTURED = "com.kevinai.pro.action.CLEAN_FRAME_CAPTURED";
    public static final String EXTRA_RESULT_CODE = "resultCode";
    public static final String EXTRA_RESULT_DATA = "resultData";
    public static final String EXTRA_FRAME = "frame";

    private static final int NOTIFICATION_ID = 2401;
    private static final String CHANNEL_ID = "kevin_live_screen";
    private static final String NOTIFICATION_TITLE =
            "🟢 Kevin AI: Live Screen Vision is Active";

    public static volatile boolean isCaptureRunning = false;
    public static volatile boolean suppressOverlayFrames = false;
    private static volatile boolean cleanCaptureWindowActive = false;
    private static volatile long cleanCaptureStartedAtMs = 0L;
    private static volatile long cleanCaptureAcceptMinMs = 0L;
    private static volatile long cleanCaptureReadyAtMs = 0L;
    private static volatile String earlyPostHideFrame = null;
    private static volatile String latestPostWindowFrame = null;
    private static volatile String verifiedCleanFrame = null;
    private static volatile ScreenCaptureService activeInstance = null;

    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private boolean framePending;
    private long lastFrameAt;

    public static void setSuppressOverlayFrames(boolean suppress) {
        suppressOverlayFrames = suppress;
    }

    public static void beginCleanCaptureWindow(long readyDelayMs) {
        beginCleanCaptureWindow(Math.min(75L, readyDelayMs), readyDelayMs);
    }

    public static void beginCleanCaptureWindow(long acceptMinDelayMs, long readyDelayMs) {
        ScreenCaptureService svc = activeInstance;
        if (svc != null) {
            svc.drainQueuedImages();
        }
        earlyPostHideFrame = null;
        latestPostWindowFrame = null;
        verifiedCleanFrame = null;
        long now = SystemClock.uptimeMillis();
        cleanCaptureStartedAtMs = now;
        cleanCaptureAcceptMinMs = now + Math.max(0L, acceptMinDelayMs);
        cleanCaptureReadyAtMs = now + Math.max(Math.max(0L, acceptMinDelayMs), readyDelayMs);
        cleanCaptureWindowActive = true;
    }

    @Nullable
    public static String finishCleanCaptureWindow() {
        boolean wasActive = cleanCaptureWindowActive;
        cleanCaptureWindowActive = false;

        String frame = verifiedCleanFrame;
        if (frame == null) {
            frame = latestPostWindowFrame;
        }
        if (frame == null && wasActive) {
            ScreenCaptureService svc = activeInstance;
            if (svc != null) {
                frame = svc.tryCapturePendingLatestImage();
            }
        }
        if (frame == null) {
            frame = earlyPostHideFrame;
        }

        earlyPostHideFrame = null;
        latestPostWindowFrame = null;
        verifiedCleanFrame = null;
        return frame;
    }

    private void drainQueuedImages() {
        ImageReader reader = imageReader;
        if (reader == null) return;
        for (int i = 0; i < 3; i++) {
            Image stale = null;
            try {
                stale = reader.acquireLatestImage();
                if (stale == null) {
                    break;
                }
            } catch (Exception ignored) {
                break;
            } finally {
                if (stale != null) {
                    try {
                        stale.close();
                    } catch (Exception ignored) {}
                }
            }
        }
    }

    @Nullable
    private String tryCapturePendingLatestImage() {
        ImageReader reader = imageReader;
        if (reader == null) return null;
        Image image = null;
        try {
            image = reader.acquireLatestImage();
            if (image == null) {
                return null;
            }
            if (SystemClock.uptimeMillis() < cleanCaptureStartedAtMs + 18L) {
                return null;
            }
            return encodeImageToBase64(image);
        } catch (Exception exception) {
            android.util.Log.e("ScreenCaptureService", "Failed synchronous clean capture", exception);
            return null;
        } finally {
            if (image != null) {
                try {
                    image.close();
                } catch (Exception ignored) {}
            }
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACTION_STOP.equals(intent.getAction())) {
            stopCapture();
            return START_NOT_STICKY;
        }

        if (ACTION_START.equals(intent.getAction())) {
            int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
            Intent resultData = intent.getParcelableExtra(EXTRA_RESULT_DATA);
            if (resultData == null) {
                stopSelf();
                return START_NOT_STICKY;
            }
            startCapture(resultCode, resultData);
        }
        return START_NOT_STICKY;
    }

    private void startCapture(int resultCode, Intent resultData) {
        activeInstance = this;
        createNotificationChannel();
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        if (mediaProjection != null) {
            stopCaptureResources();
        }

        MediaProjectionManager manager =
                (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
        mediaProjection = manager.getMediaProjection(resultCode, resultData);
        if (mediaProjection == null) {
            stopCapture();
            return;
        }
        mediaProjection.registerCallback(new MediaProjection.Callback() {
            @Override
            public void onStop() {
                stopCapture();
            }
        }, null);

        DisplayMetrics metrics = getResources().getDisplayMetrics();
        int width = Math.max(1, metrics.widthPixels);
        int height = Math.max(1, metrics.heightPixels);
        int density = metrics.densityDpi;

        imageReader = ImageReader.newInstance(width, height, android.graphics.PixelFormat.RGBA_8888, 2);
        imageReader.setOnImageAvailableListener(reader -> captureLatestFrame(reader), null);
        virtualDisplay = mediaProjection.createVirtualDisplay(
                "Kevin AI Live Screen Vision",
                width,
                height,
                density,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.getSurface(),
                null,
                null
        );
        isCaptureRunning = true;

        Intent readyIntent = new Intent(ACTION_CAPTURE_READY);
        readyIntent.setPackage(getPackageName());
        sendBroadcast(readyIntent);
    }

    private void captureLatestFrame(ImageReader reader) {
        if (cleanCaptureWindowActive) {
            Image image = null;
            try {
                image = reader.acquireLatestImage();
                if (image == null) {
                    return;
                }
                long nowUptime = SystemClock.uptimeMillis();
                long elapsedSinceStart = nowUptime - cleanCaptureStartedAtMs;
                if (elapsedSinceStart < 18L) {
                    // Discard pre-hide or mid-flight dirty buffer before the hidden frame reaches SurfaceFlinger.
                    return;
                }
                String encoded = encodeImageToBase64(image);
                if (nowUptime >= cleanCaptureReadyAtMs) {
                    cleanCaptureWindowActive = false;
                    suppressOverlayFrames = true;
                    earlyPostHideFrame = null;
                    latestPostWindowFrame = null;
                    verifiedCleanFrame = null;
                    lastFrameAt = System.currentTimeMillis();

                    Intent cleanIntent = new Intent(ACTION_CLEAN_FRAME_CAPTURED);
                    cleanIntent.setPackage(getPackageName());
                    cleanIntent.putExtra(EXTRA_FRAME, encoded);
                    sendBroadcast(cleanIntent);
                } else if (nowUptime >= cleanCaptureAcceptMinMs) {
                    verifiedCleanFrame = encoded;
                } else if (elapsedSinceStart >= 42L) {
                    latestPostWindowFrame = encoded;
                } else {
                    earlyPostHideFrame = encoded;
                }
            } catch (Exception exception) {
                android.util.Log.e("ScreenCaptureService", "Failed to capture clean screen frame", exception);
            } finally {
                if (image != null) {
                    image.close();
                }
            }
            return;
        }

        if (suppressOverlayFrames) {
            Image stale = null;
            try {
                stale = reader.acquireLatestImage();
            } catch (Exception ignored) {
            } finally {
                if (stale != null) {
                    stale.close();
                }
            }
            return;
        }

        long now = System.currentTimeMillis();
        if (framePending || now - lastFrameAt < 1000) {
            return;
        }
        Image image = null;
        try {
            image = reader.acquireLatestImage();
            if (image == null) {
                return;
            }
            framePending = true;
            lastFrameAt = now;
            String encoded = encodeImageToBase64(image);

            Intent frameIntent = new Intent(ACTION_SCREEN_FRAME);
            frameIntent.setPackage(getPackageName());
            frameIntent.putExtra(EXTRA_FRAME, encoded);
            sendBroadcast(frameIntent);
        } catch (Exception exception) {
            android.util.Log.e("ScreenCaptureService", "Failed to capture screen frame", exception);
        } finally {
            if (image != null) {
                image.close();
            }
            framePending = false;
        }
    }

    private String encodeImageToBase64(Image image) throws Exception {
        Image.Plane plane = image.getPlanes()[0];
        ByteBuffer buffer = plane.getBuffer();
        int pixelStride = plane.getPixelStride();
        int rowStride = plane.getRowStride();
        int rowPadding = rowStride - pixelStride * image.getWidth();
        Bitmap bitmap = Bitmap.createBitmap(
                image.getWidth() + rowPadding / pixelStride,
                image.getHeight(),
                Bitmap.Config.ARGB_8888
        );
        bitmap.copyPixelsFromBuffer(buffer);
        Bitmap cropped = Bitmap.createBitmap(bitmap, 0, 0, image.getWidth(), image.getHeight());
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        cropped.compress(Bitmap.CompressFormat.JPEG, 75, output);
        String encoded = Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
        cropped.recycle();
        bitmap.recycle();
        output.close();
        return encoded;
    }

    private Notification buildNotification() {
        Intent stopIntent = new Intent(this, ScreenCaptureService.class).setAction(ACTION_STOP);
        PendingIntent stopPendingIntent = PendingIntent.getService(
                this,
                2402,
                stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(com.kevinai.pro.R.mipmap.ic_launcher)
                .setContentTitle(NOTIFICATION_TITLE)
                .setContentText("Kevin AI is viewing your screen to assist you in real time.")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .addAction(com.kevinai.pro.R.mipmap.ic_launcher, "Stop Sharing", stopPendingIntent)
                .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Kevin AI Live Screen Vision",
                    NotificationManager.IMPORTANCE_LOW
            );
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    private void stopCaptureResources() {
        cleanCaptureWindowActive = false;
        earlyPostHideFrame = null;
        latestPostWindowFrame = null;
        verifiedCleanFrame = null;
        suppressOverlayFrames = false;
        if (virtualDisplay != null) {
            virtualDisplay.release();
            virtualDisplay = null;
        }
        if (imageReader != null) {
            imageReader.close();
            imageReader = null;
        }
        if (mediaProjection != null) {
            MediaProjection projection = mediaProjection;
            mediaProjection = null;
            projection.stop();
        }
    }

    private void stopCapture() {
        isCaptureRunning = false;
        stopCaptureResources();
        if (activeInstance == this) {
            activeInstance = null;
        }
        stopForeground(true);
        stopSelf();
        Intent stoppedIntent = new Intent(ACTION_STOP);
        stoppedIntent.setPackage(getPackageName());
        sendBroadcast(stoppedIntent);
    }

    @Override
    public void onDestroy() {
        isCaptureRunning = false;
        stopCaptureResources();
        if (activeInstance == this) {
            activeInstance = null;
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
