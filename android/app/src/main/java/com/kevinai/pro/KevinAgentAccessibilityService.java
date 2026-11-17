package com.kevinai.pro;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.List;

public class KevinAgentAccessibilityService extends AccessibilityService {

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
            if (("com.whatsapp".equals(pkg) || "com.whatsapp.w4b".equals(pkg))
                    && KevinAgentPrefs.isPendingWhatsAppSend(this)
                    && KevinAgentPrefs.isAutoSendEnabled(this)) {
                if (tryClickWhatsAppSend(root, pkg)) {
                    KevinAgentPrefs.clearPendingWhatsAppSend(this);
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

    private boolean tryClickWhatsAppSend(AccessibilityNodeInfo root, String pkg) {
        List<AccessibilityNodeInfo> byId = root.findAccessibilityNodeInfosByViewId(pkg + ":id/send");
        if (clickFirstClickable(byId)) {
            return true;
        }
        List<AccessibilityNodeInfo> byDesc = root.findAccessibilityNodeInfosByText("Send");
        return clickFirstClickable(byDesc);
    }

    private boolean tryClickFirstYouTubeResult(AccessibilityNodeInfo root) {
        List<AccessibilityNodeInfo> watchPlayer = root.findAccessibilityNodeInfosByViewId(
                "com.google.android.youtube:id/player_view");
        if (watchPlayer != null && !watchPlayer.isEmpty()) {
            // Already inside a video player view
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
    public void onInterrupt() {
        // No-op
    }
}
