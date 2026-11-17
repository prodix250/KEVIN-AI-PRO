package com.kevinai.pro;

import android.content.Context;
import android.content.SharedPreferences;

public final class KevinAgentPrefs {
    private static final String PREFS_NAME = "kevin_agent_prefs";
    private static final String KEY_AUTO_SEND_ENABLED = "auto_send_enabled";
    private static final String KEY_WA_AUTO_REPLY_ENABLED = "wa_auto_reply_enabled";
    private static final String KEY_WA_REPLY_STYLE = "wa_reply_style";
    private static final String KEY_USER_NAME = "user_name";
    private static final String KEY_BACKEND_BASE_URL = "backend_base_url";
    private static final String KEY_PENDING_WA_UNTIL = "pending_wa_until";
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
}
