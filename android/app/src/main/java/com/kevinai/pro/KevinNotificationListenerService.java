package com.kevinai.pro;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Parcelable;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.text.TextUtils;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class KevinNotificationListenerService extends NotificationListenerService {

    public static final String ACTION_WHATSAPP_REPLIED = "com.kevinai.pro.WHATSAPP_REPLIED";
    public static final String EXTRA_SENDER = "sender";
    public static final String EXTRA_INCOMING = "incoming";
    public static final String EXTRA_REPLY = "reply";

    private static volatile KevinNotificationListenerService instance;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Map<String, Long> recentRepliedKeys = Collections.synchronizedMap(
            new LinkedHashMap<String, Long>(64, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, Long> eldest) {
                    return size() > 80;
                }
            }
    );

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
    }

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        instance = this;
        if (KevinAgentPrefs.isWhatsAppAutoReplyEnabled(this)) {
            scanActiveWhatsAppNotifications(this, false);
        }
    }

    @Override
    public void onListenerDisconnected() {
        super.onListenerDisconnected();
        if (instance == this) {
            instance = null;
        }
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (!KevinAgentPrefs.isWhatsAppAutoReplyEnabled(this)) {
            return;
        }
        handleStatusBarNotification(sbn, false);
    }

    public static int scanActiveWhatsAppNotifications(Context context, boolean forceScan) {
        KevinNotificationListenerService svc = instance;
        if (svc == null) {
            return 0;
        }
        if (!forceScan && !KevinAgentPrefs.isWhatsAppAutoReplyEnabled(context)) {
            return 0;
        }
        try {
            StatusBarNotification[] active = svc.getActiveNotifications();
            if (active == null || active.length == 0) {
                return 0;
            }
            int queued = 0;
            for (StatusBarNotification sbn : active) {
                if (svc.handleStatusBarNotification(sbn, forceScan)) {
                    queued++;
                }
            }
            return queued;
        } catch (Exception ignored) {
            return 0;
        }
    }

    private boolean handleStatusBarNotification(StatusBarNotification sbn, boolean forceScan) {
        if (sbn == null) {
            return false;
        }
        if (!forceScan && !KevinAgentPrefs.isWhatsAppAutoReplyEnabled(this)) {
            return false;
        }
        String pkg = sbn.getPackageName();
        if (!"com.whatsapp".equals(pkg) && !"com.whatsapp.w4b".equals(pkg)) {
            return false;
        }
        Notification notification = sbn.getNotification();
        if (notification == null || (notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0) {
            return false;
        }

        Bundle extras = notification.extras;
        if (extras == null) {
            return false;
        }
        CharSequence titleSeq = extras.getCharSequence(Notification.EXTRA_TITLE);
        String sender = titleSeq != null ? titleSeq.toString().trim() : "";
        if (TextUtils.isEmpty(sender) || "WhatsApp".equalsIgnoreCase(sender) || "WhatsApp Business".equalsIgnoreCase(sender)) {
            return false;
        }

        String incoming = extractIncomingMessage(extras, sender);
        if (TextUtils.isEmpty(incoming) || isIgnorableSystemText(incoming)) {
            return false;
        }

        Notification.Action replyAction = findReplyAction(notification);
        if (replyAction == null || replyAction.getRemoteInputs() == null || replyAction.getRemoteInputs().length == 0) {
            return false;
        }

        String dedupKey = sender.toLowerCase(Locale.ROOT) + "|" + incoming;
        Long prevTime = recentRepliedKeys.get(dedupKey);
        if (prevTime != null && (System.currentTimeMillis() - prevTime) < 120_000L) {
            return false;
        }
        recentRepliedKeys.put(dedupKey, System.currentTimeMillis());

        executor.execute(() -> {
            String replyText = generateReplyStatic(this, sender, incoming);
            if (TextUtils.isEmpty(replyText)) {
                return;
            }
            if (sendNotificationReply(replyAction, replyText)) {
                Intent broadcast = new Intent(ACTION_WHATSAPP_REPLIED)
                        .setPackage(getPackageName())
                        .putExtra(EXTRA_SENDER, sender)
                        .putExtra(EXTRA_INCOMING, incoming)
                        .putExtra(EXTRA_REPLY, replyText);
                sendBroadcast(broadcast);
            }
        });
        return true;
    }

    private String extractIncomingMessage(Bundle extras, String sender) {
        List<String> collected = new ArrayList<>();

        Parcelable[] msgParcelables = extras.getParcelableArray(Notification.EXTRA_MESSAGES);
        if (msgParcelables != null && msgParcelables.length > 0) {
            int start = Math.max(0, msgParcelables.length - 4);
            for (int i = start; i < msgParcelables.length; i++) {
                if (!(msgParcelables[i] instanceof Bundle)) continue;
                Bundle msgBundle = (Bundle) msgParcelables[i];
                CharSequence msgTextSeq = msgBundle.getCharSequence("text");
                String msgText = msgTextSeq != null ? msgTextSeq.toString().trim() : "";
                if (TextUtils.isEmpty(msgText)) continue;

                CharSequence senderSeq = msgBundle.getCharSequence("sender");
                String msgSender = senderSeq != null ? senderSeq.toString().trim() : "";
                if ("You".equalsIgnoreCase(msgSender) || "Me".equalsIgnoreCase(msgSender)) {
                    collected.clear();
                    continue;
                }
                collected.add(TextUtils.isEmpty(msgSender) || msgSender.equalsIgnoreCase(sender)
                        ? msgText
                        : (msgSender + ": " + msgText));
            }
            if (!collected.isEmpty()) {
                return TextUtils.join("\n", collected);
            }
        }

        CharSequence[] textLines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
        if (textLines != null && textLines.length > 0) {
            int start = Math.max(0, textLines.length - 4);
            for (int i = start; i < textLines.length; i++) {
                String line = textLines[i] != null ? textLines[i].toString().trim() : "";
                if (TextUtils.isEmpty(line) || isIgnorableSystemText(line)) continue;
                String lower = line.toLowerCase(Locale.ROOT);
                if (lower.startsWith("you:") || lower.startsWith("me:")) {
                    collected.clear();
                    continue;
                }
                collected.add(line);
            }
            if (!collected.isEmpty()) {
                return TextUtils.join("\n", collected);
            }
        }

        CharSequence bigTextSeq = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
        CharSequence textSeq = extras.getCharSequence(Notification.EXTRA_TEXT);
        String fallback = bigTextSeq != null && !TextUtils.isEmpty(bigTextSeq.toString().trim())
                ? bigTextSeq.toString().trim()
                : (textSeq != null ? textSeq.toString().trim() : "");
        String lowerFallback = fallback.toLowerCase(Locale.ROOT);
        if (lowerFallback.startsWith("you:") || lowerFallback.startsWith("me:")) {
            return "";
        }
        return fallback;
    }

    private boolean isIgnorableSystemText(String text) {
        String lower = text.trim().toLowerCase(Locale.ROOT);
        if (TextUtils.isEmpty(lower)) return true;
        return lower.equals("checking for new messages")
                || lower.equals("you deleted this message")
                || lower.equals("this message was deleted")
                || lower.matches("\\d+\\s+new messages?");
    }

    private Notification.Action findReplyAction(Notification notification) {
        if (notification.actions == null) {
            return null;
        }
        for (Notification.Action action : notification.actions) {
            if (action != null && action.getRemoteInputs() != null && action.getRemoteInputs().length > 0) {
                return action;
            }
        }
        return null;
    }

    public static String generateReplyStatic(Context context, String sender, String incoming) {
        if (context == null || TextUtils.isEmpty(incoming)) {
            return null;
        }
        String ownerName = KevinAgentPrefs.getUserName(context);
        String replyStyle = KevinAgentPrefs.getWhatsAppReplyStyle(context);

        List<String> apiKeys = KevinAgentPrefs.getApiKeysList(context);
        if (!apiKeys.isEmpty()) {
            String directReply = generateReplyDirectGemini(apiKeys, ownerName, replyStyle, sender, incoming);
            if (!TextUtils.isEmpty(directReply)) {
                return directReply;
            }
        }

        String baseUrl = KevinAgentPrefs.getEffectiveBackendBaseUrl(context);
        if (TextUtils.isEmpty(baseUrl)) {
            return null;
        }
        HttpURLConnection conn = null;
        try {
            String endpoint = baseUrl.endsWith("/")
                    ? baseUrl + "api/whatsapp-reply"
                    : baseUrl + "/api/whatsapp-reply";
            URL url = new URL(endpoint);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(15_000);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setDoOutput(true);

            JSONObject payload = new JSONObject();
            payload.put("sender", sender != null ? sender : "Contact");
            payload.put("incomingMessage", incoming);
            payload.put("replyStyle", replyStyle != null ? replyStyle : "");
            payload.put("userName", !TextUtils.isEmpty(ownerName) ? ownerName : "Kevin");
            if (!apiKeys.isEmpty()) {
                JSONArray keysArr = new JSONArray();
                for (String k : apiKeys) {
                    keysArr.put(k);
                }
                payload.put("customApiKeys", keysArr);
            }

            try (OutputStream os = conn.getOutputStream()) {
                os.write(payload.toString().getBytes(StandardCharsets.UTF_8));
            }

            if (conn.getResponseCode() >= 200 && conn.getResponseCode() < 300) {
                StringBuilder sb = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        sb.append(line);
                    }
                }
                JSONObject json = new JSONObject(sb.toString());
                String reply = json.optString("reply", "").trim();
                if (!TextUtils.isEmpty(reply)) {
                    return reply;
                }
            }
        } catch (Exception ignored) {
            // Fall through
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
        return null;
    }

    private static String generateReplyDirectGemini(
            List<String> apiKeys,
            String ownerName,
            String replyStyle,
            String sender,
            String incoming
    ) {
        String safeOwner = !TextUtils.isEmpty(ownerName) ? ownerName.trim() : "Kevin";
        String safeSender = !TextUtils.isEmpty(sender) ? sender.trim() : "Contact";
        String sysPrompt = "You are Kevin AI acting as " + safeOwner + "'s WhatsApp Auto-Reply Assistant.\n"
                + "Reply directly and naturally to the incoming WhatsApp message from \"" + safeSender + "\".\n"
                + "Match the sender's language (Kinyarwanda, English, French, or Swahili).\n"
                + "Keep the reply concise, polite, helpful, and natural for WhatsApp (1-3 sentences max).\n"
                + "Do not say \"As an AI...\" — reply seamlessly on behalf of " + safeOwner + ".";
        if (!TextUtils.isEmpty(replyStyle)) {
            sysPrompt += "\nOwner's Auto-Reply Instructions: " + replyStyle.trim();
        }

        String[] models = new String[] { "gemini-2.5-flash", "gemini-3.1-flash-lite" };
        for (String model : models) {
            for (String key : apiKeys) {
                HttpURLConnection conn = null;
                try {
                    String endpoint = "https://generativelanguage.googleapis.com/v1beta/models/"
                            + model + ":generateContent?key=" + URLEncoder.encode(key, "UTF-8");
                    URL url = new URL(endpoint);
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setConnectTimeout(8_000);
                    conn.setReadTimeout(12_000);
                    conn.setRequestProperty("Content-Type", "application/json");
                    conn.setDoOutput(true);

                    JSONObject body = new JSONObject();
                    JSONObject sysPart = new JSONObject().put("text", sysPrompt);
                    body.put("systemInstruction", new JSONObject().put("parts", new JSONArray().put(sysPart)));

                    JSONObject userPart = new JSONObject().put("text", incoming.trim());
                    JSONObject userContent = new JSONObject()
                            .put("role", "user")
                            .put("parts", new JSONArray().put(userPart));
                    body.put("contents", new JSONArray().put(userContent));

                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(body.toString().getBytes(StandardCharsets.UTF_8));
                    }

                    if (conn.getResponseCode() >= 200 && conn.getResponseCode() < 300) {
                        StringBuilder sb = new StringBuilder();
                        try (BufferedReader reader = new BufferedReader(
                                new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                            String line;
                            while ((line = reader.readLine()) != null) {
                                sb.append(line);
                            }
                        }
                        JSONObject json = new JSONObject(sb.toString());
                        JSONArray candidates = json.optJSONArray("candidates");
                        if (candidates != null && candidates.length() > 0) {
                            JSONObject content = candidates.getJSONObject(0).optJSONObject("content");
                            if (content != null) {
                                JSONArray parts = content.optJSONArray("parts");
                                if (parts != null) {
                                    StringBuilder replySb = new StringBuilder();
                                    for (int i = 0; i < parts.length(); i++) {
                                        String t = parts.getJSONObject(i).optString("text", "");
                                        replySb.append(t);
                                    }
                                    String reply = replySb.toString().trim();
                                    if (!TextUtils.isEmpty(reply)) {
                                        return reply;
                                    }
                                }
                            }
                        }
                    }
                } catch (Exception ignored) {
                } finally {
                    if (conn != null) {
                        conn.disconnect();
                    }
                }
            }
        }
        return null;
    }

    private boolean sendNotificationReply(Notification.Action action, String replyText) {
        try {
            RemoteInput[] remoteInputs = action.getRemoteInputs();
            Bundle results = new Bundle();
            for (RemoteInput remoteInput : remoteInputs) {
                results.putCharSequence(remoteInput.getResultKey(), replyText);
            }
            Intent replyIntent = new Intent();
            RemoteInput.addResultsToIntent(remoteInputs, replyIntent, results);
            action.actionIntent.send(this, 0, replyIntent);
            return true;
        } catch (PendingIntent.CanceledException e) {
            return false;
        }
    }

    @Override
    public void onDestroy() {
        if (instance == this) {
            instance = null;
        }
        executor.shutdownNow();
        super.onDestroy();
    }
}
