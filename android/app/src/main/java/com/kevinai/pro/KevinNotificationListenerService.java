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
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

public class KevinNotificationListenerService extends NotificationListenerService {

    public static final String ACTION_WHATSAPP_REPLIED = "com.kevinai.pro.WHATSAPP_REPLIED";
    public static final String EXTRA_SENDER = "sender";
    public static final String EXTRA_INCOMING = "incoming";
    public static final String EXTRA_REPLY = "reply";

    private static final Pattern TRANSCRIPT_HEADER_PATTERN =
            Pattern.compile("^\\[[^\\]]{3,32}\\]\\s*[^:\\n]{1,40}:\\s*");
    private static final Pattern LEADING_TIMESTAMP_PATTERN =
            Pattern.compile("^\\d{1,2}[/.-]\\d{1,2}(?:[/.-]\\d{2,4})?,?\\s*\\d{1,2}:\\d{2}(?:\\s*[APMapm]{2})?\\s*[-–:]\\s*");
    private static final Pattern LEADING_TIME_ONLY_PATTERN =
            Pattern.compile("^\\d{1,2}:\\d{2}(?:\\s*[APMapm]{2})?\\s*[-–:]\\s*");
    private static final Pattern ROLE_PREFIX_PATTERN =
            Pattern.compile("^(?:reply|response|igisubizo|assistant|kevin\\s*ai|ai|me|you|option\\s*\\d+)\\s*:\\s*",
                    Pattern.CASE_INSENSITIVE);

