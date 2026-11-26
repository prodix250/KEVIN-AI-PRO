package com.kevinai.pro;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Dialog;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.UserAgentMetadata;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class GmailAuthActivity extends AppCompatActivity {

    public static final String EXTRA_AUTH_URL = "auth_url";
    public static final String EXTRA_REDIRECT_PREFIX = "redirect_prefix";
    public static final String EXTRA_EXPECTED_STATE = "expected_state";

    public static final String EXTRA_OK = "ok";
    public static final String EXTRA_CANCELLED = "cancelled";
    public static final String EXTRA_ACCESS_TOKEN = "access_token";
    public static final String EXTRA_SCOPE = "scope";
    public static final String EXTRA_EXPIRES_IN = "expires_in";
    public static final String EXTRA_ERROR = "error";
    public static final String EXTRA_ERROR_DESCRIPTION = "error_description";

    private static final String DEFAULT_REDIRECT_PREFIX =
            "https://gen-lang-client-0381242374.firebaseapp.com/__/auth/handler";
    private static final Pattern CHROME_VERSION_PATTERN =
            Pattern.compile("Chrome/(\\d+\\.\\d+\\.\\d+\\.\\d+)");

    private WebView webView;
    private ProgressBar progressBar;
    private String redirectPrefix;
    private String expectedState;
    private boolean finishedWithResult = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String authUrl = getIntent().getStringExtra(EXTRA_AUTH_URL);
        redirectPrefix = getIntent().getStringExtra(EXTRA_REDIRECT_PREFIX);
        if (TextUtils.isEmpty(redirectPrefix)) {
            redirectPrefix = DEFAULT_REDIRECT_PREFIX;
        }
        expectedState = getIntent().getStringExtra(EXTRA_EXPECTED_STATE);

        if (TextUtils.isEmpty(authUrl)) {
            deliverError("invalid_request", "Missing Google authorization URL.");
            return;
        }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        root.setFitsSystemWindows(true);

        ViewCompat.setOnApplyWindowInsetsListener(root, (v, windowInsets) -> {
            Insets insets = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            v.setPadding(insets.left, insets.top, insets.right, insets.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        // Header bar
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setBackgroundColor(Color.parseColor("#075E54"));
        int padH = dpToPx(16);
        int padV = dpToPx(12);
        header.setPadding(padH, padV, padH, padV);

        TextView titleView = new TextView(this);
        titleView.setText("Injira na Google (Gmail)");
        titleView.setTextColor(Color.WHITE);
        titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        titleView.setSingleLine(true);
        titleView.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(
                0,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                1f
        );
        header.addView(titleView, titleLp);

        Button closeBtn = new Button(this);
        closeBtn.setText("Funga");
        closeBtn.setAllCaps(false);
        closeBtn.setTextColor(Color.WHITE);
        closeBtn.setBackgroundColor(Color.TRANSPARENT);
        closeBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        closeBtn.setMinWidth(0);
        closeBtn.setMinimumWidth(0);
        closeBtn.setPadding(dpToPx(10), dpToPx(6), dpToPx(6), dpToPx(6));
        closeBtn.setOnClickListener(v -> deliverCancelled());
        header.addView(closeBtn);

        root.addView(header, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setIndeterminate(true);
        progressBar.setVisibility(View.VISIBLE);
        root.addView(progressBar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dpToPx(4)
        ));

        webView = new WebView(this);
        configureAuthWebView(webView);
        root.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
        ));

        setContentView(root);
        webView.loadUrl(authUrl);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureAuthWebView(WebView targetWebView) {
        WebSettings settings = targetWebView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);

        String defaultUa = settings.getUserAgentString();
        String chromeFullVersion = extractChromeVersion(defaultUa);
        String chromeMajorVersion = chromeFullVersion.split("\\.")[0];
        String androidRelease = !TextUtils.isEmpty(Build.VERSION.RELEASE) ? Build.VERSION.RELEASE : "13";

        // Match standard mobile Chrome UA (strip WebView "; wv" and "Version/4.0" markers)
        String cleanChromeUa = "Mozilla/5.0 (Linux; Android " + androidRelease + "; K) "
                + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/"
                + chromeFullVersion + " Mobile Safari/537.36";
        settings.setUserAgentString(cleanChromeUa);

        try {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.USER_AGENT_METADATA)) {
                UserAgentMetadata.BrandVersion notABrand = new UserAgentMetadata.BrandVersion.Builder()
                        .setBrand("Not(A:Brand")
                        .setMajorVersion("99")
                        .setFullVersion("99.0.0.0")
                        .build();
                UserAgentMetadata.BrandVersion chromiumBrand = new UserAgentMetadata.BrandVersion.Builder()
                        .setBrand("Chromium")
                        .setMajorVersion(chromeMajorVersion)
                        .setFullVersion(chromeFullVersion)
                        .build();
                UserAgentMetadata.BrandVersion chromeBrand = new UserAgentMetadata.BrandVersion.Builder()
                        .setBrand("Google Chrome")
                        .setMajorVersion(chromeMajorVersion)
                        .setFullVersion(chromeFullVersion)
                        .build();

                UserAgentMetadata metadata = new UserAgentMetadata.Builder()
                        .setBrandVersionList(Arrays.asList(notABrand, chromiumBrand, chromeBrand))
                        .setFullVersion(chromeFullVersion)
                        .setPlatform("Android")
                        .setPlatformVersion(androidRelease)
                        .setMobile(true)
                        .build();
                WebSettingsCompat.setUserAgentMetadata(settings, metadata);
            }
        } catch (Throwable ignored) {}

        try {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.REQUESTED_WITH_HEADER_ALLOW_LIST)) {
                WebSettingsCompat.setRequestedWithHeaderOriginAllowList(settings, Collections.emptySet());
            }
        } catch (Throwable ignored) {}

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(targetWebView, true);

        targetWebView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request == null || request.getUrl() == null) return false;
                return handlePotentialCallbackUrl(request.getUrl().toString());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handlePotentialCallbackUrl(url);
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                if (handlePotentialCallbackUrl(url)) {
                    view.stopLoading();
                    return;
                }
                if (progressBar != null) {
                    progressBar.setVisibility(View.VISIBLE);
                }
                super.onPageStarted(view, url, favicon);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (progressBar != null) {
                    progressBar.setVisibility(View.GONE);
                }
                handlePotentialCallbackUrl(url);
                super.onPageFinished(view, url);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request != null && request.isForMainFrame()) {
                    if (progressBar != null) {
                        progressBar.setVisibility(View.GONE);
                    }
                    String reqUrl = request.getUrl() != null ? request.getUrl().toString() : "";
                    if (reqUrl.startsWith(redirectPrefix)) {
                        handlePotentialCallbackUrl(reqUrl);
                    }
                }
            }
        });

        targetWebView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(
                    WebView view,
                    boolean isDialog,
                    boolean isUserGesture,
                    Message resultMsg
            ) {
                if (resultMsg == null) return false;
                WebView childWebView = new WebView(GmailAuthActivity.this);
                configureAuthWebView(childWebView);
                Dialog popupDialog = new Dialog(GmailAuthActivity.this);
                popupDialog.setContentView(childWebView);
                if (popupDialog.getWindow() != null) {
                    popupDialog.getWindow().setLayout(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                    );
                }
                childWebView.setWebChromeClient(new WebChromeClient() {
                    @Override
                    public void onCloseWindow(WebView window) {
                        popupDialog.dismiss();
                    }
                });
                childWebView.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                        if (req != null && req.getUrl() != null && handlePotentialCallbackUrl(req.getUrl().toString())) {
                            popupDialog.dismiss();
                            return true;
                        }
                        return false;
                    }
                });
                popupDialog.show();
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(childWebView);
                resultMsg.sendToTarget();
                return true;
            }
        });
    }

    private String extractChromeVersion(String defaultUa) {
        if (!TextUtils.isEmpty(defaultUa)) {
            Matcher matcher = CHROME_VERSION_PATTERN.matcher(defaultUa);
            if (matcher.find()) {
                String found = matcher.group(1);
                if (!TextUtils.isEmpty(found)) {
                    return found;
                }
            }
        }
        return "131.0.6778.200";
    }

    private boolean handlePotentialCallbackUrl(String url) {
        if (finishedWithResult || TextUtils.isEmpty(url)) {
            return false;
        }
        if (!url.startsWith(redirectPrefix)) {
            return false;
        }

        Map<String, String> params = new LinkedHashMap<>();
        try {
            Uri uri = Uri.parse(url);
            String query = uri.getEncodedQuery();
            if (!TextUtils.isEmpty(query)) {
                parseFormEncodedInto(query, params);
            }
            int hashIdx = url.indexOf('#');
            if (hashIdx >= 0 && hashIdx + 1 < url.length()) {
                parseFormEncodedInto(url.substring(hashIdx + 1), params);
            }
        } catch (Exception ignored) {}

        String error = params.get("error");
        String errorDescription = params.get("error_description");
        String accessToken = params.get("access_token");
        String scope = params.get("scope");
        String expiresIn = params.get("expires_in");
        String state = params.get("state");

        if (!TextUtils.isEmpty(expectedState) && !TextUtils.isEmpty(state) && !expectedState.equals(state)) {
            deliverError("state_mismatch", "Google OAuth state verification failed.");
            return true;
        }

        if (!TextUtils.isEmpty(error)) {
            if ("access_denied".equalsIgnoreCase(error)) {
                deliverCancelled();
            } else {
                deliverError(error, !TextUtils.isEmpty(errorDescription) ? errorDescription : error);
            }
            return true;
        }

        if (!TextUtils.isEmpty(accessToken)) {
            if (!TextUtils.isEmpty(expectedState) && !expectedState.equals(state)) {
                deliverError("state_mismatch", "Google OAuth state verification failed.");
                return true;
            }
            finishedWithResult = true;
            Intent out = new Intent();
            out.putExtra(EXTRA_OK, true);
            out.putExtra(EXTRA_ACCESS_TOKEN, accessToken);
            out.putExtra(EXTRA_SCOPE, scope != null ? scope : "");
            out.putExtra(EXTRA_EXPIRES_IN, expiresIn != null ? expiresIn : "");
            setResult(Activity.RESULT_OK, out);
            finish();
            return true;
        }

        return true;
    }

    private void parseFormEncodedInto(String raw, Map<String, String> target) {
        if (TextUtils.isEmpty(raw)) return;
        String[] pairs = raw.split("&");
        for (String pair : pairs) {
            if (TextUtils.isEmpty(pair)) continue;
            int eq = pair.indexOf('=');
            String rawKey = eq >= 0 ? pair.substring(0, eq) : pair;
            String rawVal = eq >= 0 ? pair.substring(eq + 1) : "";
            try {
                String k = URLDecoder.decode(rawKey, StandardCharsets.UTF_8.name());
                String v = URLDecoder.decode(rawVal, StandardCharsets.UTF_8.name());
                target.put(k, v);
            } catch (Exception ignored) {}
        }
    }

    private void deliverCancelled() {
        if (finishedWithResult) return;
        finishedWithResult = true;
        Intent out = new Intent();
        out.putExtra(EXTRA_OK, false);
        out.putExtra(EXTRA_CANCELLED, true);
        setResult(Activity.RESULT_CANCELED, out);
        finish();
    }

    private void deliverError(String error, String description) {
        if (finishedWithResult) return;
        finishedWithResult = true;
        Intent out = new Intent();
        out.putExtra(EXTRA_OK, false);
        out.putExtra(EXTRA_CANCELLED, false);
        out.putExtra(EXTRA_ERROR, error != null ? error : "auth_error");
        out.putExtra(EXTRA_ERROR_DESCRIPTION, description != null ? description : "");
        setResult(Activity.RESULT_OK, out);
        finish();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        deliverCancelled();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private int dpToPx(int dp) {
        return Math.round(dp * getResources().getDisplayMetrics().density);
    }
}
