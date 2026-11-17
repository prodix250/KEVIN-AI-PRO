package com.kevinai.pro;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.Intent;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.text.TextUtils;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class KevinNotificationListenerService extends NotificationListenerService {

    public static final String ACTION_WHATSAPP_REPLIED = "com.kevinai.pro.WHATSAPP_REPLIED";
    public static final String EXTRA_SENDER = "sender";
    public static final String EXTRA_INCOMING = "incoming";
    public static final String EXTRA_REPLY = "reply";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Map<String, Long> recentRepliedKeys = Collections.synchronizedMap(
            new LinkedHashMap<String, Long>(64, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, Long> eldest) {
                    return size() > 50;
                }
            }
    );

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || !KevinAgentPrefs.isWhatsAppAutoReplyEnabled(this)) {
            return;
        }
        String pkg = sbn.getPackageName();
        if (!"com.whatsapp".equals(pkg) && !"com.whatsapp.w4b".equals(pkg)) {
            return;
        }
        Notification notification = sbn.getNotification();
        if (notification == null || (notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0) {
            return;
        }

        Bundle extras = notification.extras;
        if (extras == null) {
            return;
        }
        CharSequence titleSeq = extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence textSeq = extras.getCharSequence(Notification.EXTRA_TEXT);
        if (TextUtils.isEmpty(titleSeq) || TextUtils.isEmpty(textSeq)) {
            return;
        }

        String sender = titleSeq.toString().trim();
        String incoming = textSeq.toString().trim();
        String dedupKey = sbn.getKey() + "|" + incoming;
        Long prevTime = recentRepliedKeys.get(dedupKey);
        if (prevTime != null && (System.currentTimeMillis() - prevTime) < 30_000L) {
            return;
        }

        Notification.Action replyAction = findReplyAction(notification);
        if (replyAction == null || replyAction.getRemoteInputs() == null || replyAction.getRemoteInputs().length == 0) {
            return;
        }

        recentRepliedKeys.put(dedupKey, System.currentTimeMillis());

        executor.execute(() -> {
            String replyText = generateReplyFromBackend(sender, incoming);
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

    private String generateReplyFromBackend(String sender, String incoming) {
        String baseUrl = KevinAgentPrefs.getBackendBaseUrl(this);
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
            payload.put("sender", sender);
            payload.put("incomingMessage", incoming);
            payload.put("replyStyle", KevinAgentPrefs.getWhatsAppReplyStyle(this));
            payload.put("userName", KevinAgentPrefs.getUserName(this));

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
                return json.optString("reply", "").trim();
            }
        } catch (Exception ignored) {
            // Silent fail if backend unreachable
        } finally {
            if (conn != null) {
                conn.disconnect();
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
        executor.shutdownNow();
        super.onDestroy();
    }
}
