package com.kevinai.pro;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentResolver;
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
import android.os.Handler;
import android.os.Looper;
import android.service.notification.StatusBarNotification;
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
    private static final String NEWS_SHADE_CHANNEL_ID = "kevin_daily_news_shade";
    private static final long HEADS_UP_DURATION_MS = 3200L;
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
                { 18, 0 },  // 18:00 Evening Tech
                { 20, 0 }   // 20:00 Evening Rwanda Regional News (Saa Mbiri)
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

            // 20:00 Evening Rwanda Regional News (Saa Mbiri)
            if (curTotalMin >= 20 * 60) {
                String sId = todayDate + "_evening_rwanda";
                if (!deliveredIds.contains(sId)) {
                    dueSlotIds.add(sId);
                }
            }

            // If early morning before 06:00, check if yesterday late slots were delivered
            if (curTotalMin < 6 * 60) {
                Calendar yest = (Calendar) cal.clone();
                yest.add(Calendar.DAY_OF_YEAR, -1);
                String yestDate = String.format(Locale.ROOT, "%04d-%02d-%02d",
                        yest.get(Calendar.YEAR), yest.get(Calendar.MONTH) + 1, yest.get(Calendar.DAY_OF_MONTH));
                String yestTechSlot = yestDate + "_evening_tech";
                if (!deliveredIds.contains(yestTechSlot)) {
                    dueSlotIds.add(yestTechSlot);
                }
                String yestRwandaSlot = yestDate + "_evening_rwanda";
                if (!deliveredIds.contains(yestRwandaSlot)) {
                    dueSlotIds.add(yestRwandaSlot);
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

            String newsCustomInstructions = KevinAgentPrefs.getNewsCustomInstructions(context);
            if (!TextUtils.isEmpty(newsCustomInstructions)) {
                requestBody.put("newsCustomInstructions", newsCustomInstructions);
            }

            Set<String> backendDeliveredSlots = new java.util.HashSet<>();
            HttpURLConnection conn = null;
            try {
                URL url = new URL(syncUrl);
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(25_000);
                conn.setReadTimeout(45_000);
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

                            backendDeliveredSlots.add(slotId);
                            deliverSingleBriefingNative(context, slotId, title, preview, b);
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

            // Direct on-device fallback for any due slots that backend failed/timed out/missed
            if (!apiKeys.isEmpty()) {
                for (String missingSlotId : dueSlotIds) {
                    if (backendDeliveredSlots.contains(missingSlotId)) continue;
                    if (KevinAgentPrefs.isNewsSlotDelivered(context, missingSlotId)) continue;
                    try {
                        JSONObject directBriefing = generateBriefingDirectlyNative(
                                missingSlotId,
                                apiKeys,
                                newsCustomInstructions
                        );
                        if (directBriefing != null) {
                            String slotId = directBriefing.optString("slotId", "");
                            String title = directBriefing.optString("title", "Kevin AI: Amakuru Mashya");
                            String preview = directBriefing.optString("preview", "");
                            String body = directBriefing.optString("body", "");
                            if (!TextUtils.isEmpty(slotId) && !TextUtils.isEmpty(body)) {
                                deliverSingleBriefingNative(context, slotId, title, preview, directBriefing);
                            }
                        }
                    } catch (Throwable directErr) {
                        Log.w(TAG, "Direct news fallback failed for " + missingSlotId + ": " + directErr.getMessage());
                    }
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

    public static boolean showHeadsUpNewsNotification(
            Context context,
            String title,
            String preview,
            String slotId,
            String briefingJson
    ) {
        if (context == null) return false;
        try {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return false;

            boolean notificationsEnabled = Build.VERSION.SDK_INT < Build.VERSION_CODES.N || nm.areNotificationsEnabled();

            String channelId = KevinAgentBridge.NEWS_CHANNEL_ID;

            String safeTitle = !TextUtils.isEmpty(title) ? title : "Kevin AI: Amakuru Mashya";
            String safePreview = !TextUtils.isEmpty(preview) ? preview : "Amakuru mashya agezweho kuri ubu.";
            String safeBigText = !TextUtils.isEmpty(preview) ? preview : "Kanda hano usome amakuru mashya muri Kevin AI.";
            long postedAtMs = System.currentTimeMillis();

            int whistleResId = context.getResources().getIdentifier(
                    "kevin_news_whistle",
                    "raw",
                    context.getPackageName()
            );
            Uri customSoundUri = whistleResId != 0
                    ? Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + context.getPackageName() + "/" + whistleResId)
                    : RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                try {
                    nm.deleteNotificationChannel("kevin_daily_news");
                } catch (Throwable ignored) {}

                NotificationChannel channel = new NotificationChannel(
                        channelId,
                        "Kevin AI Daily News & Briefings",
                        NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("Amakuru agezweho ya Kevin AI (06:00 Tech, 12:00 Isi & Sport, 15:00 Ubusesenguzi bwa Siporo, 18:00 Tech, 20:00 Rwanda)");
                channel.enableVibration(true);
                channel.setVibrationPattern(new long[]{0, 260, 120, 260});
                channel.enableLights(true);
                channel.setLightColor(Color.parseColor("#10b981"));
                channel.setShowBadge(true);
                channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

                AudioAttributes audioAttributes = new AudioAttributes.Builder()
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .build();
                channel.setSound(customSoundUri, audioAttributes);
                nm.createNotificationChannel(channel);

                NotificationChannel shadeChannel = new NotificationChannel(
                        NEWS_SHADE_CHANNEL_ID,
                        "Kevin AI News Notification Panel",
                        NotificationManager.IMPORTANCE_DEFAULT
                );
                shadeChannel.setDescription("Amakuru abikwa muri notification panel nyuma yo kwigaragaza hejuru");
                shadeChannel.enableVibration(false);
                shadeChannel.setSound(null, null);
                shadeChannel.setShowBadge(true);
                shadeChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                nm.createNotificationChannel(shadeChannel);
            }

            Intent openIntent = new Intent(context, MainActivity.class);
            openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            openIntent.putExtra("from_news_slot", slotId);
            if (!TextUtils.isEmpty(briefingJson)) {
                openIntent.putExtra("from_news_briefing_json", briefingJson);
            }

            final int reqCode = Math.abs((slotId != null ? slotId : "daily_news").hashCode());
            PendingIntent pendingIntent = PendingIntent.getActivity(
                    context,
                    reqCode,
                    openIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            NotificationCompat.BigTextStyle bigStyle = new NotificationCompat.BigTextStyle()
                    .setBigContentTitle(safeTitle)
                    .bigText(safeBigText);

            NotificationCompat.Builder headsUpBuilder = new NotificationCompat.Builder(context, channelId)
                    .setSmallIcon(com.kevinai.pro.R.mipmap.ic_launcher)
                    .setContentTitle(safeTitle)
                    .setContentText(safePreview)
                    .setStyle(bigStyle)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                    .setWhen(postedAtMs)
                    .setShowWhen(true)
                    .setAutoCancel(true)
                    .setOngoing(false)
                    .setContentIntent(pendingIntent)
                    .setVibrate(new long[]{0, 260, 120, 260})
                    .setSound(customSoundUri)
                    .setDefaults(Notification.DEFAULT_LIGHTS | Notification.DEFAULT_VIBRATE)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

            nm.notify(reqCode, headsUpBuilder.build());
            Log.d(TAG, "Heads-Up notification posted for slot: " + slotId + " with custom whistle sound (auto-collapses in " + HEADS_UP_DURATION_MS + "ms)");

            // After ~3 seconds (3.2s), collapse the floating heads-up banner into the notification panel silently
            final Context appCtx = context.getApplicationContext();
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                try {
                    NotificationManager delayedNm = (NotificationManager) appCtx.getSystemService(Context.NOTIFICATION_SERVICE);
                    if (delayedNm == null) return;

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        boolean stillActive = false;
                        for (StatusBarNotification sbn : delayedNm.getActiveNotifications()) {
                            if (sbn.getId() == reqCode) {
                                stillActive = true;
                                break;
                            }
                        }
                        if (!stillActive) return;
                    }

                    NotificationCompat.Builder shadeBuilder = new NotificationCompat.Builder(appCtx, NEWS_SHADE_CHANNEL_ID)
                            .setSmallIcon(com.kevinai.pro.R.mipmap.ic_launcher)
                            .setContentTitle(safeTitle)
                            .setContentText(safePreview)
                            .setStyle(new NotificationCompat.BigTextStyle().setBigContentTitle(safeTitle).bigText(safeBigText))
                            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                            .setWhen(postedAtMs)
                            .setShowWhen(true)
                            .setAutoCancel(true)
                            .setOngoing(false)
                            .setSilent(true)
                            .setOnlyAlertOnce(true)
                            .setDefaults(0)
                            .setContentIntent(pendingIntent)
                            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

                    delayedNm.notify(reqCode, shadeBuilder.build());
                } catch (Throwable ignored) {}
            }, HEADS_UP_DURATION_MS);

            return notificationsEnabled;
        } catch (Throwable t) {
            Log.w(TAG, "showHeadsUpNewsNotification failed: " + t.getMessage());
            return false;
        }
    }

    private static void deliverSingleBriefingNative(
            Context context,
            String slotId,
            String title,
            String preview,
            JSONObject briefingObj
    ) {
        KevinAgentPrefs.markNewsSlotDelivered(context, slotId);
        KevinAgentPrefs.addPendingNewsBriefing(context, briefingObj);
        showHeadsUpNewsNotification(context, title, preview, slotId, briefingObj.toString());

        Intent deliveredIntent = new Intent(ACTION_NEWS_BRIEFING_DELIVERED);
        deliveredIntent.putExtra(EXTRA_SLOT_ID, slotId);
        deliveredIntent.putExtra(EXTRA_BRIEFING_JSON, briefingObj.toString());
        context.sendBroadcast(deliveredIntent);
    }

    private static JSONObject generateBriefingDirectlyNative(
            String slotId,
            List<String> apiKeys,
            String cleanCustomNews
    ) {
        int sepIdx = slotId.indexOf('_');
        if (sepIdx <= 0 || sepIdx >= slotId.length() - 1) return null;
        String kigaliDate = slotId.substring(0, sepIdx);
        String slotKey = slotId.substring(sepIdx + 1);

        String scheduledLabel;
        String titleRw;
        String emoji;
        String category;
        String[] rssUrls;
        if ("morning_tech".equals(slotKey)) {
            scheduledLabel = "06:00";
            titleRw = "Amakuru y'Ikoranabuhanga & AI (Mugitondo)";
            emoji = "☀️💻";
            category = "tech_ai";
            rssUrls = new String[] {
                    "https://news.google.com/rss/search?q=(%22artificial+intelligence%22+OR+OpenAI+OR+Google+AI+OR+Anthropic+OR+new+AI+model)+when:1d&hl=en&gl=US&ceid=US:en",
                    "https://news.google.com/rss/search?q=(technology+news+OR+Apple+OR+Microsoft+OR+Nvidia+OR+Meta+OR+cybersecurity)+when:1d&hl=en&gl=US&ceid=US:en"
            };
        } else if ("noon_world".equals(slotKey)) {
            scheduledLabel = "12:00";
            titleRw = "Amakuru y'Isi & Imikino (Saa Sita)";
            emoji = "🌍⚽";
            category = "world_sports";
            rssUrls = new String[] {
                    "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en",
                    "https://news.google.com/rss/search?q=(Rwanda+OR+Africa+OR+world+breaking+news+OR+football+OR+Premier+League)+when:1d&hl=en&gl=RW&ceid=RW:en"
            };
        } else if ("afternoon_sports_analysis".equals(slotKey)) {
            scheduledLabel = "15:00";
            titleRw = "Ubusesenguzi bw'Amakipe & Imikino yo ku Isi (Saa Cyenda)";
            emoji = "⚽📊";
            category = "sports_analysis";
            rssUrls = new String[] {
                    "https://news.google.com/rss/search?q=(%22tactical+analysis%22+OR+%22football+analysis%22+OR+%22Premier+League%22+OR+%22Champions+League%22+OR+%22Real+Madrid%22+OR+%22Barcelona%22+OR+%22Arsenal%22)+when:1d&hl=en&gl=US&ceid=US:en",
                    "https://news.google.com/rss/search?q=(football+tactics+OR+club+analysis+OR+transfer+analysis)+when:1d&hl=en&gl=GB&ceid=GB:en"
            };
        } else if ("evening_rwanda".equals(slotKey)) {
            scheduledLabel = "20:00";
            titleRw = "Amakuru yo mu Rwanda Hirya no Hino (Saa Mbiri)";
            emoji = "🇷🇼📰";
            category = "rwanda_news";
            rssUrls = new String[] {
                    "https://news.google.com/rss/search?q=(Rwanda+OR+Kigali+OR+Musanze+OR+Rubavu+OR+Huye+OR+Rusizi+OR+Nyagatare+OR+Muhanga+OR+Rwamagana)+when:1d&hl=en&gl=RW&ceid=RW:en",
                    "https://news.google.com/rss/search?q=(Rwanda+news+OR+IGIHE+OR+%22Kigali+Today%22+OR+RBA+OR+%22New+Times+Rwanda%22)+when:1d&hl=en&gl=RW&ceid=RW:en"
            };
        } else {
            scheduledLabel = "18:00";
            titleRw = "Ibyiriwe mu Ikoranabuhanga & AI (Nimugoroba)";
            emoji = "🌆🤖";
            category = "tech_ai";
            rssUrls = new String[] {
                    "https://news.google.com/rss/search?q=(%22artificial+intelligence%22+OR+OpenAI+OR+Google+AI+OR+Anthropic+OR+AI+release)+when:1d&hl=en&gl=US&ceid=US:en",
                    "https://news.google.com/rss/search?q=(technology+news+OR+software+update+OR+Apple+OR+Microsoft+OR+Nvidia+OR+Meta)+when:1d&hl=en&gl=US&ceid=US:en"
            };
        }

        List<String[]> articles = new ArrayList<>();
        Set<String> seenUrls = new java.util.HashSet<>();
        for (String rssUrl : rssUrls) {
            fetchRssItemsNative(rssUrl, articles, seenUrls, 10);
            if (articles.size() >= 10) break;
        }

        StringBuilder articlesBlock = new StringBuilder();
        JSONArray sourcesArr = new JSONArray();
        for (int i = 0; i < Math.min(10, articles.size()); i++) {
            String[] a = articles.get(i);
            articlesBlock.append(i + 1).append(". \"").append(a[0]).append("\"");
            if (!TextUtils.isEmpty(a[2])) {
                articlesBlock.append(" (").append(a[2]).append(")");
            }
            articlesBlock.append(" — ").append(a[1]).append("\n");
            try {
                JSONObject src = new JSONObject();
                src.put("title", TextUtils.isEmpty(a[2]) ? a[0] : (a[2] + ": " + a[0]));
                src.put("url", a[1]);
                sourcesArr.put(src);
            } catch (Exception ignored) {}
        }

        String customNote = !TextUtils.isEmpty(cleanCustomNews)
                ? "\n\nUSER CUSTOM INSTRUCTION NEWS (PREFERENCES):\n" + cleanCustomNews
                + "\n- Prioritize requested topics ONLY when verified fresh articles exist; NEVER fabricate facts and NEVER say 'Nta makuru mashya ahari' when verified articles exist."
                : "";

        String sysPrompt = "You are Kevin AI, Rwanda's intelligent assistant created by Uwumukiza Kevin.\n"
                + "Write a scheduled WhatsApp-style daily news briefing in authentic, fluent Rwandan Kinyarwanda (date: " + kigaliDate + ").\n"
                + "STRICT FRESHNESS & TRUTHFULNESS RULE: ONLY report genuinely fresh real news from the verified sources provided (or live Google Search grounding). NEVER invent, guess, or fabricate facts, scores, or quotes. Format with 4 to 6 crisp bullet points (bold title + 1-2 short factual sentences) and friendly emojis."
                + customNote;

        String slotPrompt;
        if ("morning_tech".equals(slotKey)) {
            slotPrompt = "Tangira uti: \"Mwaramutse neza! ☀️💻 Dore amakuru mashya y'ikoranabuhanga na AI yavugwaga muri iri joro ku isi:\"\nTanga inkuru 4-6 z'ukuri z'ikoranabuhanga na AI.";
        } else if ("noon_world".equals(slotKey)) {
            slotPrompt = "Tangira uti: \"Mwiriwe neza! 🌍⚽ Dore amakuru mashya y'isi n'imikino (Sport) agezweho kuri uyu munsi saa sita:\"\nHATARIMO ikoranabuhanga/AI; vuga imikino, ubukungu, politiki n'amakuru yo mu Rwanda, Afurika n'isi.";
        } else if ("afternoon_sports_analysis".equals(slotKey)) {
            slotPrompt = "Tangira uti: \"Mwiriwe neza! ⚽📊 Dore ubusesenguzi bwimbitse bw'amakipe n'imikino yo ku isi (by'umwihariko ku mugabane w'Uburayi) bwiriwe buvugwa uyu munsi:\"\nTanga ubusesenguzi nyabwo bw'imikinire, ingamba z'abatoza n'isoko ry'abakinnyi cyane cyane i Burayi n'iyindi migabane.";
        } else if ("evening_rwanda".equals(slotKey)) {
            slotPrompt = "Tangira uti: \"Mwiriwe neza! 🇷🇼📰 Dore amakuru mashya yo mu Rwanda hose n'uko byiriwe byifashe hirya no hino mu duce tw'igihugu uyu munsi:\"\nIbanze ku makuru mashya y'ukuri yiriwe avugwa mu Mujyi wa Kigali no mu ntara zose z'u Rwanda.";
        } else {
            slotPrompt = "Tangira uti: \"Mwiriwe neza! 🌆🤖 Dore amakuru mashya y'ikoranabuhanga na AI yiriwe avugwa uyu munsi ku isi:\"\nTanga inkuru 4-6 z'ukuri z'ibyiriwe bivugwa mu ikoranabuhanga na AI.";
        }

        String fullPrompt = slotPrompt + "\n\nAMAKURU MASHYA YABONETSE KURI INTERNET:\n"
                + (articlesBlock.length() > 0 ? articlesBlock.toString() : "(Use live Google Search grounding for today's breaking news only.)");

        String[] models = new String[] { "gemini-3.5-flash-lite", "gemini-4-hydrogen", "gemini-3.1-flash-lite", "gemini-2.5-flash" };
        boolean useSearchFirst = articles.size() < 3;
        boolean[] searchModes = useSearchFirst ? new boolean[] { true, false } : new boolean[] { false, true };

        for (boolean withSearch : searchModes) {
            if (!withSearch && articles.isEmpty()) continue;
            for (String model : models) {
                for (String key : apiKeys) {
                    String generated = callGeminiGenerateNative(model, key, sysPrompt, fullPrompt, withSearch);
                    if (!TextUtils.isEmpty(generated) && generated.length() >= 40) {
                        if (articles.size() >= 3 && generated.length() < 520
                                && generated.toLowerCase(Locale.ROOT).contains("nta makuru")) {
                            continue;
                        }
                        try {
                            String cleanPreview = generated
                                    .replaceAll("\\[([^\\]]+)\\]\\([^)]+\\)", "$1")
                                    .replaceAll("[*_`#>]", "")
                                    .replaceAll("\\s+", " ")
                                    .trim();
                            if (cleanPreview.length() > 140) {
                                cleanPreview = cleanPreview.substring(0, 137) + "...";
                            }
                            JSONObject out = new JSONObject();
                            out.put("slotId", slotId);
                            out.put("kigaliDate", kigaliDate);
                            out.put("slotKey", slotKey);
                            out.put("scheduledLabel", scheduledLabel);
                            out.put("title", emoji + " " + titleRw);
                            out.put("preview", cleanPreview);
                            out.put("body", generated);
                            out.put("sources", sourcesArr);
                            out.put("generatedAtMs", System.currentTimeMillis());
                            out.put("scheduledAtMs", System.currentTimeMillis());
                            out.put("category", category);
                            return out;
                        } catch (Exception ignored) {}
                    }
                }
            }
        }
        return null;
    }

    private static void fetchRssItemsNative(
            String rssUrl,
            List<String[]> out,
            Set<String> seenUrls,
            int maxTotal
    ) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(rssUrl).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(4500);
            conn.setReadTimeout(5000);
            conn.setRequestMethod("GET");
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36");
            if (conn.getResponseCode() < 200 || conn.getResponseCode() >= 300) return;
            BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line).append('\n');
                if (sb.length() > 220_000) break;
            }
            reader.close();
            String xml = sb.toString();
            java.util.regex.Matcher itemMatcher = java.util.regex.Pattern.compile("<item>([\\s\\S]*?)</item>").matcher(xml);
            while (itemMatcher.find() && out.size() < maxTotal) {
                String block = itemMatcher.group(1);
                String t = extractXmlTag(block, "title");
                String u = extractXmlTag(block, "link");
                String s = extractXmlTag(block, "source");
                if (!TextUtils.isEmpty(t) && !TextUtils.isEmpty(u) && seenUrls.add(u)) {
                    out.add(new String[] { t, u, s });
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String extractXmlTag(String xml, String tag) {
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">").matcher(xml);
        if (!m.find()) return "";
        String val = m.group(1);
        return val
                .replaceAll("<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>", "$1")
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replace("&apos;", "'")
                .trim();
    }

    private static String callGeminiGenerateNative(
            String model,
            String apiKey,
            String systemPrompt,
            String userPrompt,
            boolean withGoogleSearch
    ) {
        HttpURLConnection conn = null;
        try {
            String endpoint = "https://generativelanguage.googleapis.com/v1beta/models/"
                    + model + ":generateContent?key=" + Uri.encode(apiKey);
            JSONObject payload = new JSONObject();
            payload.put("systemInstruction", new JSONObject().put("parts", new JSONArray().put(new JSONObject().put("text", systemPrompt))));
            payload.put("contents", new JSONArray().put(new JSONObject()
                    .put("role", "user")
                    .put("parts", new JSONArray().put(new JSONObject().put("text", userPrompt)))));
            if (withGoogleSearch) {
                payload.put("tools", new JSONArray().put(new JSONObject().put("google_search", new JSONObject())));
            }
            conn = (HttpURLConnection) new URL(endpoint).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(7000);
            conn.setReadTimeout(12000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(bytes);
                os.flush();
            }
            if (conn.getResponseCode() < 200 || conn.getResponseCode() >= 300) {
                return "";
            }
            BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line);
            }
            reader.close();
            JSONObject res = new JSONObject(sb.toString());
            JSONArray candidates = res.optJSONArray("candidates");
            if (candidates == null || candidates.length() == 0) return "";
            JSONObject content = candidates.getJSONObject(0).optJSONObject("content");
            if (content == null) return "";
            JSONArray parts = content.optJSONArray("parts");
            if (parts == null) return "";
            StringBuilder out = new StringBuilder();
            for (int i = 0; i < parts.length(); i++) {
                String txt = parts.getJSONObject(i).optString("text", "");
                if (!TextUtils.isEmpty(txt)) out.append(txt);
            }
            return out.toString().trim();
        } catch (Exception ignored) {
            return "";
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
