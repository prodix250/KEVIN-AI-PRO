package com.kevinai.pro;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.net.NetworkRequest;
import android.net.Uri;
import android.os.Build;
import android.text.TextUtils;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public final class DailyNewsManager {

    private static final String TAG = "DailyNewsManager";

    public static final String ACTION_NEWS_BRIEFING_DELIVERED =
            "com.kevinai.pro.action.NEWS_BRIEFING_DELIVERED";
    public static final String EXTRA_BRIEFING_JSON = "briefing_json";
    public static final String EXTRA_SLOT_ID = "slot_id";

    private static final String TIMEZONE_KIGALI = "Africa/Kigali";
    private static final int ALARM_REQUEST_CODE = 9001;

    private static final ExecutorService executor = Executors.newSingleThreadExecutor();
    private static final AtomicBoolean isNetworkCallbackRegistered = new AtomicBoolean(false);
    private static final AtomicBoolean isChecking = new AtomicBoolean(false);
    private static long lastCheckTimestampMs = 0L;

    private DailyNewsManager() {}

    public static void init(Context context) {
        if (context == null) return;
        Context appCtx = context.getApplicationContext();

        // 1. Schedule next alarms
        scheduleNextAlarms(appCtx);

        // 2. Register network callback to immediately deliver if user connects to mobile bundle / WiFi
        registerNetworkCallback(appCtx);

        // 3. Trigger initial async check
        checkAndDeliverNewsAsync(appCtx);
    }

    public static void scheduleNextAlarms(Context context) {
        if (context == null) return;
        try {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;

            long nextTriggerMs = computeNextSlotTriggerMs();
            if (nextTriggerMs <= System.currentTimeMillis()) {
                nextTriggerMs = System.currentTimeMillis() + 60_000L;
            }

            Intent alarmIntent = new Intent(context, DailyNewsAlarmReceiver.class);
            alarmIntent.setAction(DailyNewsAlarmReceiver.ACTION_CHECK_DAILY_NEWS);

            PendingIntent pi = PendingIntent.getBroadcast(
                    context,
                    ALARM_REQUEST_CODE,
                    alarmIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                Intent showIntent = new Intent(context, MainActivity.class);
                showIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                PendingIntent showPi = PendingIntent.getActivity(
                        context,
                        ALARM_REQUEST_CODE + 1,
                        showIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );
                am.setAlarmClock(new AlarmManager.AlarmClockInfo(nextTriggerMs, showPi), pi);
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, nextTriggerMs, pi);
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, nextTriggerMs, pi);
            }

            Log.d(TAG, "Next daily news alarm scheduled at: " + nextTriggerMs
                    + " (" + new java.util.Date(nextTriggerMs) + ")");
        } catch (Throwable t) {
            Log.w(TAG, "scheduleNextAlarms failed: " + t.getMessage());
        }
    }

    public static long computeNextSlotTriggerMs() {
        TimeZone tz = TimeZone.getTimeZone(TIMEZONE_KIGALI);
        Calendar now = Calendar.getInstance(tz);

        int[][] slotHours = new int[][] {
                { 6, 0 },   // 06:00 Morning Tech
                { 12, 0 },  // 12:00 Noon World & Sports
                { 15, 0 },  // 15:00 Afternoon Football & Sports Analysis (Saa Cyenda)
                { 18, 0 }   // 18:00 Evening Tech
        };

        long earliestFuture = Long.MAX_VALUE;

        // Check slots today
        for (int[] slot : slotHours) {
            Calendar target = (Calendar) now.clone();
            target.set(Calendar.HOUR_OF_DAY, slot[0]);
            target.set(Calendar.MINUTE, slot[1]);
            target.set(Calendar.SECOND, 0);
            target.set(Calendar.MILLISECOND, 0);

            long ms = target.getTimeInMillis();
            if (ms > now.getTimeInMillis() + 1500L && ms < earliestFuture) {
                earliestFuture = ms;
            }
        }

        // Check slots tomorrow if all today have passed
        if (earliestFuture == Long.MAX_VALUE) {
            Calendar target = (Calendar) now.clone();
            target.add(Calendar.DAY_OF_YEAR, 1);
            target.set(Calendar.HOUR_OF_DAY, slotHours[0][0]);
            target.set(Calendar.MINUTE, slotHours[0][1]);
            target.set(Calendar.SECOND, 0);
            target.set(Calendar.MILLISECOND, 0);
            earliestFuture = target.getTimeInMillis();
        }

        return earliestFuture;
    }

    private static void registerNetworkCallback(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return;
        if (isNetworkCallbackRegistered.getAndSet(true)) return;

        try {
            ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return;

            NetworkRequest request = new NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build();

            cm.registerNetworkCallback(request, new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    Log.d(TAG, "Network became available — checking pending news briefings...");
                    checkAndDeliverNewsAsync(context);
                }
            });
        } catch (Throwable t) {
            Log.w(TAG, "registerNetworkCallback failed: " + t.getMessage());
        }
    }

    public static boolean isNetworkConnected(Context context) {
        try {
            ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return false;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Network network = cm.getActiveNetwork();
                if (network == null) return false;
                NetworkCapabilities caps = cm.getNetworkCapabilities(network);
                return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
            } else {
                NetworkInfo ni = cm.getActiveNetworkInfo();
                return ni != null && ni.isConnectedOrConnecting();
            }
        } catch (Throwable ignored) {
            return false;
        }
    }

    public static void checkAndDeliverNewsAsync(Context context) {
        if (context == null) return;
        Context appCtx = context.getApplicationContext();

        executor.execute(() -> {
            try {
                checkAndDeliverNewsSync(appCtx);
            } catch (Throwable t) {
                Log.w(TAG, "checkAndDeliverNewsSync error: " + t.getMessage());
            }
        });
    }

    public static synchronized void checkAndDeliverNewsSync(Context context) {
        if (context == null) return;
        long now = System.currentTimeMillis();
        if (now - lastCheckTimestampMs < 8000L) {
            return;
        }
        if (isChecking.getAndSet(true)) {
            return;
        }

        lastCheckTimestampMs = now;
        try {
            if (!isNetworkConnected(context)) {
                Log.d(TAG, "Device is offline. Will automatically check when bundle/WiFi turns on.");
                scheduleNextAlarms(context);
                return;
            }

            TimeZone tz = TimeZone.getTimeZone(TIMEZONE_KIGALI);
            Calendar cal = Calendar.getInstance(tz);

            int hour = cal.get(Calendar.HOUR_OF_DAY);
            int minute = cal.get(Calendar.MINUTE);
            int curTotalMin = hour * 60 + minute;

            String todayDate = String.format(Locale.ROOT, "%04d-%02d-%02d",
                    cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH));

            Set<String> deliveredIds = KevinAgentPrefs.getDeliveredNewsSlotIds(context);
            List<String> dueSlotIds = new ArrayList<>();

            // 06:00 Morning Tech
            if (curTotalMin >= 6 * 60) {
                String sId = todayDate + "_morning_tech";
                if (!deliveredIds.contains(sId)) {
                    dueSlotIds.add(sId);
                }
            }

            // 12:00 Noon World & Sports
            if (curTotalMin >= 12 * 60) {
                String sId = todayDate + "_noon_world";
                if (!deliveredIds.contains(sId)) {
                    dueSlotIds.add(sId);
                }
            }

            // 15:00 Afternoon Football & Sports Analysis (Saa Cyenda)
            if (curTotalMin >= 15 * 60) {
                String sId = todayDate + "_afternoon_sports_analysis";
                if (!deliveredIds.contains(sId)) {
                    dueSlotIds.add(sId);
                }
            }

            // 18:00 Evening Tech
            if (curTotalMin >= 18 * 60) {
                String sId = todayDate + "_evening_tech";
                if (!deliveredIds.contains(sId)) {
                    dueSlotIds.add(sId);
                }
            }

            // If early morning before 06:00, check if yesterday evening slot was delivered
            if (curTotalMin < 6 * 60) {
                Calendar yest = (Calendar) cal.clone();
                yest.add(Calendar.DAY_OF_YEAR, -1);
                String yestDate = String.format(Locale.ROOT, "%04d-%02d-%02d",
                        yest.get(Calendar.YEAR), yest.get(Calendar.MONTH) + 1, yest.get(Calendar.DAY_OF_MONTH));
                String yestSlot = yestDate + "_evening_tech";
                if (!deliveredIds.contains(yestSlot)) {
                    dueSlotIds.add(yestSlot);
                }
            }

            if (dueSlotIds.isEmpty()) {
                Log.d(TAG, "All scheduled slots are currently up to date.");
                scheduleNextAlarms(context);
                return;
            }

            Log.d(TAG, "Due undelivered slots found: " + dueSlotIds + " — requesting sync from backend...");

            String baseUrl = KevinAgentPrefs.getEffectiveBackendBaseUrl(context);
            String syncUrl = baseUrl + "/api/news-briefings/sync";

            JSONObject requestBody = new JSONObject();
            JSONArray deliveredArr = new JSONArray();
            for (String id : deliveredIds) {
                deliveredArr.put(id);
            }
            requestBody.put("deliveredIds", deliveredArr);

            List<String> apiKeys = KevinAgentPrefs.getApiKeysList(context);
            if (!apiKeys.isEmpty()) {
                JSONArray keysArr = new JSONArray();
                for (String k : apiKeys) {
                    keysArr.put(k);
                }
                requestBody.put("customApiKeys", keysArr);
            }

            HttpURLConnection conn = null;
            try {
                URL url = new URL(syncUrl);
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(14_000);
                conn.setReadTimeout(20_000);
                conn.setDoInput(true);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                conn.setRequestProperty("User-Agent", "KevinAI-Android-DailyNews/1.0");

                byte[] postBytes = requestBody.toString().getBytes(StandardCharsets.UTF_8);
                conn.setFixedLengthStreamingMode(postBytes.length);

                try (OutputStream os = conn.getOutputStream()) {
                    os.write(postBytes);
                    os.flush();
                }

                int respCode = conn.getResponseCode();
                if (respCode == HttpURLConnection.HTTP_OK) {
                    InputStream is = conn.getInputStream();
                    BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) {
                        sb.append(line);
                    }
                    reader.close();

                    JSONObject resObj = new JSONObject(sb.toString());
                    JSONArray briefings = resObj.optJSONArray("briefings");
                    if (briefings != null && briefings.length() > 0) {
                        for (int i = 0; i < briefings.length(); i++) {
                            JSONObject b = briefings.optJSONObject(i);
                            if (b == null) continue;
                            String slotId = b.optString("slotId", "");
                            String title = b.optString("title", "Kevin AI: Amakuru Mashya");
                            String preview = b.optString("preview", "");
                            String body = b.optString("body", "");

                            if (TextUtils.isEmpty(slotId) || TextUtils.isEmpty(body)) continue;

                            // Mark delivered & store pending
                            KevinAgentPrefs.markNewsSlotDelivered(context, slotId);
                            KevinAgentPrefs.addPendingNewsBriefing(context, b);

                            // Trigger Heads-Up pop-up notification
                            showHeadsUpNewsNotification(context, title, preview, slotId, b.toString());

                            // Broadcast to active activity
                            Intent deliveredIntent = new Intent(ACTION_NEWS_BRIEFING_DELIVERED);
                            deliveredIntent.putExtra(EXTRA_SLOT_ID, slotId);
                            deliveredIntent.putExtra(EXTRA_BRIEFING_JSON, b.toString());
                            context.sendBroadcast(deliveredIntent);
                        }
                    }
                } else {
                    Log.w(TAG, "Backend sync returned HTTP " + respCode);
                }
            } catch (Throwable netErr) {
                Log.w(TAG, "Backend sync connection error: " + netErr.getMessage());
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }

            // Reschedule next alarms
            scheduleNextAlarms(context);

        } catch (Throwable t) {
            Log.e(TAG, "checkAndDeliverNewsSync unhandled: " + t.getMessage(), t);
        } finally {
            isChecking.set(false);
        }
    }

    public static void showHeadsUpNewsNotification(
            Context context,
            String title,
            String preview,
            String slotId,
            String briefingJson
    ) {
        if (context == null) return;
        try {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            String channelId = KevinAgentBridge.NEWS_CHANNEL_ID;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel channel = new NotificationChannel(
                        channelId,
                        "Kevin AI Daily News & Briefings",
                        NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("Amakuru agezweho ya Kevin AI (06:00 Tech, 12:00 Isi & Sport, 15:00 Ubusesenguzi bwa Siporo, 18:00 Tech)");
                channel.enableVibration(true);
                channel.setVibrationPattern(new long[]{0, 300, 150, 300});
                channel.enableLights(true);
                channel.setLightColor(Color.parseColor("#10b981"));
                channel.setShowBadge(true);
                channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

                Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                AudioAttributes audioAttributes = new AudioAttributes.Builder()
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_COMMUNICATION_INSTANT)
                        .build();
                channel.setSound(soundUri, audioAttributes);

                nm.createNotificationChannel(channel);
            }

            Intent openIntent = new Intent(context, MainActivity.class);
            openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            openIntent.putExtra("from_news_slot", slotId);
            openIntent.putExtra("from_news_briefing_json", briefingJson);

            int reqCode = Math.abs((slotId != null ? slotId : "daily_news").hashCode());
            PendingIntent pendingIntent = PendingIntent.getActivity(
                    context,
                    reqCode,
                    openIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            NotificationCompat.BigTextStyle bigStyle = new NotificationCompat.BigTextStyle()
                    .setBigContentTitle(!TextUtils.isEmpty(title) ? title : "Kevin AI: Amakuru Mashya")
                    .bigText(!TextUtils.isEmpty(preview) ? preview : "Kanda hano usome amakuru mashya muri Kevin AI.");

            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
                    .setSmallIcon(com.kevinai.pro.R.mipmap.ic_launcher)
                    .setContentTitle(!TextUtils.isEmpty(title) ? title : "Kevin AI: Amakuru Mashya")
                    .setContentText(!TextUtils.isEmpty(preview) ? preview : "Amakuru mashya agezweho kuri ubu.")
                    .setStyle(bigStyle)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                    .setAutoCancel(true)
                    .setOngoing(false)
                    .setContentIntent(pendingIntent)
                    .setFullScreenIntent(pendingIntent, false)
                    .setVibrate(new long[]{0, 300, 150, 300})
                    .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
                    .setDefaults(Notification.DEFAULT_ALL)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

            nm.notify(reqCode, builder.build());
            Log.d(TAG, "Heads-Up notification posted for slot: " + slotId);
        } catch (Throwable t) {
            Log.w(TAG, "showHeadsUpNewsNotification failed: " + t.getMessage());
        }
    }
}
