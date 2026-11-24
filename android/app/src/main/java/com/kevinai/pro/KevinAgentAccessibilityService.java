package com.kevinai.pro;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.Context;
import android.content.Intent;
import android.graphics.Path;
import android.graphics.Rect;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.TextUtils;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class KevinAgentAccessibilityService extends AccessibilityService {

    private static final long CHAT_REPLY_COOLDOWN_MS = 300_000L;

    private final ExecutorService scanExecutor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private volatile boolean scanStepBusy = false;
    private long lastNavigationAt = 0L;
    private int consecutiveEmptyListScans = 0;
    private Runnable pendingWindowPollRunnable = null;

    private final Map<String, Long> scannedChatsCooldown = Collections.synchronizedMap(
            new LinkedHashMap<String, Long>(48, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, Long> eldest) {
                    return size() > 60;
                }
            }
    );

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null || event.getPackageName() == null) {
            return;
        }
        String pkg = event.getPackageName().toString();
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) {
            return;
        }

        try {
            if ("com.whatsapp".equals(pkg) || "com.whatsapp.w4b".equals(pkg)) {
                if (KevinAgentPrefs.isPendingWhatsAppSend(this)) {
                    if (tryClickWhatsAppSend(root, pkg)) {
                        KevinAgentPrefs.clearPendingWhatsAppSend(this);
                        return;
                    }
                }
                if (KevinAgentPrefs.isWhatsAppScanActive(this)
                        && KevinAgentPrefs.isWhatsAppAutoReplyCurrentlyActive(this)) {
                    handleWhatsAppUnreadScan(root, pkg);
                }
            } else if ("com.google.android.youtube".equals(pkg)
                    && KevinAgentPrefs.isPendingYouTubePlay(this)) {
                if (tryClickFirstYouTubeResult(root, pkg)) {
                    KevinAgentPrefs.clearPendingYouTubePlay(this);
                }
            } else if (isLarkPlayerPackage(pkg)
                    && KevinAgentPrefs.isPendingLarkActionActive(this)) {
                handleLarkPlayerAction(root, pkg);
            } else if (isAudiomackPackage(pkg)
                    && KevinAgentPrefs.isPendingAudiomackActionActive(this)) {
                handleAudiomackAction(root, pkg);
            }
        } finally {
            root.recycle();
        }
    }

    private void scheduleActiveWindowPoll(final String expectedPkg, long delayMs) {
        if (TextUtils.isEmpty(expectedPkg)) return;
        if (pendingWindowPollRunnable != null) {
            mainHandler.removeCallbacks(pendingWindowPollRunnable);
        }
        pendingWindowPollRunnable = () -> {
            pendingWindowPollRunnable = null;
            AccessibilityNodeInfo freshRoot = getRootInActiveWindow();
            if (freshRoot == null) return;
            try {
                CharSequence pkgSeq = freshRoot.getPackageName();
                String activePkg = pkgSeq != null ? pkgSeq.toString() : "";
                if ("com.google.android.youtube".equals(expectedPkg)
                        && "com.google.android.youtube".equals(activePkg)
                        && KevinAgentPrefs.isPendingYouTubePlay(KevinAgentAccessibilityService.this)) {
                    if (tryClickFirstYouTubeResult(freshRoot, activePkg)) {
                        KevinAgentPrefs.clearPendingYouTubePlay(KevinAgentAccessibilityService.this);
                    }
                } else if (isLarkPlayerPackage(expectedPkg)
                        && isLarkPlayerPackage(activePkg)
                        && KevinAgentPrefs.isPendingLarkActionActive(KevinAgentAccessibilityService.this)) {
                    handleLarkPlayerAction(freshRoot, activePkg);
                } else if (isAudiomackPackage(expectedPkg)
                        && isAudiomackPackage(activePkg)
                        && KevinAgentPrefs.isPendingAudiomackActionActive(KevinAgentAccessibilityService.this)) {
                    handleAudiomackAction(freshRoot, activePkg);
                }
            } finally {
                freshRoot.recycle();
            }
        };
        mainHandler.postDelayed(pendingWindowPollRunnable, Math.max(250L, delayMs));
    }

    private void handleWhatsAppUnreadScan(AccessibilityNodeInfo root, String pkg) {
        if (scanStepBusy) {
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastNavigationAt < 900L) {
            return;
        }
        if (!KevinAgentPrefs.isWhatsAppAutoReplyCurrentlyActive(this)
                || KevinAgentPrefs.getWhatsAppScanCount(this) >= 5) {
            KevinAgentPrefs.clearWhatsAppScan(this);
            return;
        }

        List<AccessibilityNodeInfo> entryNodes = root.findAccessibilityNodeInfosByViewId(pkg + ":id/entry");
        boolean insideChat = entryNodes != null && !entryNodes.isEmpty();

        if (insideChat) {
            consecutiveEmptyListScans = 0;
            handleInsideWhatsAppChat(root, pkg);
        } else {
            handleWhatsAppChatsList(root, pkg);
        }
    }

    private void handleWhatsAppChatsList(AccessibilityNodeInfo root, String pkg) {
        AccessibilityNodeInfo unreadTargetRow = findFirstUnreadRow(root, pkg);
        if (unreadTargetRow != null) {
            consecutiveEmptyListScans = 0;
            lastNavigationAt = System.currentTimeMillis();
            unreadTargetRow.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            return;
        }

        consecutiveEmptyListScans++;
        if (consecutiveEmptyListScans >= 4) {
            consecutiveEmptyListScans = 0;
            KevinAgentPrefs.clearWhatsAppScan(this);
        }
    }

    private boolean isSkippedSystemChat(String contactName) {
        if (TextUtils.isEmpty(contactName)) return false;
        String lower = contactName.trim().toLowerCase(Locale.ROOT);
        return lower.equals("whatsapp")
                || lower.equals("whatsapp business")
                || lower.equals("meta ai")
                || lower.equals("archived")
                || lower.equals("locked chats");
    }

    private AccessibilityNodeInfo findFirstUnreadRow(AccessibilityNodeInfo root, String pkg) {
        long now = System.currentTimeMillis();
        List<AccessibilityNodeInfo> badges = root.findAccessibilityNodeInfosByViewId(
                pkg + ":id/conversations_row_message_count");
        if (badges != null && !badges.isEmpty()) {
            for (AccessibilityNodeInfo badge : badges) {
                CharSequence badgeText = badge.getText();
                if (badgeText == null || TextUtils.isEmpty(badgeText.toString().trim())) {
                    continue;
                }
                AccessibilityNodeInfo row = climbToClickableParent(badge, 6);
                if (row == null) continue;

                String contactName = extractFirstTextByViewId(row, pkg + ":id/conversations_row_contact_name");
                if (isSkippedSystemChat(contactName)) continue;

                String key = !TextUtils.isEmpty(contactName)
                        ? contactName.toLowerCase(Locale.ROOT)
                        : ("row_" + badge.hashCode());
                Long prev = scannedChatsCooldown.get(key);
                if ((prev != null && (now - prev) < CHAT_REPLY_COOLDOWN_MS)
                        || KevinAgentPrefs.wasWhatsAppChatRecentlyReplied(this, contactName, CHAT_REPLY_COOLDOWN_MS)) {
                    continue;
                }
                return row;
            }
        }

        List<AccessibilityNodeInfo> names = root.findAccessibilityNodeInfosByViewId(
                pkg + ":id/conversations_row_contact_name");
        if (names != null) {
            for (AccessibilityNodeInfo nameNode : names) {
                AccessibilityNodeInfo row = climbToClickableParent(nameNode, 5);
                if (row == null) continue;
                CharSequence rowDesc = row.getContentDescription();
                String descLower = rowDesc != null ? rowDesc.toString().toLowerCase(Locale.ROOT) : "";
                if (!descLower.contains("unread")) continue;

                CharSequence contactSeq = nameNode.getText();
                String contactName = contactSeq != null ? contactSeq.toString().trim() : "";
                if (TextUtils.isEmpty(contactName) || isSkippedSystemChat(contactName)) continue;
                String key = contactName.toLowerCase(Locale.ROOT);
                Long prev = scannedChatsCooldown.get(key);
                if ((prev != null && (now - prev) < CHAT_REPLY_COOLDOWN_MS)
                        || KevinAgentPrefs.wasWhatsAppChatRecentlyReplied(this, contactName, CHAT_REPLY_COOLDOWN_MS)) {
                    continue;
                }
                return row;
            }
        }
        return null;
    }

    private void handleInsideWhatsAppChat(AccessibilityNodeInfo root, String pkg) {
        String senderName = extractFirstTextByViewId(root, pkg + ":id/conversation_contact_name");
        if (TextUtils.isEmpty(senderName)) {
            senderName = "WhatsApp Contact";
        }
        if (isSkippedSystemChat(senderName)) {
            lastNavigationAt = System.currentTimeMillis();
            performGlobalAction(GLOBAL_ACTION_BACK);
            return;
        }

        String senderKey = senderName.toLowerCase(Locale.ROOT);
        long now = System.currentTimeMillis();
        Long prev = scannedChatsCooldown.get(senderKey);
        if ((prev != null && (now - prev) < CHAT_REPLY_COOLDOWN_MS)
                || KevinAgentPrefs.wasWhatsAppChatRecentlyReplied(this, senderName, CHAT_REPLY_COOLDOWN_MS)) {
            lastNavigationAt = now;
            performGlobalAction(GLOBAL_ACTION_BACK);
            return;
        }

        List<AccessibilityNodeInfo> msgTextNodes = root.findAccessibilityNodeInfosByViewId(pkg + ":id/message_text");
        if (msgTextNodes == null || msgTextNodes.isEmpty()) {
            scannedChatsCooldown.put(senderKey, now);
            lastNavigationAt = now;
            performGlobalAction(GLOBAL_ACTION_BACK);
            return;
        }

        int screenWidth = getResources().getDisplayMetrics().widthPixels;
        AccessibilityNodeInfo lastMsgNode = msgTextNodes.get(msgTextNodes.size() - 1);
        CharSequence lastSeq = lastMsgNode.getText();
        String lastTxt = lastSeq != null ? lastSeq.toString().trim() : "";

        if (isOutgoingMessageBubble(lastMsgNode, pkg, screenWidth)
                || KevinAgentPrefs.isOwnSentWhatsAppText(this, senderName, lastTxt)) {
            scannedChatsCooldown.put(senderKey, now);
            lastNavigationAt = now;
            performGlobalAction(GLOBAL_ACTION_BACK);
            return;
        }

        // Gather up to last 2 consecutive incoming messages on a single clean line
        List<String> incomingParts = new ArrayList<>();
        int start = Math.max(0, msgTextNodes.size() - 2);
        for (int i = start; i < msgTextNodes.size(); i++) {
            AccessibilityNodeInfo node = msgTextNodes.get(i);
            CharSequence txt = node.getText();
            String msgStr = txt != null ? txt.toString().trim() : "";
            if (isOutgoingMessageBubble(node, pkg, screenWidth)
                    || KevinAgentPrefs.isOwnSentWhatsAppText(this, senderName, msgStr)) {
                incomingParts.clear();
                continue;
            }
            if (!TextUtils.isEmpty(msgStr)) {
                incomingParts.add(msgStr);
            }
        }

        String incomingText = TextUtils.join(" ", incomingParts).trim();
        if (TextUtils.isEmpty(incomingText)) {
            scannedChatsCooldown.put(senderKey, now);
            lastNavigationAt = now;
            performGlobalAction(GLOBAL_ACTION_BACK);
            return;
        }

        scanStepBusy = true;
        scannedChatsCooldown.put(senderKey, now);
        KevinAgentPrefs.recordWhatsAppChatReplied(this, senderName, "");
        final String finalSender = senderName;

        scanExecutor.execute(() -> {
            String rawReply = KevinNotificationListenerService.generateReplyStatic(
                    KevinAgentAccessibilityService.this,
                    finalSender,
                    incomingText
            );
            String replyText = KevinNotificationListenerService.sanitizeWhatsAppReply(
                    rawReply,
                    KevinAgentPrefs.getUserName(KevinAgentAccessibilityService.this),
                    finalSender
            );

            mainHandler.post(() -> {
                if (TextUtils.isEmpty(replyText)) {
                    scanStepBusy = false;
                    lastNavigationAt = System.currentTimeMillis();
                    performGlobalAction(GLOBAL_ACTION_BACK);
                    return;
                }
                AccessibilityNodeInfo freshRoot = getRootInActiveWindow();
                if (freshRoot == null) {
                    scanStepBusy = false;
                    return;
                }
                boolean entered = false;
                try {
                    List<AccessibilityNodeInfo> entries = freshRoot.findAccessibilityNodeInfosByViewId(pkg + ":id/entry");
                    if (entries != null && !entries.isEmpty()) {
                        AccessibilityNodeInfo entry = entries.get(0);
                        Bundle args = new Bundle();
                        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, replyText);
                        entered = entry.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
                    }
                } finally {
                    freshRoot.recycle();
                }

                if (!entered) {
                    scanStepBusy = false;
                    lastNavigationAt = System.currentTimeMillis();
                    performGlobalAction(GLOBAL_ACTION_BACK);
                    return;
                }

                mainHandler.postDelayed(() -> {
                    if (!KevinAgentPrefs.isWhatsAppAutoReplyCurrentlyActive(KevinAgentAccessibilityService.this)) {
                        KevinAgentPrefs.clearWhatsAppScan(KevinAgentAccessibilityService.this);
                        scanStepBusy = false;
                        return;
                    }
                    AccessibilityNodeInfo sendRoot = getRootInActiveWindow();
                    boolean sent = false;
                    if (sendRoot != null) {
                        try {
                            sent = tryClickWhatsAppSend(sendRoot, pkg);
                        } finally {
                            sendRoot.recycle();
                        }
                    }
                    if (sent) {
                        KevinAgentPrefs.recordWhatsAppChatReplied(
                                KevinAgentAccessibilityService.this,
                                finalSender,
                                replyText
                        );
                        KevinAgentPrefs.incrementWhatsAppScanCount(KevinAgentAccessibilityService.this);
                        Intent broadcast = new Intent(KevinNotificationListenerService.ACTION_WHATSAPP_REPLIED)
                                .setPackage(getPackageName())
                                .putExtra(KevinNotificationListenerService.EXTRA_SENDER, finalSender)
                                .putExtra(KevinNotificationListenerService.EXTRA_INCOMING, incomingText)
                                .putExtra(KevinNotificationListenerService.EXTRA_REPLY, replyText);
                        sendBroadcast(broadcast);
                    }
                    mainHandler.postDelayed(() -> {
                        lastNavigationAt = System.currentTimeMillis();
                        scanStepBusy = false;
                        if (KevinAgentPrefs.getWhatsAppScanCount(KevinAgentAccessibilityService.this) >= 5) {
                            KevinAgentPrefs.clearWhatsAppScan(KevinAgentAccessibilityService.this);
                        } else {
                            performGlobalAction(GLOBAL_ACTION_BACK);
                        }
                    }, 600L);
                }, 320L);
            });
        });
    }

    private boolean isOutgoingMessageBubble(AccessibilityNodeInfo msgTextNode, String pkg, int screenWidth) {
        if (msgTextNode == null) return false;
        AccessibilityNodeInfo parent = msgTextNode;
        for (int depth = 0; depth < 6 && parent != null; depth++) {
            List<AccessibilityNodeInfo> statusNodes = parent.findAccessibilityNodeInfosByViewId(pkg + ":id/status");
            if (statusNodes != null && !statusNodes.isEmpty()) {
                return true;
            }
            List<AccessibilityNodeInfo> msgStatusNodes = parent.findAccessibilityNodeInfosByViewId(pkg + ":id/message_status");
            if (msgStatusNodes != null && !msgStatusNodes.isEmpty()) {
                return true;
            }
            parent = parent.getParent();
        }
        if (screenWidth > 0) {
            Rect bounds = new Rect();
            msgTextNode.getBoundsInScreen(bounds);
            int rightMargin = screenWidth - bounds.right;
            if (bounds.left > screenWidth * 0.16 && rightMargin < screenWidth * 0.16 && bounds.left > rightMargin * 1.4) {
                return true;
            }
        }
        return false;
    }

    private String extractFirstTextByViewId(AccessibilityNodeInfo container, String viewId) {
        if (container == null) return "";
        List<AccessibilityNodeInfo> nodes = container.findAccessibilityNodeInfosByViewId(viewId);
        if (nodes == null || nodes.isEmpty()) return "";
        CharSequence seq = nodes.get(0).getText();
        return seq != null ? seq.toString().trim() : "";
    }

    private AccessibilityNodeInfo climbToClickableParent(AccessibilityNodeInfo node, int maxDepth) {
        AccessibilityNodeInfo current = node;
        int depth = 0;
        while (current != null && depth <= maxDepth) {
            if (current.isClickable() && current.isEnabled()) {
                return current;
            }
            current = current.getParent();
            depth++;
        }
        return null;
    }

    private boolean tryClickWhatsAppSend(AccessibilityNodeInfo root, String pkg) {
        List<AccessibilityNodeInfo> byId = root.findAccessibilityNodeInfosByViewId(pkg + ":id/send");
        if (clickFirstClickable(byId)) {
            return true;
        }
        List<AccessibilityNodeInfo> byActionBtn = root.findAccessibilityNodeInfosByViewId(
                pkg + ":id/conversation_entry_action_button");
        if (byActionBtn != null) {
            for (AccessibilityNodeInfo node : byActionBtn) {
                CharSequence desc = node.getContentDescription();
                String lowerDesc = desc != null ? desc.toString().toLowerCase(Locale.ROOT) : "";
                if (lowerDesc.contains("send") || lowerDesc.contains("ohereza") || lowerDesc.contains("envoyer")) {
                    if (node.isClickable() && node.isEnabled()
                            && node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                        return true;
                    }
                }
            }
        }
        if (clickByContentDescRecursive(root)) {
            return true;
        }
        List<AccessibilityNodeInfo> byDesc = root.findAccessibilityNodeInfosByText("Send");
        return clickFirstClickable(byDesc);
    }

    private boolean clickByContentDescRecursive(AccessibilityNodeInfo node) {
        if (node == null) return false;
        CharSequence desc = node.getContentDescription();
        if (desc != null) {
            String lower = desc.toString().trim().toLowerCase(Locale.ROOT);
            if ("send".equals(lower) || "ohereza".equals(lower) || "envoyer".equals(lower)) {
                AccessibilityNodeInfo current = node;
                int depth = 0;
                while (current != null && depth < 4) {
                    if (current.isClickable() && current.isEnabled()) {
                        return current.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                    }
                    current = current.getParent();
                    depth++;
                }
            }
        }
        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                try {
                    if (clickByContentDescRecursive(child)) {
                        return true;
                    }
                } finally {
                    child.recycle();
                }
            }
        }
        return false;
    }

    private boolean isMusicActivelyPlaying(String playerHint) {
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am != null && am.isMusicActive()) {
                return true;
            }
            if ("lark".equals(playerHint)) {
                org.json.JSONObject np = new org.json.JSONObject(KevinNotificationListenerService.getLarkNowPlayingJson(this));
                if (np.optBoolean("isPlaying", false)) return true;
            } else if ("audiomack".equals(playerHint)) {
                org.json.JSONObject np = new org.json.JSONObject(KevinNotificationListenerService.getAudiomackNowPlayingJson(this));
                if (np.optBoolean("isPlaying", false)) return true;
            }
        } catch (Exception ignored) {}
        return false;
    }

    private boolean dispatchMediaPlayKey() {
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return false;
            long eventTime = SystemClock.uptimeMillis();
            am.dispatchMediaKeyEvent(new KeyEvent(eventTime, eventTime, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PLAY, 0));
            am.dispatchMediaKeyEvent(new KeyEvent(eventTime, eventTime, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_PLAY, 0));
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private boolean tryClickFirstYouTubeResult(AccessibilityNodeInfo root, String pkg) {
        long now = System.currentTimeMillis();
        if (clickExactPromoDismissButton(root)) {
            lastNavigationAt = now;
            scheduleActiveWindowPoll(pkg, 650L);
            return false;
        }

        List<AccessibilityNodeInfo> watchPlayer = root.findAccessibilityNodeInfosByViewId(
                "com.google.android.youtube:id/player_view");
        if (watchPlayer != null && !watchPlayer.isEmpty()) {
            Rect playerBounds = new Rect();
            watchPlayer.get(0).getBoundsInScreen(playerBounds);
            boolean isFullWatchPlayer = playerBounds.height() > 260;
            if (isFullWatchPlayer) {
                if (isMusicActivelyPlaying("youtube")) {
                    return true;
                }
                List<AccessibilityNodeInfo> playCtrls = root.findAccessibilityNodeInfosByViewId(
                        "com.google.android.youtube:id/player_control_play_pause_replay_button");
                if (playCtrls != null && !playCtrls.isEmpty()) {
                    CharSequence desc = playCtrls.get(0).getContentDescription();
                    String d = desc != null ? desc.toString().toLowerCase(Locale.ROOT) : "";
                    if (d.contains("play") && !d.contains("pause")) {
                        playCtrls.get(0).performAction(AccessibilityNodeInfo.ACTION_CLICK);
                        return true;
                    }
                }
                if (clickNodeByKeywords(root, new String[] { "play video", "play" }, false)) {
                    return true;
                }
                dispatchMediaPlayKey();
                return true;
            }
        }

        if (now - lastNavigationAt < 500L) {
            return false;
        }

        List<AccessibilityNodeInfo> videoTitles = root.findAccessibilityNodeInfosByViewId(
                "com.google.android.youtube:id/title");
        if (videoTitles != null && !videoTitles.isEmpty()) {
            for (AccessibilityNodeInfo titleNode : videoTitles) {
                CharSequence t = titleNode.getText();
                String s = t != null ? t.toString().trim().toLowerCase(Locale.ROOT) : "";
                if (TextUtils.isEmpty(s) || s.length() < 3
                        || s.equals("shorts") || s.equals("all") || s.equals("videos")
                        || s.equals("sponsored") || s.startsWith("ad ")) {
                    continue;
                }
                Rect b = new Rect();
                titleNode.getBoundsInScreen(b);
                if (b.top < 160) continue;
                AccessibilityNodeInfo clickable = climbToClickableParent(titleNode, 5);
                if (clickable != null && clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                    lastNavigationAt = now;
                    scheduleActiveWindowPoll(pkg, 900L);
                    return false;
                }
            }
        }

        if (clickFirstPlayableResult(root, "")) {
            lastNavigationAt = now;
            scheduleActiveWindowPoll(pkg, 900L);
            return false;
        }

        scheduleActiveWindowPoll(pkg, 750L);
        return false;
    }

    private boolean clickFirstClickable(List<AccessibilityNodeInfo> nodes) {
        if (nodes == null || nodes.isEmpty()) {
            return false;
        }
        for (AccessibilityNodeInfo node : nodes) {
            AccessibilityNodeInfo current = node;
            int depth = 0;
            while (current != null && depth < 5) {
                if (current.isClickable() && current.isEnabled()) {
                    return current.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                }
                current = current.getParent();
                depth++;
            }
        }
        return false;
    }

    private boolean isLarkPlayerPackage(String pkg) {
        if (TextUtils.isEmpty(pkg)) return false;
        String lower = pkg.toLowerCase(Locale.ROOT);
        return lower.contains("larkplayer") || lower.equals("com.lark.player");
    }

    private void handleLarkPlayerAction(AccessibilityNodeInfo root, String pkg) {
        long now = System.currentTimeMillis();
        if (now - lastNavigationAt < 550L) {
            scheduleActiveWindowPoll(pkg, 620L);
            return;
        }
        String actionJson = KevinAgentPrefs.getPendingLarkActionJson(this);
        if (TextUtils.isEmpty(actionJson)) {
            KevinAgentPrefs.clearPendingLarkAction(this);
            return;
        }

        int step = KevinAgentPrefs.incrementPendingLarkStep(this);
        if (step > 32) {
            KevinAgentPrefs.clearPendingLarkAction(this);
            return;
        }

        try {
            org.json.JSONObject task = new org.json.JSONObject(actionJson);
            String action = task.optString("action", "play").toLowerCase(Locale.ROOT);
            String query = task.optString("query", "").trim();
            String songTitle = task.optString("songTitle", "").trim();
            String artist = task.optString("artist", "").trim();
            String playlistName = task.optString("playlistName", "").trim();
            String tab = task.optString("tab", "").trim();
            boolean alreadySearched = task.optBoolean("_searched", false);
            boolean playlistNamed = task.optBoolean("_playlistNamed", false);
            boolean playlistCreated = task.optBoolean("_playlistCreated", false);

            // Dismiss any non-blocking promo/skip/permission popups safely (exact match so we never click "Play Later" or "Skip Next")
            if (clickExactPromoDismissButton(root)) {
                lastNavigationAt = now;
                scheduleActiveWindowPoll(pkg, 600L);
                return;
            }

            if ("open".equals(action) || "open_app".equals(action)) {
                KevinAgentPrefs.clearPendingLarkAction(this);
                return;
            }

            if ("ensure_play".equals(action)) {
                if (isMusicActivelyPlaying("lark")) {
                    KevinAgentPrefs.clearPendingLarkAction(this);
                    return;
                }
                if (tryClickExplicitPlayButton(root)) {
                    lastNavigationAt = now;
                    KevinAgentPrefs.clearPendingLarkAction(this);
                    return;
                }
                if (step >= 4) {
                    dispatchMediaPlayKey();
                    KevinAgentPrefs.clearPendingLarkAction(this);
                    return;
                }
                scheduleActiveWindowPoll(pkg, 650L);
                return;
            }

            if ("equalizer".equals(action) || "eq".equals(action)
                    || "set_equalizer".equals(action) || "toggle_equalizer".equals(action)
                    || "bass_boost".equals(action)) {
                handleEqualizerUiAutomation(root, pkg, task, step, now, true);
                return;
            }

            if ("play".equals(action) || "play_song".equals(action) || "search".equals(action)) {
                String targetText = !TextUtils.isEmpty(songTitle) ? songTitle : query;
                if (TextUtils.isEmpty(targetText)) {
                    // Play all / first song
                    if (isMusicActivelyPlaying("lark")) {
                        KevinAgentPrefs.clearPendingLarkAction(this);
                        return;
                    }
                    if (clickNodeByKeywords(root, new String[] { "shuffle all", "play all", "play" }, false)
                            || clickFirstPlayableResult(root, "")) {
                        KevinAgentPrefs.clearPendingLarkAction(this);
                        lastNavigationAt = now;
                    } else {
                        scheduleActiveWindowPoll(pkg, 650L);
                    }
                    return;
                }

                // 0) If we already clicked a result, ensure playback is actually running!
                if (task.optBoolean("_clickedResult", false)) {
                    if (isMusicActivelyPlaying("lark")) {
                        KevinAgentPrefs.clearPendingLarkAction(this);
                        return;
                    }
                    if (tryClickExplicitPlayButton(root)) {
                        KevinAgentPrefs.clearPendingLarkAction(this);
                        lastNavigationAt = now;
                        return;
                    }
                    if (step >= 8) {
                        dispatchMediaPlayKey();
                        KevinAgentPrefs.clearPendingLarkAction(this);
                    } else {
                        scheduleActiveWindowPoll(pkg, 650L);
                    }
                    return;
                }

                // 1) If already searched, try clicking matching song result (or first playable track after results settle)
                if (alreadySearched) {
                    if (clickBestMatchingSongNode(root, targetText, artist)
                            || (step >= 4 && clickFirstPlayableResult(root, targetText))) {
                        lastNavigationAt = now;
                        if ("search".equals(action)) {
                            KevinAgentPrefs.clearPendingLarkAction(this);
                        } else {
                            task.put("_clickedResult", true);
                            KevinAgentPrefs.updatePendingLarkActionJson(this, task.toString());
                            scheduleActiveWindowPoll(pkg, 700L);
                        }
                        return;
                    }
                }

                // 2) If an EditText search box is visible and we haven't typed yet, type query and submit IME search
                AccessibilityNodeInfo searchBox = findEditableNode(root);
                if (searchBox != null && !alreadySearched) {
                    Bundle args = new Bundle();
                    args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, targetText);
                    searchBox.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
                    if (searchBox.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
                        task.put("_searched", true);
                        KevinAgentPrefs.updatePendingLarkActionJson(this, task.toString());
                        lastNavigationAt = now;
                        submitSearchNode(searchBox, root);
                        scheduleActiveWindowPoll(pkg, 700L);
                        return;
                    }
                }

                // 3) If song is already visible right on the current list, click it directly!
                if (clickBestMatchingSongNode(root, targetText, artist)) {
                    lastNavigationAt = now;
                    task.put("_clickedResult", true);
                    KevinAgentPrefs.updatePendingLarkActionJson(this, task.toString());
                    scheduleActiveWindowPoll(pkg, 700L);
                    return;
                }

                // 4) Otherwise tap the Search icon/bar in Lark Player to open search
                if (!alreadySearched && clickSearchTrigger(root, pkg)) {
                    lastNavigationAt = now;
                    scheduleActiveWindowPoll(pkg, 650L);
                    return;
                }

                scheduleActiveWindowPoll(pkg, 700L);
                return;
            }

            if ("play_all".equals(action) || "shuffle_all".equals(action) || "shuffle".equals(action)) {
                if (isMusicActivelyPlaying("lark") && task.optBoolean("_clickedResult", false)) {
                    KevinAgentPrefs.clearPendingLarkAction(this);
                    return;
                }
                if (clickNodeByKeywords(root, new String[] { "shuffle all", "shuffle", "play all", "play" }, true)
                        || clickFirstPlayableResult(root, "")) {
                    task.put("_clickedResult", true);
                    KevinAgentPrefs.updatePendingLarkActionJson(this, task.toString());
                    lastNavigationAt = now;
                    scheduleActiveWindowPoll(pkg, 700L);
                    return;
                }
                clickNodeByKeywords(root, new String[] { "songs", "music", "tracks", "local" }, false);
                lastNavigationAt = now;
                scheduleActiveWindowPoll(pkg, 650L);
                return;
            }

            if ("create_playlist".equals(action) || "add_to_playlist".equals(action)) {
                String pName = !TextUtils.isEmpty(playlistName) ? playlistName : (!TextUtils.isEmpty(query) ? query : "Kevin Mix");

                // Step A: If a name EditText dialog is currently open, type playlistName & confirm
                if (!playlistNamed) {
                    AccessibilityNodeInfo input = findEditableNode(root);
                    if (input != null) {
                        Bundle args = new Bundle();
                        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, pName);
                        input.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
                        if (input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
                            task.put("_playlistNamed", true);
                            KevinAgentPrefs.updatePendingLarkActionJson(this, task.toString());
                            lastNavigationAt = now;
                            mainHandler.postDelayed(() -> {
                                AccessibilityNodeInfo fresh = getRootInActiveWindow();
                                if (fresh != null) {
                                    try {
                                        clickNodeByKeywords(fresh, new String[] { "ok", "create", "save", "confirm", "done", "add" }, false);
                                    } finally {
                                        fresh.recycle();
                                    }
                                }
                            }, 280L);
                            return;
                        }
                    }
                }

                // Step B: If playlist was named and "Add songs" button OR song selection list is open
                if (playlistNamed && !playlistCreated) {
                    if (!task.optBoolean("_openedAddSongs", false)
                            && clickNodeByKeywords(root, new String[] { "add songs", "add music", "add audio", "add tracks" }, false)) {
                        task.put("_openedAddSongs", true);
                        KevinAgentPrefs.updatePendingLarkActionJson(this, task.toString());
                        lastNavigationAt = now;
                        return;
                    }
                    org.json.JSONArray songTitles = task.optJSONArray("songTitles");
                    int clicked = 0;
                    if (songTitles != null && songTitles.length() > 0) {
                        for (int i = 0; i < Math.min(songTitles.length(), 8); i++) {
                            String title = songTitles.optString(i, "");
                            if (!TextUtils.isEmpty(title) && clickBestMatchingSongNode(root, title, "")) {
                                clicked++;
                            }
                        }
                    }
                    if (clicked > 0) {
                        task.put("_playlistCreated", true);
                        KevinAgentPrefs.updatePendingLarkActionJson(this, task.toString());
                        lastNavigationAt = now;
                        mainHandler.postDelayed(() -> {
                            AccessibilityNodeInfo fresh = getRootInActiveWindow();
                            if (fresh != null) {
                                try {
                                    clickNodeByKeywords(fresh, new String[] { "done", "save", "ok", "confirm", "add" }, false);
                                } finally {
                                    fresh.recycle();
                                }
                            }
                        }, 260L);
                        return;
                    }
                    if (clickNodeByKeywords(root, new String[] { "done", "save", "ok", "confirm", "create" }, false)) {
                        task.put("_playlistCreated", true);
                        KevinAgentPrefs.updatePendingLarkActionJson(this, task.toString());
                        KevinAgentPrefs.clearPendingLarkAction(this);
                        lastNavigationAt = now;
                        return;
                    }
                }

                if (playlistCreated) {
                    clickNodeByKeywords(root, new String[] { "done", "save", "ok", "confirm", "add" }, false);
                    KevinAgentPrefs.clearPendingLarkAction(this);
                    lastNavigationAt = now;
                    return;
                }

                // Step C: If "add_to_playlist" and target playlist exists on screen, click it
                if ("add_to_playlist".equals(action) && !TextUtils.isEmpty(pName)) {
                    if (clickExactOrContainsText(root, pName)) {
                        KevinAgentPrefs.clearPendingLarkAction(this);
                        lastNavigationAt = now;
                        return;
                    }
                }

                // Step D: Click New Playlist / Create / + button, or navigate to Playlists tab first
                if (clickNodeByKeywords(root, new String[] { "new playlist", "create playlist", "create new", "add playlist", "iv_add", "btn_add", "fab", "+" }, true)) {
                    lastNavigationAt = now;
                    return;
                }
                if (clickNodeByKeywords(root, new String[] { "playlists", "playlist" }, false)) {
                    lastNavigationAt = now;
                    return;
                }
                return;
            }

            if ("play_playlist".equals(action)) {
                String pName = !TextUtils.isEmpty(playlistName) ? playlistName : query;
                if (!task.optBoolean("_openedPlaylist", false) && !TextUtils.isEmpty(pName)) {
                    if (clickExactOrContainsText(root, pName)) {
                        task.put("_openedPlaylist", true);
                        KevinAgentPrefs.updatePendingLarkActionJson(this, task.toString());
                        lastNavigationAt = now;
                        return;
                    }
                }
                if (task.optBoolean("_openedPlaylist", false)) {
                    if (clickNodeByKeywords(root, new String[] { "play all", "shuffle", "play" }, true)) {
                        KevinAgentPrefs.clearPendingLarkAction(this);
                        lastNavigationAt = now;
                        return;
                    }
                }
                clickNodeByKeywords(root, new String[] { "playlists", "playlist" }, false);
                lastNavigationAt = now;
                return;
            }

            // Generic Lark Player UI feature actions (pause, resume, next, previous, repeat, favorite, equalizer, sleep_timer, lyrics, queue, open_tab, etc.)
            String[] targetKeywords = resolveLarkActionKeywords(action, tab);
            if (targetKeywords.length > 0 && clickNodeByKeywords(root, targetKeywords, true)) {
                KevinAgentPrefs.clearPendingLarkAction(this);
                lastNavigationAt = now;
                return;
            }

            // If a feature (like sleep timer, equalizer, lyrics, repeat) is inside the player screen or menu, try opening mini-player or menu
            if (step <= 3) {
                if (clickNodeByKeywords(root, new String[] { "more", "menu", "options", "now playing", "player" }, true)) {
                    lastNavigationAt = now;
                    return;
                }
            }
            if (step >= 5) {
                KevinAgentPrefs.clearPendingLarkAction(this);
            }
        } catch (Exception ignored) {
            KevinAgentPrefs.clearPendingLarkAction(this);
        }
    }

    private String[] resolveLarkActionKeywords(String action, String tab) {
        switch (action) {
            case "pause":
                return new String[] { "pause" };
            case "resume":
            case "toggle":
                return new String[] { "play", "pause" };
            case "next":
                return new String[] { "next", "skip next", "forward" };
            case "previous":
            case "prev":
                return new String[] { "previous", "prev", "skip previous" };
            case "repeat":
            case "loop":
                return new String[] { "repeat", "loop", "cycle" };
            case "favorite":
            case "like":
                return new String[] { "favorite", "favourite", "like", "heart", "love" };
            case "equalizer":
            case "eq":
                return new String[] { "equalizer", "eq", "sound effect", "audio effect" };
            case "sleep_timer":
            case "timer":
                return new String[] { "sleep timer", "sleep", "timer" };
            case "lyrics":
                return new String[] { "lyrics", "lyric" };
            case "queue":
            case "add_to_queue":
                return new String[] { "queue", "playing queue", "add to queue", "up next" };
            case "play_next":
                return new String[] { "play next" };
            case "share":
                return new String[] { "share" };
            case "ringtone":
                return new String[] { "ringtone", "set as ringtone" };
            case "speed":
                return new String[] { "speed", "playback speed" };
            case "list_playlists":
                return new String[] { "playlists", "playlist" };
            case "list_artists":
                return new String[] { "artists", "artist" };
            case "list_albums":
                return new String[] { "albums", "album" };
            case "list_folders":
                return new String[] { "folders", "folder" };
            case "list_songs":
                return new String[] { "songs", "tracks", "music" };
            case "open_tab":
                if (!TextUtils.isEmpty(tab)) {
                    return new String[] { tab.toLowerCase(Locale.ROOT) };
                }
                return new String[] { "music", "songs" };
            default:
                return new String[0];
        }
    }

    private boolean isAudiomackPackage(String pkg) {
        if (TextUtils.isEmpty(pkg)) return false;
        return pkg.toLowerCase(Locale.ROOT).contains("audiomack");
    }

    private void handleAudiomackAction(AccessibilityNodeInfo root, String pkg) {
        long now = System.currentTimeMillis();
        if (now - lastNavigationAt < 550L) {
            scheduleActiveWindowPoll(pkg, 620L);
            return;
        }
        String actionJson = KevinAgentPrefs.getPendingAudiomackActionJson(this);
        if (TextUtils.isEmpty(actionJson)) {
            KevinAgentPrefs.clearPendingAudiomackAction(this);
            return;
        }

        int step = KevinAgentPrefs.incrementPendingAudiomackStep(this);
        if (step > 34) {
            KevinAgentPrefs.clearPendingAudiomackAction(this);
            return;
        }

        try {
            org.json.JSONObject task = new org.json.JSONObject(actionJson);
            String action = task.optString("action", "play").toLowerCase(Locale.ROOT);
            String query = task.optString("query", "").trim();
            String songTitle = task.optString("songTitle", "").trim();
            String artist = task.optString("artist", "").trim();
            String playlistName = task.optString("playlistName", "").trim();
            String tab = task.optString("tab", "").trim();
            boolean alreadySearched = task.optBoolean("_searched", false);
            boolean clickedResult = task.optBoolean("_clickedResult", false);
            boolean secondaryDone = task.optBoolean("_secondaryDone", false);

            // Dismiss Audiomack onboarding/upgrade/promo dialogs safely (exact text match)
            if (clickExactPromoDismissButton(root)) {
                lastNavigationAt = now;
                scheduleActiveWindowPoll(pkg, 600L);
                return;
            }

            if ("open".equals(action) || "open_app".equals(action)) {
                KevinAgentPrefs.clearPendingAudiomackAction(this);
                return;
            }

            if ("equalizer".equals(action) || "eq".equals(action)
                    || "set_equalizer".equals(action) || "toggle_equalizer".equals(action)
                    || "bass_boost".equals(action)) {
                handleEqualizerUiAutomation(root, pkg, task, step, now, false);
                return;
            }

            String targetText = !TextUtils.isEmpty(songTitle) ? songTitle : query;
            boolean needsSongSearchFirst = !TextUtils.isEmpty(targetText) && (
                    "play".equals(action) || "play_song".equals(action) || "search".equals(action)
                            || "download".equals(action) || "favorite".equals(action) || "like".equals(action)
                            || "repost".equals(action) || "follow".equals(action) || "queue".equals(action)
                            || "add_to_queue".equals(action) || "play_next".equals(action)
                            || "add_to_playlist".equals(action) || "share".equals(action)
            );

            if (needsSongSearchFirst && !clickedResult) {
                if (alreadySearched && (clickBestMatchingSongNode(root, targetText, artist)
                        || (step >= 4 && clickFirstPlayableResult(root, targetText)))) {
                    task.put("_clickedResult", true);
                    KevinAgentPrefs.updatePendingAudiomackActionJson(this, task.toString());
                    lastNavigationAt = now;
                    if ("search".equals(action)) {
                        KevinAgentPrefs.clearPendingAudiomackAction(this);
                    } else {
                        scheduleActiveWindowPoll(pkg, 700L);
                    }
                    return;
                }

                AccessibilityNodeInfo searchBox = findEditableNode(root);
                if (searchBox != null && !alreadySearched) {
                    Bundle args = new Bundle();
                    args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, targetText);
                    searchBox.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
                    if (searchBox.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
                        task.put("_searched", true);
                        KevinAgentPrefs.updatePendingAudiomackActionJson(this, task.toString());
                        lastNavigationAt = now;
                        submitSearchNode(searchBox, root);
                        scheduleActiveWindowPoll(pkg, 700L);
                        return;
                    }
                }

                if (clickBestMatchingSongNode(root, targetText, artist)) {
                    task.put("_clickedResult", true);
                    KevinAgentPrefs.updatePendingAudiomackActionJson(this, task.toString());
                    lastNavigationAt = now;
                    scheduleActiveWindowPoll(pkg, 700L);
                    return;
                }

                if (!alreadySearched && clickSearchTrigger(root, pkg)) {
                    lastNavigationAt = now;
                    scheduleActiveWindowPoll(pkg, 650L);
                    return;
                }

                scheduleActiveWindowPoll(pkg, 700L);
                return;
            }

            // If we clicked a track/result for playback
            if ("play".equals(action) || "play_song".equals(action)) {
                if (clickedResult) {
                    if (isMusicActivelyPlaying("audiomack")) {
                        KevinAgentPrefs.clearPendingAudiomackAction(this);
                        return;
                    }
                    if (tryClickExplicitPlayButton(root)) {
                        KevinAgentPrefs.clearPendingAudiomackAction(this);
                        lastNavigationAt = now;
                        return;
                    }
                    if (step >= 10) {
                        dispatchMediaPlayKey();
                        KevinAgentPrefs.clearPendingAudiomackAction(this);
                    } else {
                        scheduleActiveWindowPoll(pkg, 650L);
                    }
                    return;
                }
                if (TextUtils.isEmpty(targetText)) {
                    if (clickNodeByKeywords(root, new String[] { "play", "play all", "shuffle", "trending" }, true)
                            || clickFirstPlayableResult(root, "")) {
                        KevinAgentPrefs.clearPendingAudiomackAction(this);
                        lastNavigationAt = now;
                    } else {
                        scheduleActiveWindowPoll(pkg, 650L);
                    }
                    return;
                }
            }

            // Playlist creation or adding track to playlist inside Audiomack
            if ("create_playlist".equals(action) || "add_to_playlist".equals(action)) {
                String pName = !TextUtils.isEmpty(playlistName) ? playlistName : (!TextUtils.isEmpty(query) ? query : "Kevin Mix");
                if (!task.optBoolean("_playlistNamed", false)) {
                    AccessibilityNodeInfo input = findEditableNode(root);
                    if (input != null && (!needsSongSearchFirst || clickedResult)) {
                        Bundle args = new Bundle();
                        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, pName);
                        input.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
                        if (input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
                            task.put("_playlistNamed", true);
                            KevinAgentPrefs.updatePendingAudiomackActionJson(this, task.toString());
                            lastNavigationAt = now;
                            mainHandler.postDelayed(() -> {
                                AccessibilityNodeInfo fresh = getRootInActiveWindow();
                                if (fresh != null) {
                                    try {
                                        clickNodeByKeywords(fresh, new String[] { "create", "save", "done", "ok", "confirm", "add" }, false);
                                    } finally {
                                        fresh.recycle();
                                    }
                                }
                            }, 300L);
                            return;
                        }
                    }
                } else {
                    clickNodeByKeywords(root, new String[] { "create", "save", "done", "ok", "confirm", "add" }, false);
                    KevinAgentPrefs.clearPendingAudiomackAction(this);
                    lastNavigationAt = now;
                    return;
                }

                if ("add_to_playlist".equals(action) && clickedResult && !TextUtils.isEmpty(pName)) {
                    if (clickExactOrContainsText(root, pName)) {
                        KevinAgentPrefs.clearPendingAudiomackAction(this);
                        lastNavigationAt = now;
                        return;
                    }
                }
                if (clickNodeByKeywords(root, new String[] { "add to playlist", "new playlist", "create playlist", "create new", "iv_add", "btn_add", "fab", "+" }, true)) {
                    lastNavigationAt = now;
                    return;
                }
                if (!clickedResult && clickNodeByKeywords(root, new String[] { "my library", "library", "playlists", "playlist" }, true)) {
                    lastNavigationAt = now;
                    return;
                }
                if (clickedResult && !secondaryDone) {
                    if (clickNodeByKeywords(root, new String[] { "more", "menu", "options", "overflow" }, true)) {
                        task.put("_secondaryDone", true);
                        KevinAgentPrefs.updatePendingAudiomackActionJson(this, task.toString());
                        lastNavigationAt = now;
                    }
                }
                return;
            }

            if ("play_playlist".equals(action)) {
                String pName = !TextUtils.isEmpty(playlistName) ? playlistName : query;
                if (!task.optBoolean("_openedPlaylist", false) && !TextUtils.isEmpty(pName)) {
                    if (clickExactOrContainsText(root, pName)) {
                        task.put("_openedPlaylist", true);
                        KevinAgentPrefs.updatePendingAudiomackActionJson(this, task.toString());
                        lastNavigationAt = now;
                        return;
                    }
                }
                if (task.optBoolean("_openedPlaylist", false)) {
                    if (clickNodeByKeywords(root, new String[] { "play", "play all", "shuffle" }, true)) {
                        KevinAgentPrefs.clearPendingAudiomackAction(this);
                        lastNavigationAt = now;
                        return;
                    }
                }
                if (clickNodeByKeywords(root, new String[] { "playlists", "playlist", "my library", "library" }, true)) {
                    lastNavigationAt = now;
                    return;
                }
            }

            // Track/Artist UI actions (download, favorite/like, repost, follow, queue, play_next, shuffle, repeat, equalizer, sleep_timer, lyrics, share, open_tab, list_playlists, playback controls)
            String[] targetKeywords = resolveAudiomackActionKeywords(action, tab);
            if (targetKeywords.length > 0 && clickNodeByKeywords(root, targetKeywords, true)) {
                KevinAgentPrefs.clearPendingAudiomackAction(this);
                lastNavigationAt = now;
                return;
            }

            if (step <= 4) {
                if (clickNodeByKeywords(root, new String[] { "more", "menu", "options", "now playing", "player" }, true)) {
                    lastNavigationAt = now;
                    return;
                }
            }
            if (step >= 8) {
                KevinAgentPrefs.clearPendingAudiomackAction(this);
            }
        } catch (Exception ignored) {
            KevinAgentPrefs.clearPendingAudiomackAction(this);
        }
    }

    private String[] resolveAudiomackActionKeywords(String action, String tab) {
        switch (action) {
            case "pause":
                return new String[] { "pause" };
            case "resume":
            case "toggle":
                return new String[] { "play", "pause" };
            case "next":
                return new String[] { "next", "skip next", "forward" };
            case "previous":
            case "prev":
                return new String[] { "previous", "prev", "skip previous" };
            case "download":
                return new String[] { "download", "save offline", "offline" };
            case "favorite":
            case "like":
                return new String[] { "favorite", "favourite", "like", "heart" };
            case "repost":
                return new String[] { "repost", "re-up", "reup" };
            case "follow":
                return new String[] { "follow", "subscribe" };
            case "queue":
            case "add_to_queue":
                return new String[] { "add to queue", "queue", "up next" };
            case "play_next":
                return new String[] { "play next" };
            case "shuffle":
                return new String[] { "shuffle" };
            case "repeat":
            case "loop":
                return new String[] { "repeat", "loop" };
            case "equalizer":
            case "eq":
                return new String[] { "equalizer", "eq", "audio settings" };
            case "sleep_timer":
            case "timer":
                return new String[] { "sleep timer", "sleep", "timer" };
            case "lyrics":
                return new String[] { "lyrics", "lyric" };
            case "share":
                return new String[] { "share" };
            case "list_playlists":
                return new String[] { "playlists", "playlist", "my library" };
            case "open_tab":
                if (!TextUtils.isEmpty(tab)) {
                    String lowerTab = tab.toLowerCase(Locale.ROOT);
                    if ("library".equals(lowerTab) || "offline".equals(lowerTab)) {
                        return new String[] { "my library", "library", "offline" };
                    }
                    return new String[] { lowerTab };
                }
                return new String[] { "home", "trending", "feed" };
            default:
                return new String[0];
        }
    }

    private void submitSearchNode(AccessibilityNodeInfo searchBox, AccessibilityNodeInfo root) {
        if (searchBox != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                searchBox.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.getId());
            } catch (Exception ignored) {}
        }
        clickNodeByKeywords(root, new String[] { "search", "done", "go" }, true);
    }

    private boolean clickExactPromoDismissButton(AccessibilityNodeInfo root) {
        if (root == null) return false;
        String[] exactTerms = new String[] {
                "skip", "skip ad", "not now", "maybe later", "no thanks", "no, thanks", "dismiss", "close ad"
        };
        java.util.ArrayDeque<AccessibilityNodeInfo> queue = new java.util.ArrayDeque<>();
        queue.add(root);
        int visited = 0;
        while (!queue.isEmpty() && visited < 300) {
            AccessibilityNodeInfo node = queue.poll();
            visited++;
            if (node == null) continue;
            CharSequence cls = node.getClassName();
            boolean isEdit = cls != null && cls.toString().contains("EditText");
            if (!isEdit) {
                String text = node.getText() != null ? node.getText().toString().trim().toLowerCase(Locale.ROOT) : "";
                String desc = node.getContentDescription() != null ? node.getContentDescription().toString().trim().toLowerCase(Locale.ROOT) : "";
                for (String term : exactTerms) {
                    if (text.equals(term) || desc.equals(term)) {
                        AccessibilityNodeInfo clickable = climbToClickableParent(node, 4);
                        if (clickable != null && clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                            return true;
                        }
                    }
                }
            }
            int count = node.getChildCount();
            for (int i = 0; i < count; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) queue.add(child);
            }
        }
        return false;
    }

    private AccessibilityNodeInfo findEditableNode(AccessibilityNodeInfo root) {
        if (root == null) return null;
        CharSequence cls = root.getClassName();
        if (root.isEnabled() && (root.isEditable() || (cls != null && cls.toString().contains("EditText")))) {
            return root;
        }
        int count = root.getChildCount();
        for (int i = 0; i < count; i++) {
            AccessibilityNodeInfo child = root.getChild(i);
            if (child != null) {
                AccessibilityNodeInfo found = findEditableNode(child);
                if (found != null) return found;
            }
        }
        return null;
    }

    private boolean clickSearchTrigger(AccessibilityNodeInfo root, String pkg) {
        String[] candidateIds = new String[] {
                pkg + ":id/search",
                pkg + ":id/iv_search",
                pkg + ":id/btn_search",
                pkg + ":id/search_bar",
                pkg + ":id/search_layout",
                pkg + ":id/tv_search",
                pkg + ":id/action_search",
                pkg + ":id/search_src_text",
                pkg + ":id/menu_search",
                pkg + ":id/et_search",
                pkg + ":id/search_container",
                pkg + ":id/search_tab",
                pkg + ":id/navigation_search",
                pkg + ":id/tab_search",
                pkg + ":id/search_icon",
                pkg + ":id/search_button"
        };
        for (String id : candidateIds) {
            List<AccessibilityNodeInfo> nodes = root.findAccessibilityNodeInfosByViewId(id);
            if (clickFirstClickable(nodes)) return true;
        }
        return clickNodeByKeywords(root, new String[] { "search", "shakisha", "find" }, true);
    }

    private boolean clickExactOrContainsText(AccessibilityNodeInfo root, String target) {
        if (root == null || TextUtils.isEmpty(target)) return false;
        String lowerTarget = target.trim().toLowerCase(Locale.ROOT);
        List<AccessibilityNodeInfo> matched = root.findAccessibilityNodeInfosByText(target);
        if (clickFirstClickable(matched)) return true;
        return clickNodeByKeywords(root, new String[] { lowerTarget }, false);
    }

    private boolean isSkippedTabOrUiLabel(String txtLower) {
        if (TextUtils.isEmpty(txtLower)) return true;
        return txtLower.equals("all") || txtLower.equals("songs") || txtLower.equals("music")
                || txtLower.equals("videos") || txtLower.equals("artists") || txtLower.equals("albums")
                || txtLower.equals("playlists") || txtLower.equals("folders") || txtLower.equals("local")
                || txtLower.equals("online") || txtLower.equals("top") || txtLower.equals("shorts")
                || txtLower.equals("channels") || txtLower.equals("search") || txtLower.equals("cancel")
                || txtLower.equals("clear") || txtLower.equals("back") || txtLower.equals("sponsored")
                || txtLower.equals("ad") || txtLower.equals("home") || txtLower.equals("trending")
                || txtLower.equals("feed") || txtLower.equals("my library") || txtLower.equals("library");
    }

    private boolean clickBestMatchingSongNode(AccessibilityNodeInfo root, String queryOrTitle, String artist) {
        if (root == null || TextUtils.isEmpty(queryOrTitle)) return false;
        String combined = (queryOrTitle + " " + (artist != null ? artist : "")).trim().toLowerCase(Locale.ROOT);
        String[] rawTokens = combined.split("\\s+");
        List<String> tokens = new ArrayList<>();
        for (String t : rawTokens) {
            String clean = t.replaceAll("[^\\p{L}\\p{N}]", "");
            if (clean.length() >= 2
                    && !clean.equals("by")
                    && !clean.equals("ya")
                    && !clean.equals("za")
                    && !clean.equals("indirimbo")
                    && !clean.equals("song")
                    && !clean.equals("curanga")
                    && !clean.equals("play")
                    && !clean.equals("lark")
                    && !clean.equals("audiomack")) {
                tokens.add(clean);
            }
        }
        if (tokens.isEmpty()) return false;

        AccessibilityNodeInfo bestNode = null;
        int bestScore = 0;
        java.util.ArrayDeque<AccessibilityNodeInfo> queue = new java.util.ArrayDeque<>();
        queue.add(root);
        int visited = 0;
        while (!queue.isEmpty() && visited < 450) {
            AccessibilityNodeInfo node = queue.poll();
            visited++;
            if (node == null) continue;
            CharSequence cls = node.getClassName();
            boolean isEdit = node.isEditable() || (cls != null && cls.toString().contains("EditText"));
            if (!isEdit) {
                String txt = node.getText() != null ? node.getText().toString().trim().toLowerCase(Locale.ROOT) : "";
                String desc = node.getContentDescription() != null ? node.getContentDescription().toString().trim().toLowerCase(Locale.ROOT) : "";
                String checkStr = !TextUtils.isEmpty(txt) ? txt : desc;
                if (!TextUtils.isEmpty(checkStr) && checkStr.length() >= 2 && checkStr.length() <= 180
                        && !isSkippedTabOrUiLabel(checkStr)) {
                    int score = 0;
                    for (String tok : tokens) {
                        if (checkStr.contains(tok)) score += 2;
                    }
                    if (checkStr.contains(queryOrTitle.toLowerCase(Locale.ROOT))) score += 5;
                    if (score > bestScore) {
                        AccessibilityNodeInfo clickable = climbToClickableParent(node, 5);
                        if (clickable != null) {
                            Rect cb = new Rect();
                            clickable.getBoundsInScreen(cb);
                            if (cb.top > 130 && cb.height() >= 36) {
                                bestScore = score;
                                bestNode = clickable;
                            }
                        }
                    }
                }
            }
            int count = node.getChildCount();
            for (int i = 0; i < count; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) queue.add(child);
            }
        }

        if (bestNode != null && bestScore >= 2) {
            return bestNode.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        }
        return false;
    }

    private boolean clickFirstPlayableResult(AccessibilityNodeInfo root, String queryHint) {
        if (root == null) return false;
        java.util.ArrayDeque<AccessibilityNodeInfo> queue = new java.util.ArrayDeque<>();
        queue.add(root);
        int visited = 0;
        while (!queue.isEmpty() && visited < 400) {
            AccessibilityNodeInfo node = queue.poll();
            visited++;
            if (node == null) continue;
            CharSequence cls = node.getClassName();
            String clsStr = cls != null ? cls.toString() : "";
            if (clsStr.contains("RecyclerView") || clsStr.contains("ListView")) {
                int cCount = node.getChildCount();
                for (int i = 0; i < Math.min(cCount, 6); i++) {
                    AccessibilityNodeInfo item = node.getChild(i);
                    if (item == null || !item.isEnabled()) continue;
                    Rect b = new Rect();
                    item.getBoundsInScreen(b);
                    if (b.height() >= 64 && b.top > 170) {
                        String summary = collectSubtreeText(item).toLowerCase(Locale.ROOT);
                        if (!isSkippedTabOrUiLabel(summary.trim())
                                && !summary.contains("sponsored")
                                && !summary.contains("history")) {
                            if (item.isClickable() && item.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                                return true;
                            }
                            AccessibilityNodeInfo innerClick = findFirstClickableDescendant(item);
                            if (innerClick != null && innerClick.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                                return true;
                            }
                        }
                    }
                }
            }
            int count = node.getChildCount();
            for (int i = 0; i < count; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) queue.add(child);
            }
        }
        return false;
    }

    private AccessibilityNodeInfo findFirstClickableDescendant(AccessibilityNodeInfo parent) {
        if (parent == null) return null;
        if (parent.isClickable() && parent.isEnabled() && !parent.isEditable()) {
            return parent;
        }
        int count = parent.getChildCount();
        for (int i = 0; i < count; i++) {
            AccessibilityNodeInfo found = findFirstClickableDescendant(parent.getChild(i));
            if (found != null) return found;
        }
        return null;
    }

    private boolean tryClickExplicitPlayButton(AccessibilityNodeInfo root) {
        if (root == null) return false;
        String[] playKeywords = new String[] {
                "play all", "shuffle all", "play video", "iv_play", "btn_play", "fab_play", "play_button", "play"
        };
        java.util.ArrayDeque<AccessibilityNodeInfo> queue = new java.util.ArrayDeque<>();
        queue.add(root);
        int visited = 0;
        while (!queue.isEmpty() && visited < 400) {
            AccessibilityNodeInfo node = queue.poll();
            visited++;
            if (node == null) continue;
            CharSequence cls = node.getClassName();
            boolean isEdit = node.isEditable() || (cls != null && cls.toString().contains("EditText"));
            if (!isEdit) {
                String text = node.getText() != null ? node.getText().toString().trim().toLowerCase(Locale.ROOT) : "";
                String desc = node.getContentDescription() != null ? node.getContentDescription().toString().trim().toLowerCase(Locale.ROOT) : "";
                String viewId = node.getViewIdResourceName() != null ? node.getViewIdResourceName().toLowerCase(Locale.ROOT) : "";
                if (text.equals("pause") || desc.equals("pause") || desc.startsWith("pause ")) {
                    // Already playing
                    return true;
                }
                for (String kw : playKeywords) {
                    boolean matched = text.equals(kw) || desc.equals(kw)
                            || (text.length() <= 24 && text.contains(kw) && !text.contains("later") && !text.contains("playlist"))
                            || (desc.length() <= 28 && desc.contains(kw) && !desc.contains("later") && !desc.contains("playlist"))
                            || (!TextUtils.isEmpty(viewId) && viewId.contains(kw) && !viewId.contains("playlist"));
                    if (matched) {
                        AccessibilityNodeInfo clickable = climbToClickableParent(node, 4);
                        if (clickable != null && clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                            return true;
                        }
                    }
                }
            }
            int count = node.getChildCount();
            for (int i = 0; i < count; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) queue.add(child);
            }
        }
        return false;
    }

    private String collectSubtreeText(AccessibilityNodeInfo node) {
        if (node == null) return "";
        StringBuilder sb = new StringBuilder();
        collectSubtreeTextRecursive(node, sb, 0);
        return sb.toString().trim();
    }

    private void collectSubtreeTextRecursive(AccessibilityNodeInfo node, StringBuilder sb, int depth) {
        if (node == null || depth > 4 || sb.length() > 260) return;
        CharSequence t = node.getText();
        CharSequence d = node.getContentDescription();
        if (t != null && !TextUtils.isEmpty(t.toString().trim())) {
            sb.append(t.toString().trim()).append(" ");
        } else if (d != null && !TextUtils.isEmpty(d.toString().trim())) {
            sb.append(d.toString().trim()).append(" ");
        }
        int c = node.getChildCount();
        for (int i = 0; i < c; i++) {
            collectSubtreeTextRecursive(node.getChild(i), sb, depth + 1);
        }
    }

    private boolean isOnEqualizerScreen(AccessibilityNodeInfo root) {
        if (root == null) return false;
        int seekBarCount = 0;
        int freqHints = 0;
        boolean hasBassOrVirt = false;
        boolean hasEqualizerHeader = false;

        java.util.ArrayDeque<AccessibilityNodeInfo> queue = new java.util.ArrayDeque<>();
        queue.add(root);
        int visited = 0;
        while (!queue.isEmpty() && visited < 450) {
            AccessibilityNodeInfo node = queue.poll();
            visited++;
            if (node == null) continue;
            CharSequence cls = node.getClassName();
            String clsStr = cls != null ? cls.toString() : "";
            if (clsStr.contains("SeekBar") || node.getRangeInfo() != null) {
                seekBarCount++;
            }
            String t = node.getText() != null ? node.getText().toString().trim().toLowerCase(Locale.ROOT) : "";
            String d = node.getContentDescription() != null ? node.getContentDescription().toString().trim().toLowerCase(Locale.ROOT) : "";
            String s = !TextUtils.isEmpty(t) ? t : d;
            if (!TextUtils.isEmpty(s)) {
                if (s.contains("60hz") || s.contains("230hz") || s.contains("910hz")
                        || s.contains("3.6khz") || s.contains("14khz") || s.contains("1khz")
                        || s.equals("60") || s.equals("230") || s.equals("910")) {
                    freqHints++;
                }
                if (s.contains("bass boost") || s.contains("virtualizer") || s.contains("reverb")
                        || s.contains("3d effect") || s.contains("surround")) {
                    hasBassOrVirt = true;
                }
                if (s.equals("equalizer") || s.contains("sound effect") || s.contains("preset")) {
                    hasEqualizerHeader = true;
                }
            }
            int c = node.getChildCount();
            for (int i = 0; i < c; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) queue.add(child);
            }
        }
        return seekBarCount >= 2 || freqHints >= 2 || (hasEqualizerHeader && hasBassOrVirt);
    }

    private void handleEqualizerUiAutomation(
            AccessibilityNodeInfo root,
            String pkg,
            org.json.JSONObject task,
            int step,
            long now,
            boolean isLark
    ) {
        try {
            if (!isOnEqualizerScreen(root)) {
                // Step 0..N: Navigate into Equalizer screen inside Lark Player / Audiomack
                String[] directEqKeywords = new String[] {
                        "equalizer", "sound effect", "sound effects", "audio effect",
                        "audio settings", "iv_eq", "btn_eq", "tv_eq"
                };
                if (clickNodeByKeywords(root, directEqKeywords, true)) {
                    lastNavigationAt = now;
                    scheduleActiveWindowPoll(pkg, 700L);
                    return;
                }

                String navStage = task.optString("_eqNavStage", "");
                if (!"opened_player".equals(navStage) && !"opened_menu".equals(navStage)) {
                    // Try mini-player bar or menu/settings
                    if (clickNodeByKeywords(root, new String[] {
                            "mini_player", "play_bar", "player_bar", "bottom_player",
                            "now playing", "iv_cover", "more", "menu", "drawer", "settings", "me"
                    }, true)) {
                        task.put("_eqNavStage", "opened_player");
                        updatePendingEqTask(isLark, task);
                        lastNavigationAt = now;
                        scheduleActiveWindowPoll(pkg, 700L);
                        return;
                    }
                } else if ("opened_player".equals(navStage)) {
                    if (clickNodeByKeywords(root, new String[] {
                            "more", "menu", "options", "overflow", "settings", "sound", "effect", "iv_more", "btn_more"
                    }, true)) {
                        task.put("_eqNavStage", "opened_menu");
                        updatePendingEqTask(isLark, task);
                        lastNavigationAt = now;
                        scheduleActiveWindowPoll(pkg, 700L);
                        return;
                    }
                }

                if (step >= 8) {
                    clearPendingEqTask(isLark);
                } else {
                    scheduleActiveWindowPoll(pkg, 700L);
                }
                return;
            }

            // We ARE on the Equalizer screen!
            boolean eqEnabled = task.optBoolean("eqEnabled", true);
            String eqPreset = task.optString("eqPreset", "").trim();
            boolean hasBassBoost = task.optBoolean("hasBassBoost", false);
            int bassBoost = task.optInt("bassBoost", 0);
            boolean hasVirtualizer = task.optBoolean("hasVirtualizer", false);
            int virtualizer = task.optInt("virtualizer", 0);
            boolean hasLoudness = task.optBoolean("hasLoudness", false);
            int loudness = task.optInt("loudness", 0);
            String reverb = task.optString("reverb", "").trim();
            org.json.JSONArray eqBands = task.optJSONArray("eqBands");
            boolean eqBandsExplicit = task.optBoolean("eqBandsExplicit", false);

            // 1) Master Equalizer Toggle Switch
            if (!task.optBoolean("_eqSwitchDone", false)) {
                AccessibilityNodeInfo eqSwitch = findMasterEqualizerSwitch(root);
                if (eqSwitch != null && eqSwitch.isCheckable()) {
                    boolean currentlyChecked = eqSwitch.isChecked();
                    task.put("_eqSwitchDone", true);
                    updatePendingEqTask(isLark, task);
                    if (currentlyChecked != eqEnabled) {
                        AccessibilityNodeInfo clickTarget = eqSwitch.isClickable() ? eqSwitch : climbToClickableParent(eqSwitch, 3);
                        if (clickTarget != null && clickTarget.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                            lastNavigationAt = now;
                            if (!eqEnabled) {
                                clearPendingEqTask(isLark);
                                return;
                            }
                            scheduleActiveWindowPoll(pkg, 550L);
                            return;
                        }
                    } else if (!eqEnabled) {
                        clearPendingEqTask(isLark);
                        return;
                    }
                } else {
                    task.put("_eqSwitchDone", true);
                    updatePendingEqTask(isLark, task);
                    if (!eqEnabled) {
                        clearPendingEqTask(isLark);
                        return;
                    }
                }
            }

            // 2) Preset Selection (only when eqPreset requested and no explicit custom band override only)
            if (!TextUtils.isEmpty(eqPreset) && !task.optBoolean("_eqPresetDone", false)) {
                boolean dropdownOpened = task.optBoolean("_eqPresetDropdownOpened", false);
                if (clickExactPresetOption(root, eqPreset, dropdownOpened)) {
                    task.put("_eqPresetDone", true);
                    updatePendingEqTask(isLark, task);
                    lastNavigationAt = now;
                    scheduleActiveWindowPoll(pkg, 550L);
                    return;
                }
                if (!dropdownOpened) {
                    if (openPresetSelectorOrScroll(root)) {
                        task.put("_eqPresetDropdownOpened", true);
                        updatePendingEqTask(isLark, task);
                        lastNavigationAt = now;
                        scheduleActiveWindowPoll(pkg, 550L);
                        return;
                    }
                }
                // Preset already active or unavailable cleanly mark done so sliders/effects proceed
                task.put("_eqPresetDone", true);
                updatePendingEqTask(isLark, task);
            }

            // 3) Sliders: 5-Band EQ (if explicit or Custom or no named preset) + Bass Boost + Virtualizer + Loudness
            if (!task.optBoolean("_eqSlidersDone", false)) {
                boolean shouldSetBands = eqBands != null && eqBands.length() > 0
                        && (eqBandsExplicit || TextUtils.isEmpty(eqPreset) || "Custom".equalsIgnoreCase(eqPreset));
                if (shouldSetBands || hasBassBoost || hasVirtualizer || hasLoudness) {
                    applyAllEqualizerSliders(
                            root,
                            shouldSetBands ? eqBands : null,
                            hasBassBoost ? bassBoost : -1,
                            hasVirtualizer ? virtualizer : -1,
                            hasLoudness ? loudness : -1
                    );
                }
                task.put("_eqSlidersDone", true);
                updatePendingEqTask(isLark, task);
                if (!TextUtils.isEmpty(reverb)) {
                    lastNavigationAt = now;
                    scheduleActiveWindowPoll(pkg, 550L);
                    return;
                }
            }

            // 4) Reverb Preset Selection
            if (!TextUtils.isEmpty(reverb) && !task.optBoolean("_eqReverbDone", false)) {
                boolean reverbOpened = task.optBoolean("_eqReverbOpened", false);
                if (clickExactOrContainsText(root, reverb)) {
                    task.put("_eqReverbDone", true);
                    updatePendingEqTask(isLark, task);
                    clearPendingEqTask(isLark);
                    lastNavigationAt = now;
                    return;
                }
                if (!reverbOpened && clickNodeByKeywords(root, new String[] {
                        "reverb", "none", "small room", "medium room", "large room", "medium hall", "large hall", "plate"
                }, true)) {
                    task.put("_eqReverbOpened", true);
                    updatePendingEqTask(isLark, task);
                    lastNavigationAt = now;
                    scheduleActiveWindowPoll(pkg, 550L);
                    return;
                }
            }

            clearPendingEqTask(isLark);
        } catch (Exception ignored) {
            clearPendingEqTask(isLark);
        }
    }

    private void updatePendingEqTask(boolean isLark, org.json.JSONObject task) {
        if (isLark) {
            KevinAgentPrefs.updatePendingLarkActionJson(this, task.toString());
        } else {
            KevinAgentPrefs.updatePendingAudiomackActionJson(this, task.toString());
        }
    }

    private void clearPendingEqTask(boolean isLark) {
        if (isLark) {
            KevinAgentPrefs.clearPendingLarkAction(this);
        } else {
            KevinAgentPrefs.clearPendingAudiomackAction(this);
        }
    }

    private AccessibilityNodeInfo findMasterEqualizerSwitch(AccessibilityNodeInfo root) {
        List<AccessibilityNodeInfo> switches = new ArrayList<>();
        java.util.ArrayDeque<AccessibilityNodeInfo> queue = new java.util.ArrayDeque<>();
        queue.add(root);
        int visited = 0;
        while (!queue.isEmpty() && visited < 400) {
            AccessibilityNodeInfo node = queue.poll();
            visited++;
            if (node == null) continue;
            CharSequence cls = node.getClassName();
            String clsStr = cls != null ? cls.toString() : "";
            if (node.isCheckable() || clsStr.contains("Switch") || clsStr.contains("ToggleButton")) {
                switches.add(node);
            }
            int c = node.getChildCount();
            for (int i = 0; i < c; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) queue.add(child);
            }
        }
        if (switches.isEmpty()) return null;
        AccessibilityNodeInfo topMost = null;
        int minTop = Integer.MAX_VALUE;
        for (AccessibilityNodeInfo sw : switches) {
            AccessibilityNodeInfo parent = sw.getParent();
            String nearText = parent != null ? collectSubtreeText(parent).toLowerCase(Locale.ROOT) : "";
            if (nearText.contains("equalizer") || nearText.contains("eq") || nearText.contains("effect")) {
                return sw;
            }
            Rect b = new Rect();
            sw.getBoundsInScreen(b);
            if (b.top < minTop) {
                minTop = b.top;
                topMost = sw;
            }
        }
        return topMost;
    }

    private boolean clickExactPresetOption(AccessibilityNodeInfo root, String presetName, boolean dropdownOpen) {
        if (root == null || TextUtils.isEmpty(presetName)) return false;
        String target = presetName.trim().toLowerCase(Locale.ROOT);
        java.util.ArrayDeque<AccessibilityNodeInfo> queue = new java.util.ArrayDeque<>();
        queue.add(root);
        int visited = 0;
        while (!queue.isEmpty() && visited < 450) {
            AccessibilityNodeInfo node = queue.poll();
            visited++;
            if (node == null) continue;
            String txt = node.getText() != null ? node.getText().toString().trim().toLowerCase(Locale.ROOT) : "";
            String desc = node.getContentDescription() != null ? node.getContentDescription().toString().trim().toLowerCase(Locale.ROOT) : "";
            if (txt.equals(target) || desc.equals(target)
                    || (txt.length() <= 24 && txt.contains(target) && !txt.contains("preset"))) {
                CharSequence cls = node.getClassName();
                String clsStr = cls != null ? cls.toString() : "";
                // Avoid endlessly clicking a closed Spinner showing the current preset name unless dropdown is open
                if (!dropdownOpen && (clsStr.contains("Spinner") || (node.getParent() != null && node.getParent().getClassName() != null
                        && node.getParent().getClassName().toString().contains("Spinner")))) {
                    return true;
                }
                AccessibilityNodeInfo clickable = climbToClickableParent(node, 4);
                if (clickable != null && clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                    return true;
                }
            }
            int c = node.getChildCount();
            for (int i = 0; i < c; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) queue.add(child);
            }
        }
        return false;
    }

    private boolean openPresetSelectorOrScroll(AccessibilityNodeInfo root) {
        if (clickNodeByKeywords(root, new String[] {
                "preset", "tv_preset", "spinner", "normal", "custom", "flat", "pop", "rock", "jazz", "classical", "dance", "hip hop"
        }, true)) {
            return true;
        }
        java.util.ArrayDeque<AccessibilityNodeInfo> queue = new java.util.ArrayDeque<>();
        queue.add(root);
        int visited = 0;
        while (!queue.isEmpty() && visited < 300) {
            AccessibilityNodeInfo node = queue.poll();
            visited++;
            if (node == null) continue;
            CharSequence cls = node.getClassName();
            String clsStr = cls != null ? cls.toString() : "";
            if (node.isScrollable() && (clsStr.contains("HorizontalScrollView") || clsStr.contains("RecyclerView"))) {
                Rect b = new Rect();
                node.getBoundsInScreen(b);
                if (b.height() < 260) {
                    return node.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD);
                }
            }
            int c = node.getChildCount();
            for (int i = 0; i < c; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) queue.add(child);
            }
        }
        return false;
    }

    private void applyAllEqualizerSliders(
            AccessibilityNodeInfo root,
            org.json.JSONArray eqBands,
            int bassBoostPct,
            int virtualizerPct,
            int loudnessPct
    ) {
        List<AccessibilityNodeInfo> allSeekBars = new ArrayList<>();
        java.util.ArrayDeque<AccessibilityNodeInfo> queue = new java.util.ArrayDeque<>();
        queue.add(root);
        int visited = 0;
        while (!queue.isEmpty() && visited < 500) {
            AccessibilityNodeInfo node = queue.poll();
            visited++;
            if (node == null) continue;
            CharSequence cls = node.getClassName();
            String clsStr = cls != null ? cls.toString() : "";
            String viewId = node.getViewIdResourceName() != null ? node.getViewIdResourceName().toLowerCase(Locale.ROOT) : "";
            if (clsStr.contains("SeekBar") || node.getRangeInfo() != null
                    || viewId.contains("seekbar") || viewId.contains("slider") || viewId.contains("eq_bar")) {
                allSeekBars.add(node);
            }
            int c = node.getChildCount();
            for (int i = 0; i < c; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) queue.add(child);
            }
        }
        if (allSeekBars.isEmpty()) return;

        List<AccessibilityNodeInfo> verticalBars = new ArrayList<>();
        List<AccessibilityNodeInfo> horizontalBars = new ArrayList<>();
        java.util.Set<AccessibilityNodeInfo> alreadySet = new java.util.HashSet<>();

        for (AccessibilityNodeInfo sb : allSeekBars) {
            String vid = sb.getViewIdResourceName() != null ? sb.getViewIdResourceName().toLowerCase(Locale.ROOT) : "";
            AccessibilityNodeInfo parent = sb.getParent();
            String contextTxt = ((parent != null ? collectSubtreeText(parent) : "") + " " + vid).toLowerCase(Locale.ROOT);

            if (bassBoostPct >= 0 && contextTxt.contains("bass")) {
                setSeekBarProgressOrSwipe(sb, bassBoostPct);
                alreadySet.add(sb);
                continue;
            }
            if (virtualizerPct >= 0 && (contextTxt.contains("virtual") || contextTxt.contains("3d") || contextTxt.contains("surround"))) {
                setSeekBarProgressOrSwipe(sb, virtualizerPct);
                alreadySet.add(sb);
                continue;
            }
            if (loudnessPct >= 0 && (contextTxt.contains("loud") || contextTxt.contains("preamp") || contextTxt.contains("gain"))) {
                setSeekBarProgressOrSwipe(sb, loudnessPct);
                alreadySet.add(sb);
                continue;
            }
            if (eqBands != null && eqBands.length() >= 5) {
                int bandIdx = -1;
                if (contextTxt.contains("60")) bandIdx = 0;
                else if (contextTxt.contains("230") || contextTxt.contains("250")) bandIdx = 1;
                else if (contextTxt.contains("910") || contextTxt.contains("1k")) bandIdx = 2;
                else if (contextTxt.contains("3.6") || contextTxt.contains("3600") || contextTxt.contains("4k")) bandIdx = 3;
                else if (contextTxt.contains("14k") || contextTxt.contains("16k")) bandIdx = 4;
                if (bandIdx >= 0) {
                    setSeekBarProgressOrSwipe(sb, eqBands.optInt(bandIdx, 50));
                    alreadySet.add(sb);
                    continue;
                }
            }

            Rect r = new Rect();
            sb.getBoundsInScreen(r);
            if (r.height() > r.width() * 1.15f) {
                verticalBars.add(sb);
            } else {
                horizontalBars.add(sb);
            }
        }

        if (eqBands != null && eqBands.length() > 0 && !verticalBars.isEmpty()) {
            verticalBars.sort((a, b) -> {
                Rect ra = new Rect();
                Rect rb = new Rect();
                a.getBoundsInScreen(ra);
                b.getBoundsInScreen(rb);
                return Integer.compare(ra.left, rb.left);
            });
            for (int i = 0; i < verticalBars.size() && i < eqBands.length(); i++) {
                AccessibilityNodeInfo bar = verticalBars.get(i);
                if (!alreadySet.contains(bar)) {
                    setSeekBarProgressOrSwipe(bar, eqBands.optInt(i, 50));
                    alreadySet.add(bar);
                }
            }
        }

        horizontalBars.sort((a, b) -> {
            Rect ra = new Rect();
            Rect rb = new Rect();
            a.getBoundsInScreen(ra);
            b.getBoundsInScreen(rb);
            int cmpTop = Integer.compare(ra.top, rb.top);
            return cmpTop != 0 ? cmpTop : Integer.compare(ra.left, rb.left);
        });
        int hIdx = 0;
        if (bassBoostPct >= 0 && hIdx < horizontalBars.size()) {
            boolean alreadyAppliedBass = false;
            for (AccessibilityNodeInfo setNode : alreadySet) {
                String v = setNode.getViewIdResourceName() != null ? setNode.getViewIdResourceName().toLowerCase(Locale.ROOT) : "";
                if (v.contains("bass")) {
                    alreadyAppliedBass = true;
                    break;
                }
            }
            if (!alreadyAppliedBass) {
                setSeekBarProgressOrSwipe(horizontalBars.get(hIdx++), bassBoostPct);
            }
        }
        if (virtualizerPct >= 0 && hIdx < horizontalBars.size()) {
            boolean alreadyAppliedVirt = false;
            for (AccessibilityNodeInfo setNode : alreadySet) {
                String v = setNode.getViewIdResourceName() != null ? setNode.getViewIdResourceName().toLowerCase(Locale.ROOT) : "";
                if (v.contains("virt") || v.contains("3d")) {
                    alreadyAppliedVirt = true;
                    break;
                }
            }
            if (!alreadyAppliedVirt) {
                setSeekBarProgressOrSwipe(horizontalBars.get(hIdx++), virtualizerPct);
            }
        }
        if (loudnessPct >= 0 && hIdx < horizontalBars.size()) {
            setSeekBarProgressOrSwipe(horizontalBars.get(hIdx), loudnessPct);
        }
    }

    private void setSeekBarProgressOrSwipe(AccessibilityNodeInfo seekBar, int percent) {
        if (seekBar == null) return;
        int clampedPct = Math.max(0, Math.min(100, percent));
        boolean progressSet = false;
        AccessibilityNodeInfo.RangeInfo range = seekBar.getRangeInfo();
        if (range != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            float min = range.getMin();
            float max = range.getMax();
            if (max > min) {
                float targetVal = min + (clampedPct / 100.0f) * (max - min);
                Bundle args = new Bundle();
                args.putFloat("android.view.accessibility.action.ARGUMENT_PROGRESS_VALUE", targetVal);
                progressSet = seekBar.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SET_PROGRESS.getId(), args);
            }
        }

        if (!progressSet && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            Rect bounds = new Rect();
            seekBar.getBoundsInScreen(bounds);
            if (bounds.width() > 10 && bounds.height() > 10) {
                Path path = new Path();
                float ratio = clampedPct / 100.0f;
                if (bounds.height() > bounds.width() * 1.15f) {
                    int padY = Math.min(16, bounds.height() / 10);
                    float usableH = Math.max(10, bounds.height() - 2 * padY);
                    float startY = bounds.centerY();
                    float targetY = (bounds.bottom - padY) - ratio * usableH;
                    if (Math.abs(targetY - startY) < 4f) {
                        startY = Math.min(bounds.bottom - padY, targetY + 8f);
                    }
                    float cx = bounds.centerX();
                    path.moveTo(cx, startY);
                    path.lineTo(cx, targetY);
                } else {
                    int padX = Math.min(16, bounds.width() / 10);
                    float usableW = Math.max(10, bounds.width() - 2 * padX);
                    float startX = bounds.centerX();
                    float targetX = (bounds.left + padX) + ratio * usableW;
                    if (Math.abs(targetX - startX) < 4f) {
                        startX = Math.max(bounds.left + padX, targetX - 8f);
                    }
                    float cy = bounds.centerY();
                    path.moveTo(startX, cy);
                    path.lineTo(targetX, cy);
                }
                GestureDescription.Builder builder = new GestureDescription.Builder();
                builder.addStroke(new GestureDescription.StrokeDescription(path, 0L, 160L));
                dispatchGesture(builder.build(), null, null);
            }
        }
    }

    private boolean clickNodeByKeywords(AccessibilityNodeInfo root, String[] keywords, boolean checkViewId) {
        if (root == null || keywords == null || keywords.length == 0) return false;
        java.util.ArrayDeque<AccessibilityNodeInfo> queue = new java.util.ArrayDeque<>();
        queue.add(root);
        int visited = 0;
        while (!queue.isEmpty() && visited < 400) {
            AccessibilityNodeInfo node = queue.poll();
            visited++;
            if (node == null) continue;
            CharSequence cls = node.getClassName();
            boolean isEdit = node.isEditable() || (cls != null && cls.toString().contains("EditText"));
            if (!isEdit) {
                String text = node.getText() != null ? node.getText().toString().trim().toLowerCase(Locale.ROOT) : "";
                String desc = node.getContentDescription() != null ? node.getContentDescription().toString().trim().toLowerCase(Locale.ROOT) : "";
                String viewId = checkViewId && node.getViewIdResourceName() != null
                        ? node.getViewIdResourceName().toLowerCase(Locale.ROOT)
                        : "";
                for (String kw : keywords) {
                    if (TextUtils.isEmpty(kw)) continue;
                    boolean matched = text.equals(kw)
                            || desc.equals(kw)
                            || (text.length() <= 40 && text.contains(kw))
                            || (desc.length() <= 40 && desc.contains(kw))
                            || (!TextUtils.isEmpty(viewId) && viewId.contains(kw));
                    if (matched) {
                        AccessibilityNodeInfo clickable = climbToClickableParent(node, 4);
                        if (clickable != null && clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                            return true;
                        }
                    }
                }
            }
            int count = node.getChildCount();
            for (int i = 0; i < count; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) queue.add(child);
            }
        }
        return false;
    }

    @Override
    public void onDestroy() {
        if (pendingWindowPollRunnable != null) {
            mainHandler.removeCallbacks(pendingWindowPollRunnable);
            pendingWindowPollRunnable = null;
        }
        scanExecutor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public void onInterrupt() {
        scanStepBusy = false;
    }
}
