package com.kevinai.pro;

import android.Manifest;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import androidx.core.app.NotificationCompat;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.media.AudioManager;
import android.media.ExifInterface;
import android.media.audiofx.BassBoost;
import android.media.audiofx.Equalizer;
import android.media.audiofx.LoudnessEnhancer;
import android.media.audiofx.PresetReverb;
import android.media.audiofx.Virtualizer;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.ContactsContract;
import android.provider.Settings;
import android.speech.SpeechRecognizer;
import android.telephony.SmsManager;
import android.text.TextUtils;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public class KevinAgentBridge {

    public static final int AGENT_PERMISSIONS_REQUEST_CODE = 1004;

    private final Activity activity;
    private final WebView webView;
    private final Handler bridgeHandler = new Handler(Looper.getMainLooper());
    private Equalizer systemEqualizer;
    private BassBoost systemBassBoost;
    private Virtualizer systemVirtualizer;
    private PresetReverb systemPresetReverb;
    private LoudnessEnhancer systemLoudness;

    public KevinAgentBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    public boolean isAccessibilityEnabled() {
        AccessibilityManager am = (AccessibilityManager) activity.getSystemService(Activity.ACCESSIBILITY_SERVICE);
        if (am == null) return false;
        List<AccessibilityServiceInfo> enabled =
                am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK);
        String target = activity.getPackageName() + "/" + KevinAgentAccessibilityService.class.getName();
        for (AccessibilityServiceInfo info : enabled) {
            if (info.getId() != null && info.getId().equals(target)) {
                return true;
            }
        }
        return false;
    }

    public boolean isNotificationListenerEnabled() {
        String flat = Settings.Secure.getString(activity.getContentResolver(), "enabled_notification_listeners");
        if (TextUtils.isEmpty(flat)) return false;
        ComponentName cn = new ComponentName(activity, KevinNotificationListenerService.class);
        return flat.contains(cn.flattenToString());
    }

    public boolean isDefaultAssistant() {
        try {
            String assistant = Settings.Secure.getString(activity.getContentResolver(), "assistant");
            if (!TextUtils.isEmpty(assistant) && assistant.contains(activity.getPackageName())) {
                return true;
            }
            String voiceService = Settings.Secure.getString(activity.getContentResolver(), "voice_interaction_service");
            return !TextUtils.isEmpty(voiceService) && voiceService.contains(activity.getPackageName());
        } catch (Exception ignored) {
            return false;
        }
    }

    public String buildAgentStatusJson() {
        try {
            JSONObject obj = new JSONObject();
            obj.put("isAndroid", true);
            obj.put("hasSmsPermission", ContextCompat.checkSelfPermission(activity, Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED);
            obj.put("hasCallPermission", ContextCompat.checkSelfPermission(activity, Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED);
            obj.put("hasContactsPermission", ContextCompat.checkSelfPermission(activity, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED);
            obj.put("hasMicPermission", ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED);
            obj.put("hasAccessibility", isAccessibilityEnabled());
            obj.put("hasNotificationAccess", isNotificationListenerEnabled());
            obj.put("isDefaultAssistant", isDefaultAssistant());
            obj.put("autoSendEnabled", KevinAgentPrefs.isAutoSendEnabled(activity));
            obj.put("whatsappAutoReplyEnabled", KevinAgentPrefs.isWhatsAppAutoReplyEnabled(activity));
            obj.put("whatsappAutoReplyPausedUntil", KevinAgentPrefs.getWhatsAppPausedUntil(activity));
            obj.put("whatsappAutoReplyPaused", KevinAgentPrefs.isWhatsAppAutoReplyPaused(activity));
            obj.put("whatsappAutoReplyCurrentlyActive", KevinAgentPrefs.isWhatsAppAutoReplyCurrentlyActive(activity));
            obj.put("wakeWordEnabled", KevinAgentPrefs.isWakeWordEnabled(activity));
            obj.put("wakeWordActive", KevinWakeWordService.isRunning);
            obj.put("wakeWordEngine", KevinWakeWordService.activeEngine);
            obj.put("wakeWordDiag", KevinWakeWordService.lastDiagnostic);
            obj.put("hasOverlayPermission", Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(activity));
            obj.put("hasNotificationPermission", Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                    || ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED);
            obj.put("speechRecognizerAvailable", SpeechRecognizer.isRecognitionAvailable(activity));
            boolean hasAudioPerm = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                    ? ContextCompat.checkSelfPermission(activity, Manifest.permission.READ_MEDIA_AUDIO) == PackageManager.PERMISSION_GRANTED
                    : ContextCompat.checkSelfPermission(activity, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
            obj.put("hasMusicPermission", hasAudioPerm);
            obj.put("larkPlayerInstalled", findInstalledLarkPlayerPackage() != null);
            obj.put("audiomackInstalled", findInstalledAudiomackPackage() != null);
            return obj.toString();
        } catch (Exception e) {
            return "{\"isAndroid\":true}";
        }
    }

    public void dispatchAgentStatus() {
        if (webView == null) return;
        String json = JSONObject.quote(buildAgentStatusJson());
        webView.post(() ->
                webView.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('kevinAgentStatus', { detail: JSON.parse(" + json + ") }))",
                        null
                )
        );
    }

    @JavascriptInterface
    public String getStatusJson() {
        return buildAgentStatusJson();
    }

    @JavascriptInterface
    public void requestAgentPermissions() {
        activity.runOnUiThread(() -> {
            java.util.List<String> perms = new java.util.ArrayList<>();
            perms.add(Manifest.permission.SEND_SMS);
            perms.add(Manifest.permission.CALL_PHONE);
            perms.add(Manifest.permission.READ_CONTACTS);
            perms.add(Manifest.permission.RECORD_AUDIO);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                perms.add(Manifest.permission.READ_MEDIA_AUDIO);
                perms.add(Manifest.permission.POST_NOTIFICATIONS);
            } else {
                perms.add(Manifest.permission.READ_EXTERNAL_STORAGE);
            }
            ActivityCompat.requestPermissions(
                    activity,
                    perms.toArray(new String[0]),
                    AGENT_PERMISSIONS_REQUEST_CODE
            );
        });
    }

    @JavascriptInterface
    public void setAgentApiKeys(String keysJson) {
        KevinAgentPrefs.setApiKeysJson(activity, keysJson);
    }

    @JavascriptInterface
    public boolean setWakeWordEnabled(boolean enabled) {
        KevinAgentPrefs.setWakeWordEnabled(activity, enabled);
        if (enabled && ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            activity.runOnUiThread(() -> ActivityCompat.requestPermissions(
                    activity,
                    new String[] { Manifest.permission.RECORD_AUDIO },
                    AGENT_PERMISSIONS_REQUEST_CODE
            ));
            dispatchAgentStatus();
            return false;
        }
        KevinWakeWordService.syncWithPreferences(activity);
        dispatchAgentStatus();
        return enabled;
    }

    @JavascriptInterface
    public void pauseWakeWord() {
        KevinWakeWordService.pauseListening(activity);
    }

    @JavascriptInterface
    public void resumeWakeWord() {
        KevinWakeWordService.resumeListening(activity);
    }

    @JavascriptInterface
    public void setInAppOverlayOpen(boolean open) {
        KevinWakeWordService.setOverlayVisible(open);
        if (open) {
            KevinWakeWordService.pauseListening(activity);
        } else {
            KevinWakeWordService.resumeListening(activity);
        }
    }

    public static final String NEWS_CHANNEL_ID = "kevin_daily_news_whistle_v1";

    @JavascriptInterface
    public boolean showNewsNotification(String title, String preview, String slotId) {
        try {
            boolean posted = DailyNewsManager.showHeadsUpNewsNotification(activity, title, preview, slotId, "");
            if (!TextUtils.isEmpty(slotId)) {
                KevinAgentPrefs.markNewsSlotDelivered(activity, slotId);
            }
            return posted;
        } catch (Throwable t) {
            return false;
        }
    }

    @JavascriptInterface
    public String consumePendingNewsBriefingsJson() {
        try {
            return KevinAgentPrefs.consumePendingNewsBriefingsJson(activity);
        } catch (Throwable t) {
            return "[]";
        }
    }

    @JavascriptInterface
    public void syncDeliveredSlotId(String slotId) {
        try {
            if (!TextUtils.isEmpty(slotId)) {
                KevinAgentPrefs.markNewsSlotDelivered(activity, slotId);
            }
        } catch (Throwable ignored) {}
    }

    @JavascriptInterface
    public void setNewsCustomInstructions(String instructions) {
        try {
            KevinAgentPrefs.setNewsCustomInstructions(activity, instructions);
        } catch (Throwable ignored) {}
    }

    @JavascriptInterface
    public String getNewsCustomInstructions() {
        try {
            return KevinAgentPrefs.getNewsCustomInstructions(activity);
        } catch (Throwable t) {
            return "";
        }
    }

    @JavascriptInterface
    public String getDeliveredNewsSlotIdsJson() {
        try {
            Set<String> set = KevinAgentPrefs.getDeliveredNewsSlotIds(activity);
            JSONArray arr = new JSONArray();
            for (String s : set) {
                arr.put(s);
            }
            return arr.toString();
        } catch (Throwable t) {
            return "[]";
        }
    }

    @JavascriptInterface
    public void openOverlayPermissionSettings() {
        activity.runOnUiThread(() -> {
            try {
                Intent intent = new Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + activity.getPackageName())
                );
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
            } catch (Exception e) {
                try {
                    Intent fallback = new Intent(
                            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.parse("package:" + activity.getPackageName())
                    );
                    fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    activity.startActivity(fallback);
                } catch (Exception ignored) {}
            }
        });
    }

    @JavascriptInterface
    public void openAssistantSettings() {
        activity.runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Settings.ACTION_VOICE_INPUT_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
            } catch (Exception e) {
                try {
                    Intent fallback = new Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);
                    fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    activity.startActivity(fallback);
                } catch (Exception ignored) {}
            }
        });
    }

    private String normalizeForSearch(String input) {
        if (TextUtils.isEmpty(input)) return "";
        String decomposed = Normalizer.normalize(input, Normalizer.Form.NFD);
        return decomposed.replaceAll("\\p{InCombiningDiacriticalMarks}+", "")
                .toLowerCase(Locale.ROOT)
                .trim();
    }

    @JavascriptInterface
    public String lookupContactsJson(String query) {
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.READ_CONTACTS)
                != PackageManager.PERMISSION_GRANTED) {
            return "[]";
        }
        JSONArray results = new JSONArray();
        Set<String> seenPhones = new LinkedHashSet<>();
        String normalizedQuery = normalizeForSearch(query);
        String[] queryTokens = TextUtils.isEmpty(normalizedQuery)
                ? new String[0]
                : normalizedQuery.split("\\s+");
        int limit = TextUtils.isEmpty(normalizedQuery) ? 5000 : 100;

        String[] projection = new String[] {
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                ContactsContract.CommonDataKinds.Phone.NUMBER
        };

        try (Cursor cursor = activity.getContentResolver().query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                projection,
                null,
                null,
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC"
        )) {
            if (cursor == null) return "[]";
            int nameIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
            int numIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
            while (cursor.moveToNext() && results.length() < limit) {
                String name = nameIdx >= 0 ? cursor.getString(nameIdx) : "";
                String rawNum = numIdx >= 0 ? cursor.getString(numIdx) : "";
                if (TextUtils.isEmpty(name) || TextUtils.isEmpty(rawNum)) continue;

                String cleanPhone = rawNum.trim().replaceAll("[^\\d+*#]", "");
                if (cleanPhone.length() < 3) continue;
                String digitsOnly = cleanPhone.replaceAll("[^\\d]", "");

                if (queryTokens.length > 0) {
                    String normalizedName = normalizeForSearch(name);
                    boolean allMatch = true;
                    for (String token : queryTokens) {
                        String tokenDigits = token.replaceAll("[^\\d]", "");
                        boolean matchesName = normalizedName.contains(token);
                        boolean matchesPhone = cleanPhone.contains(token)
                                || (!TextUtils.isEmpty(tokenDigits) && digitsOnly.contains(tokenDigits));
                        if (!matchesName && !matchesPhone) {
                            allMatch = false;
                            break;
                        }
                    }
                    if (!allMatch) continue;
                }

                String dedupKey = name.toLowerCase(Locale.ROOT) + "|" + digitsOnly;
                if (seenPhones.contains(dedupKey)) continue;
                seenPhones.add(dedupKey);

                JSONObject entry = new JSONObject();
                entry.put("name", name.trim());
                entry.put("phone", cleanPhone);
                results.put(entry);
            }
        } catch (Exception ignored) {
            return "[]";
        }
        return results.toString();
    }

    @JavascriptInterface
    public void openAccessibilitySettings() {
        activity.runOnUiThread(() -> {
            Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
        });
    }

    @JavascriptInterface
    public void openNotificationListenerSettings() {
        activity.runOnUiThread(() -> {
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
        });
    }

    @JavascriptInterface
    public void setAgentConfig(
            boolean autoSendEnabled,
            boolean waAutoReplyEnabled,
            String replyStyle,
            String userName,
            String backendBaseUrl
    ) {
        KevinAgentPrefs.setAgentConfig(
                activity,
                autoSendEnabled,
                waAutoReplyEnabled,
                replyStyle,
                userName,
                backendBaseUrl
        );
        if (KevinAgentPrefs.isWhatsAppAutoReplyCurrentlyActive(activity)) {
            KevinNotificationListenerService.scanActiveWhatsAppNotifications(activity, false);
        }
        dispatchAgentStatus();
    }

    @JavascriptInterface
    public void setWhatsAppAutoReplyPause(long pausedUntilMs) {
        KevinAgentPrefs.setWhatsAppPausedUntil(activity, pausedUntilMs);
        if (KevinAgentPrefs.isWhatsAppAutoReplyCurrentlyActive(activity)) {
            KevinNotificationListenerService.scanActiveWhatsAppNotifications(activity, false);
        }
        dispatchAgentStatus();
    }

    @JavascriptInterface
    public String scanAndReplyWhatsAppChats() {
        KevinAgentPrefs.setWhatsAppPausedUntil(activity, 0L);
        boolean hasNotifAccess = isNotificationListenerEnabled();
        boolean hasAcc = isAccessibilityEnabled();
        String waPkg = findInstalledWhatsAppPackage();
        int activeNotifQueued = hasNotifAccess
                ? KevinNotificationListenerService.scanActiveWhatsAppNotifications(activity, true)
                : 0;
        boolean openedWhatsAppForScan = false;

        if (waPkg != null && hasAcc) {
            Intent launchIntent = activity.getPackageManager().getLaunchIntentForPackage(waPkg);
            if (launchIntent != null) {
                KevinAgentPrefs.armWhatsAppScan(activity, 45_000L);
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                activity.runOnUiThread(() -> {
                    try {
                        activity.startActivity(launchIntent);
                    } catch (Exception ignored) {}
                });
                openedWhatsAppForScan = true;
            }
        }

        try {
            JSONObject res = new JSONObject();
            res.put("activeNotifQueued", activeNotifQueued);
            res.put("openedWhatsAppForScan", openedWhatsAppForScan);
            res.put("hasNotificationAccess", hasNotifAccess);
            res.put("hasAccessibility", hasAcc);
            res.put("whatsappInstalled", waPkg != null);
            return res.toString();
        } catch (Exception e) {
            return "{\"activeNotifQueued\":0,\"openedWhatsAppForScan\":false}";
        }
    }

    @JavascriptInterface
    public boolean sendSms(String phoneNumber, String message) {
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.SEND_SMS)
                != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        if (TextUtils.isEmpty(phoneNumber) || TextUtils.isEmpty(message)) {
            return false;
        }
        try {
            SmsManager smsManager = activity.getSystemService(SmsManager.class);
            if (smsManager == null) {
                smsManager = SmsManager.getDefault();
            }
            smsManager.sendMultipartTextMessage(
                    phoneNumber.trim(),
                    null,
                    smsManager.divideMessage(message),
                    null,
                    null
            );
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private String findInstalledWhatsAppPackage() {
        PackageManager pm = activity.getPackageManager();
        String[] pkgs = new String[] { "com.whatsapp", "com.whatsapp.w4b" };
        for (String pkg : pkgs) {
            try {
                pm.getPackageInfo(pkg, 0);
                return pkg;
            } catch (Exception ignored) {}
        }
        return null;
    }

    @JavascriptInterface
    public boolean sendWhatsApp(String phoneNumber, String message) {
        if (TextUtils.isEmpty(phoneNumber)) return false;
        activity.runOnUiThread(() -> {
            try {
                KevinAgentPrefs.armPendingWhatsAppSend(activity, 20_000L);
                String cleanDigits = formatWhatsAppNumber(phoneNumber);
                String encodedText = Uri.encode(message != null ? message : "");
                String waPkg = findInstalledWhatsAppPackage();

                String directSchemeUri = "whatsapp://send?phone="
                        + Uri.encode(cleanDigits)
                        + "&text=" + encodedText;
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(directSchemeUri));
                if (waPkg != null) {
                    intent.setPackage(waPkg);
                }
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                try {
                    activity.startActivity(intent);
                    return;
                } catch (Exception ignored) {}

                String webUri = "https://api.whatsapp.com/send?phone="
                        + Uri.encode(cleanDigits)
                        + "&text=" + encodedText;
                Intent fallback = new Intent(Intent.ACTION_VIEW, Uri.parse(webUri));
                if (waPkg != null) {
                    fallback.setPackage(waPkg);
                }
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                activity.startActivity(fallback);
            } catch (Exception ignored) {}
        });
        return true;
    }

    private String formatWhatsAppNumber(String raw) {
        if (TextUtils.isEmpty(raw)) return "";
        String trimmed = raw.trim();
        if (trimmed.startsWith("+")) {
            return trimmed.replaceAll("[^\\d]", "");
        }
        String digits = trimmed.replaceAll("[^\\d]", "");
        if (digits.startsWith("00")) {
            digits = digits.substring(2);
        }
        if (digits.startsWith("250")) {
            return digits;
        }
        if (digits.startsWith("0") && digits.length() == 10) {
            return "250" + digits.substring(1);
        }
        if (digits.length() == 9 && digits.startsWith("7")) {
            return "250" + digits;
        }
        if (digits.startsWith("0") && digits.length() >= 9) {
            return "250" + digits.replaceFirst("^0+", "");
        }
        if (digits.length() == 9) {
            return "250" + digits;
        }
        return digits;
    }

    @JavascriptInterface
    public boolean playYouTube(String videoId, String query) {
        activity.runOnUiThread(() -> {
            try {
                if (!TextUtils.isEmpty(videoId)) {
                    KevinAgentPrefs.armPendingYouTubePlay(activity, 8_000L);
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("vnd.youtube://" + videoId));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    activity.startActivity(intent);
                    scheduleDirectAutoplayKick("youtube");
                } else {
                    KevinAgentPrefs.armPendingYouTubePlay(activity, 20_000L);
                    Intent intent = new Intent(Intent.ACTION_VIEW,
                            Uri.parse("https://www.youtube.com/results?search_query=" + Uri.encode(query != null ? query : "")));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    activity.startActivity(intent);
                }
            } catch (Exception e) {
                try {
                    if (TextUtils.isEmpty(videoId)) {
                        KevinAgentPrefs.armPendingYouTubePlay(activity, 20_000L);
                    }
                    String webUrl = !TextUtils.isEmpty(videoId)
                            ? "https://www.youtube.com/watch?v=" + Uri.encode(videoId) + "&autoplay=1"
                            : "https://www.youtube.com/results?search_query=" + Uri.encode(query != null ? query : "");
                    Intent fallback = new Intent(Intent.ACTION_VIEW, Uri.parse(webUrl));
                    fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    activity.startActivity(fallback);
                    if (!TextUtils.isEmpty(videoId)) {
                        scheduleDirectAutoplayKick("youtube");
                    }
                } catch (Exception ignored) {}
            }
        });
        return true;
    }

    private boolean hasAudioStoragePermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? ContextCompat.checkSelfPermission(activity, Manifest.permission.READ_MEDIA_AUDIO) == PackageManager.PERMISSION_GRANTED
                : ContextCompat.checkSelfPermission(activity, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    public String findInstalledLarkPlayerPackage() {
        PackageManager pm = activity.getPackageManager();
        String[] candidatePkgs = new String[] {
                "com.dywx.larkplayer",
                "com.dywx.larkplayer.lite",
                "com.dywx.larkplayer.music",
                "com.gemini.larkplayer",
                "com.larkplayer.music",
                "com.larkplayer",
                "com.lark.player",
                "com.larkplayer.free"
        };
        for (String pkg : candidatePkgs) {
            try {
                pm.getPackageInfo(pkg, 0);
                return pkg;
            } catch (Exception ignored) {}
            try {
                if (pm.getLaunchIntentForPackage(pkg) != null) {
                    return pkg;
                }
            } catch (Exception ignored) {}
        }
        try {
            Intent mainLauncher = new Intent(Intent.ACTION_MAIN);
            mainLauncher.addCategory(Intent.CATEGORY_LAUNCHER);
            List<android.content.pm.ResolveInfo> infos = pm.queryIntentActivities(mainLauncher, 0);
            for (android.content.pm.ResolveInfo info : infos) {
                if (info.activityInfo == null || info.activityInfo.packageName == null) continue;
                String pLower = info.activityInfo.packageName.toLowerCase(Locale.ROOT);
                if (pLower.contains("larkplayer") || pLower.equals("com.lark.player") || pLower.contains("lark.player")) {
                    return info.activityInfo.packageName;
                }
                try {
                    CharSequence label = info.loadLabel(pm);
                    if (label != null && label.toString().toLowerCase(Locale.ROOT).contains("lark")) {
                        String l = label.toString().toLowerCase(Locale.ROOT);
                        if (l.contains("lark player") || l.contains("larkplayer")) {
                            return info.activityInfo.packageName;
                        }
                    }
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
        try {
            List<android.content.pm.ApplicationInfo> apps = pm.getInstalledApplications(0);
            for (android.content.pm.ApplicationInfo app : apps) {
                if (app.packageName != null) {
                    String pkgLower = app.packageName.toLowerCase(Locale.ROOT);
                    if (pkgLower.contains("larkplayer") || pkgLower.equals("com.lark.player") || pkgLower.contains("lark.player")) {
                        return app.packageName;
                    }
                    try {
                        CharSequence label = pm.getApplicationLabel(app);
                        if (label != null) {
                            String l = label.toString().toLowerCase(Locale.ROOT);
                            if (l.contains("lark player") || l.contains("larkplayer")) {
                                return app.packageName;
                            }
                        }
                    } catch (Exception ignored) {}
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private boolean startActivitySafely(Intent intent) {
        if (intent == null) return false;
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            activity.startActivity(intent);
            return true;
        } catch (Exception ignored) {
            try {
                activity.getApplicationContext().startActivity(intent);
                return true;
            } catch (Exception ignored2) {
                return false;
            }
        }
    }

    private Intent buildPackageLaunchIntent(String pkg) {
        if (TextUtils.isEmpty(pkg)) return null;
        PackageManager pm = activity.getPackageManager();
        try {
            Intent launchIntent = pm.getLaunchIntentForPackage(pkg);
            if (launchIntent != null) {
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
                return launchIntent;
            }
        } catch (Exception ignored) {}
        try {
            Intent q = new Intent(Intent.ACTION_MAIN);
            q.addCategory(Intent.CATEGORY_LAUNCHER);
            q.setPackage(pkg);
            List<android.content.pm.ResolveInfo> list = pm.queryIntentActivities(q, 0);
            if (list != null && !list.isEmpty() && list.get(0).activityInfo != null) {
                Intent explicit = new Intent(Intent.ACTION_MAIN);
                explicit.addCategory(Intent.CATEGORY_LAUNCHER);
                explicit.setComponent(new ComponentName(pkg, list.get(0).activityInfo.name));
                explicit.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
                return explicit;
            }
        } catch (Exception ignored) {}
        return null;
    }

    public String findInstalledAppPackageByName(String appName) {
        if (TextUtils.isEmpty(appName)) return null;
        String lower = appName.trim().toLowerCase(Locale.ROOT);
        String compact = lower.replaceAll("[^\\p{L}\\p{N}]", "");
        if (compact.contains("larkplayer") || lower.contains("lark player") || lower.equals("lark")) {
            return findInstalledLarkPlayerPackage();
        }
        if (compact.contains("audiomack") || lower.contains("audio mack")) {
            return findInstalledAudiomackPackage();
        }
        PackageManager pm = activity.getPackageManager();
        String[] aliasPkgs = null;
        if (lower.contains("whatsapp")) {
            aliasPkgs = new String[] { "com.whatsapp", "com.whatsapp.w4b" };
        } else if (lower.contains("youtube")) {
            aliasPkgs = new String[] { "com.google.android.youtube" };
        } else if (lower.contains("instagram")) {
            aliasPkgs = new String[] { "com.instagram.android" };
        } else if (lower.contains("tiktok")) {
            aliasPkgs = new String[] { "com.zhiliaoapp.musically", "com.ss.android.ugc.trill" };
        } else if (lower.contains("spotify")) {
            aliasPkgs = new String[] { "com.spotify.music" };
        } else if (lower.contains("facebook")) {
            aliasPkgs = new String[] { "com.facebook.katana", "com.facebook.lite" };
        } else if (lower.contains("maps")) {
            aliasPkgs = new String[] { "com.google.android.apps.maps" };
        } else if (lower.contains("chrome")) {
            aliasPkgs = new String[] { "com.android.chrome" };
        }
        if (aliasPkgs != null) {
            for (String pkg : aliasPkgs) {
                if (buildPackageLaunchIntent(pkg) != null) return pkg;
            }
        }
        try {
            Intent mainLauncher = new Intent(Intent.ACTION_MAIN);
            mainLauncher.addCategory(Intent.CATEGORY_LAUNCHER);
            List<android.content.pm.ResolveInfo> infos = pm.queryIntentActivities(mainLauncher, 0);
            for (android.content.pm.ResolveInfo info : infos) {
                if (info.activityInfo == null || info.activityInfo.packageName == null) continue;
                String pkg = info.activityInfo.packageName;
                CharSequence lbl = info.loadLabel(pm);
                String lblLower = lbl != null ? lbl.toString().toLowerCase(Locale.ROOT) : "";
                String lblCompact = lblLower.replaceAll("[^\\p{L}\\p{N}]", "");
                if ((!TextUtils.isEmpty(lblLower) && (lblLower.equals(lower) || lblLower.contains(lower) || lblCompact.contains(compact)))
                        || pkg.toLowerCase(Locale.ROOT).contains(compact)) {
                    return pkg;
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    @JavascriptInterface
    public String openApp(String appName) {
        JSONObject result = new JSONObject();
        try {
            String rawName = appName != null ? appName.trim() : "";
            String lower = rawName.toLowerCase(Locale.ROOT);
            String compact = lower.replaceAll("[^\\p{L}\\p{N}]", "");
            result.put("appName", rawName);

            if (compact.contains("larkplayer") || lower.contains("lark player") || lower.equals("lark")) {
                JSONObject larkRes = new JSONObject(executeLarkPlayerAction("{\"action\":\"open\"}"));
                result.put("ok", true);
                result.put("launched", larkRes.optBoolean("larkInstalled", false));
                result.put("packageName", larkRes.optString("larkPackage", ""));
                return result.toString();
            }
            if (compact.contains("audiomack") || lower.contains("audio mack")) {
                JSONObject amRes = new JSONObject(executeAudiomackAction("{\"action\":\"open\"}"));
                result.put("ok", true);
                result.put("launched", true);
                result.put("packageName", amRes.optString("audiomackPackage", ""));
                return result.toString();
            }
            if (lower.contains("setting")) {
                final boolean[] okFlag = new boolean[] { false };
                activity.runOnUiThread(() -> {
                    Intent i = new Intent(Settings.ACTION_SETTINGS);
                    okFlag[0] = startActivitySafely(i);
                });
                result.put("ok", true);
                result.put("launched", true);
                result.put("packageName", "com.android.settings");
                return result.toString();
            }
            if (lower.contains("camera") || lower.contains("kamera")) {
                activity.runOnUiThread(() -> startActivitySafely(new Intent(android.provider.MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA)));
                result.put("ok", true);
                result.put("launched", true);
                return result.toString();
            }

            String targetPkg = findInstalledAppPackageByName(rawName);
            result.put("packageName", targetPkg != null ? targetPkg : "");
            if (targetPkg != null) {
                Intent launchIntent = buildPackageLaunchIntent(targetPkg);
                if (launchIntent != null) {
                    activity.runOnUiThread(() -> startActivitySafely(launchIntent));
                    result.put("ok", true);
                    result.put("launched", true);
                    return result.toString();
                }
            }
            result.put("ok", false);
            result.put("launched", false);
        } catch (Exception e) {
            try {
                result.put("ok", false);
                result.put("launched", false);
                result.put("error", e.getMessage());
            } catch (Exception ignored) {}
        }
        return result.toString();
    }

    private List<String> tokenizeMusicQuery(String query) {
        List<String> tokens = new ArrayList<>();
        String normalized = normalizeForSearch(query);
        if (TextUtils.isEmpty(normalized)) return tokens;
        Set<String> stopWords = new LinkedHashSet<>(java.util.Arrays.asList(
                "curanga", "indirimbo", "yitwa", "kuri", "muri", "lark", "player",
                "play", "song", "music", "track", "audio", "by", "ya", "za", "yo",
                "the", "and", "from", "on", "in", "my", "phone", "telefone"
        ));
        for (String part : normalized.split("\\s+")) {
            String clean = part.replaceAll("[^\\p{L}\\p{N}]", "");
            if (clean.length() >= 2 && !stopWords.contains(clean)) {
                tokens.add(clean);
            }
        }
        if (tokens.isEmpty()) {
            for (String part : normalized.split("\\s+")) {
                String clean = part.replaceAll("[^\\p{L}\\p{N}]", "");
                if (!TextUtils.isEmpty(clean)) {
                    tokens.add(clean);
                }
            }
        }
        return tokens;
    }

    private JSONArray queryMatchingSongsArray(String query, int limit) {
        JSONArray results = new JSONArray();
        if (!hasAudioStoragePermission()) {
            return results;
        }
        List<String> queryTokens = tokenizeMusicQuery(query);
        String normalizedQuery = normalizeForSearch(query);

        String[] projection = new String[] {
                android.provider.MediaStore.Audio.Media._ID,
                android.provider.MediaStore.Audio.Media.TITLE,
                android.provider.MediaStore.Audio.Media.ARTIST,
                android.provider.MediaStore.Audio.Media.ALBUM,
                android.provider.MediaStore.Audio.Media.DURATION,
                android.provider.MediaStore.Audio.Media.DATA,
                android.provider.MediaStore.Audio.Media.MIME_TYPE,
                android.provider.MediaStore.Audio.Media.DISPLAY_NAME,
                android.provider.MediaStore.Audio.Media.IS_MUSIC
        };

        class ScoredSong {
            int score;
            JSONObject json;
        }
        List<ScoredSong> scored = new ArrayList<>();

        try (Cursor cursor = activity.getContentResolver().query(
                android.provider.MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                projection,
                null,
                null,
                android.provider.MediaStore.Audio.Media.TITLE + " ASC"
        )) {
            if (cursor == null) return results;
            int idCol = cursor.getColumnIndex(android.provider.MediaStore.Audio.Media._ID);
            int titleCol = cursor.getColumnIndex(android.provider.MediaStore.Audio.Media.TITLE);
            int artistCol = cursor.getColumnIndex(android.provider.MediaStore.Audio.Media.ARTIST);
            int albumCol = cursor.getColumnIndex(android.provider.MediaStore.Audio.Media.ALBUM);
            int durCol = cursor.getColumnIndex(android.provider.MediaStore.Audio.Media.DURATION);
            int dataCol = cursor.getColumnIndex(android.provider.MediaStore.Audio.Media.DATA);
            int mimeCol = cursor.getColumnIndex(android.provider.MediaStore.Audio.Media.MIME_TYPE);
            int dispCol = cursor.getColumnIndex(android.provider.MediaStore.Audio.Media.DISPLAY_NAME);
            int isMusicCol = cursor.getColumnIndex(android.provider.MediaStore.Audio.Media.IS_MUSIC);

            while (cursor.moveToNext()) {
                long id = idCol >= 0 ? cursor.getLong(idCol) : 0L;
                String title = titleCol >= 0 ? cursor.getString(titleCol) : "";
                String artist = artistCol >= 0 ? cursor.getString(artistCol) : "";
                String album = albumCol >= 0 ? cursor.getString(albumCol) : "";
                long duration = durCol >= 0 ? cursor.getLong(durCol) : 0L;
                String path = dataCol >= 0 ? cursor.getString(dataCol) : "";
                String mimeType = mimeCol >= 0 ? cursor.getString(mimeCol) : "audio/*";
                String displayName = dispCol >= 0 ? cursor.getString(dispCol) : "";
                int isMusic = isMusicCol >= 0 ? cursor.getInt(isMusicCol) : 1;

                if (isMusic == 0 && duration > 0 && duration < 10_000L) continue;
                String effectiveTitle = !TextUtils.isEmpty(title) ? title.trim() : (!TextUtils.isEmpty(displayName) ? displayName.replaceFirst("\\.[^.]+$", "").trim() : "");
                if (TextUtils.isEmpty(effectiveTitle)) continue;

                int score = 1;
                if (!queryTokens.isEmpty()) {
                    String normTitle = normalizeForSearch(effectiveTitle);
                    String normArtist = normalizeForSearch(artist);
                    String normAlbum = normalizeForSearch(album);
                    String normFile = normalizeForSearch(displayName + " " + path);
                    String combined = normTitle + " " + normArtist + " " + normAlbum + " " + normFile;
                    int matchedTokens = 0;
                    for (String token : queryTokens) {
                        if (normTitle.contains(token)) {
                            score += 5;
                            matchedTokens++;
                        } else if (normArtist.contains(token)) {
                            score += 4;
                            matchedTokens++;
                        } else if (combined.contains(token)) {
                            score += 2;
                            matchedTokens++;
                        }
                    }
                    if (!TextUtils.isEmpty(normalizedQuery) && normTitle.equals(normalizedQuery)) {
                        score += 20;
                    } else if (!TextUtils.isEmpty(normalizedQuery) && normTitle.contains(normalizedQuery)) {
                        score += 10;
                    }
                    if (matchedTokens == 0) continue;
                    if (queryTokens.size() >= 2 && matchedTokens == queryTokens.size()) {
                        score += 8;
                    }
                }

                JSONObject song = new JSONObject();
                song.put("id", String.valueOf(id));
                song.put("title", effectiveTitle);
                song.put("artist", TextUtils.isEmpty(artist) || "<unknown>".equalsIgnoreCase(artist) ? "" : artist.trim());
                song.put("album", TextUtils.isEmpty(album) || "<unknown>".equalsIgnoreCase(album) ? "" : album.trim());
                song.put("durationMs", duration);
                song.put("uri", android.content.ContentUris.withAppendedId(
                        android.provider.MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id).toString());
                song.put("path", path != null ? path : "");
                song.put("mimeType", !TextUtils.isEmpty(mimeType) ? mimeType : "audio/mpeg");

                ScoredSong ss = new ScoredSong();
                ss.score = score;
                ss.json = song;
                scored.add(ss);
                if (queryTokens.isEmpty() && scored.size() >= limit) {
                    break;
                }
            }
        } catch (Exception ignored) {
            return results;
        }

        if (!queryTokens.isEmpty()) {
            scored.sort((a, b) -> Integer.compare(b.score, a.score));
        }
        int maxCount = Math.min(limit, scored.size());
        for (int i = 0; i < maxCount; i++) {
            results.put(scored.get(i).json);
        }
        return results;
    }

    @JavascriptInterface
    public String lookupDeviceMusicJson(String query) {
        int limit = TextUtils.isEmpty(normalizeForSearch(query)) ? 500 : 80;
        return queryMatchingSongsArray(query, limit).toString();
    }

    private boolean launchLarkPlayerHome(String larkPkg, String pendingActionJson) {
        if (!TextUtils.isEmpty(pendingActionJson)) {
            KevinAgentPrefs.armPendingLarkAction(activity, pendingActionJson, 28_000L);
        }
        if (larkPkg != null) {
            Intent launchIntent = buildPackageLaunchIntent(larkPkg);
            if (launchIntent != null && startActivitySafely(launchIntent)) {
                return true;
            }
        }
        Intent genericPkgIntent = new Intent(Intent.ACTION_MAIN);
        genericPkgIntent.addCategory(Intent.CATEGORY_APP_MUSIC);
        if (larkPkg != null) {
            genericPkgIntent.setPackage(larkPkg);
        }
        if (startActivitySafely(genericPkgIntent)) {
            return true;
        }
        Intent genericMusicIntent = new Intent(Intent.ACTION_MAIN);
        genericMusicIntent.addCategory(Intent.CATEGORY_APP_MUSIC);
        return startActivitySafely(genericMusicIntent);
    }

    private boolean dispatchMediaKey(int keyCode) {
        try {
            AudioManager am = (AudioManager) activity.getSystemService(Activity.AUDIO_SERVICE);
            if (am == null) return false;
            long eventTime = SystemClock.uptimeMillis();
            KeyEvent down = new KeyEvent(eventTime, eventTime, KeyEvent.ACTION_DOWN, keyCode, 0);
            KeyEvent up = new KeyEvent(eventTime, eventTime, KeyEvent.ACTION_UP, keyCode, 0);
            am.dispatchMediaKeyEvent(down);
            am.dispatchMediaKeyEvent(up);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private void scheduleDirectAutoplayKick(String targetPlayer) {
        final String target = targetPlayer != null ? targetPlayer.toLowerCase(Locale.ROOT) : "";
        long[] delays = new long[] { 950L, 1950L };
        for (long delay : delays) {
            bridgeHandler.postDelayed(() -> {
                try {
                    AudioManager am = (AudioManager) activity.getSystemService(Activity.AUDIO_SERVICE);
                    if (am != null && am.isMusicActive()) {
                        return;
                    }
                    boolean controlled = false;
                    if (target.contains("lark")) {
                        controlled = KevinNotificationListenerService.controlLarkMediaSession(activity, "play", 0L);
                    } else if (target.contains("audiomack")) {
                        controlled = KevinNotificationListenerService.controlAudiomackMediaSession(activity, "play", 0L);
                    }
                    if (!controlled) {
                        dispatchMediaKey(KeyEvent.KEYCODE_MEDIA_PLAY);
                    }
                } catch (Exception ignored) {}
            }, delay);
        }
    }

    private String writeM3uPlaylistFile(String playlistName, JSONArray songs) {
        if (TextUtils.isEmpty(playlistName) || songs == null || songs.length() == 0) return "";
        try {
            String safeFileName = playlistName.trim().replaceAll("[^\\p{L}\\p{N}_\\- ]", "_").replaceAll("\\s+", "_") + ".m3u";
            File dir = null;
            if (hasAudioStoragePermission()) {
                File pubMusic = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC);
                if (pubMusic != null) {
                    File candidate = new File(pubMusic, "KevinPlaylists");
                    if (candidate.exists() || candidate.mkdirs()) {
                        dir = candidate;
                    }
                }
            }
            if (dir == null) {
                File appMusic = activity.getExternalFilesDir(Environment.DIRECTORY_MUSIC);
                if (appMusic != null) {
                    File candidate = new File(appMusic, "KevinPlaylists");
                    if (candidate.exists() || candidate.mkdirs()) {
                        dir = candidate;
                    }
                }
            }
            if (dir == null) return "";
            File outFile = new File(dir, safeFileName);
            StringBuilder sb = new StringBuilder("#EXTM3U\n");
            for (int i = 0; i < songs.length(); i++) {
                JSONObject s = songs.optJSONObject(i);
                if (s == null) continue;
                String title = s.optString("title", "Unknown");
                String artist = s.optString("artist", "");
                long durSec = Math.max(-1L, s.optLong("durationMs", 0L) / 1000L);
                String path = s.optString("path", "");
                String uri = s.optString("uri", "");
                String target = !TextUtils.isEmpty(path) ? path : uri;
                if (TextUtils.isEmpty(target)) continue;
                sb.append("#EXTINF:").append(durSec).append(",");
                if (!TextUtils.isEmpty(artist)) {
                    sb.append(artist).append(" - ");
                }
                sb.append(title).append("\n").append(target).append("\n");
            }
            try (FileOutputStream fos = new FileOutputStream(outFile)) {
                fos.write(sb.toString().getBytes(StandardCharsets.UTF_8));
            }
            return outFile.getAbsolutePath();
        } catch (Exception ignored) {
            return "";
        }
    }

    @JavascriptInterface
    public boolean playInLarkPlayer(String songIdOrQuery, String songTitle, String artist) {
        activity.runOnUiThread(() -> {
            try {
                String larkPkg = findInstalledLarkPlayerPackage();
                Uri songContentUri = null;
                String resolvedMime = "audio/mpeg";
                String resolvedTitle = songTitle != null ? songTitle.trim() : "";
                String resolvedArtist = artist != null ? artist.trim() : "";

                if (!TextUtils.isEmpty(songIdOrQuery) && songIdOrQuery.startsWith("content://")) {
                    songContentUri = Uri.parse(songIdOrQuery);
                } else if (hasAudioStoragePermission()) {
                    String combinedSearch = (!TextUtils.isEmpty(resolvedTitle) ? resolvedTitle : (songIdOrQuery != null ? songIdOrQuery : ""))
                            + (!TextUtils.isEmpty(resolvedArtist) ? " " + resolvedArtist : "");
                    JSONArray matches = queryMatchingSongsArray(combinedSearch.trim(), 5);
                    if (matches.length() == 0 && !TextUtils.isEmpty(songIdOrQuery) && !songIdOrQuery.equals(resolvedTitle)) {
                        matches = queryMatchingSongsArray(songIdOrQuery, 5);
                    }
                    if (matches.length() > 0) {
                        JSONObject top = matches.optJSONObject(0);
                        if (top != null) {
                            String uriStr = top.optString("uri", "");
                            if (!TextUtils.isEmpty(uriStr)) {
                                songContentUri = Uri.parse(uriStr);
                            }
                            if (TextUtils.isEmpty(resolvedTitle)) {
                                resolvedTitle = top.optString("title", "");
                            }
                            if (TextUtils.isEmpty(resolvedArtist)) {
                                resolvedArtist = top.optString("artist", "");
                            }
                            String mime = top.optString("mimeType", "");
                            if (!TextUtils.isEmpty(mime)) {
                                resolvedMime = mime;
                            }
                        }
                    }
                }

                PackageManager pm = activity.getPackageManager();
                reapplySavedEqualizerIfEnabled();
                if (songContentUri != null) {
                    String[] mimesToTry = new String[] { resolvedMime, "audio/*", "audio/mpeg" };
                    for (String mime : mimesToTry) {
                        Intent playIntent = new Intent(Intent.ACTION_VIEW);
                        playIntent.setDataAndType(songContentUri, mime);
                        playIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        if (larkPkg != null) {
                            playIntent.setPackage(larkPkg);
                        }
                        try {
                            if (pm.resolveActivity(playIntent, 0) != null) {
                                JSONObject ensureTask = new JSONObject();
                                ensureTask.put("action", "ensure_play");
                                ensureTask.put("songTitle", resolvedTitle);
                                KevinAgentPrefs.armPendingLarkAction(activity, ensureTask.toString(), 7_500L);
                                if (startActivitySafely(playIntent)) {
                                    scheduleDirectAutoplayKick("lark");
                                    return;
                                }
                            }
                        } catch (Exception ignored) {}
                    }
                }

                String queryToSearch = !TextUtils.isEmpty(resolvedTitle) ? resolvedTitle : (songIdOrQuery != null ? songIdOrQuery : "");
                if (!TextUtils.isEmpty(queryToSearch)) {
                    Intent searchIntent = new Intent(android.provider.MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH);
                    searchIntent.putExtra(android.app.SearchManager.QUERY, queryToSearch);
                    if (!TextUtils.isEmpty(resolvedArtist)) {
                        searchIntent.putExtra(android.provider.MediaStore.EXTRA_MEDIA_ARTIST, resolvedArtist);
                    }
                    if (!TextUtils.isEmpty(resolvedTitle)) {
                        searchIntent.putExtra(android.provider.MediaStore.EXTRA_MEDIA_TITLE, resolvedTitle);
                    }
                    searchIntent.putExtra(android.provider.MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/*");
                    searchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    if (larkPkg != null) {
                        searchIntent.setPackage(larkPkg);
                    }
                    try {
                        if (pm.resolveActivity(searchIntent, 0) != null) {
                            JSONObject task = new JSONObject();
                            task.put("action", "play");
                            task.put("query", queryToSearch);
                            task.put("songTitle", resolvedTitle);
                            task.put("artist", resolvedArtist);
                            KevinAgentPrefs.armPendingLarkAction(activity, task.toString(), 25_000L);
                            if (startActivitySafely(searchIntent)) {
                                return;
                            }
                        }
                    } catch (Exception ignored) {}
                }

                JSONObject task = new JSONObject();
                task.put("action", "play");
                task.put("query", queryToSearch);
                task.put("songTitle", resolvedTitle);
                task.put("artist", resolvedArtist);
                launchLarkPlayerHome(larkPkg, task.toString());
            } catch (Exception ignored) {}
        });
        return true;
    }

    @JavascriptInterface
    public String executeLarkPlayerAction(String actionJson) {
        JSONObject result = new JSONObject();
        try {
            JSONObject req = !TextUtils.isEmpty(actionJson) ? new JSONObject(actionJson) : new JSONObject();
            String action = req.optString("action", "play").trim().toLowerCase(Locale.ROOT);
            String query = req.optString("query", "").trim();
            String songTitle = req.optString("songTitle", req.optString("song_title", "")).trim();
            String artist = req.optString("artist", "").trim();
            String playlistName = req.optString("playlistName", req.optString("playlist_name", "")).trim();
            String tab = req.optString("tab", "").trim();
            int volumePercent = req.optInt("volumePercent", req.optInt("volume_percent", -1));
            long seekMs = req.optLong("seekMs", req.optInt("seek_seconds", 0) * 1000L);

            String larkPkg = findInstalledLarkPlayerPackage();
            boolean hasPerm = hasAudioStoragePermission();
            result.put("ok", true);
            result.put("action", action);
            result.put("larkInstalled", larkPkg != null);
            result.put("larkPackage", larkPkg != null ? larkPkg : "");
            result.put("hasMusicPermission", hasPerm);
            result.put("hasAccessibility", isAccessibilityEnabled());

            if (!hasPerm && ("list_songs".equals(action) || "list_artists".equals(action) || "list_albums".equals(action)
                    || "list_folders".equals(action))) {
                requestAgentPermissions();
            }

            if ("now_playing".equals(action)) {
                JSONObject np = new JSONObject(KevinNotificationListenerService.getLarkNowPlayingJson(activity));
                result.put("nowPlaying", np);
                return result.toString();
            }

            if ("volume_up".equals(action) || "volume_down".equals(action) || "set_volume".equals(action)
                    || "mute".equals(action) || "unmute".equals(action)) {
                AudioManager am = (AudioManager) activity.getSystemService(Activity.AUDIO_SERVICE);
                if (am != null) {
                    int maxVol = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                    int curVol = am.getStreamVolume(AudioManager.STREAM_MUSIC);
                    if ("volume_up".equals(action)) {
                        am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI);
                    } else if ("volume_down".equals(action)) {
                        am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI);
                    } else if ("mute".equals(action)) {
                        am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_MUTE, AudioManager.FLAG_SHOW_UI);
                    } else if ("unmute".equals(action)) {
                        am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, AudioManager.FLAG_SHOW_UI);
                    } else if ("set_volume".equals(action) && volumePercent >= 0) {
                        int targetVol = Math.max(0, Math.min(maxVol, Math.round((volumePercent / 100.0f) * maxVol)));
                        am.setStreamVolume(AudioManager.STREAM_MUSIC, targetVol, AudioManager.FLAG_SHOW_UI);
                    }
                    int updatedVol = am.getStreamVolume(AudioManager.STREAM_MUSIC);
                    result.put("volumePercent", maxVol > 0 ? Math.round((updatedVol * 100.0f) / maxVol) : 0);
                }
                return result.toString();
            }

            if ("pause".equals(action) || "resume".equals(action) || "toggle".equals(action)
                    || "stop".equals(action) || "next".equals(action) || "previous".equals(action)
                    || "prev".equals(action) || "fast_forward".equals(action) || "rewind".equals(action)
                    || "seek".equals(action)) {
                boolean controlled = KevinNotificationListenerService.controlLarkMediaSession(activity, action, seekMs);
                if (!controlled) {
                    int keyCode = -1;
                    switch (action) {
                        case "pause": keyCode = KeyEvent.KEYCODE_MEDIA_PAUSE; break;
                        case "resume": keyCode = KeyEvent.KEYCODE_MEDIA_PLAY; break;
                        case "toggle": keyCode = KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE; break;
                        case "stop": keyCode = KeyEvent.KEYCODE_MEDIA_STOP; break;
                        case "next": keyCode = KeyEvent.KEYCODE_MEDIA_NEXT; break;
                        case "previous":
                        case "prev": keyCode = KeyEvent.KEYCODE_MEDIA_PREVIOUS; break;
                        case "fast_forward": keyCode = KeyEvent.KEYCODE_MEDIA_FAST_FORWARD; break;
                        case "rewind": keyCode = KeyEvent.KEYCODE_MEDIA_REWIND; break;
                    }
                    if (keyCode != -1) {
                        controlled = dispatchMediaKey(keyCode);
                    }
                }
                if (!controlled && larkPkg != null) {
                    JSONObject pending = new JSONObject();
                    pending.put("action", action);
                    activity.runOnUiThread(() -> launchLarkPlayerHome(larkPkg, pending.toString()));
                }
                result.put("controlled", controlled);
                result.put("nowPlaying", new JSONObject(KevinNotificationListenerService.getLarkNowPlayingJson(activity)));
                return result.toString();
            }

            if ("list_songs".equals(action)) {
                JSONArray songs = queryMatchingSongsArray(query, 80);
                result.put("songs", songs);
                return result.toString();
            }

            if ("list_playlists".equals(action)) {
                JSONArray playlists = new JSONArray(KevinAgentPrefs.getLarkPlaylistsJson(activity));
                result.put("playlists", playlists);
                activity.runOnUiThread(() -> {
                    try {
                        JSONObject pending = new JSONObject();
                        pending.put("action", "list_playlists");
                        launchLarkPlayerHome(larkPkg, pending.toString());
                    } catch (Exception ignored) {}
                });
                return result.toString();
            }

            if ("list_artists".equals(action) || "list_albums".equals(action) || "list_folders".equals(action)) {
                JSONArray allSongs = queryMatchingSongsArray(query, 500);
                Set<String> items = new LinkedHashSet<>();
                for (int i = 0; i < allSongs.length(); i++) {
                    JSONObject s = allSongs.optJSONObject(i);
                    if (s == null) continue;
                    if ("list_artists".equals(action)) {
                        String a = s.optString("artist", "");
                        if (!TextUtils.isEmpty(a)) items.add(a);
                    } else if ("list_albums".equals(action)) {
                        String a = s.optString("album", "");
                        if (!TextUtils.isEmpty(a)) items.add(a);
                    } else {
                        String p = s.optString("path", "");
                        if (!TextUtils.isEmpty(p)) {
                            File f = new File(p).getParentFile();
                            if (f != null) items.add(f.getName());
                        }
                    }
                }
                result.put("items", new JSONArray(items));
                result.put("songs", allSongs);
                activity.runOnUiThread(() -> {
                    try {
                        JSONObject pending = new JSONObject();
                        pending.put("action", action);
                        launchLarkPlayerHome(larkPkg, pending.toString());
                    } catch (Exception ignored) {}
                });
                return result.toString();
            }

            if ("delete_playlist".equals(action)) {
                String pName = !TextUtils.isEmpty(playlistName) ? playlistName : query;
                boolean deleted = KevinAgentPrefs.deleteLarkPlaylist(activity, pName);
                result.put("deleted", deleted);
                result.put("playlists", new JSONArray(KevinAgentPrefs.getLarkPlaylistsJson(activity)));
                return result.toString();
            }

            if ("create_playlist".equals(action) || "add_to_playlist".equals(action)) {
                String pName = !TextUtils.isEmpty(playlistName) ? playlistName : (!TextUtils.isEmpty(query) ? query : "Kevin Mix");
                JSONArray matchedSongs = new JSONArray();
                Set<String> seenIds = new LinkedHashSet<>();
                JSONArray requestedSongs = req.optJSONArray("songs");
                if (requestedSongs != null && requestedSongs.length() > 0) {
                    for (int i = 0; i < requestedSongs.length(); i++) {
                        String sq = requestedSongs.optString(i, "").trim();
                        if (TextUtils.isEmpty(sq)) continue;
                        JSONArray found = queryMatchingSongsArray(sq, 6);
                        for (int j = 0; j < found.length(); j++) {
                            JSONObject s = found.optJSONObject(j);
                            if (s != null && seenIds.add(s.optString("id", s.optString("title", "")))) {
                                matchedSongs.put(s);
                            }
                        }
                    }
                }
                if (matchedSongs.length() == 0) {
                    String searchTerms = (!TextUtils.isEmpty(query) ? query : (!TextUtils.isEmpty(artist) ? artist : songTitle));
                    JSONArray found = queryMatchingSongsArray(searchTerms, 25);
                    if (found.length() == 0 && !TextUtils.isEmpty(searchTerms)) {
                        found = queryMatchingSongsArray("", 15);
                    }
                    matchedSongs = found;
                }

                boolean append = "add_to_playlist".equals(action);
                KevinAgentPrefs.saveLarkPlaylist(activity, pName, matchedSongs, append);
                String m3uPath = writeM3uPlaylistFile(pName, matchedSongs);

                JSONObject pending = new JSONObject();
                pending.put("action", action);
                pending.put("playlistName", pName);
                pending.put("query", query);
                JSONArray titles = new JSONArray();
                for (int i = 0; i < Math.min(matchedSongs.length(), 10); i++) {
                    JSONObject s = matchedSongs.optJSONObject(i);
                    if (s != null) titles.put(s.optString("title", ""));
                }
                pending.put("songTitles", titles);

                final String finalPending = pending.toString();
                activity.runOnUiThread(() -> launchLarkPlayerHome(larkPkg, finalPending));

                result.put("songs", matchedSongs);
                result.put("playlistName", pName);
                result.put("m3uPath", m3uPath);
                result.put("playlists", new JSONArray(KevinAgentPrefs.getLarkPlaylistsJson(activity)));
                return result.toString();
            }

            if ("play_playlist".equals(action)) {
                String pName = !TextUtils.isEmpty(playlistName) ? playlistName : query;
                JSONObject savedPl = KevinAgentPrefs.findLarkPlaylist(activity, pName);
                JSONArray plSongs = savedPl != null ? savedPl.optJSONArray("songs") : null;
                if (plSongs != null && plSongs.length() > 0) {
                    result.put("songs", plSongs);
                    JSONObject first = plSongs.optJSONObject(0);
                    if (first != null && !TextUtils.isEmpty(first.optString("uri", ""))) {
                        playInLarkPlayer(first.optString("uri"), first.optString("title", ""), first.optString("artist", ""));
                        return result.toString();
                    }
                }
                JSONObject pending = new JSONObject();
                pending.put("action", "play_playlist");
                pending.put("playlistName", pName);
                pending.put("query", query);
                final String finalPending = pending.toString();
                activity.runOnUiThread(() -> launchLarkPlayerHome(larkPkg, finalPending));
                return result.toString();
            }

            if ("open".equals(action) || "open_app".equals(action)) {
                activity.runOnUiThread(() -> launchLarkPlayerHome(larkPkg, ""));
                return result.toString();
            }

            if ("play".equals(action) || "play_song".equals(action)) {
                String target = !TextUtils.isEmpty(songTitle) ? songTitle : query;
                String searchCombined = (target + " " + artist).trim();
                JSONArray matched = queryMatchingSongsArray(searchCombined, 15);
                result.put("songs", matched);
                playInLarkPlayer(
                        matched.length() > 0 ? matched.optJSONObject(0).optString("uri", target) : target,
                        songTitle,
                        artist
                );
                return result.toString();
            }

            if ("equalizer".equals(action) || "eq".equals(action)
                    || "set_equalizer".equals(action) || "toggle_equalizer".equals(action)
                    || "bass_boost".equals(action)) {
                JSONObject eqConfig = buildNormalizedEqualizerConfig(req, action);
                JSONObject eqResult = applySystemEqualizerSettings(eqConfig);
                result.put("equalizerState", eqConfig);
                result.put("audioFx", eqResult);

                JSONObject pending = new JSONObject(eqConfig.toString());
                pending.put("action", "equalizer");
                final String finalPending = pending.toString();
                activity.runOnUiThread(() -> {
                    try {
                        if (larkPkg != null) {
                            launchLarkPlayerHome(larkPkg, finalPending);
                        } else {
                            Intent eqIntent = new Intent(android.media.audiofx.AudioEffect.ACTION_DISPLAY_AUDIO_EFFECT_CONTROL_PANEL);
                            eqIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            activity.startActivity(eqIntent);
                        }
                    } catch (Exception ignored) {}
                });
                return result.toString();
            }

            // All other Lark Player features (search, play_all, shuffle_all, shuffle, repeat, loop, favorite, sleep_timer, lyrics, queue, add_to_queue, play_next, open_tab, share, ringtone, speed)
            JSONObject pending = new JSONObject();
            pending.put("action", action);
            pending.put("query", query);
            pending.put("songTitle", songTitle);
            pending.put("artist", artist);
            pending.put("playlistName", playlistName);
            pending.put("tab", tab);
            final String finalPending = pending.toString();
            activity.runOnUiThread(() -> launchLarkPlayerHome(larkPkg, finalPending));
            return result.toString();
        } catch (Exception e) {
            try {
                result.put("ok", false);
                result.put("error", e.getMessage());
            } catch (Exception ignored) {}
            return result.toString();
        }
    }

    @JavascriptInterface
    public String getLarkPlaylistsJson() {
        return KevinAgentPrefs.getLarkPlaylistsJson(activity);
    }

    @JavascriptInterface
    public String getLarkNowPlayingJson() {
        return KevinNotificationListenerService.getLarkNowPlayingJson(activity);
    }

    @JavascriptInterface
    public String getLarkLibrarySummaryJson() {
        JSONObject summary = new JSONObject();
        try {
            JSONArray songs = queryMatchingSongsArray("", 500);
            Set<String> artists = new LinkedHashSet<>();
            Set<String> albums = new LinkedHashSet<>();
            Set<String> folders = new LinkedHashSet<>();
            for (int i = 0; i < songs.length(); i++) {
                JSONObject s = songs.optJSONObject(i);
                if (s == null) continue;
                String a = s.optString("artist", "");
                String al = s.optString("album", "");
                String p = s.optString("path", "");
                if (!TextUtils.isEmpty(a)) artists.add(a);
                if (!TextUtils.isEmpty(al)) albums.add(al);
                if (!TextUtils.isEmpty(p)) {
                    File pf = new File(p).getParentFile();
                    if (pf != null) folders.add(pf.getName());
                }
            }
            summary.put("larkInstalled", findInstalledLarkPlayerPackage() != null);
            summary.put("hasMusicPermission", hasAudioStoragePermission());
            summary.put("songCount", songs.length());
            summary.put("artistCount", artists.size());
            summary.put("albumCount", albums.size());
            summary.put("folderCount", folders.size());
            summary.put("playlists", new JSONArray(KevinAgentPrefs.getLarkPlaylistsJson(activity)));
        } catch (Exception ignored) {}
        return summary.toString();
    }

    public String findInstalledAudiomackPackage() {
        PackageManager pm = activity.getPackageManager();
        String[] candidatePkgs = new String[] {
                "com.audiomack",
                "com.audiomack.lite"
        };
        for (String pkg : candidatePkgs) {
            try {
                pm.getPackageInfo(pkg, 0);
                return pkg;
            } catch (Exception ignored) {}
            try {
                if (pm.getLaunchIntentForPackage(pkg) != null) {
                    return pkg;
                }
            } catch (Exception ignored) {}
        }
        try {
            Intent mainLauncher = new Intent(Intent.ACTION_MAIN);
            mainLauncher.addCategory(Intent.CATEGORY_LAUNCHER);
            List<android.content.pm.ResolveInfo> infos = pm.queryIntentActivities(mainLauncher, 0);
            for (android.content.pm.ResolveInfo info : infos) {
                if (info.activityInfo == null || info.activityInfo.packageName == null) continue;
                String pLower = info.activityInfo.packageName.toLowerCase(Locale.ROOT);
                if (pLower.contains("audiomack")) {
                    return info.activityInfo.packageName;
                }
                try {
                    CharSequence label = info.loadLabel(pm);
                    if (label != null) {
                        String l = label.toString().toLowerCase(Locale.ROOT);
                        if (l.contains("audiomack") || l.contains("audio mack")) {
                            return info.activityInfo.packageName;
                        }
                    }
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
        try {
            List<android.content.pm.ApplicationInfo> apps = pm.getInstalledApplications(0);
            for (android.content.pm.ApplicationInfo app : apps) {
                if (app.packageName != null) {
                    String pkgLower = app.packageName.toLowerCase(Locale.ROOT);
                    if (pkgLower.contains("audiomack")) {
                        return app.packageName;
                    }
                    try {
                        CharSequence label = pm.getApplicationLabel(app);
                        if (label != null) {
                            String l = label.toString().toLowerCase(Locale.ROOT);
                            if (l.contains("audiomack") || l.contains("audio mack")) {
                                return app.packageName;
                            }
                        }
                    } catch (Exception ignored) {}
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private boolean launchAudiomackHome(String amPkg, String pendingActionJson, String webFallbackUrl) {
        if (!TextUtils.isEmpty(pendingActionJson)) {
            KevinAgentPrefs.armPendingAudiomackAction(activity, pendingActionJson, 28_000L);
        }
        if (amPkg != null) {
            Intent launchIntent = buildPackageLaunchIntent(amPkg);
            if (launchIntent != null && startActivitySafely(launchIntent)) {
                return true;
            }
        }
        if (!TextUtils.isEmpty(webFallbackUrl)) {
            Intent webIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(webFallbackUrl));
            return startActivitySafely(webIntent);
        }
        return false;
    }

    @JavascriptInterface
    public boolean openAudiomack(String query, String action) {
        try {
            JSONObject req = new JSONObject();
            req.put("query", query != null ? query : "");
            req.put("action", !TextUtils.isEmpty(action) ? action : (TextUtils.isEmpty(query) ? "open" : "play"));
            executeAudiomackAction(req.toString());
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    @JavascriptInterface
    public String executeAudiomackAction(String actionJson) {
        JSONObject result = new JSONObject();
        try {
            JSONObject req = !TextUtils.isEmpty(actionJson) ? new JSONObject(actionJson) : new JSONObject();
            String action = req.optString("action", "play").trim().toLowerCase(Locale.ROOT);
            String query = req.optString("query", "").trim();
            String songTitle = req.optString("songTitle", req.optString("song_title", "")).trim();
            String artist = req.optString("artist", "").trim();
            String playlistName = req.optString("playlistName", req.optString("playlist_name", "")).trim();
            String tab = req.optString("tab", "").trim();
            int volumePercent = req.optInt("volumePercent", req.optInt("volume_percent", -1));
            long seekMs = req.optLong("seekMs", req.optInt("seek_seconds", 0) * 1000L);

            String effectiveQuery = !TextUtils.isEmpty(query)
                    ? query
                    : ((!TextUtils.isEmpty(songTitle) ? songTitle : "")
                            + (!TextUtils.isEmpty(artist) ? " " + artist : "")).trim();
            String webFallbackUrl = !TextUtils.isEmpty(effectiveQuery)
                    ? "https://audiomack.com/search?q=" + Uri.encode(effectiveQuery)
                    : "https://audiomack.com";

            String amPkg = findInstalledAudiomackPackage();
            result.put("ok", true);
            result.put("action", action);
            result.put("audiomackInstalled", amPkg != null);
            result.put("audiomackPackage", amPkg != null ? amPkg : "");
            result.put("hasAccessibility", isAccessibilityEnabled());
            result.put("webFallbackUrl", webFallbackUrl);

            if ("now_playing".equals(action)) {
                JSONObject np = new JSONObject(KevinNotificationListenerService.getAudiomackNowPlayingJson(activity));
                result.put("nowPlaying", np);
                return result.toString();
            }

            if ("volume_up".equals(action) || "volume_down".equals(action) || "set_volume".equals(action)
                    || "mute".equals(action) || "unmute".equals(action)) {
                AudioManager am = (AudioManager) activity.getSystemService(Activity.AUDIO_SERVICE);
                if (am != null) {
                    int maxVol = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                    if ("volume_up".equals(action)) {
                        am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI);
                    } else if ("volume_down".equals(action)) {
                        am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI);
                    } else if ("mute".equals(action)) {
                        am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_MUTE, AudioManager.FLAG_SHOW_UI);
                    } else if ("unmute".equals(action)) {
                        am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, AudioManager.FLAG_SHOW_UI);
                    } else if ("set_volume".equals(action) && volumePercent >= 0) {
                        int targetVol = Math.max(0, Math.min(maxVol, Math.round((volumePercent / 100.0f) * maxVol)));
                        am.setStreamVolume(AudioManager.STREAM_MUSIC, targetVol, AudioManager.FLAG_SHOW_UI);
                    }
                    int updatedVol = am.getStreamVolume(AudioManager.STREAM_MUSIC);
                    result.put("volumePercent", maxVol > 0 ? Math.round((updatedVol * 100.0f) / maxVol) : 0);
                }
                return result.toString();
            }

            if ("pause".equals(action) || "resume".equals(action) || "toggle".equals(action)
                    || "stop".equals(action) || "next".equals(action) || "previous".equals(action)
                    || "prev".equals(action) || "fast_forward".equals(action) || "rewind".equals(action)
                    || "seek".equals(action)) {
                boolean controlled = KevinNotificationListenerService.controlAudiomackMediaSession(activity, action, seekMs);
                if (!controlled) {
                    int keyCode = -1;
                    switch (action) {
                        case "pause": keyCode = KeyEvent.KEYCODE_MEDIA_PAUSE; break;
                        case "resume": keyCode = KeyEvent.KEYCODE_MEDIA_PLAY; break;
                        case "toggle": keyCode = KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE; break;
                        case "stop": keyCode = KeyEvent.KEYCODE_MEDIA_STOP; break;
                        case "next": keyCode = KeyEvent.KEYCODE_MEDIA_NEXT; break;
                        case "previous":
                        case "prev": keyCode = KeyEvent.KEYCODE_MEDIA_PREVIOUS; break;
                        case "fast_forward": keyCode = KeyEvent.KEYCODE_MEDIA_FAST_FORWARD; break;
                        case "rewind": keyCode = KeyEvent.KEYCODE_MEDIA_REWIND; break;
                    }
                    if (keyCode != -1) {
                        controlled = dispatchMediaKey(keyCode);
                    }
                }
                if (!controlled && amPkg != null) {
                    JSONObject pending = new JSONObject();
                    pending.put("action", action);
                    final String finalPending = pending.toString();
                    activity.runOnUiThread(() -> launchAudiomackHome(amPkg, finalPending, webFallbackUrl));
                }
                result.put("controlled", controlled);
                result.put("nowPlaying", new JSONObject(KevinNotificationListenerService.getAudiomackNowPlayingJson(activity)));
                return result.toString();
            }

            if ("list_playlists".equals(action)) {
                JSONArray playlists = new JSONArray(KevinAgentPrefs.getAudiomackPlaylistsJson(activity));
                result.put("playlists", playlists);
                if (amPkg != null) {
                    JSONObject pending = new JSONObject();
                    pending.put("action", "list_playlists");
                    final String finalPending = pending.toString();
                    activity.runOnUiThread(() -> launchAudiomackHome(amPkg, finalPending, webFallbackUrl));
                } else {
                    activity.runOnUiThread(() -> launchAudiomackHome(null, "", "https://audiomack.com/my-library/playlists"));
                }
                return result.toString();
            }

            if ("create_playlist".equals(action) || "add_to_playlist".equals(action)) {
                String pName = !TextUtils.isEmpty(playlistName) ? playlistName : (!TextUtils.isEmpty(query) ? query : "Kevin Mix");
                JSONArray trackedSongs = new JSONArray();
                if (!TextUtils.isEmpty(songTitle) || !TextUtils.isEmpty(effectiveQuery)) {
                    JSONObject songEntry = new JSONObject();
                    songEntry.put("title", !TextUtils.isEmpty(songTitle) ? songTitle : effectiveQuery);
                    songEntry.put("artist", artist);
                    trackedSongs.put(songEntry);
                }
                KevinAgentPrefs.saveAudiomackPlaylist(activity, pName, trackedSongs, "add_to_playlist".equals(action));
                result.put("playlistName", pName);
                result.put("playlists", new JSONArray(KevinAgentPrefs.getAudiomackPlaylistsJson(activity)));
            }

            if ("open".equals(action) || "open_app".equals(action)) {
                activity.runOnUiThread(() -> launchAudiomackHome(amPkg, "", webFallbackUrl));
                return result.toString();
            }

            if ("equalizer".equals(action) || "eq".equals(action)
                    || "set_equalizer".equals(action) || "toggle_equalizer".equals(action)
                    || "bass_boost".equals(action)) {
                JSONObject eqConfig = buildNormalizedEqualizerConfig(req, action);
                JSONObject eqResult = applySystemEqualizerSettings(eqConfig);
                result.put("equalizerState", eqConfig);
                result.put("audioFx", eqResult);

                JSONObject pending = new JSONObject(eqConfig.toString());
                pending.put("action", "equalizer");
                final String finalPending = pending.toString();
                activity.runOnUiThread(() -> {
                    try {
                        if (amPkg != null) {
                            launchAudiomackHome(amPkg, finalPending, webFallbackUrl);
                        } else {
                            Intent eqIntent = new Intent(android.media.audiofx.AudioEffect.ACTION_DISPLAY_AUDIO_EFFECT_CONTROL_PANEL);
                            eqIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            activity.startActivity(eqIntent);
                        }
                    } catch (Exception ignored) {}
                });
                return result.toString();
            }

            if (amPkg == null) {
                activity.runOnUiThread(() -> launchAudiomackHome(null, "", webFallbackUrl));
                return result.toString();
            }

            // Build pending task for Audiomack Accessibility Automation (play, search, create_playlist, add_to_playlist, play_playlist, download, favorite, repost, follow, queue, add_to_queue, play_next, shuffle, repeat, sleep_timer, lyrics, share, open_tab)
            JSONObject pending = new JSONObject();
            pending.put("action", action);
            pending.put("query", effectiveQuery);
            pending.put("songTitle", songTitle);
            pending.put("artist", artist);
            pending.put("playlistName", playlistName);
            pending.put("tab", tab);
            final String finalPending = pending.toString();

            reapplySavedEqualizerIfEnabled();
            KevinAgentPrefs.armPendingAudiomackAction(activity, finalPending, 28_000L);
            activity.runOnUiThread(() -> launchAudiomackHome(amPkg, finalPending, webFallbackUrl));
            return result.toString();
        } catch (Exception e) {
            try {
                result.put("ok", false);
                result.put("error", e.getMessage());
            } catch (Exception ignored) {}
            return result.toString();
        }
    }

    @JavascriptInterface
    public String getAudiomackNowPlayingJson() {
        return KevinNotificationListenerService.getAudiomackNowPlayingJson(activity);
    }

    @JavascriptInterface
    public String getAudiomackPlaylistsJson() {
        return KevinAgentPrefs.getAudiomackPlaylistsJson(activity);
    }

    @JavascriptInterface
    public String placeCall(String phoneNumber) {
        if (TextUtils.isEmpty(phoneNumber)) return "invalid_number";
        String sanitized = phoneNumber.trim().replaceAll("[^\\d+*#]", "");
        if (sanitized.length() < 3) return "invalid_number";

        boolean hasCallPerm = ContextCompat.checkSelfPermission(activity, Manifest.permission.CALL_PHONE)
                == PackageManager.PERMISSION_GRANTED;

        activity.runOnUiThread(() -> {
            try {
                Uri telUri = Uri.fromParts("tel", sanitized, null);
                Intent intent = new Intent(
                        hasCallPerm ? Intent.ACTION_CALL : Intent.ACTION_DIAL,
                        telUri
                );
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
            } catch (Exception ignored) {}
        });
        return hasCallPerm ? "called" : "dialed_needs_permission";
    }

    @JavascriptInterface
    public String fetchWebNewsRss(String query) {
        if (TextUtils.isEmpty(query)) return "";
        String[] urls = new String[] {
                "https://news.google.com/rss/search?q=" + Uri.encode(query.trim()) + "&hl=en&gl=US&ceid=US:en",
                "https://news.google.com/rss/search?q=" + Uri.encode(query.trim()) + "&hl=en&gl=RW&ceid=RW:en"
        };
        for (String rssUrl : urls) {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(rssUrl);
                conn = (HttpURLConnection) url.openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(2000);
                conn.setReadTimeout(2200);
                conn.setRequestMethod("GET");
                conn.setRequestProperty(
                        "User-Agent",
                        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
                );
                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) {
                    continue;
                }
                BufferedReader reader = new BufferedReader(
                        new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8)
                );
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line).append('\n');
                    if (sb.length() > 200_000) break;
                }
                reader.close();
                String xml = sb.toString();
                if (xml.contains("<item")) {
                    return xml;
                }
            } catch (Exception ignored) {
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        }
        return "";
    }

    private File resolveLocalImageFile(String uriOrPath) {
        if (TextUtils.isEmpty(uriOrPath)) return null;
        String candidate = uriOrPath.trim();
        if (candidate.startsWith("https://localhost/_capacitor_file_")) {
            candidate = Uri.decode(candidate.substring("https://localhost/_capacitor_file_".length()));
        } else if (candidate.startsWith("http://localhost/_capacitor_file_")) {
            candidate = Uri.decode(candidate.substring("http://localhost/_capacitor_file_".length()));
        } else if (candidate.startsWith("file://")) {
            String path = Uri.parse(candidate).getPath();
            if (!TextUtils.isEmpty(path)) {
                candidate = path;
            }
        }
        if (candidate.startsWith("content://")) {
            return null;
        }
        File f = new File(candidate);
        if (f.exists() && f.isFile()) {
            return f;
        }
        String decoded = Uri.decode(candidate);
        File decodedFile = new File(decoded);
        if (decodedFile.exists() && decodedFile.isFile()) {
            return decodedFile;
        }
        return null;
    }

    private InputStream openImageInputStream(String uriOrPath, File localFile) {
        try {
            if (localFile != null) {
                return new FileInputStream(localFile);
            }
            if (!TextUtils.isEmpty(uriOrPath) && uriOrPath.trim().startsWith("content://")) {
                return activity.getContentResolver().openInputStream(Uri.parse(uriOrPath.trim()));
            }
        } catch (Exception ignored) {}
        return null;
    }

    private int readExifOrientation(String uriOrPath, File localFile) {
        try (InputStream is = openImageInputStream(uriOrPath, localFile)) {
            if (is == null) return ExifInterface.ORIENTATION_NORMAL;
            ExifInterface exif = new ExifInterface(is);
            return exif.getAttributeInt(
                    ExifInterface.TAG_ORIENTATION,
                    ExifInterface.ORIENTATION_NORMAL
            );
        } catch (Throwable ignored) {
            return ExifInterface.ORIENTATION_NORMAL;
        }
    }

    @JavascriptInterface
    public String readAndCompressImage(String uriOrPath, int maxDim, int quality) {
        if (TextUtils.isEmpty(uriOrPath)) return "";
        int targetMax = (maxDim >= 320 && maxDim <= 1920) ? maxDim : 1280;
        int safeQuality = (quality >= 40 && quality <= 95) ? quality : 82;

        File localFile = resolveLocalImageFile(uriOrPath);
        if (localFile == null && !uriOrPath.trim().startsWith("content://")) {
            return "";
        }

        Bitmap decoded = null;
        Bitmap transformed = null;
        Bitmap opaque = null;
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            try (InputStream is = openImageInputStream(uriOrPath, localFile)) {
                if (is == null) return "";
                BitmapFactory.decodeStream(is, null, bounds);
            }
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
                return "";
            }

            int orientation = readExifOrientation(uriOrPath, localFile);

            int inSampleSize = 1;
            while ((bounds.outWidth / inSampleSize) > targetMax * 2
                    || (bounds.outHeight / inSampleSize) > targetMax * 2) {
                inSampleSize *= 2;
            }

            BitmapFactory.Options decodeOpts = new BitmapFactory.Options();
            decodeOpts.inSampleSize = inSampleSize;
            decodeOpts.inPreferredConfig = Bitmap.Config.ARGB_8888;

            try (InputStream is = openImageInputStream(uriOrPath, localFile)) {
                if (is == null) return "";
                decoded = BitmapFactory.decodeStream(is, null, decodeOpts);
            } catch (OutOfMemoryError oom) {
                decodeOpts.inSampleSize = Math.max(2, inSampleSize * 2);
                decodeOpts.inPreferredConfig = Bitmap.Config.RGB_565;
                try (InputStream isRetry = openImageInputStream(uriOrPath, localFile)) {
                    if (isRetry != null) {
                        decoded = BitmapFactory.decodeStream(isRetry, null, decodeOpts);
                    }
                }
            }

            if (decoded == null) {
                return "";
            }

            int w = decoded.getWidth();
            int h = decoded.getHeight();
            float scale = Math.min(1.0f, (float) targetMax / Math.max(w, h));

            Matrix matrix = new Matrix();
            boolean hasTransform = scale < 0.999f;
            if (hasTransform) {
                matrix.postScale(scale, scale);
            }
            switch (orientation) {
                case ExifInterface.ORIENTATION_ROTATE_90:
                    matrix.postRotate(90f);
                    hasTransform = true;
                    break;
                case ExifInterface.ORIENTATION_ROTATE_180:
                    matrix.postRotate(180f);
                    hasTransform = true;
                    break;
                case ExifInterface.ORIENTATION_ROTATE_270:
                    matrix.postRotate(270f);
                    hasTransform = true;
                    break;
                case ExifInterface.ORIENTATION_FLIP_HORIZONTAL:
                    matrix.postScale(-1f, 1f);
                    hasTransform = true;
                    break;
                case ExifInterface.ORIENTATION_FLIP_VERTICAL:
                    matrix.postScale(1f, -1f);
                    hasTransform = true;
                    break;
                case ExifInterface.ORIENTATION_TRANSPOSE:
                    matrix.postRotate(90f);
                    matrix.postScale(-1f, 1f);
                    hasTransform = true;
                    break;
                case ExifInterface.ORIENTATION_TRANSVERSE:
                    matrix.postRotate(270f);
                    matrix.postScale(-1f, 1f);
                    hasTransform = true;
                    break;
                default:
                    break;
            }

            if (hasTransform) {
                transformed = Bitmap.createBitmap(decoded, 0, 0, w, h, matrix, true);
                if (transformed != decoded) {
                    decoded.recycle();
                    decoded = null;
                }
            } else {
                transformed = decoded;
                decoded = null;
            }

            Bitmap outputBitmap = transformed;
            if (transformed.hasAlpha()) {
                opaque = Bitmap.createBitmap(
                        transformed.getWidth(),
                        transformed.getHeight(),
                        Bitmap.Config.ARGB_8888
                );
                Canvas canvas = new Canvas(opaque);
                canvas.drawColor(Color.WHITE);
                canvas.drawBitmap(transformed, 0f, 0f, null);
                transformed.recycle();
                transformed = null;
                outputBitmap = opaque;
            }

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            outputBitmap.compress(Bitmap.CompressFormat.JPEG, safeQuality, baos);
            if (baos.size() > 1_500_000) {
                baos.reset();
                outputBitmap.compress(Bitmap.CompressFormat.JPEG, Math.min(safeQuality, 70), baos);
            }

            byte[] jpegBytes = baos.toByteArray();
            if (jpegBytes.length == 0) {
                return "";
            }
            String b64 = Base64.encodeToString(jpegBytes, Base64.NO_WRAP);
            JSONObject out = new JSONObject();
            out.put("base64", "data:image/jpeg;base64," + b64);
            out.put("sizeKb", Math.max(1, Math.round(jpegBytes.length / 1024.0f)));
            return out.toString();
        } catch (Throwable ignored) {
            return "";
        } finally {
            if (decoded != null && !decoded.isRecycled()) {
                decoded.recycle();
            }
            if (transformed != null && !transformed.isRecycled()) {
                transformed.recycle();
            }
            if (opaque != null && !opaque.isRecycled()) {
                opaque.recycle();
            }
        }
    }

    @JavascriptInterface
    public void playPopSound() {
        activity.runOnUiThread(() -> {
            try {
                int resId = activity.getResources().getIdentifier("pop_sound", "raw", activity.getPackageName());
                if (resId != 0) {
                    android.media.MediaPlayer mp = android.media.MediaPlayer.create(activity, resId);
                    if (mp != null) {
                        mp.setAudioStreamType(android.media.AudioManager.STREAM_MUSIC);
                        mp.setOnCompletionListener(android.media.MediaPlayer::release);
                        mp.start();
                        return;
                    }
                }
            } catch (Exception ignored) {}

            try {
                android.content.res.AssetFileDescriptor afd = activity.getAssets().openFd("public/assets/aistudio/mixkit-long-pop-2358_551c9e9a.wav");
                android.media.MediaPlayer mp = new android.media.MediaPlayer();
                mp.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
                afd.close();
                mp.setAudioStreamType(android.media.AudioManager.STREAM_MUSIC);
                mp.prepare();
                mp.setOnCompletionListener(android.media.MediaPlayer::release);
                mp.start();
                return;
            } catch (Exception ignored) {}

            try {
                android.media.ToneGenerator tg = new android.media.ToneGenerator(
                        android.media.AudioManager.STREAM_NOTIFICATION,
                        90
                );
                tg.startTone(android.media.ToneGenerator.TONE_PROP_BEEP, 120);
                new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(tg::release, 200L);
            } catch (Exception ignored) {}
        });
    }

    @JavascriptInterface
    public void playBeep() {
        playPopSound();
    }

    @JavascriptInterface
    public void playNewsNotificationSound() {
        activity.runOnUiThread(() -> {
            try {
                int resId = activity.getResources().getIdentifier("kevin_news_whistle", "raw", activity.getPackageName());
                if (resId != 0) {
                    android.media.MediaPlayer mp = android.media.MediaPlayer.create(activity, resId);
                    if (mp != null) {
                        mp.setAudioStreamType(android.media.AudioManager.STREAM_MUSIC);
                        mp.setOnCompletionListener(android.media.MediaPlayer::release);
                        mp.start();
                        return;
                    }
                }
            } catch (Exception ignored) {}

            try {
                android.content.res.AssetFileDescriptor afd = activity.getAssets().openFd("public/assets/aistudio/samsung_whistle_cce9e4f7.mp3");
                android.media.MediaPlayer mp = new android.media.MediaPlayer();
                mp.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
                afd.close();
                mp.setAudioStreamType(android.media.AudioManager.STREAM_MUSIC);
                mp.prepare();
                mp.setOnCompletionListener(android.media.MediaPlayer::release);
                mp.start();
                return;
            } catch (Exception ignored) {}

            playPopSound();
        });
    }

    private String normalizeEqPresetName(String rawPreset) {
        if (TextUtils.isEmpty(rawPreset)) return "";
        String p = rawPreset.trim().toLowerCase(Locale.ROOT);
        if (p.contains("hip") || p.contains("rap")) return "Hip Hop";
        if (p.contains("heavy") || p.contains("metal")) return "Heavy Metal";
        if (p.contains("classic")) return "Classical";
        if (p.contains("dance") || p.contains("edm") || p.contains("club")) return "Dance";
        if (p.contains("electr")) return "Electronic";
        if (p.contains("acoust")) return "Acoustic";
        if (p.contains("vocal") || p.contains("voice") || p.contains("podcast")) return "Vocal";
        if (p.contains("bass")) return "Bass Boost";
        if (p.contains("r&b") || p.contains("rnb")) return "R&B";
        if (p.contains("rock")) return "Rock";
        if (p.contains("pop")) return "Pop";
        if (p.contains("jazz")) return "Jazz";
        if (p.contains("folk")) return "Folk";
        if (p.contains("flat")) return "Flat";
        if (p.contains("normal") || p.contains("default")) return "Normal";
        if (p.contains("custom")) return "Custom";
        return rawPreset.trim();
    }

    private int clampPercent(int val) {
        return Math.max(0, Math.min(100, val));
    }

    private int normalizeBandValueToPercent(double rawVal, boolean forceDbScale) {
        if (forceDbScale || rawVal < 0.0 || (rawVal <= 15.0 && rawVal != 0.0 && Math.abs(rawVal) <= 15.0 && rawVal != 10.0 && rawVal != 15.0)) {
            double clampedDb = Math.max(-15.0, Math.min(15.0, rawVal));
            return clampPercent((int) Math.round(((clampedDb + 15.0) / 30.0) * 100.0));
        }
        return clampPercent((int) Math.round(rawVal));
    }

    private int[] getDefaultBandsForPreset(String preset) {
        String p = preset != null ? preset.trim().toLowerCase(Locale.ROOT) : "";
        switch (p) {
            case "rock": return new int[] { 72, 60, 42, 63, 74 };
            case "pop": return new int[] { 45, 62, 70, 62, 46 };
            case "hip hop": return new int[] { 78, 66, 50, 56, 68 };
            case "jazz": return new int[] { 65, 56, 44, 60, 68 };
            case "classical": return new int[] { 68, 60, 46, 62, 65 };
            case "dance":
            case "electronic": return new int[] { 76, 68, 52, 66, 72 };
            case "heavy metal": return new int[] { 70, 54, 72, 68, 52 };
            case "folk": return new int[] { 62, 52, 50, 58, 48 };
            case "bass boost": return new int[] { 88, 74, 52, 50, 52 };
            case "vocal": return new int[] { 40, 54, 72, 68, 52 };
            case "acoustic": return new int[] { 62, 56, 54, 62, 60 };
            case "r&b": return new int[] { 70, 74, 52, 46, 58 };
            case "flat":
            case "normal":
            default:
                return new int[] { 50, 50, 50, 50, 50 };
        }
    }

    private JSONObject buildNormalizedEqualizerConfig(JSONObject req, String actionName) {
        JSONObject out = new JSONObject();
        try {
            JSONObject saved = new JSONObject(KevinAgentPrefs.getEqualizerStateJson(activity));
            String rawPreset = req.optString("eqPreset", req.optString("eq_preset", req.optString("preset", ""))).trim();
            String normPreset = normalizeEqPresetName(rawPreset);

            boolean hasExplicitEnabled = req.has("eqEnabled") || req.has("eq_enabled") || req.has("enabled");
            boolean eqEnabled = hasExplicitEnabled
                    ? req.optBoolean("eqEnabled", req.optBoolean("eq_enabled", req.optBoolean("enabled", true)))
                    : true;
            if ("off".equalsIgnoreCase(rawPreset) || "disable".equalsIgnoreCase(rawPreset)) {
                eqEnabled = false;
                normPreset = "";
            }

            boolean hasBass = req.has("bassBoost") || req.has("bass_boost") || "bass_boost".equals(actionName);
            int bassBoost = req.optInt("bassBoost", req.optInt("bass_boost",
                    "bass_boost".equals(actionName) ? 85 : saved.optInt("bassBoost", 0)));
            bassBoost = clampPercent(bassBoost);
            if ("Bass Boost".equals(normPreset) && !req.has("bassBoost") && !req.has("bass_boost")) {
                hasBass = true;
                bassBoost = 85;
            }

            boolean hasVirtualizer = req.has("virtualizer") || req.has("surround");
            int virtualizer = clampPercent(req.optInt("virtualizer", req.optInt("surround", saved.optInt("virtualizer", 0))));

            boolean hasLoudness = req.has("loudness") || req.has("preamp");
            int loudness = clampPercent(req.optInt("loudness", req.optInt("preamp", saved.optInt("loudness", 0))));

            String reverb = req.optString("reverb", "").trim();

            JSONArray rawBandsArr = req.optJSONArray("eqBands");
            if (rawBandsArr == null) rawBandsArr = req.optJSONArray("eq_bands");
            if (rawBandsArr == null) rawBandsArr = req.optJSONArray("bands");

            boolean bandsExplicit = false;
            JSONArray eqBands = new JSONArray();
            if (rawBandsArr != null && rawBandsArr.length() > 0) {
                bandsExplicit = true;
                boolean looksDb = false;
                for (int i = 0; i < rawBandsArr.length(); i++) {
                    double v = rawBandsArr.optDouble(i, 50.0);
                    if (v < 0.0) {
                        looksDb = true;
                        break;
                    }
                }
                if (!looksDb && rawBandsArr.length() >= 3) {
                    boolean allSmall = true;
                    for (int i = 0; i < rawBandsArr.length(); i++) {
                        if (rawBandsArr.optDouble(i, 50.0) > 15.0) {
                            allSmall = false;
                            break;
                        }
                    }
                    if (allSmall) looksDb = true;
                }
                for (int i = 0; i < 5; i++) {
                    double v = i < rawBandsArr.length() ? rawBandsArr.optDouble(i, looksDb ? 0.0 : 50.0) : (looksDb ? 0.0 : 50.0);
                    eqBands.put(normalizeBandValueToPercent(v, looksDb));
                }
            } else if (req.optJSONObject("eq_bands") != null || req.optJSONObject("eqBands") != null) {
                bandsExplicit = true;
                JSONObject bandObj = req.optJSONObject("eq_bands") != null ? req.optJSONObject("eq_bands") : req.optJSONObject("eqBands");
                String[][] keys = new String[][] {
                        { "60Hz", "60", "band1", "low" },
                        { "230Hz", "230", "250Hz", "band2" },
                        { "910Hz", "910", "1kHz", "band3", "mid" },
                        { "3.6kHz", "3600", "4kHz", "band4" },
                        { "14kHz", "14000", "16kHz", "band5", "high", "treble" }
                };
                for (String[] keyGroup : keys) {
                    double v = 50.0;
                    for (String k : keyGroup) {
                        if (bandObj.has(k)) {
                            v = bandObj.optDouble(k, 50.0);
                            break;
                        }
                    }
                    eqBands.put(normalizeBandValueToPercent(v, v < 0.0));
                }
            } else if (!TextUtils.isEmpty(normPreset)) {
                int[] defaults = getDefaultBandsForPreset(normPreset);
                for (int b : defaults) eqBands.put(b);
            } else {
                JSONArray savedBands = saved.optJSONArray("eqBands");
                if (savedBands != null && savedBands.length() == 5) {
                    eqBands = savedBands;
                } else {
                    for (int b : getDefaultBandsForPreset("Normal")) eqBands.put(b);
                }
            }

            if (TextUtils.isEmpty(normPreset) && bandsExplicit) {
                normPreset = "Custom";
            }

            out.put("eqEnabled", eqEnabled);
            out.put("eqPreset", normPreset);
            out.put("hasBassBoost", hasBass);
            out.put("bassBoost", bassBoost);
            out.put("hasVirtualizer", hasVirtualizer);
            out.put("virtualizer", virtualizer);
            out.put("hasLoudness", hasLoudness);
            out.put("loudness", loudness);
            out.put("reverb", reverb);
            out.put("eqBands", eqBands);
            out.put("eqBandsExplicit", bandsExplicit);
            out.put("updatedAt", System.currentTimeMillis());
        } catch (Exception ignored) {}
        return out;
    }

    private short mapReverbPreset(String reverbName) {
        if (TextUtils.isEmpty(reverbName)) return PresetReverb.PRESET_NONE;
        String r = reverbName.trim().toLowerCase(Locale.ROOT);
        if (r.contains("plate")) return PresetReverb.PRESET_PLATE;
        if (r.contains("large") && r.contains("hall")) return PresetReverb.PRESET_LARGEHALL;
        if ((r.contains("medium") || r.contains("hall")) && r.contains("hall")) return PresetReverb.PRESET_MEDIUMHALL;
        if (r.contains("large") && r.contains("room")) return PresetReverb.PRESET_LARGEROOM;
        if (r.contains("medium") && r.contains("room")) return PresetReverb.PRESET_MEDIUMROOM;
        if (r.contains("small") || r.contains("room")) return PresetReverb.PRESET_SMALLROOM;
        return PresetReverb.PRESET_NONE;
    }

    private JSONObject applySystemEqualizerSettings(JSONObject eqConfig) {
        JSONObject status = new JSONObject();
        if (eqConfig == null) return status;
        try {
            KevinAgentPrefs.saveEqualizerStateJson(activity, eqConfig.toString());
            boolean enabled = eqConfig.optBoolean("eqEnabled", true);
            String presetName = eqConfig.optString("eqPreset", "");
            int bassBoost = eqConfig.optInt("bassBoost", 0);
            int virtualizer = eqConfig.optInt("virtualizer", 0);
            int loudness = eqConfig.optInt("loudness", 0);
            String reverb = eqConfig.optString("reverb", "");
            JSONArray bands = eqConfig.optJSONArray("eqBands");
            boolean bandsExplicit = eqConfig.optBoolean("eqBandsExplicit", false);

            try {
                if (systemEqualizer == null) {
                    systemEqualizer = new Equalizer(0, 0);
                }
                systemEqualizer.setEnabled(enabled);
                short numBands = systemEqualizer.getNumberOfBands();
                short[] range = systemEqualizer.getBandLevelRange();
                short minLvl = range != null && range.length >= 2 ? range[0] : (short) -1500;
                short maxLvl = range != null && range.length >= 2 ? range[1] : (short) 1500;

                boolean presetMatched = false;
                if (enabled && !TextUtils.isEmpty(presetName) && !bandsExplicit && !"Custom".equalsIgnoreCase(presetName)) {
                    short presetCount = systemEqualizer.getNumberOfPresets();
                    for (short i = 0; i < presetCount; i++) {
                        String sysName = systemEqualizer.getPresetName(i);
                        if (sysName != null && (sysName.equalsIgnoreCase(presetName)
                                || sysName.toLowerCase(Locale.ROOT).contains(presetName.toLowerCase(Locale.ROOT)))) {
                            systemEqualizer.usePreset(i);
                            presetMatched = true;
                            break;
                        }
                    }
                }
                if (enabled && !presetMatched && bands != null && bands.length() > 0) {
                    for (short b = 0; b < numBands; b++) {
                        int srcIdx = bands.length() >= numBands ? b : (b * bands.length() / Math.max(1, (int) numBands));
                        int pct = clampPercent(bands.optInt(Math.min(srcIdx, bands.length() - 1), 50));
                        short lvl = (short) Math.round(minLvl + (pct / 100.0) * (maxLvl - minLvl));
                        systemEqualizer.setBandLevel(b, lvl);
                    }
                }
                status.put("equalizerActive", true);
                status.put("bandCount", numBands);
            } catch (Throwable t) {
                status.put("equalizerActive", false);
            }

            try {
                if (eqConfig.optBoolean("hasBassBoost", false) || !enabled) {
                    if (systemBassBoost == null) {
                        systemBassBoost = new BassBoost(0, 0);
                    }
                    systemBassBoost.setEnabled(enabled && bassBoost > 0);
                    if (systemBassBoost.getStrengthSupported()) {
                        short strength = (short) Math.max(0, Math.min(1000, bassBoost * 10));
                        systemBassBoost.setStrength(strength);
                    }
                    status.put("bassBoostActive", true);
                }
            } catch (Throwable ignored) {}

            try {
                if (eqConfig.optBoolean("hasVirtualizer", false) || !enabled) {
                    if (systemVirtualizer == null) {
                        systemVirtualizer = new Virtualizer(0, 0);
                    }
                    systemVirtualizer.setEnabled(enabled && virtualizer > 0);
                    if (systemVirtualizer.getStrengthSupported()) {
                        short strength = (short) Math.max(0, Math.min(1000, virtualizer * 10));
                        systemVirtualizer.setStrength(strength);
                    }
                    status.put("virtualizerActive", true);
                }
            } catch (Throwable ignored) {}

            try {
                if (!TextUtils.isEmpty(reverb) || !enabled) {
                    if (systemPresetReverb == null) {
                        systemPresetReverb = new PresetReverb(0, 0);
                    }
                    short rPreset = mapReverbPreset(reverb);
                    systemPresetReverb.setEnabled(enabled && rPreset != PresetReverb.PRESET_NONE);
                    systemPresetReverb.setPreset(rPreset);
                    status.put("reverbActive", true);
                }
            } catch (Throwable ignored) {}

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT
                        && (eqConfig.optBoolean("hasLoudness", false) || !enabled)) {
                    if (systemLoudness == null) {
                        systemLoudness = new LoudnessEnhancer(0);
                    }
                    systemLoudness.setEnabled(enabled && loudness > 0);
                    systemLoudness.setTargetGain(Math.max(0, Math.min(1500, loudness * 15)));
                    status.put("loudnessActive", true);
                }
            } catch (Throwable ignored) {}
        } catch (Exception ignored) {}
        return status;
    }

    private void reapplySavedEqualizerIfEnabled() {
        try {
            String raw = KevinAgentPrefs.getEqualizerStateJson(activity);
            if (TextUtils.isEmpty(raw) || "{}".equals(raw)) return;
            JSONObject saved = new JSONObject(raw);
            if (saved.optBoolean("eqEnabled", false)) {
                applySystemEqualizerSettings(saved);
            }
        } catch (Exception ignored) {}
    }

    @JavascriptInterface
    public String configureEqualizer(String eqJson) {
        try {
            JSONObject req = !TextUtils.isEmpty(eqJson) ? new JSONObject(eqJson) : new JSONObject();
            JSONObject cfg = buildNormalizedEqualizerConfig(req, "equalizer");
            JSONObject fx = applySystemEqualizerSettings(cfg);
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("equalizerState", cfg);
            out.put("audioFx", fx);
            return out.toString();
        } catch (Exception e) {
            return "{\"ok\":false}";
        }
    }

    @JavascriptInterface
    public String getEqualizerStateJson() {
        return KevinAgentPrefs.getEqualizerStateJson(activity);
    }

    @JavascriptInterface
    public boolean startGmailAuth(String authUrl, String redirectPrefix, String expectedState) {
        if (TextUtils.isEmpty(authUrl)) {
            return false;
        }
        activity.runOnUiThread(() -> {
            try {
                Intent intent = new Intent(activity, GmailAuthActivity.class);
                intent.putExtra(GmailAuthActivity.EXTRA_AUTH_URL, authUrl);
                intent.putExtra(GmailAuthActivity.EXTRA_REDIRECT_PREFIX, redirectPrefix != null ? redirectPrefix : "");
                intent.putExtra(GmailAuthActivity.EXTRA_EXPECTED_STATE, expectedState != null ? expectedState : "");
                activity.startActivityForResult(intent, MainActivity.GMAIL_AUTH_REQUEST_CODE);
            } catch (Exception e) {
                dispatchGmailAuthErrorJson("launch_failed", e.getMessage());
            }
        });
        return true;
    }

    @JavascriptInterface
    public void clearGmailAuthCookies() {
        activity.runOnUiThread(() -> {
            try {
                CookieManager cm = CookieManager.getInstance();
                cm.removeAllCookies(null);
                cm.flush();
            } catch (Exception ignored) {}
        });
    }

    private void dispatchGmailAuthErrorJson(String error, String description) {
        if (webView == null) return;
        try {
            JSONObject payload = new JSONObject();
            payload.put("ok", false);
            payload.put("cancelled", false);
            payload.put("error", error != null ? error : "auth_error");
            payload.put("errorDescription", description != null ? description : "");
            String quoted = JSONObject.quote(payload.toString());
            webView.post(() ->
                    webView.evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('kevinGmailAuthResult', { detail: JSON.parse(" + quoted + ") }))",
                            null
                    )
            );
        } catch (Exception ignored) {}
    }

    public void dispatchGmailAuthResult(int resultCode, Intent data) {
        if (webView == null) return;
        try {
            JSONObject payload = new JSONObject();
            if (data == null) {
                payload.put("ok", false);
                payload.put("cancelled", resultCode != Activity.RESULT_OK);
                payload.put("error", resultCode == Activity.RESULT_OK ? "empty_result" : "cancelled");
                payload.put("errorDescription", "");
            } else {
                boolean ok = resultCode == Activity.RESULT_OK && data.getBooleanExtra(GmailAuthActivity.EXTRA_OK, false);
                boolean cancelled = resultCode != Activity.RESULT_OK || data.getBooleanExtra(GmailAuthActivity.EXTRA_CANCELLED, false);
                payload.put("ok", ok);
                payload.put("cancelled", !ok && cancelled);
                payload.put("accessToken", data.getStringExtra(GmailAuthActivity.EXTRA_ACCESS_TOKEN) != null
                        ? data.getStringExtra(GmailAuthActivity.EXTRA_ACCESS_TOKEN) : "");
                payload.put("scope", data.getStringExtra(GmailAuthActivity.EXTRA_SCOPE) != null
                        ? data.getStringExtra(GmailAuthActivity.EXTRA_SCOPE) : "");
                payload.put("expiresIn", data.getStringExtra(GmailAuthActivity.EXTRA_EXPIRES_IN) != null
                        ? data.getStringExtra(GmailAuthActivity.EXTRA_EXPIRES_IN) : "");
                payload.put("error", data.getStringExtra(GmailAuthActivity.EXTRA_ERROR) != null
                        ? data.getStringExtra(GmailAuthActivity.EXTRA_ERROR) : "");
                payload.put("errorDescription", data.getStringExtra(GmailAuthActivity.EXTRA_ERROR_DESCRIPTION) != null
                        ? data.getStringExtra(GmailAuthActivity.EXTRA_ERROR_DESCRIPTION) : "");
            }
            String quoted = JSONObject.quote(payload.toString());
            webView.post(() ->
                    webView.evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('kevinGmailAuthResult', { detail: JSON.parse(" + quoted + ") }))",
                            null
                    )
            );
        } catch (Exception ignored) {}
    }
}
