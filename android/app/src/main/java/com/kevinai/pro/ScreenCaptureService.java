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
    private static volatile long cleanCaptureReadyAtMs = 0L;
    private static volatile String fallbackCleanFrame = null;

    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private boolean framePending;
    private long lastFrameAt;

    public static void setSuppressOverlayFrames(boolean suppress) {
        suppressOverlayFrames = suppress;
    }

    public static void beginCleanCaptureWindow(long readyDelayMs) {
        fallbackCleanFrame = null;
        cleanCaptureReadyAtMs = SystemClock.uptimeMillis() + Math.max(0L, readyDelayMs);
        cleanCaptureWindowActive = true;
    }

    @Nullable
    public static String finishCleanCaptureWindow() {
        cleanCaptureWindowActive = false;
        String frame = fallbackCleanFrame;
        fallbackCleanFrame = null;
        return frame;
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
                String encoded = encodeImageToBase64(image);
                long nowUptime = SystemClock.uptimeMillis();
                if (nowUptime >= cleanCaptureReadyAtMs) {
                    cleanCaptureWindowActive = false;
                    suppressOverlayFrames = true;
                    fallbackCleanFrame = null;
                    lastFrameAt = System.currentTimeMillis();

                    Intent cleanIntent = new Intent(ACTION_CLEAN_FRAME_CAPTURED);
                    cleanIntent.setPackage(getPackageName());
                    cleanIntent.putExtra(EXTRA_FRAME, encoded);
                    sendBroadcast(cleanIntent);
                } else {
                    fallbackCleanFrame = encoded;
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
        fallbackCleanFrame = null;
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
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
