package com.kevinai.pro;

import android.content.Context;
import android.content.SharedPreferences;
import android.text.TextUtils;

public final class KevinAgentPrefs {
    public static final String DEFAULT_BACKEND_BASE_URL =
            "https://kevin-ai-pro.onrender.com";

    private static final String PREFS_NAME = "kevin_agent_prefs";
    private static final String KEY_AUTO_SEND_ENABLED = "auto_send_enabled";
    private static final String KEY_WA_AUTO_REPLY_ENABLED = "wa_auto_reply_enabled";
    private static final String KEY_WA_REPLY_STYLE = "wa_reply_style";
    private static final String KEY_USER_NAME = "user_name";
    private static final String KEY_BACKEND_BASE_URL = "backend_base_url";
    private static final String KEY_API_KEYS_JSON = "api_keys_json";
    private static final String KEY_AUTO_LIVE_SCREEN_ON_HOME = "auto_live_screen_on_home";
    private static final String KEY_WAKE_WORD_ENABLED = "wake_word_enabled";
    private static final String KEY_PENDING_WA_UNTIL = "pending_wa_until";
    private static final String KEY_PENDING_WA_SCAN_UNTIL = "pending_wa_scan_until";
    private static final String KEY_WA_SCAN_REPLIED_COUNT = "wa_scan_replied_count";
    private static final String KEY_WA_RECENT_REPLIED_JSON = "wa_recent_replied_json";
    private static final String KEY_PENDING_YT_UNTIL = "pending_yt_until";

    private KevinAgentPrefs() {}

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public static void setAgentConfig(
            Context context,
            boolean autoSendEnabled,
            boolean waAutoReplyEnabled,
            String replyStyle,
            String userName,
            String backendBaseUrl
    ) {
        prefs(context).edit()
                .putBoolean(KEY_AUTO_SEND_ENABLED, autoSendEnabled)
                .putBoolean(KEY_WA_AUTO_REPLY_ENABLED, waAutoReplyEnabled)
                .putString(KEY_WA_REPLY_STYLE, replyStyle != null ? replyStyle : "")
                .putString(KEY_USER_NAME, userName != null ? userName : "Kevin")
                .putString(KEY_BACKEND_BASE_URL, backendBaseUrl != null ? backendBaseUrl : "")
                .apply();
    }

    public static void setApiKeysJson(Context context, String keysJson) {
        prefs(context).edit()
                .putString(KEY_API_KEYS_JSON, keysJson != null ? keysJson : "[]")
                .apply();
    }

