package com.kevinai.pro;

import android.Manifest;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;
import android.provider.Settings;
import android.telephony.SmsManager;
import android.text.TextUtils;
import android.view.accessibility.AccessibilityManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public class KevinAgentBridge {

    public static final int AGENT_PERMISSIONS_REQUEST_CODE = 1004;

    private final Activity activity;
    private final WebView webView;

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
            obj.put("wakeWordEnabled", KevinAgentPrefs.isWakeWordEnabled(activity));
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
        activity.runOnUiThread(() -> ActivityCompat.requestPermissions(
                activity,
                new String[] {
                    Manifest.permission.SEND_SMS,
                    Manifest.permission.CALL_PHONE,
                    Manifest.permission.READ_CONTACTS,
                    Manifest.permission.RECORD_AUDIO
                },
                AGENT_PERMISSIONS_REQUEST_CODE
        ));
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

    @JavascriptInterface
    public String lookupContactsJson(String query) {
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.READ_CONTACTS)
                != PackageManager.PERMISSION_GRANTED) {
            return "[]";
        }
        JSONArray results = new JSONArray();
        Set<String> seenPhones = new LinkedHashSet<>();
        String normalizedQuery = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
        String[] queryTokens = TextUtils.isEmpty(normalizedQuery)
                ? new String[0]
                : normalizedQuery.split("\\s+");
        int limit = TextUtils.isEmpty(normalizedQuery) ? 150 : 30;

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

                if (queryTokens.length > 0) {
                    String lowerName = name.toLowerCase(Locale.ROOT);
                    boolean allMatch = true;
                    for (String token : queryTokens) {
                        if (!lowerName.contains(token) && !cleanPhone.contains(token)) {
                            allMatch = false;
                            break;
                        }
                    }
                    if (!allMatch) continue;
                }

                String dedupKey = name.toLowerCase(Locale.ROOT) + "|" + cleanPhone.replaceAll("[^\\d]", "");
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
        dispatchAgentStatus();
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
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("vnd.youtube://" + videoId));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    activity.startActivity(intent);
                } else {
                    KevinAgentPrefs.armPendingYouTubePlay(activity, 12_000L);
                    Intent intent = new Intent(Intent.ACTION_VIEW,
                            Uri.parse("https://www.youtube.com/results?search_query=" + Uri.encode(query != null ? query : "")));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    activity.startActivity(intent);
                }
            } catch (Exception e) {
                try {
                    String webUrl = !TextUtils.isEmpty(videoId)
                            ? "https://www.youtube.com/watch?v=" + Uri.encode(videoId) + "&autoplay=1"
                            : "https://www.youtube.com/results?search_query=" + Uri.encode(query != null ? query : "");
                    Intent fallback = new Intent(Intent.ACTION_VIEW, Uri.parse(webUrl));
                    fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    activity.startActivity(fallback);
                } catch (Exception ignored) {}
            }
        });
        return true;
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
        HttpURLConnection conn = null;
        try {
            String rssUrl = "https://news.google.com/rss/search?q="
                    + Uri.encode(query.trim())
                    + "&hl=en&gl=US&ceid=US:en";
            URL url = new URL(rssUrl);
            conn = (HttpURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(4500);
            conn.setReadTimeout(4500);
            conn.setRequestMethod("GET");
            conn.setRequestProperty(
                    "User-Agent",
                    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
            );
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                return "";
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
            return sb.toString();
        } catch (Exception ignored) {
            return "";
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }
}
