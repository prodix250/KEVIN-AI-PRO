package com.kevinai.pro;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.WebViewListener;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    private static final int AUDIO_PERMISSION_REQUEST_CODE = 1001;
    private static final int SCREEN_CAPTURE_REQUEST_CODE = 1002;
    private static final int NOTIFICATION_PERMISSION_REQUEST_CODE = 1003;
    private boolean waitingForNotificationPermission;
    private KevinAgentBridge agentBridge;

    private final android.content.BroadcastReceiver screenCaptureReceiver =
            new android.content.BroadcastReceiver() {
                @Override
                public void onReceive(android.content.Context context, Intent intent) {
                    String action = intent != null ? intent.getAction() : null;
                    if (action == null) return;
                    if (ScreenCaptureService.ACTION_SCREEN_FRAME.equals(action)) {
                        String frame = intent.getStringExtra(ScreenCaptureService.EXTRA_FRAME);
                        if (frame != null) {
                            dispatchScreenFrame(frame);
                        }
                    } else if (ScreenCaptureService.ACTION_STOP.equals(action)) {
                        dispatchScreenSharingState(false);
                    } else if (KevinNotificationListenerService.ACTION_WHATSAPP_REPLIED.equals(action)) {
                        dispatchWhatsAppAutoReply(
                                intent.getStringExtra(KevinNotificationListenerService.EXTRA_SENDER),
                                intent.getStringExtra(KevinNotificationListenerService.EXTRA_INCOMING),
                                intent.getStringExtra(KevinNotificationListenerService.EXTRA_REPLY)
                        );
                    } else if (KevinWakeWordService.ACTION_WAKE_WORD_IN_APP.equals(action)) {
                        dispatchInAppWakeWord(intent.getStringExtra(KevinWakeWordService.EXTRA_WAKE_COMMAND));
                    } else if (DailyNewsManager.ACTION_NEWS_BRIEFING_DELIVERED.equals(action)) {
                        dispatchNewsBriefingDelivered(intent.getStringExtra(DailyNewsManager.EXTRA_BRIEFING_JSON));
                    }
                }
            };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                    this,
                    new String[] {
                        Manifest.permission.RECORD_AUDIO,
                        Manifest.permission.MODIFY_AUDIO_SETTINGS,
                        Manifest.permission.CAMERA
                    },
                    AUDIO_PERMISSION_REQUEST_CODE
            );
        }

        getBridge().getWebView().setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }
        });
        getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);

        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                runOnUiThread(() -> {
                    if (!isFinishing() && !isDestroyed()) {
                        recreate();
                    }
                });
                return true;
            }
        });

        agentBridge = new KevinAgentBridge(this, getBridge().getWebView());
        getBridge().getWebView().addJavascriptInterface(new ScreenCaptureBridge(), "KevinScreenCapture");
        getBridge().getWebView().addJavascriptInterface(agentBridge, "KevinAgentBridge");

        IntentFilter filter = new IntentFilter();
        filter.addAction(ScreenCaptureService.ACTION_SCREEN_FRAME);
        filter.addAction(ScreenCaptureService.ACTION_STOP);
        filter.addAction(KevinNotificationListenerService.ACTION_WHATSAPP_REPLIED);
        filter.addAction(KevinWakeWordService.ACTION_WAKE_WORD_IN_APP);
        filter.addAction(DailyNewsManager.ACTION_NEWS_BRIEFING_DELIVERED);
        ContextCompat.registerReceiver(
                this,
                screenCaptureReceiver,
                filter,
                4
        );

        KevinWakeWordService.syncWithPreferences(this);
        DailyNewsManager.init(this);
        handleNewsIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleNewsIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        KevinWakeWordService.setMainVisible(true);
        KevinWakeWordService.syncWithPreferences(this);
        DailyNewsManager.checkAndDeliverNewsAsync(this);
        dispatchPendingNativeBriefings();
    }

    @Override
    public void onPause() {
        KevinWakeWordService.setMainVisible(false);
        super.onPause();
    }

    @Override
    public void onDestroy() {
        try {
            unregisterReceiver(screenCaptureReceiver);
        } catch (IllegalArgumentException ignored) {
            // Receiver may already be unregistered during activity recreation.
        }
        super.onDestroy();
    }

    private void requestScreenCapture() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(
                        this,
                        Manifest.permission.POST_NOTIFICATIONS
                ) != PackageManager.PERMISSION_GRANTED) {
            waitingForNotificationPermission = true;
            ActivityCompat.requestPermissions(
                    this,
                    new String[] { Manifest.permission.POST_NOTIFICATIONS },
                    NOTIFICATION_PERMISSION_REQUEST_CODE
            );
            return;
        }
        launchScreenCapturePermission();
    }

    private void launchScreenCapturePermission() {
        android.media.projection.MediaProjectionManager manager =
                (android.media.projection.MediaProjectionManager) getSystemService(
                        MEDIA_PROJECTION_SERVICE
                );
        startActivityForResult(manager.createScreenCaptureIntent(), SCREEN_CAPTURE_REQUEST_CODE);
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode,
            String[] permissions,
            int[] grantResults
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == AUDIO_PERMISSION_REQUEST_CODE) {
            KevinWakeWordService.syncWithPreferences(this);
        }
        if (requestCode == KevinAgentBridge.AGENT_PERMISSIONS_REQUEST_CODE && agentBridge != null) {
            KevinWakeWordService.syncWithPreferences(this);
            agentBridge.dispatchAgentStatus();
            return;
        }
        if (requestCode != NOTIFICATION_PERMISSION_REQUEST_CODE) {
            return;
        }
        boolean shouldContinue = waitingForNotificationPermission;
        waitingForNotificationPermission = false;
        if (shouldContinue
                && grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            launchScreenCapturePermission();
        } else if (shouldContinue) {
            dispatchScreenSharingState(false);
        }
    }

    private void stopScreenCapture() {
        Intent intent = new Intent(this, ScreenCaptureService.class)
                .setAction(ScreenCaptureService.ACTION_STOP);
        startService(intent);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != SCREEN_CAPTURE_REQUEST_CODE) {
            return;
        }
        if (resultCode != Activity.RESULT_OK || data == null) {
            dispatchScreenSharingState(false);
            return;
        }
        Intent serviceIntent = new Intent(this, ScreenCaptureService.class)
                .setAction(ScreenCaptureService.ACTION_START)
                .putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, resultCode)
                .putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, data);
        ContextCompat.startForegroundService(this, serviceIntent);
        dispatchScreenSharingState(true);
    }

    private void dispatchInAppWakeWord(String trailingCommand) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        KevinWakeWordService.setOverlayVisible(true);
        KevinWakeWordService.pauseListening(this);
        long wakeId = System.currentTimeMillis();
        String quotedCmd = JSONObject.quote(trailingCommand != null ? trailingCommand : "");
        String js = "try{window.__kevinPendingWakeWord={id:" + wakeId + ",command:" + quotedCmd
                + "};window.dispatchEvent(new CustomEvent('kevinWakeWordTriggered',{detail:{id:"
                + wakeId + ",command:" + quotedCmd + "}}));}catch(e){}";
        getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(js, null));
    }

    private void dispatchWhatsAppAutoReply(String sender, String incoming, String reply) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        try {
            JSONObject payload = new JSONObject();
            payload.put("sender", sender != null ? sender : "");
            payload.put("incoming", incoming != null ? incoming : "");
            payload.put("reply", reply != null ? reply : "");
            String quoted = JSONObject.quote(payload.toString());
            getBridge().getWebView().post(() ->
                    getBridge().getWebView().evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('kevinWhatsAppAutoReplied', { detail: JSON.parse(" + quoted + ") }))",
                            null
                    )
            );
        } catch (Exception ignored) {}
    }

    private void dispatchScreenFrame(String frame) {
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }
        String safeFrame = JSONObject.quote(frame);
        getBridge().getWebView().post(() ->
                getBridge().getWebView().evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('screenCaptured', { detail: { base64Image: '"
                                + safeFrame.substring(1, safeFrame.length() - 1)
                                + "' } }))",
                        null
                )
        );
    }

    private void dispatchScreenSharingState(boolean active) {
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }
        getBridge().getWebView().post(() ->
                getBridge().getWebView().evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('screenSharingState', { detail: { active: "
                                + active + " } }))",
                        null
                )
        );
    }

    private void handleNewsIntent(Intent intent) {
        if (intent == null) return;
        String briefingJson = intent.getStringExtra("from_news_briefing_json");
        if (briefingJson != null && !briefingJson.isEmpty()) {
            dispatchNewsBriefingDelivered(briefingJson);
        } else {
            String slotId = intent.getStringExtra("from_news_slot");
            if (slotId != null && !slotId.isEmpty()) {
                dispatchPendingNativeBriefings();
            }
        }
    }

    private void dispatchNewsBriefingDelivered(String briefingJson) {
        if (getBridge() == null || getBridge().getWebView() == null || briefingJson == null || briefingJson.isEmpty()) return;
        try {
            String quoted = JSONObject.quote(briefingJson);
            getBridge().getWebView().post(() ->
                    getBridge().getWebView().evaluateJavascript(
                            "try{var _b=JSON.parse(" + quoted + ");if(!Array.isArray(window.__kevinPendingNativeBriefings)){window.__kevinPendingNativeBriefings=[];}window.__kevinPendingNativeBriefings.push(_b);window.dispatchEvent(new CustomEvent('kevinNewsBriefingNativeReceived',{detail:_b}));}catch(e){}",
                            null
                    )
            );
        } catch (Exception ignored) {}
    }

    private void dispatchPendingNativeBriefings() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        try {
            String pending = KevinAgentPrefs.peekPendingNewsBriefingsJson(this);
            if (pending != null && !pending.isEmpty() && !pending.equals("[]")) {
                String quoted = JSONObject.quote(pending);
                getBridge().getWebView().post(() ->
                        getBridge().getWebView().evaluateJavascript(
                                "try{var _arr=JSON.parse(" + quoted + ");window.__kevinPendingNativeBriefings=Array.isArray(_arr)?_arr:[_arr];window.dispatchEvent(new CustomEvent('kevinNewsBriefingNativeReceived',{detail:_arr}));}catch(e){}",
                                null
                        )
                );
            }
        } catch (Exception ignored) {}
    }

    private final class ScreenCaptureBridge {
        @JavascriptInterface
        public void start() {
            runOnUiThread(MainActivity.this::requestScreenCapture);
        }

        @JavascriptInterface
        public void stop() {
            runOnUiThread(MainActivity.this::stopScreenCapture);
        }
    }
}