    private static volatile KevinNotificationListenerService instance;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Map<String, Long> recentRepliedKeys = Collections.synchronizedMap(
            new LinkedHashMap<String, Long>(64, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, Long> eldest) {
                    return size() > 100;
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
        if (KevinAgentPrefs.isWhatsAppAutoReplyCurrentlyActive(this)) {
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
        if (!KevinAgentPrefs.isWhatsAppAutoReplyCurrentlyActive(this)) {
            return;
        }
        handleStatusBarNotification(sbn, false);
    }

    public static int scanActiveWhatsAppNotifications(Context context, boolean forceScan) {
        KevinNotificationListenerService svc = instance;
        if (svc == null) {
            return 0;
        }
        if (!forceScan && !KevinAgentPrefs.isWhatsAppAutoReplyCurrentlyActive(context)) {
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
        if (!forceScan && !KevinAgentPrefs.isWhatsAppAutoReplyCurrentlyActive(this)) {
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
        if (TextUtils.isEmpty(sender)
                || "WhatsApp".equalsIgnoreCase(sender)
                || "WhatsApp Business".equalsIgnoreCase(sender)) {
            return false;
        }

        // Prevent rapid multi-replies when WhatsApp updates the same notification multiple times
        if (KevinAgentPrefs.wasWhatsAppChatRecentlyReplied(this, sender, 25_000L)) {
            return false;
        }

        String ownerName = KevinAgentPrefs.getUserName(this);
        String incoming = extractIncomingMessage(extras, sender, ownerName);
        if (TextUtils.isEmpty(incoming) || isIgnorableSystemText(incoming)) {
            return false;
        }
        if (KevinAgentPrefs.isOwnSentWhatsAppText(this, sender, incoming)) {
            return false;
        }

        Notification.Action replyAction = findReplyAction(notification);
        if (replyAction == null || replyAction.getRemoteInputs() == null || replyAction.getRemoteInputs().length == 0) {
            return false;
        }

        String dedupKey = sender.toLowerCase(Locale.ROOT) + "|" + incoming;
        Long prevTime = recentRepliedKeys.get(dedupKey);
        if (prevTime != null && (System.currentTimeMillis() - prevTime) < 300_000L) {
            return false;
        }
        recentRepliedKeys.put(dedupKey, System.currentTimeMillis());
        KevinAgentPrefs.recordWhatsAppChatReplied(this, sender, "");

        final boolean isForced = forceScan;
        executor.execute(() -> {
            if (!isForced && !KevinAgentPrefs.isWhatsAppAutoReplyCurrentlyActive(this)) {
                return;
            }
            String replyText = generateReplyStatic(this, sender, incoming);
            if (TextUtils.isEmpty(replyText)) {
                return;
            }
            if (!isForced && !KevinAgentPrefs.isWhatsAppAutoReplyCurrentlyActive(this)) {
                return;
            }
            if (sendNotificationReply(replyAction, replyText)) {
                KevinAgentPrefs.recordWhatsAppChatReplied(this, sender, replyText);
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

    private String extractIncomingMessage(Bundle extras, String sender, String ownerName) {
        String selfName = "";
        CharSequence selfSeq = extras.getCharSequence(Notification.EXTRA_SELF_DISPLAY_NAME);
        if (selfSeq != null) {
            selfName = selfSeq.toString().trim();
        }
        List<String> collected = new ArrayList<>();

        Parcelable[] msgParcelables = extras.getParcelableArray(Notification.EXTRA_MESSAGES);
        if (msgParcelables != null && msgParcelables.length > 0) {
            int start = Math.max(0, msgParcelables.length - 3);
            for (int i = start; i < msgParcelables.length; i++) {
                if (!(msgParcelables[i] instanceof Bundle)) continue;
                Bundle msgBundle = (Bundle) msgParcelables[i];
                CharSequence msgTextSeq = msgBundle.getCharSequence("text");
                String msgText = msgTextSeq != null ? msgTextSeq.toString().trim() : "";
                if (TextUtils.isEmpty(msgText) || isIgnorableSystemText(msgText)) continue;

                CharSequence senderSeq = msgBundle.getCharSequence("sender");
                String msgSender = senderSeq != null ? senderSeq.toString().trim() : "";
                if ("You".equalsIgnoreCase(msgSender)
                        || "Me".equalsIgnoreCase(msgSender)
                        || (!TextUtils.isEmpty(selfName) && selfName.equalsIgnoreCase(msgSender))
                        || (!TextUtils.isEmpty(ownerName) && ownerName.equalsIgnoreCase(msgSender))
                        || KevinAgentPrefs.isOwnSentWhatsAppText(this, sender, msgText)) {
                    collected.clear();
                    continue;
                }
                collected.add(stripIncomingTranscriptPrefix(msgText));
            }
            if (!collected.isEmpty()) {
                return TextUtils.join(" ", collected).trim();
            }
        }

        CharSequence[] textLines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
        if (textLines != null && textLines.length > 0) {
            int start = Math.max(0, textLines.length - 3);
            for (int i = start; i < textLines.length; i++) {
                String line = textLines[i] != null ? textLines[i].toString().trim() : "";
                if (TextUtils.isEmpty(line) || isIgnorableSystemText(line)) continue;
                String lower = line.toLowerCase(Locale.ROOT);
                if (lower.startsWith("you:") || lower.startsWith("me:")
                        || (!TextUtils.isEmpty(ownerName) && lower.startsWith(ownerName.toLowerCase(Locale.ROOT) + ":"))
                        || KevinAgentPrefs.isOwnSentWhatsAppText(this, sender, line)) {
                    collected.clear();
                    continue;
                }
                collected.add(stripIncomingTranscriptPrefix(line));
            }
            if (!collected.isEmpty()) {
                return TextUtils.join(" ", collected).trim();
            }
        }

        CharSequence bigTextSeq = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
        CharSequence textSeq = extras.getCharSequence(Notification.EXTRA_TEXT);
        String fallback = bigTextSeq != null && !TextUtils.isEmpty(bigTextSeq.toString().trim())
                ? bigTextSeq.toString().trim()
                : (textSeq != null ? textSeq.toString().trim() : "");
        String lowerFallback = fallback.toLowerCase(Locale.ROOT);
        if (lowerFallback.startsWith("you:")
                || lowerFallback.startsWith("me:")
                || (!TextUtils.isEmpty(ownerName) && lowerFallback.startsWith(ownerName.toLowerCase(Locale.ROOT) + ":"))) {
            return "";
        }
        return stripIncomingTranscriptPrefix(fallback);
    }

    private String stripIncomingTranscriptPrefix(String text) {
        if (TextUtils.isEmpty(text)) return "";
        String s = text.trim();
        s = TRANSCRIPT_HEADER_PATTERN.matcher(s).replaceFirst("");
        s = LEADING_TIMESTAMP_PATTERN.matcher(s).replaceFirst("");
        return s.trim();
    }

    private boolean isIgnorableSystemText(String text) {
        String lower = text.trim().toLowerCase(Locale.ROOT);
        if (TextUtils.isEmpty(lower)) return true;
        return lower.equals("checking for new messages")
                || lower.equals("you deleted this message")
                || lower.equals("this message was deleted")
                || lower.startsWith("missed voice call")
                || lower.startsWith("missed video call")
                || lower.startsWith("incoming voice call")
                || lower.startsWith("incoming video call")
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

    public static String sanitizeWhatsAppReply(String raw, String ownerName, String sender) {
        if (TextUtils.isEmpty(raw)) {
            return "";
        }
        String cleaned = raw.trim()
                .replaceAll("^```(?:\\w+)?\\s*", "")
                .replaceAll("\\s*```$", "")
                .trim();

        String[] rawLines = cleaned.split("\\r?\\n+");
        List<String> validLines = new ArrayList<>();
        int transcriptLineCount = 0;

        for (String rawLine : rawLines) {
            String trimmed = rawLine != null ? rawLine.trim() : "";
            if (TextUtils.isEmpty(trimmed)) continue;
            if (TRANSCRIPT_HEADER_PATTERN.matcher(trimmed).find()
                    || trimmed.matches("(?i)^(?:option\\s*\\d+|reply|\\d+[.)]).*")) {
                transcriptLineCount++;
            }
            validLines.add(trimmed);
        }

        if (validLines.isEmpty()) {
            return "";
        }

        List<String> cleanedLines = new ArrayList<>();
        for (String line : validLines) {
            String stripped = stripReplyPrefixes(line, ownerName, sender);
            if (!TextUtils.isEmpty(stripped)) {
                cleanedLines.add(stripped);
            }
        }

        if (cleanedLines.isEmpty()) {
            return "";
        }

        // If Gemini output a multi-line WhatsApp chat transcript (e.g. "[23/11, 11:23] Kevin: ..."), keep ONLY ONE single reply
        if (transcriptLineCount >= 2 || cleanedLines.size() >= 3) {
            return cleanedLines.get(0);
        }

        if (cleanedLines.size() == 2) {
            String first = cleanedLines.get(0);
            String second = cleanedLines.get(1);
            if (hasHighWordOverlap(first, second)) {
                return first;
            }
            return (first + " " + second).trim();
        }

        return cleanedLines.get(0);
    }

    private static String stripReplyPrefixes(String line, String ownerName, String sender) {
        String s = line.trim();
        s = TRANSCRIPT_HEADER_PATTERN.matcher(s).replaceFirst("");
        s = LEADING_TIMESTAMP_PATTERN.matcher(s).replaceFirst("");
        s = LEADING_TIME_ONLY_PATTERN.matcher(s).replaceFirst("");
        s = ROLE_PREFIX_PATTERN.matcher(s).replaceFirst("");
        if (!TextUtils.isEmpty(ownerName)) {
            s = s.replaceFirst("(?i)^" + Pattern.quote(ownerName.trim()) + "\\s*:\\s*", "");
        }
        if (!TextUtils.isEmpty(sender)) {
            s = s.replaceFirst("(?i)^" + Pattern.quote(sender.trim()) + "\\s*:\\s*", "");
        }
        s = s.replaceAll("^[\"'“”]+|[\"'“”]+$", "").trim();
        return s;
    }

    private static boolean hasHighWordOverlap(String first, String second) {
        Set<String> firstWords = new HashSet<>();
        for (String w : first.toLowerCase(Locale.ROOT).split("\\s+")) {
            if (w.length() > 3) firstWords.add(w);
        }
        int overlap = 0;
        for (String w : second.toLowerCase(Locale.ROOT).split("\\s+")) {
            if (w.length() > 3 && firstWords.contains(w)) {
                overlap++;
            }
        }
        return overlap >= 2;
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
                String reply = sanitizeWhatsAppReply(json.optString("reply", ""), ownerName, sender);
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
        String safeSender = !TextUtils.isEmpty(sender) ? sender.trim() : "your contact";
        String sysPrompt = "You are " + safeOwner + " replying directly on WhatsApp to \"" + safeSender + "\".\n"
                + "Write ONE single, natural human WhatsApp reply message directly addressing what they just wrote.\n"
                + "STRICT LANGUAGE RULE:\n"
                + "- If the message is in English, reply ONLY in natural, conversational English.\n"
                + "- If the message is in Kinyarwanda, reply ONLY in authentic, fluent, grammatically correct native Kinyarwanda (Ikinyarwanda cy'umwimerere — warm, polite, natural Rwandan phrasing, NEVER awkward literal translations).\n"
                + "- If the message is in French or Swahili, reply fluently in that exact language.\n"
                + "STRICT FORMAT RULES:\n"
                + "- Output ONLY the exact message text to send (1 to 2 short sentences max).\n"
                + "- NEVER include dates, timestamps (like [23/11, 11:23]), sender names (like \"" + safeOwner + ":\"), labels, quotes, or markdown.\n"
                + "- NEVER generate multiple replies, multiple options, or a back-and-forth conversation.\n"
                + "- NEVER sound like or mention being an AI — write naturally as " + safeOwner + " themselves.";
        if (!TextUtils.isEmpty(replyStyle)) {
            sysPrompt += "\nOwner's Personal Style Preference: " + replyStyle.trim();
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
                                    String reply = sanitizeWhatsAppReply(replySb.toString(), safeOwner, safeSender);
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
