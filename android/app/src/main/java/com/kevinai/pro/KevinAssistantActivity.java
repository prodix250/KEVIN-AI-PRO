package com.kevinai.pro;

import android.Manifest;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.CapConfig;
import com.getcapacitor.CapacitorWebView;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginLoadException;
import com.getcapacitor.PluginManager;
import com.getcapacitor.WebViewListener;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class KevinAssistantActivity extends AppCompatActivity {

    private static final int AUDIO_PERMISSION_REQUEST_CODE = 1001;
    private static final int SCREEN_CAPTURE_REQUEST_CODE = 1002;
    private static final int NOTIFICATION_PERMISSION_REQUEST_CODE = 1003;

    private Bridge bridge;
    private KevinAgentBridge agentBridge;
    private FrameLayout overlayRoot;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean waitingForNotificationPermission = false;
    private boolean waitingForInitialCleanCapture = false;
    private boolean cleanCapturePending = false;
    private boolean isOverlayResumed = false;
    private boolean hasPausedWhileCapturing = false;
    private int activityDepth = 0;
    private long pendingWakeId = 0L;
    private String pendingWakeCommand = null;

    private final Runnable cleanCaptureWatchdog = () -> finishCleanBehindCapture(null);

    private final BroadcastReceiver screenCaptureReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null || intent.getAction() == null) return;
            String action = intent.getAction();
            if (ScreenCaptureService.ACTION_CAPTURE_READY.equals(action)) {
                if (waitingForInitialCleanCapture) {
                    waitingForInitialCleanCapture = false;
                    mainHandler.postDelayed(KevinAssistantActivity.this::performCleanBehindCapture, 300L);
                }
            } else if (ScreenCaptureService.ACTION_CLEAN_FRAME_CAPTURED.equals(action)) {
                String frame = intent.getStringExtra(ScreenCaptureService.EXTRA_FRAME);
                finishCleanBehindCapture(frame);
            } else if (ScreenCaptureService.ACTION_SCREEN_FRAME.equals(action)) {
                if (isOverlayResumed
                        || cleanCapturePending
                        || waitingForInitialCleanCapture
                        || ScreenCaptureService.suppressOverlayFrames) {
                    return;
                }
                String frame = intent.getStringExtra(ScreenCaptureService.EXTRA_FRAME);
                if (frame != null) {
                    dispatchScreenFrame(frame);
                }
            } else if (ScreenCaptureService.ACTION_STOP.equals(action)) {
                waitingForInitialCleanCapture = false;
                cancelCleanCaptureAndRestore();
                dispatchScreenSharingState(false);
            } else if (KevinNotificationListenerService.ACTION_WHATSAPP_REPLIED.equals(action)) {
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

        try {
            getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                setShowWhenLocked(true);
                setTurnScreenOn(true);
            } else {
                getWindow().addFlags(
                        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                );
            }
        } catch (Throwable ignored) {}

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.TRANSPARENT);
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        overlayRoot = root;
        ScreenCaptureService.setSuppressOverlayFrames(true);

        CapacitorWebView webView = new CapacitorWebView(this, null);
        webView.setId(com.getcapacitor.android.R.id.webview);
        webView.setBackgroundColor(Color.TRANSPARENT);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(root);

        requestMissingRuntimePermissions();

        PluginManager loader = new PluginManager(getAssets());
        List<Class<? extends Plugin>> filteredPlugins = new ArrayList<>();
        try {
            for (Class<? extends Plugin> pluginClass : loader.loadPluginClasses()) {
                if (!pluginClass.getSimpleName().contains("SplashScreen")) {
                    filteredPlugins.add(pluginClass);
                }
            }
        } catch (PluginLoadException ex) {
            Logger.error("Error loading plugins for assistant overlay.", ex);
        }

        CapConfig overlayConfig = new CapConfig.Builder(this)
                .setStartPath("/?assistant=1")
                .setBackgroundColor("#00000000")
                .create();

        bridge = new Bridge.Builder(this)
                .setInstanceState(savedInstanceState)
                .setPlugins(filteredPlugins)
                .setConfig(overlayConfig)
                .create();

        WebView bridgeWebView = bridge.getWebView();
        bridgeWebView.setBackgroundColor(Color.TRANSPARENT);
        bridgeWebView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        bridgeWebView.setWebChromeClient(new BridgeWebChromeClient(bridge) {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    try {
                        request.grant(request.getResources());
                    } catch (Throwable ignored) {}
                });
            }
        });

        bridge.addWebViewListener(new WebViewListener() {
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

        agentBridge = new KevinAgentBridge(this, bridgeWebView);
        bridgeWebView.addJavascriptInterface(new OverlayBridge(), "KevinOverlayBridge");
        bridgeWebView.addJavascriptInterface(new ScreenCaptureBridge(), "KevinScreenCapture");
        bridgeWebView.addJavascriptInterface(agentBridge, "KevinAgentBridge");

        IntentFilter filter = new IntentFilter();
        filter.addAction(ScreenCaptureService.ACTION_CAPTURE_READY);
        filter.addAction(ScreenCaptureService.ACTION_CLEAN_FRAME_CAPTURED);
        filter.addAction(ScreenCaptureService.ACTION_SCREEN_FRAME);
        filter.addAction(ScreenCaptureService.ACTION_STOP);
        filter.addAction(KevinNotificationListenerService.ACTION_WHATSAPP_REPLIED);
        ContextCompat.registerReceiver(this, screenCaptureReceiver, filter, 4);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                dismissOverlay();
            }
        });

        if (getIntent() != null) {
            bridge.onNewIntent(getIntent());
            handleWakeWordIntent(getIntent());
        }
    }

    private void handleWakeWordIntent(Intent intent) {
        if (intent == null) return;
        if (!intent.getBooleanExtra(KevinWakeWordService.EXTRA_WAKE_WORD_TRIGGERED, false)) return;
        final String command = intent.getStringExtra(KevinWakeWordService.EXTRA_WAKE_COMMAND);
        intent.removeExtra(KevinWakeWordService.EXTRA_WAKE_WORD_TRIGGERED);
        intent.removeExtra(KevinWakeWordService.EXTRA_WAKE_COMMAND);

        try {
            android.app.NotificationManager nm = getSystemService(android.app.NotificationManager.class);
            if (nm != null) {
                nm.cancel(KevinWakeWordService.TRIGGER_NOTIFICATION_ID);
            }
        } catch (Throwable ignored) {}

        final long wakeId = System.currentTimeMillis();
        pendingWakeId = wakeId;
        pendingWakeCommand = command != null ? command : "";

        if (bridge == null || bridge.getWebView() == null) return;
        final String quotedCmd = JSONObject.quote(pendingWakeCommand);
        final String js = "try{window.__kevinPendingWakeWord={id:" + wakeId + ",command:" + quotedCmd
                + "};window.dispatchEvent(new CustomEvent('kevinWakeWordTriggered',{detail:{id:"
                + wakeId + ",command:" + quotedCmd + "}}));}catch(e){}";
        long[] delays = new long[] { 120L, 420L, 900L, 1600L, 2600L };
        for (long delay : delays) {
            mainHandler.postDelayed(() -> {
                if (pendingWakeId == wakeId && bridge != null && bridge.getWebView() != null) {
                    bridge.getWebView().evaluateJavascript(js, null);
                }
            }, delay);
        }
    }

    private void requestMissingRuntimePermissions() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED
                || ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
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
    }

    private void requestScreenCapture() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
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
        try {
            MediaProjectionManager manager =
                    (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
            if (manager == null) {
                dispatchScreenSharingState(false);
                return;
            }
            startActivityForResult(manager.createScreenCaptureIntent(), SCREEN_CAPTURE_REQUEST_CODE);
        } catch (Throwable ignored) {
            dispatchScreenSharingState(false);
        }
    }

    private void stopScreenCapture() {
        waitingForInitialCleanCapture = false;
        cancelCleanCaptureAndRestore();
        try {
            Intent intent = new Intent(this, ScreenCaptureService.class)
                    .setAction(ScreenCaptureService.ACTION_STOP);
            startService(intent);
        } catch (Throwable ignored) {}
    }

    private void setAssistantWindowHidden(boolean hidden) {
        try {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            if (hidden) {
                getWindow().clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
                lp.dimAmount = 0f;
                lp.alpha = 0f;
                getWindow().setAttributes(lp);
                getWindow().getDecorView().setAlpha(0f);
                if (bridge != null && bridge.getWebView() != null) {
                    bridge.getWebView().setAlpha(0f);
                    bridge.getWebView().setVisibility(View.INVISIBLE);
                }
                if (overlayRoot != null) {
                    overlayRoot.setAlpha(0f);
                    overlayRoot.setVisibility(View.INVISIBLE);
                }
            } else {
                if (overlayRoot != null) {
                    overlayRoot.setVisibility(View.VISIBLE);
                    overlayRoot.setAlpha(1f);
                }
                if (bridge != null && bridge.getWebView() != null) {
                    bridge.getWebView().setVisibility(View.VISIBLE);
                    bridge.getWebView().setAlpha(1f);
                }
                getWindow().getDecorView().setAlpha(1f);
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
                lp.dimAmount = 0.42f;
                lp.alpha = 1f;
                getWindow().setAttributes(lp);
            }
        } catch (Throwable ignored) {}
    }

    private void performCleanBehindCapture() {
        if (!ScreenCaptureService.isCaptureRunning
                || cleanCapturePending
                || overlayRoot == null
                || isFinishing()
                || isDestroyed()) {
            return;
        }
        cleanCapturePending = true;
        ScreenCaptureService.setSuppressOverlayFrames(true);
        setAssistantWindowHidden(true);
        ScreenCaptureService.beginCleanCaptureWindow(75L, 150L);
        mainHandler.removeCallbacks(cleanCaptureWatchdog);
        mainHandler.postDelayed(cleanCaptureWatchdog, 480L);
    }

    private void finishCleanBehindCapture(String capturedFrame) {
        mainHandler.removeCallbacks(cleanCaptureWatchdog);
        String fallback = ScreenCaptureService.finishCleanCaptureWindow();
        ScreenCaptureService.setSuppressOverlayFrames(!isFinishing() && !isDestroyed());
        setAssistantWindowHidden(false);
        cleanCapturePending = false;

        String frameToSend = (capturedFrame != null && !capturedFrame.isEmpty()) ? capturedFrame : fallback;
        if (frameToSend != null && !frameToSend.isEmpty()) {
            dispatchScreenFrame(frameToSend);
        }
    }

    private void cancelCleanCaptureAndRestore() {
        mainHandler.removeCallbacks(cleanCaptureWatchdog);
        ScreenCaptureService.finishCleanCaptureWindow();
        setAssistantWindowHidden(false);
        cleanCapturePending = false;
    }

    private void openFullApp() {
        try {
            Intent intent = new Intent(this, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(intent);
        } catch (Throwable ignored) {}
        finish();
    }

    private void dismissOverlay() {
        waitingForInitialCleanCapture = false;
        cancelCleanCaptureAndRestore();
        ScreenCaptureService.setSuppressOverlayFrames(false);
        if (ScreenCaptureService.isCaptureRunning) {
            stopScreenCapture();
        }
        finish();
    }

    private void dispatchWhatsAppAutoReply(String sender, String incoming, String reply) {
        if (bridge == null || bridge.getWebView() == null) return;
        try {
            JSONObject payload = new JSONObject();
            payload.put("sender", sender != null ? sender : "");
            payload.put("incoming", incoming != null ? incoming : "");
            payload.put("reply", reply != null ? reply : "");
            String quoted = JSONObject.quote(payload.toString());
            bridge.getWebView().post(() ->
                    bridge.getWebView().evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('kevinWhatsAppAutoReplied', { detail: JSON.parse(" + quoted + ") }))",
                            null
                    )
            );
        } catch (Exception ignored) {}
    }

    private void dispatchScreenFrame(String frame) {
        if (bridge == null || bridge.getWebView() == null) return;
        String safeFrame = JSONObject.quote(frame);
        bridge.getWebView().post(() ->
                bridge.getWebView().evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('screenCaptured', { detail: { base64Image: "
                                + safeFrame
                                + " } }))",
                        null
                )
        );
    }

    private void dispatchScreenSharingState(boolean active) {
        if (bridge == null || bridge.getWebView() == null) return;
        bridge.getWebView().post(() ->
                bridge.getWebView().evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('screenSharingState', { detail: { active: "
                                + active + " } }))",
                        null
                )
        );
    }

    private final class OverlayBridge {
        @JavascriptInterface
        public boolean isOverlay() {
            return true;
        }

        @JavascriptInterface
        public void dismissAssistant() {
            runOnUiThread(KevinAssistantActivity.this::dismissOverlay);
        }

        @JavascriptInterface
        public void openFullApp() {
            runOnUiThread(KevinAssistantActivity.this::openFullApp);
        }

        @JavascriptInterface
        public String consumePendingWakeWord() {
            if (pendingWakeId == 0L) return "";
            try {
                JSONObject obj = new JSONObject();
                obj.put("id", pendingWakeId);
                obj.put("command", pendingWakeCommand != null ? pendingWakeCommand : "");
                pendingWakeId = 0L;
                pendingWakeCommand = null;
                return obj.toString();
            } catch (Exception e) {
                pendingWakeId = 0L;
                pendingWakeCommand = null;
                return "";
            }
        }
    }

    private final class ScreenCaptureBridge {
        @JavascriptInterface
        public void start() {
            runOnUiThread(KevinAssistantActivity.this::requestScreenCapture);
        }

        @JavascriptInterface
        public void stop() {
            runOnUiThread(KevinAssistantActivity.this::stopScreenCapture);
        }

        @JavascriptInterface
        public void captureCleanFrame() {
            runOnUiThread(KevinAssistantActivity.this::performCleanBehindCapture);
        }
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        super.onSaveInstanceState(outState);
        if (bridge != null) {
            bridge.saveInstanceState(outState);
        }
    }

    @Override
    protected void onStart() {
        super.onStart();
        activityDepth++;
        if (bridge != null) {
            bridge.onStart();
        }
    }

    @Override
    protected void onRestart() {
        super.onRestart();
        if (bridge != null) {
            bridge.onRestart();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        isOverlayResumed = true;
        KevinWakeWordService.setOverlayVisible(true);
        KevinWakeWordService.pauseListening(this);
        ScreenCaptureService.setSuppressOverlayFrames(true);
        if (bridge != null) {
            bridge.getApp().fireStatusChange(true);
            bridge.onResume();
        }
        boolean shouldRefreshBehindFrame = hasPausedWhileCapturing;
        hasPausedWhileCapturing = false;
        if (shouldRefreshBehindFrame
                && ScreenCaptureService.isCaptureRunning
                && !waitingForInitialCleanCapture
                && !cleanCapturePending) {
            mainHandler.postDelayed(this::performCleanBehindCapture, 220L);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        isOverlayResumed = false;
        if (ScreenCaptureService.isCaptureRunning) {
            hasPausedWhileCapturing = true;
        }
        KevinWakeWordService.setOverlayVisible(false);
        cancelCleanCaptureAndRestore();
        ScreenCaptureService.setSuppressOverlayFrames(false);
        if (bridge != null) {
            bridge.onPause();
        }
    }

    @Override
    protected void onStop() {
        super.onStop();
        KevinWakeWordService.setOverlayVisible(false);
        KevinWakeWordService.resumeListening(this);
        if (bridge != null) {
            activityDepth = Math.max(0, activityDepth - 1);
            if (activityDepth == 0) {
                bridge.getApp().fireStatusChange(false);
            }
            bridge.onStop();
        }
    }

    @Override
    protected void onDestroy() {
        isOverlayResumed = false;
        hasPausedWhileCapturing = false;
        waitingForInitialCleanCapture = false;
        KevinWakeWordService.setOverlayVisible(false);
        cancelCleanCaptureAndRestore();
        ScreenCaptureService.setSuppressOverlayFrames(false);
        KevinWakeWordService.resumeListening(this);
        try {
            unregisterReceiver(screenCaptureReceiver);
        } catch (IllegalArgumentException ignored) {}
        super.onDestroy();
        if (bridge != null) {
            bridge.onDestroy();
        }
    }

    @Override
    public void onDetachedFromWindow() {
        super.onDetachedFromWindow();
        if (bridge != null) {
            bridge.onDetachedFromWindow();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (bridge != null && intent != null) {
            bridge.onNewIntent(intent);
            handleWakeWordIntent(intent);
        }
    }

    @Override
    public void onConfigurationChanged(@NonNull Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (bridge != null) {
            bridge.onConfigurationChanged(newConfig);
        }
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode,
            @NonNull String[] permissions,
            @NonNull int[] grantResults
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == KevinAgentBridge.AGENT_PERMISSIONS_REQUEST_CODE && agentBridge != null) {
            agentBridge.dispatchAgentStatus();
            return;
        }
        if (requestCode == NOTIFICATION_PERMISSION_REQUEST_CODE) {
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
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == SCREEN_CAPTURE_REQUEST_CODE) {
            if (resultCode == Activity.RESULT_OK && data != null) {
                ScreenCaptureService.setSuppressOverlayFrames(true);
                waitingForInitialCleanCapture = true;
                Intent serviceIntent = new Intent(this, ScreenCaptureService.class)
                        .setAction(ScreenCaptureService.ACTION_START)
                        .putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, resultCode)
                        .putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, data);
                ContextCompat.startForegroundService(this, serviceIntent);
                dispatchScreenSharingState(true);
            } else {
                waitingForInitialCleanCapture = false;
                dispatchScreenSharingState(false);
            }
        }
    }
}
