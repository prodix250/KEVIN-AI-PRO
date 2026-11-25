package com.kevinai.pro;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.PowerManager;
import android.util.Log;

public class DailyNewsAlarmReceiver extends BroadcastReceiver {

    private static final String TAG = "DailyNewsAlarmReceiver";
    public static final String ACTION_CHECK_DAILY_NEWS = "com.kevinai.pro.action.CHECK_DAILY_NEWS";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null) return;
        String action = intent != null ? intent.getAction() : null;
        Log.d(TAG, "DailyNewsAlarmReceiver onReceive action: " + action);

        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        PowerManager.WakeLock wakeLock = null;
        if (pm != null) {
            try {
                wakeLock = pm.newWakeLock(
                        PowerManager.PARTIAL_WAKE_LOCK,
                        "KevinAI:DailyNewsWakeLock"
                );
                wakeLock.acquire(30_000L); // 30 seconds max
            } catch (Throwable ignored) {}
        }

        final PowerManager.WakeLock finalLock = wakeLock;
        try {
            // Check due news and deliver
            DailyNewsManager.checkAndDeliverNewsAsync(context);

            // Re-schedule next alarm
            DailyNewsManager.scheduleNextAlarms(context);
        } finally {
            if (finalLock != null) {
                new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                    try {
                        if (finalLock.isHeld()) {
                            finalLock.release();
                        }
                    } catch (Throwable ignored) {}
                }, 5000L);
            }
        }
    }
}
