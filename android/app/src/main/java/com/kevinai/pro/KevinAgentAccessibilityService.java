package com.kevinai.pro;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
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
                if (KevinAgentPrefs.isWhatsAppScanActive(this)) {
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
        if (now - lastNavigationAt < 850L) {
            return;
        }
        if (KevinAgentPrefs.getWhatsAppScanCount(this) >= 5) {
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
                String key = !TextUtils.isEmpty(contactName)
                        ? contactName.toLowerCase(Locale.ROOT)
                        : ("row_" + badge.hashCode());
                Long prev = scannedChatsCooldown.get(key);
                if (prev != null && (now - prev) < 120_000L) {
                    continue;
                }
                return row;
            }
        }

        // Fallback: search rows whose accessibility contentDescription contains "unread"
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
                if (TextUtils.isEmpty(contactName)) continue;
                String key = contactName.toLowerCase(Locale.ROOT);
                Long prev = scannedChatsCooldown.get(key);
                if (prev != null && (now - prev) < 120_000L) {
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
        String senderKey = senderName.toLowerCase(Locale.ROOT);
        long now = System.currentTimeMillis();
        Long prev = scannedChatsCooldown.get(senderKey);
        if (prev != null && (now - prev) < 120_000L) {
            lastNavigationAt = now;
            performGlobalAction(GLOBAL_ACTION_BACK);
            return;
        }

        // Collect all visible message text nodes and verify whether the last message bubble is incoming or outgoing
        List<AccessibilityNodeInfo> msgTextNodes = root.findAccessibilityNodeInfosByViewId(pkg + ":id/message_text");
        if (msgTextNodes == null || msgTextNodes.isEmpty()) {
            scannedChatsCooldown.put(senderKey, now);
            lastNavigationAt = now;
            performGlobalAction(GLOBAL_ACTION_BACK);
            return;
        }

        AccessibilityNodeInfo lastMsgNode = msgTextNodes.get(msgTextNodes.size() - 1);
        if (isOutgoingMessageBubble(lastMsgNode, pkg)) {
            // Already replied by user/agent
            scannedChatsCooldown.put(senderKey, now);
            lastNavigationAt = now;
            performGlobalAction(GLOBAL_ACTION_BACK);
            return;
        }

        // Gather up to last 3 consecutive incoming messages
        List<String> incomingParts = new ArrayList<>();
        int start = Math.max(0, msgTextNodes.size() - 3);
        for (int i = start; i < msgTextNodes.size(); i++) {
            AccessibilityNodeInfo node = msgTextNodes.get(i);
            if (isOutgoingMessageBubble(node, pkg)) {
                incomingParts.clear();
                continue;
            }
            CharSequence txt = node.getText();
            if (txt != null && !TextUtils.isEmpty(txt.toString().trim())) {
                incomingParts.add(txt.toString().trim());
            }
        }

        String incomingText = TextUtils.join("\n", incomingParts).trim();
        if (TextUtils.isEmpty(incomingText)) {
            scannedChatsCooldown.put(senderKey, now);
            lastNavigationAt = now;
            performGlobalAction(GLOBAL_ACTION_BACK);
            return;
        }

        scanStepBusy = true;
        scannedChatsCooldown.put(senderKey, now);
        final String finalSender = senderName;

        scanExecutor.execute(() -> {
            String replyText = KevinNotificationListenerService.generateReplyStatic(
                    KevinAgentAccessibilityService.this,
                    finalSender,
                    incomingText
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
                    }, 550L);
                }, 300L);
            });
        });
    }

    private boolean isOutgoingMessageBubble(AccessibilityNodeInfo msgTextNode, String pkg) {
        AccessibilityNodeInfo parent = msgTextNode;
        for (int depth = 0; depth < 5 && parent != null; depth++) {
            List<AccessibilityNodeInfo> statusNodes = parent.findAccessibilityNodeInfosByViewId(pkg + ":id/status");
            if (statusNodes != null && !statusNodes.isEmpty()) {
                return true;
            }
            parent = parent.getParent();
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
