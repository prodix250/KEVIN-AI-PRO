package com.kevinai.pro;

import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class KevinAssistantActivity extends BridgeActivity {

    private KevinAgentBridge agentBridge;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        setTheme(R.style.Theme_KevinAssistantOverlay);
        super.onCreate(savedInstanceState);

        getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));

        WebView webView = getBridge().getWebView();
        webView.setBackgroundColor(Color.TRANSPARENT);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        webView.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }
        });

        agentBridge = new KevinAgentBridge(this, webView);
        webView.addJavascriptInterface(agentBridge, "KevinAgentBridge");
        webView.addJavascriptInterface(new OverlayBridge(), "KevinOverlayBridge");

        String localUrl = getBridge().getLocalUrl();
        if (localUrl != null) {
            String target = localUrl.contains("?")
                    ? localUrl + "&assistant=1"
                    : localUrl + "/?assistant=1";
            webView.post(() -> webView.loadUrl(target));
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == KevinAgentBridge.AGENT_PERMISSIONS_REQUEST_CODE && agentBridge != null) {
            agentBridge.dispatchAgentStatus();
        }
    }

    private final class OverlayBridge {
        @JavascriptInterface
        public boolean isOverlay() {
            return true;
        }

        @JavascriptInterface
        public void dismissAssistant() {
            runOnUiThread(() -> {
                finish();
                overridePendingTransition(0, android.R.anim.fade_out);
            });
        }

        @JavascriptInterface
        public void openFullApp() {
            runOnUiThread(() -> {
                Intent intent = new Intent(KevinAssistantActivity.this, MainActivity.class);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                startActivity(intent);
                finish();
            });
        }
    }
}
