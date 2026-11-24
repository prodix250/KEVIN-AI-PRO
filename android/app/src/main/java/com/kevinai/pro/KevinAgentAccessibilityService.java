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

    private boolean isLarkPlayerPackage(String pkg) {
        if (TextUtils.isEmpty(pkg)) return false;
        String lower = pkg.toLowerCase(Locale.ROOT);
        return lower.contains("larkplayer") || lower.equals("com.lark.player");
    }

    private void handleLarkPlayerAction(AccessibilityNodeInfo root, String pkg) {
        long now = System.currentTimeMillis();
        if (now - lastNavigationAt < 650L) {
            return;
        }
        String actionJson = KevinAgentPrefs.getPendingLarkActionJson(this);
        if (TextUtils.isEmpty(actionJson)) {
            KevinAgentPrefs.clearPendingLarkAction(this);
            return;
        }

        int step = KevinAgentPrefs.incrementPendingLarkStep(this);
        if (step > 20) {
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

            // Dismiss any non-blocking promo/skip/permission popups if present
            if (clickNodeByKeywords(root, new String[] { "skip", "not now", "later", "no thanks", "dismiss" }, false)) {
                lastNavigationAt = now;
                return;
            }

            if ("open".equals(action) || "open_app".equals(action)) {
                KevinAgentPrefs.clearPendingLarkAction(this);
                return;
            }

            if ("play".equals(action) || "play_song".equals(action) || "search".equals(action)) {
                String targetText = !TextUtils.isEmpty(songTitle) ? songTitle : query;
                if (TextUtils.isEmpty(targetText)) {
                    // Play all / first song
                    if (clickNodeByKeywords(root, new String[] { "shuffle all", "play all", "play" }, false)) {
                        KevinAgentPrefs.clearPendingLarkAction(this);
                        lastNavigationAt = now;
                    }
                    return;
                }

                // 1) If already searched, try clicking matching song result
                if (alreadySearched) {
                    if (clickBestMatchingSongNode(root, targetText, artist)) {
                        lastNavigationAt = now;
                        if ("search".equals(action)) {
                            KevinAgentPrefs.clearPendingLarkAction(this);
                        } else {
                            task.put("_clickedResult", true);
                            KevinAgentPrefs.updatePendingLarkActionJson(this, task.toString());
                        }
                        return;
                    }
                }

                // 2) If an EditText search box is visible and we haven't typed yet, type query
                AccessibilityNodeInfo searchBox = findEditableNode(root);
                if (searchBox != null && !alreadySearched) {
                    Bundle args = new Bundle();
                    args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, targetText);
                    searchBox.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
                    if (searchBox.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
                        task.put("_searched", true);
                        KevinAgentPrefs.updatePendingLarkActionJson(this, task.toString());
                        lastNavigationAt = now;
                        // Also try clicking IME/search confirm button if present
                        clickNodeByKeywords(root, new String[] { "search", "done", "go" }, true);
                        return;
                    }
                }

                // 3) If song is already visible right on the current list, click it directly!
                if (!task.optBoolean("_clickedResult", false) && clickBestMatchingSongNode(root, targetText, artist)) {
                    lastNavigationAt = now;
                    KevinAgentPrefs.clearPendingLarkAction(this);
                    return;
                }

                // 4) Otherwise tap the Search icon/bar in Lark Player to open search
                if (!alreadySearched && clickSearchTrigger(root, pkg)) {
                    lastNavigationAt = now;
                    return;
                }

                // 5) If we already clicked a result and a Play button is shown, click Play
                if (task.optBoolean("_clickedResult", false)) {
                    if (clickNodeByKeywords(root, new String[] { "play", "curanga", "pause" }, true)) {
                        KevinAgentPrefs.clearPendingLarkAction(this);
                        lastNavigationAt = now;
                    } else if (step >= 6) {
                        KevinAgentPrefs.clearPendingLarkAction(this);
                    }
                }
                return;
            }

            if ("play_all".equals(action) || "shuffle_all".equals(action) || "shuffle".equals(action)) {
                if (clickNodeByKeywords(root, new String[] { "shuffle all", "shuffle", "play all", "play" }, true)) {
                    KevinAgentPrefs.clearPendingLarkAction(this);
                    lastNavigationAt = now;
                    return;
                }
                clickNodeByKeywords(root, new String[] { "songs", "music", "tracks", "local" }, false);
                lastNavigationAt = now;
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

                // Step B: If playlist was named and song selection screen is open, pick matching songs & confirm
                if (playlistNamed && !playlistCreated) {
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
                    if (clicked > 0 || clickNodeByKeywords(root, new String[] { "add", "done", "save", "ok", "confirm" }, false)) {
                        task.put("_playlistCreated", true);
                        KevinAgentPrefs.updatePendingLarkActionJson(this, task.toString());
                        lastNavigationAt = now;
                        if (clicked == 0) {
                            KevinAgentPrefs.clearPendingLarkAction(this);
                        }
                        return;
                    }
                }

                if (playlistCreated) {
                    clickNodeByKeywords(root, new String[] { "add", "done", "save", "ok", "confirm" }, false);
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
                if (clickNodeByKeywords(root, new String[] { "new playlist", "create playlist", "create new", "new", "add playlist" }, true)) {
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
        if (now - lastNavigationAt < 650L) {
            return;
        }
        String actionJson = KevinAgentPrefs.getPendingAudiomackActionJson(this);
        if (TextUtils.isEmpty(actionJson)) {
            KevinAgentPrefs.clearPendingAudiomackAction(this);
            return;
        }

        int step = KevinAgentPrefs.incrementPendingAudiomackStep(this);
        if (step > 24) {
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

            // Dismiss Audiomack onboarding/upgrade/promo dialogs if present
            if (clickNodeByKeywords(root, new String[] { "skip", "not now", "maybe later", "no thanks", "dismiss", "close ad" }, false)) {
                lastNavigationAt = now;
                return;
            }

            if ("open".equals(action) || "open_app".equals(action)) {
                KevinAgentPrefs.clearPendingAudiomackAction(this);
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
                if (alreadySearched && clickBestMatchingSongNode(root, targetText, artist)) {
                    task.put("_clickedResult", true);
                    KevinAgentPrefs.updatePendingAudiomackActionJson(this, task.toString());
                    lastNavigationAt = now;
                    if ("search".equals(action)) {
                        KevinAgentPrefs.clearPendingAudiomackAction(this);
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
                        clickNodeByKeywords(root, new String[] { "search", "done", "go" }, true);
                        return;
                    }
                }

                if (clickBestMatchingSongNode(root, targetText, artist)) {
                    task.put("_clickedResult", true);
                    KevinAgentPrefs.updatePendingAudiomackActionJson(this, task.toString());
                    lastNavigationAt = now;
                    if ("search".equals(action) || "play".equals(action) || "play_song".equals(action)) {
                        // Allow one more pass if a Play button shows up on track page
                        return;
                    }
                    return;
                }

                if (!alreadySearched && clickSearchTrigger(root, pkg)) {
                    lastNavigationAt = now;
                    return;
                }
            }

            // If we clicked a track/result for playback
            if ("play".equals(action) || "play_song".equals(action)) {
                if (clickedResult) {
                    if (clickNodeByKeywords(root, new String[] { "play", "play all", "shuffle", "curanga" }, true)) {
                        KevinAgentPrefs.clearPendingAudiomackAction(this);
                        lastNavigationAt = now;
                        return;
                    }
                    if (step >= 7) {
                        KevinAgentPrefs.clearPendingAudiomackAction(this);
                    }
                    return;
                }
                if (TextUtils.isEmpty(targetText)) {
                    if (clickNodeByKeywords(root, new String[] { "play", "play all", "shuffle", "trending" }, true)) {
                        KevinAgentPrefs.clearPendingAudiomackAction(this);
                        lastNavigationAt = now;
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
                if (clickNodeByKeywords(root, new String[] { "add to playlist", "new playlist", "create playlist", "create new" }, true)) {
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

    private AccessibilityNodeInfo findEditableNode(AccessibilityNodeInfo root) {
        if (root == null) return null;
        CharSequence cls = root.getClassName();
        if (cls != null && cls.toString().contains("EditText") && root.isEnabled()) {
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
                pkg + ":id/action_search"
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
                    && !clean.equals("lark")) {
                tokens.add(clean);
            }
        }
        if (tokens.isEmpty()) return false;

        AccessibilityNodeInfo bestNode = null;
        int bestScore = 0;
        java.util.ArrayDeque<AccessibilityNodeInfo> queue = new java.util.ArrayDeque<>();
        queue.add(root);
        int visited = 0;
        while (!queue.isEmpty() && visited < 400) {
            AccessibilityNodeInfo node = queue.poll();
            visited++;
            if (node == null) continue;
            CharSequence cls = node.getClassName();
            boolean isEdit = cls != null && cls.toString().contains("EditText");
            if (!isEdit) {
                String txt = node.getText() != null ? node.getText().toString().trim().toLowerCase(Locale.ROOT) : "";
                if (!TextUtils.isEmpty(txt) && txt.length() >= 2 && txt.length() <= 160) {
                    int score = 0;
                    for (String tok : tokens) {
                        if (txt.contains(tok)) score += 2;
                    }
                    if (txt.contains(queryOrTitle.toLowerCase(Locale.ROOT))) score += 5;
                    if (score > bestScore) {
                        AccessibilityNodeInfo clickable = climbToClickableParent(node, 5);
                        if (clickable != null) {
                            bestScore = score;
                            bestNode = clickable;
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
            boolean isEdit = cls != null && cls.toString().contains("EditText");
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
        scanExecutor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public void onInterrupt() {
        scanStepBusy = false;
    }
}
