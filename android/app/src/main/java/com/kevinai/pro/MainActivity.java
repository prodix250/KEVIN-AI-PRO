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
                    if (ScreenCaptureService.ACTION_SCREEN_FRAME.equals(intent.getAction())) {
                        String frame = intent.getStringExtra(ScreenCaptureService.EXTRA_FRAME);
                        if (frame != null) {
                            dispatchScreenFrame(frame);
                        }
                    } else if (ScreenCaptureService.ACTION_STOP.equals(intent.getAction())) {
                        dispatchScreenSharingState(false);
                    } else if (KevinNotificationListenerService.ACTION_WHATSAPP_REPLIED.equals(intent.getAction())) {
                        dispatchWhatsAppAutoReply(
                                intent.getStringExtra(KevinNotificationListenerService.EXTRA_SENDER),
                                intent.getStringExtra(KevinNotificationListenerService.EXTRA_INCOMING),
                                intent.getStringExtra(KevinNotificationListenerService.EXTRA_REPLY)
                        );
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
        ContextCompat.registerReceiver(
                this,
                screenCaptureReceiver,
                filter,
                4
        );

        KevinWakeWordService.syncWithPreferences(this);
    }

    @Override
    public void onResume() {
        super.onResume();
        KevinWakeWordService.syncWithPreferences(this);
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
