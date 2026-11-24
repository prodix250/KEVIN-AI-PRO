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
    private static final String KEY_WA_PAUSED_UNTIL = "wa_paused_until";
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
    private static final String KEY_PENDING_LARK_UNTIL = "pending_lark_until";
    private static final String KEY_PENDING_LARK_ACTION_JSON = "pending_lark_action_json";
    private static final String KEY_PENDING_LARK_STEP = "pending_lark_step";
    private static final String KEY_LARK_PLAYLISTS_JSON = "lark_playlists_json";
    private static final String KEY_PENDING_AUDIOMACK_UNTIL = "pending_audiomack_until";
    private static final String KEY_PENDING_AUDIOMACK_ACTION_JSON = "pending_audiomack_action_json";
    private static final String KEY_PENDING_AUDIOMACK_STEP = "pending_audiomack_step";
    private static final String KEY_AUDIOMACK_PLAYLISTS_JSON = "audiomack_playlists_json";

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
        SharedPreferences.Editor editor = prefs(context).edit()
                .putBoolean(KEY_AUTO_SEND_ENABLED, autoSendEnabled)
                .putBoolean(KEY_WA_AUTO_REPLY_ENABLED, waAutoReplyEnabled)
                .putString(KEY_WA_REPLY_STYLE, replyStyle != null ? replyStyle : "")
                .putString(KEY_USER_NAME, userName != null ? userName : "Kevin")
                .putString(KEY_BACKEND_BASE_URL, backendBaseUrl != null ? backendBaseUrl : "");
        if (!waAutoReplyEnabled) {
            editor.putLong(KEY_WA_PAUSED_UNTIL, 0L);
            editor.putLong(KEY_PENDING_WA_SCAN_UNTIL, 0L);
        }
        editor.apply();
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

    public static void setWhatsAppPausedUntil(Context context, long pausedUntilMs) {
        long cleanUntil = Math.max(0L, pausedUntilMs);
        SharedPreferences.Editor editor = prefs(context).edit()
                .putLong(KEY_WA_PAUSED_UNTIL, cleanUntil);
        if (cleanUntil > System.currentTimeMillis() || !isWhatsAppAutoReplyEnabled(context)) {
            editor.putLong(KEY_PENDING_WA_SCAN_UNTIL, 0L);
        }
        editor.apply();
    }

    public static long getWhatsAppPausedUntil(Context context) {
        return prefs(context).getLong(KEY_WA_PAUSED_UNTIL, 0L);
    }

    public static boolean isWhatsAppAutoReplyPaused(Context context) {
        long until = prefs(context).getLong(KEY_WA_PAUSED_UNTIL, 0L);
        if (until <= 0L) {
            return false;
        }
        if (System.currentTimeMillis() >= until) {
            prefs(context).edit().putLong(KEY_WA_PAUSED_UNTIL, 0L).apply();
            return false;
        }
        return true;
    }

    public static boolean isWhatsAppAutoReplyCurrentlyActive(Context context) {
        return isWhatsAppAutoReplyEnabled(context) && !isWhatsAppAutoReplyPaused(context);
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

    public static void armPendingLarkAction(Context context, String actionJson, long durationMs) {
        if (context == null) return;
        prefs(context).edit()
                .putString(KEY_PENDING_LARK_ACTION_JSON, actionJson != null ? actionJson : "{}")
                .putLong(KEY_PENDING_LARK_UNTIL, System.currentTimeMillis() + Math.max(3000L, durationMs))
                .putInt(KEY_PENDING_LARK_STEP, 0)
                .apply();
    }

    public static boolean isPendingLarkActionActive(Context context) {
        if (context == null) return false;
        long until = prefs(context).getLong(KEY_PENDING_LARK_UNTIL, 0L);
        return until > System.currentTimeMillis();
    }

    public static String getPendingLarkActionJson(Context context) {
        if (!isPendingLarkActionActive(context)) return "";
        return prefs(context).getString(KEY_PENDING_LARK_ACTION_JSON, "");
    }

    public static void updatePendingLarkActionJson(Context context, String actionJson) {
        if (context == null) return;
        prefs(context).edit()
                .putString(KEY_PENDING_LARK_ACTION_JSON, actionJson != null ? actionJson : "{}")
                .apply();
    }

    public static int incrementPendingLarkStep(Context context) {
        if (context == null) return 0;
        int next = prefs(context).getInt(KEY_PENDING_LARK_STEP, 0) + 1;
        prefs(context).edit().putInt(KEY_PENDING_LARK_STEP, next).apply();
        return next;
    }

    public static int getPendingLarkStep(Context context) {
        if (context == null) return 0;
        return prefs(context).getInt(KEY_PENDING_LARK_STEP, 0);
    }

    public static void clearPendingLarkAction(Context context) {
        if (context == null) return;
        prefs(context).edit()
                .putLong(KEY_PENDING_LARK_UNTIL, 0L)
                .putInt(KEY_PENDING_LARK_STEP, 0)
                .remove(KEY_PENDING_LARK_ACTION_JSON)
                .apply();
    }

    public static synchronized void saveLarkPlaylist(Context context, String playlistName, org.json.JSONArray songsArray, boolean append) {
        if (context == null || TextUtils.isEmpty(playlistName)) return;
        String cleanName = playlistName.trim();
        try {
            org.json.JSONObject all = new org.json.JSONObject(prefs(context).getString(KEY_LARK_PLAYLISTS_JSON, "{}"));
            org.json.JSONObject existing = null;
            String matchedKey = cleanName;
            java.util.Iterator<String> keys = all.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                if (k.equalsIgnoreCase(cleanName)) {
                    matchedKey = k;
                    existing = all.optJSONObject(k);
                    break;
                }
            }
            org.json.JSONArray mergedSongs = new org.json.JSONArray();
            java.util.Set<String> seen = new java.util.HashSet<>();
            if (append && existing != null) {
                org.json.JSONArray oldSongs = existing.optJSONArray("songs");
                if (oldSongs != null) {
                    for (int i = 0; i < oldSongs.length(); i++) {
                        org.json.JSONObject s = oldSongs.optJSONObject(i);
                        if (s == null) continue;
                        String key = (s.optString("id", "") + "|" + s.optString("title", "")).toLowerCase(java.util.Locale.ROOT);
                        if (!seen.contains(key)) {
                            seen.add(key);
                            mergedSongs.put(s);
                        }
                    }
                }
            }
            if (songsArray != null) {
                for (int i = 0; i < songsArray.length(); i++) {
                    org.json.JSONObject s = songsArray.optJSONObject(i);
                    if (s == null) continue;
                    String key = (s.optString("id", "") + "|" + s.optString("title", "")).toLowerCase(java.util.Locale.ROOT);
                    if (!seen.contains(key)) {
                        seen.add(key);
                        mergedSongs.put(s);
                    }
                }
            }
            org.json.JSONObject entry = new org.json.JSONObject();
            entry.put("name", matchedKey);
            entry.put("updatedAt", System.currentTimeMillis());
            entry.put("songs", mergedSongs);
            all.put(matchedKey, entry);
            prefs(context).edit().putString(KEY_LARK_PLAYLISTS_JSON, all.toString()).apply();
        } catch (Exception ignored) {}
    }

    public static synchronized String getLarkPlaylistsJson(Context context) {
        if (context == null) return "[]";
        try {
            org.json.JSONObject all = new org.json.JSONObject(prefs(context).getString(KEY_LARK_PLAYLISTS_JSON, "{}"));
            org.json.JSONArray arr = new org.json.JSONArray();
            java.util.Iterator<String> keys = all.keys();
            while (keys.hasNext()) {
                org.json.JSONObject item = all.optJSONObject(keys.next());
                if (item != null) {
                    arr.put(item);
                }
            }
            return arr.toString();
        } catch (Exception ignored) {
            return "[]";
        }
    }

    public static synchronized org.json.JSONObject findLarkPlaylist(Context context, String playlistName) {
        if (context == null || TextUtils.isEmpty(playlistName)) return null;
        String target = playlistName.trim().toLowerCase(java.util.Locale.ROOT);
        try {
            org.json.JSONObject all = new org.json.JSONObject(prefs(context).getString(KEY_LARK_PLAYLISTS_JSON, "{}"));
            java.util.Iterator<String> keys = all.keys();
            org.json.JSONObject partial = null;
            while (keys.hasNext()) {
                String k = keys.next();
                org.json.JSONObject item = all.optJSONObject(k);
                if (item == null) continue;
                String lower = k.toLowerCase(java.util.Locale.ROOT);
                if (lower.equals(target)) return item;
                if (partial == null && (lower.contains(target) || target.contains(lower))) {
                    partial = item;
                }
            }
            return partial;
        } catch (Exception ignored) {
            return null;
        }
    }

    public static synchronized boolean deleteLarkPlaylist(Context context, String playlistName) {
        if (context == null || TextUtils.isEmpty(playlistName)) return false;
        String target = playlistName.trim().toLowerCase(java.util.Locale.ROOT);
        try {
            org.json.JSONObject all = new org.json.JSONObject(prefs(context).getString(KEY_LARK_PLAYLISTS_JSON, "{}"));
            java.util.Iterator<String> keys = all.keys();
            String keyToRemove = null;
            while (keys.hasNext()) {
                String k = keys.next();
                if (k.toLowerCase(java.util.Locale.ROOT).equals(target)) {
                    keyToRemove = k;
                    break;
                }
            }
            if (keyToRemove != null) {
                all.remove(keyToRemove);
                prefs(context).edit().putString(KEY_LARK_PLAYLISTS_JSON, all.toString()).apply();
                return true;
            }
        } catch (Exception ignored) {}
        return false;
    }

    public static void armPendingAudiomackAction(Context context, String actionJson, long durationMs) {
        if (context == null) return;
        prefs(context).edit()
                .putString(KEY_PENDING_AUDIOMACK_ACTION_JSON, actionJson != null ? actionJson : "{}")
                .putLong(KEY_PENDING_AUDIOMACK_UNTIL, System.currentTimeMillis() + Math.max(3000L, durationMs))
                .putInt(KEY_PENDING_AUDIOMACK_STEP, 0)
                .apply();
    }

    public static boolean isPendingAudiomackActionActive(Context context) {
        if (context == null) return false;
        long until = prefs(context).getLong(KEY_PENDING_AUDIOMACK_UNTIL, 0L);
        return until > System.currentTimeMillis();
    }

    public static String getPendingAudiomackActionJson(Context context) {
        if (!isPendingAudiomackActionActive(context)) return "";
        return prefs(context).getString(KEY_PENDING_AUDIOMACK_ACTION_JSON, "");
    }

    public static void updatePendingAudiomackActionJson(Context context, String actionJson) {
        if (context == null) return;
        prefs(context).edit()
                .putString(KEY_PENDING_AUDIOMACK_ACTION_JSON, actionJson != null ? actionJson : "{}")
                .apply();
    }

    public static int incrementPendingAudiomackStep(Context context) {
        if (context == null) return 0;
        int next = prefs(context).getInt(KEY_PENDING_AUDIOMACK_STEP, 0) + 1;
        prefs(context).edit().putInt(KEY_PENDING_AUDIOMACK_STEP, next).apply();
        return next;
    }

    public static void clearPendingAudiomackAction(Context context) {
        if (context == null) return;
        prefs(context).edit()
                .putLong(KEY_PENDING_AUDIOMACK_UNTIL, 0L)
                .putInt(KEY_PENDING_AUDIOMACK_STEP, 0)
                .remove(KEY_PENDING_AUDIOMACK_ACTION_JSON)
                .apply();
    }

    public static synchronized void saveAudiomackPlaylist(Context context, String playlistName, org.json.JSONArray songsArray, boolean append) {
        if (context == null || TextUtils.isEmpty(playlistName)) return;
        String cleanName = playlistName.trim();
        try {
            org.json.JSONObject all = new org.json.JSONObject(prefs(context).getString(KEY_AUDIOMACK_PLAYLISTS_JSON, "{}"));
            org.json.JSONObject existing = null;
            String matchedKey = cleanName;
            java.util.Iterator<String> keys = all.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                if (k.equalsIgnoreCase(cleanName)) {
                    matchedKey = k;
                    existing = all.optJSONObject(k);
                    break;
                }
            }
            org.json.JSONArray mergedSongs = new org.json.JSONArray();
            java.util.Set<String> seen = new java.util.HashSet<>();
            if (append && existing != null) {
                org.json.JSONArray oldSongs = existing.optJSONArray("songs");
                if (oldSongs != null) {
                    for (int i = 0; i < oldSongs.length(); i++) {
                        org.json.JSONObject s = oldSongs.optJSONObject(i);
                        if (s == null) continue;
                        String key = s.optString("title", "").toLowerCase(java.util.Locale.ROOT);
                        if (!TextUtils.isEmpty(key) && seen.add(key)) {
                            mergedSongs.put(s);
                        }
                    }
                }
            }
            if (songsArray != null) {
                for (int i = 0; i < songsArray.length(); i++) {
                    org.json.JSONObject s = songsArray.optJSONObject(i);
                    if (s == null) continue;
                    String key = s.optString("title", "").toLowerCase(java.util.Locale.ROOT);
                    if (!TextUtils.isEmpty(key) && seen.add(key)) {
                        mergedSongs.put(s);
                    }
                }
            }
            org.json.JSONObject entry = new org.json.JSONObject();
            entry.put("name", matchedKey);
            entry.put("updatedAt", System.currentTimeMillis());
            entry.put("songs", mergedSongs);
            all.put(matchedKey, entry);
            prefs(context).edit().putString(KEY_AUDIOMACK_PLAYLISTS_JSON, all.toString()).apply();
        } catch (Exception ignored) {}
    }

    public static synchronized String getAudiomackPlaylistsJson(Context context) {
        if (context == null) return "[]";
        try {
            org.json.JSONObject all = new org.json.JSONObject(prefs(context).getString(KEY_AUDIOMACK_PLAYLISTS_JSON, "{}"));
            org.json.JSONArray arr = new org.json.JSONArray();
            java.util.Iterator<String> keys = all.keys();
            while (keys.hasNext()) {
                org.json.JSONObject item = all.optJSONObject(keys.next());
                if (item != null) {
                    arr.put(item);
                }
            }
            return arr.toString();
        } catch (Exception ignored) {
            return "[]";
        }
    }
}