    public static java.util.List<String> getApiKeysList(Context context) {
        java.util.List<String> list = new java.util.ArrayList<>();
        String raw = prefs(context).getString(KEY_API_KEYS_JSON, "[]");
        if (TextUtils.isEmpty(raw)) return list;
        try {
            org.json.JSONArray arr = new org.json.JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                String k = arr.optString(i, "").trim();
                if (!TextUtils.isEmpty(k) && !list.contains(k)) {
                    list.add(k);
                }
            }
        } catch (Exception ignored) {}
        return list;
    }

    public static boolean isAutoSendEnabled(Context context) {
        return prefs(context).getBoolean(KEY_AUTO_SEND_ENABLED, false);
    }

    public static boolean isWhatsAppAutoReplyEnabled(Context context) {
        return prefs(context).getBoolean(KEY_WA_AUTO_REPLY_ENABLED, false);
    }

    public static String getWhatsAppReplyStyle(Context context) {
        return prefs(context).getString(KEY_WA_REPLY_STYLE, "");
    }

    public static String getUserName(Context context) {
        return prefs(context).getString(KEY_USER_NAME, "Kevin");
    }

    public static String getBackendBaseUrl(Context context) {
        return prefs(context).getString(KEY_BACKEND_BASE_URL, "");
    }

    public static String getEffectiveBackendBaseUrl(Context context) {
        String saved = getBackendBaseUrl(context);
        if (!TextUtils.isEmpty(saved)) {
            String trimmed = saved.trim();
            if ((trimmed.startsWith("http://") || trimmed.startsWith("https://"))
                    && !trimmed.contains("://localhost")
                    && !trimmed.contains("://127.0.0.1")
                    && !trimmed.contains("ais-pre-bup3wt53tqo6n2xr3ho7st")) {
                return trimmed.endsWith("/") ? trimmed.substring(0, trimmed.length() - 1) : trimmed;
            }
        }
        return DEFAULT_BACKEND_BASE_URL;
    }

    public static void setAutoLiveScreenOnHome(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(KEY_AUTO_LIVE_SCREEN_ON_HOME, enabled).apply();
    }

    public static boolean isAutoLiveScreenOnHome(Context context) {
        return prefs(context).getBoolean(KEY_AUTO_LIVE_SCREEN_ON_HOME, true);
    }

    public static void setWakeWordEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(KEY_WAKE_WORD_ENABLED, enabled).apply();
    }

    public static boolean isWakeWordEnabled(Context context) {
        return prefs(context).getBoolean(KEY_WAKE_WORD_ENABLED, true);
    }

    public static void armPendingWhatsAppSend(Context context, long durationMs) {
        prefs(context).edit()
                .putLong(KEY_PENDING_WA_UNTIL, System.currentTimeMillis() + durationMs)
                .apply();
    }

    public static boolean isPendingWhatsAppSend(Context context) {
        long until = prefs(context).getLong(KEY_PENDING_WA_UNTIL, 0L);
        return until > System.currentTimeMillis();
    }

    public static void clearPendingWhatsAppSend(Context context) {
        prefs(context).edit().putLong(KEY_PENDING_WA_UNTIL, 0L).apply();
    }

    public static void armPendingYouTubePlay(Context context, long durationMs) {
        prefs(context).edit()
                .putLong(KEY_PENDING_YT_UNTIL, System.currentTimeMillis() + durationMs)
                .apply();
    }

    public static boolean isPendingYouTubePlay(Context context) {
        long until = prefs(context).getLong(KEY_PENDING_YT_UNTIL, 0L);
        return until > System.currentTimeMillis();
    }

    public static void clearPendingYouTubePlay(Context context) {
        prefs(context).edit().putLong(KEY_PENDING_YT_UNTIL, 0L).apply();
    }

    public static void armWhatsAppScan(Context context, long durationMs) {
        prefs(context).edit()
                .putLong(KEY_PENDING_WA_SCAN_UNTIL, System.currentTimeMillis() + durationMs)
                .putInt(KEY_WA_SCAN_REPLIED_COUNT, 0)
                .apply();
    }

    public static boolean isWhatsAppScanActive(Context context) {
        long until = prefs(context).getLong(KEY_PENDING_WA_SCAN_UNTIL, 0L);
        return until > System.currentTimeMillis();
    }

    public static void clearWhatsAppScan(Context context) {
        prefs(context).edit().putLong(KEY_PENDING_WA_SCAN_UNTIL, 0L).apply();
    }

    public static int incrementWhatsAppScanCount(Context context) {
        int next = prefs(context).getInt(KEY_WA_SCAN_REPLIED_COUNT, 0) + 1;
        prefs(context).edit().putInt(KEY_WA_SCAN_REPLIED_COUNT, next).apply();
        return next;
    }

    public static int getWhatsAppScanCount(Context context) {
        return prefs(context).getInt(KEY_WA_SCAN_REPLIED_COUNT, 0);
    }

    public static synchronized void recordWhatsAppChatReplied(Context context, String sender, String replyText) {
        if (context == null || TextUtils.isEmpty(sender)) return;
        String senderKey = sender.trim().toLowerCase(java.util.Locale.ROOT);
        try {
            org.json.JSONObject map = new org.json.JSONObject(
                    prefs(context).getString(KEY_WA_RECENT_REPLIED_JSON, "{}")
            );
            long now = System.currentTimeMillis();
            java.util.Iterator<String> it = map.keys();
            java.util.List<String> expired = new java.util.ArrayList<>();
            while (it.hasNext()) {
                String k = it.next();
                org.json.JSONObject item = map.optJSONObject(k);
                if (item == null || (now - item.optLong("ts", 0L)) > 600_000L) {
                    expired.add(k);
                }
            }
            for (String k : expired) {
                map.remove(k);
            }
            org.json.JSONObject entry = new org.json.JSONObject();
            entry.put("ts", now);
            entry.put("reply", replyText != null ? replyText.trim() : "");
            map.put(senderKey, entry);
            prefs(context).edit().putString(KEY_WA_RECENT_REPLIED_JSON, map.toString()).apply();
        } catch (Exception ignored) {}
    }

    public static synchronized boolean wasWhatsAppChatRecentlyReplied(Context context, String sender, long windowMs) {
        if (context == null || TextUtils.isEmpty(sender)) return false;
        String senderKey = sender.trim().toLowerCase(java.util.Locale.ROOT);
        try {
            org.json.JSONObject map = new org.json.JSONObject(
                    prefs(context).getString(KEY_WA_RECENT_REPLIED_JSON, "{}")
            );
            org.json.JSONObject item = map.optJSONObject(senderKey);
            if (item == null) return false;
            long ts = item.optLong("ts", 0L);
            return (System.currentTimeMillis() - ts) < windowMs;
        } catch (Exception ignored) {
            return false;
        }
    }

    public static synchronized boolean isOwnSentWhatsAppText(Context context, String sender, String text) {
        if (context == null || TextUtils.isEmpty(text)) return false;
        String trimmed = text.trim();
        try {
            org.json.JSONObject map = new org.json.JSONObject(
                    prefs(context).getString(KEY_WA_RECENT_REPLIED_JSON, "{}")
            );
            long now = System.currentTimeMillis();
            if (!TextUtils.isEmpty(sender)) {
                org.json.JSONObject item = map.optJSONObject(sender.trim().toLowerCase(java.util.Locale.ROOT));
                if (item != null && (now - item.optLong("ts", 0L)) < 600_000L) {
                    String sentReply = item.optString("reply", "").trim();
                    if (!TextUtils.isEmpty(sentReply) && trimmed.contains(sentReply)) {
                        return true;
                    }
                }
            }
            java.util.Iterator<String> it = map.keys();
            while (it.hasNext()) {
                org.json.JSONObject item = map.optJSONObject(it.next());
                if (item != null && (now - item.optLong("ts", 0L)) < 600_000L) {
                    String sentReply = item.optString("reply", "").trim();
                    if (!TextUtils.isEmpty(sentReply) && sentReply.equals(trimmed)) {
                        return true;
                    }
                }
            }
        } catch (Exception ignored) {}
        return false;
    }
}
