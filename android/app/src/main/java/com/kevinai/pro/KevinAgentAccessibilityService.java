package com.kevinai.pro;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.graphics.Rect;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
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
                if (tryClickFirstYouTubeResult(root)) {
                    KevinAgentPrefs.clearPendingYouTubePlay(this);
                }
            }
        } finally {
            root.recycle();
        }
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

    private boolean tryClickFirstYouTubeResult(AccessibilityNodeInfo root) {
        List<AccessibilityNodeInfo> watchPlayer = root.findAccessibilityNodeInfosByViewId(
                "com.google.android.youtube:id/player_view");
        if (watchPlayer != null && !watchPlayer.isEmpty()) {
            return true;
        }
        List<AccessibilityNodeInfo> videoTitles = root.findAccessibilityNodeInfosByViewId(
                "com.google.android.youtube:id/title");
        return clickFirstClickable(videoTitles);
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

    @Override
    public void onDestroy() {
        scanExecutor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public void onInterrupt() {
        scanStepBusy = false;
    }
}
