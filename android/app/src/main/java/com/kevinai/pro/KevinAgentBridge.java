package com.kevinai.pro;

import android.Manifest;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.provider.ContactsContract;
import android.provider.Settings;
import android.speech.SpeechRecognizer;
import android.telephony.SmsManager;
import android.text.TextUtils;
import android.util.Base64;
import android.view.accessibility.AccessibilityManager;
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
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
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
                perms.add(Manifest.permission.POST_NOTIFICATIONS);
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
                conn.setConnectTimeout(4500);
                conn.setReadTimeout(4500);
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
}
